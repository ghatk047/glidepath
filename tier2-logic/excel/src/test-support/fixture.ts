import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import type { InputValueRow } from '@glidepath/domain';
import {
  seedToTenantData,
  type InputValue,
  type ModelBundle,
  type TenantMembers,
  type TenantSeed,
} from '@glidepath/spec';
import { ExcelTemplateSchema, type ExcelTemplate } from '@glidepath/spec/generated';
import { loadModelBundleFromDir, readTenantSeed } from '@glidepath/spec/node';
import {
  buildReport,
  buildTemplate,
  buildWorkbook,
  columnHeader,
  diff,
  parseWorkbook,
  validateParsed,
  writeWorkbook,
  type BuiltReport,
  type ExportMeta,
  type ExportSnapshot,
  type ExportValues,
  type ReportOptions,
  type SheetDef,
  type ValidationBundle,
} from '../index';

/**
 * Shared set-up of the report and toChangeset tests: an export of the AA seed (scenarios A and C), helpers to edit
 * the workbook the way a user does, and the import pipeline up to the report.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const specDir = join(here, '../../../../docs/spec');
const NOW = new Date(Date.UTC(2026, 11, 4, 9, 5, 59));

export interface Fixture {
  readonly template: ExcelTemplate;
  readonly model: ModelBundle;
  readonly members: TenantMembers;
  readonly defs: SheetDef[];
  readonly values: ExportValues;
  readonly meta: ExportMeta;
  readonly snapshot: ExportSnapshot;
  readonly bytes: Uint8Array;
  readonly scenarios: { id: string; label: string }[];
  readonly vb: ValidationBundle;
}

const rowsOf = (v: Readonly<Record<string, InputValue>>): InputValueRow[] =>
  Object.entries(v).flatMap(([var_key, value]) =>
    typeof value === 'number'
      ? [{ var_key, member_key: '', value }]
      : Object.entries(value).map(([member_key, n]) => ({ var_key, member_key, value: n })),
  );

export async function makeFixture(): Promise<Fixture> {
  const template = ExcelTemplateSchema.parse(
    JSON.parse(readFileSync(join(specDir, 'excel_template.json'), 'utf8')),
  );
  const model = await loadModelBundleFromDir(specDir);
  const seed: TenantSeed = await readTenantSeed(join(specDir, 'seed/aa'));
  const members = seedToTenantData(seed, 'C', model).members;
  const defs = buildTemplate(template, model, members);
  const scenarios = ['A', 'C'].map((id) => {
    const s = seed.scenarios.scenarios.find((x) => x.id === id);
    if (s === undefined) throw new Error(`no scenario ${id}`);
    return { id, label: s.label };
  });
  // The AA seed holds a few values outside the registry's min/max: start from an export that is inside them.
  const bounds = new Map(model.variables.map((v) => [v.id, v]));
  const inside = (rows: InputValueRow[]): InputValueRow[] =>
    rows.map((r) => {
      const { min = null, max = null } = bounds.get(r.var_key) ?? {};
      return { ...r, value: Math.min(max ?? Infinity, Math.max(min ?? -Infinity, r.value)) };
    });
  const values: ExportValues = {
    defaults: inside(rowsOf(seed.variableValues)),
    scenarios: scenarios.map(({ id, label }) => ({
      id,
      label,
      values: inside(rowsOf(seed.scenarios.scenarios.find((x) => x.id === id)?.values ?? {})),
      overrides: [{ node_key: 'res.net', member_key: '', value: 12.5, reason: 'board pin' }],
    })),
    notes: [{ var_key: 'g.target_net', member_key: '', note: 'agreed with finance' }],
  };
  const meta: ExportMeta = {
    tenantId: seed.tenant.id,
    tenantSlug: 'aa',
    modelVersion: 'mv-test',
    templateVersion: template.template_version,
    exportJobId: 'exp-0001',
    exportedAt: NOW,
    exportedBy: 'user-1',
  };
  const built = buildWorkbook(defs, values, meta);
  return {
    template,
    model,
    members,
    defs,
    values,
    meta,
    snapshot: built.snapshot,
    bytes: await writeWorkbook(built.workbook),
    scenarios,
    vb: {
      sheets: defs,
      model,
      members,
      current: {
        defaults: values.defaults,
        scenarios: Object.fromEntries(values.scenarios.map((s) => [s.id, s.values])),
      },
    },
  };
}

export async function freshBook(fx: Fixture): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(fx.bytes as unknown as ArrayBuffer);
  return book;
}

export const sheetOf = (book: ExcelJS.Workbook, name: string): ExcelJS.Worksheet => {
  const ws = book.getWorksheet(name);
  if (ws === undefined) throw new Error(`no sheet ${name}`);
  return ws;
};

/** Header text of a column id; per-scenario columns for the scenario at `index` of the export. */
export function header(fx: Fixture, sheet: string, columnId: string, index?: number): string {
  const col = fx.defs.find((d) => d.name === sheet)?.columns.find((c) => c.id === columnId);
  if (col === undefined) throw new Error(`${sheet}: no column ${columnId}`);
  return columnHeader(col, index === undefined ? undefined : fx.values.scenarios[index]);
}

function colOf(ws: ExcelJS.Worksheet, text: string): number {
  for (let c = 1; c <= ws.columnCount; c += 1) if (ws.getCell(1, c).value === text) return c;
  throw new Error(`${ws.name}: no column '${text}'`);
}

/** The row of an input sheet (key, member) or of a table sheet (key only: member '' matches a blank member column). */
export function rowOf(ws: ExcelJS.Worksheet, key: string, member = ''): number {
  for (let r = 2; r <= ws.rowCount; r += 1)
    if (ws.getCell(r, 1).value === key && (ws.getCell(r, 2).value ?? '') === member) return r;
  for (let r = 2; r <= ws.rowCount; r += 1) if (ws.getCell(r, 1).value === key) return r;
  throw new Error(`${ws.name}: no row ${key}|${member}`);
}

/** Write `value` in the cell of row (key, member) under the header `text`. */
export function put(
  book: ExcelJS.Workbook,
  sheet: string,
  key: string,
  member: string,
  text: string,
  value: ExcelJS.CellValue,
): number {
  const ws = sheetOf(book, sheet);
  const r = rowOf(ws, key, member);
  ws.getCell(r, colOf(ws, text)).value = value;
  return r;
}

/** First blank row below the data (table sheets have spare rows there). */
export function spareRow(ws: ExcelJS.Worksheet): number {
  for (let r = 2; r <= ws.rowCount + 1; r += 1) {
    let blank = true;
    for (let c = 1; c <= ws.columnCount; c += 1) if (ws.getCell(r, c).value !== null) blank = false;
    if (blank) return r;
  }
  return ws.rowCount + 1;
}

export const putAt = (
  ws: ExcelJS.Worksheet,
  row: number,
  text: string,
  value: ExcelJS.CellValue,
): void => {
  ws.getCell(row, colOf(ws, text)).value = value;
};

/** The app's values since the export: `[var, member, value]` defaults and `[scenario, var, member, value]` scenario values. */
export function appValues(
  fx: Fixture,
  edits: { defaults?: [string, string, number][]; scenarios?: [string, string, string, number][] },
): ExportValues {
  const setRow = (
    rows: readonly InputValueRow[],
    var_key: string,
    member_key: string,
    value: number,
  ): InputValueRow[] => [
    ...rows.filter((r) => !(r.var_key === var_key && r.member_key === member_key)),
    { var_key, member_key, value },
  ];
  return {
    ...fx.values,
    defaults: (edits.defaults ?? []).reduce(
      (rows, [v, m, x]) => setRow(rows, v, m, x),
      fx.values.defaults,
    ),
    scenarios: fx.values.scenarios.map((s) => ({
      ...s,
      values: (edits.scenarios ?? [])
        .filter(([id]) => id === s.id)
        .reduce((rows, [, v, m, x]) => setRow(rows, v, m, x), s.values),
    })),
  };
}

/** Import pipeline up to the report: parse, validate, diff against the app (default: unchanged since the export), report. */
export async function report(
  fx: Fixture,
  book: ExcelJS.Workbook,
  app: ExportValues = fx.values,
  options: ReportOptions = {},
): Promise<BuiltReport> {
  const bytes = new Uint8Array(await book.xlsx.writeBuffer());
  const W = await parseWorkbook(bytes, fx.defs, { scenarios: fx.scenarios });
  const D = buildWorkbook(fx.defs, app, fx.meta).snapshot;
  const vb: ValidationBundle = {
    ...fx.vb,
    current: {
      defaults: app.defaults,
      scenarios: Object.fromEntries(app.scenarios.map((s) => [s.id, s.values])),
    },
  };
  return buildReport(diff(fx.snapshot, W, D, fx.defs), validateParsed(W, vb), {
    exportJobId: fx.meta.exportJobId,
    ...options,
  });
}
