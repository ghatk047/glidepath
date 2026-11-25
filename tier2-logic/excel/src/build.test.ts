import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
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
  BuildError,
  DEFAULT_FILE_NAME_PATTERN,
  EDITABLE_FILL,
  NEW_ROW_SLOTS,
  buildTemplate,
  buildWorkbook,
  columnHeader,
  excelNumberFormat,
  exportFileName,
  hashRow,
  rowKey,
  scenarioColumnId,
  snapshotKey,
  writeWorkbook,
  type ExportMeta,
  type ExportValues,
  type SheetDef,
  type SnapshotValue,
} from './index';

const here = dirname(fileURLToPath(import.meta.url));
const specDir = join(here, '../../../docs/spec');

let template: ExcelTemplate;
let bundle: ModelBundle;
let seed: TenantSeed;
let members: TenantMembers;
let defs: SheetDef[];
let values: ExportValues;
let meta: ExportMeta;
let book: ExcelJS.Workbook;
let snapshot: Awaited<ReturnType<typeof buildOnce>>['snapshot'];
let fileName: string;

const NOW = new Date(Date.UTC(2026, 11, 4, 9, 5, 59));

const rowsOf = (v: Readonly<Record<string, InputValue>>): InputValueRow[] =>
  Object.entries(v).flatMap(([var_key, value]) =>
    typeof value === 'number'
      ? [{ var_key, member_key: '', value }]
      : Object.entries(value).map(([member_key, n]) => ({ var_key, member_key, value: n })),
  );

function exportValues(scenarioIds: readonly string[]): ExportValues {
  return {
    defaults: rowsOf(seed.variableValues),
    scenarios: scenarioIds.map((id) => {
      const s = seed.scenarios.scenarios.find((x) => x.id === id);
      if (s === undefined) throw new Error(`no scenario ${id}`);
      return {
        id,
        label: s.label,
        values: rowsOf(s.values),
        overrides: [{ node_key: 'res.net', member_key: '', value: 12.5, reason: 'board pin' }],
        outputs: [{ node_key: 'res.net', member_key: '', value: 119.3 }],
      };
    }),
    notes: [{ var_key: 'g.target_net', member_key: '', note: 'agreed with finance' }],
  };
}

async function buildOnce(v: ExportValues, m: ExportMeta, d: SheetDef[] = defs) {
  const built = buildWorkbook(d, v, m);
  const bytes = await writeWorkbook(built.workbook);
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(bytes as unknown as ArrayBuffer);
  return { ...built, bytes, read };
}

const sheet = (name: string): ExcelJS.Worksheet => {
  const ws = book.getWorksheet(name);
  if (ws === undefined) throw new Error(`no sheet ${name}`);
  return ws;
};
const defOf = (name: string): SheetDef => {
  const d = defs.find((x) => x.name === name);
  if (d === undefined) throw new Error(`no def ${name}`);
  return d;
};

/** 1-based column of a header text in row 1. */
function colOf(ws: ExcelJS.Worksheet, header: string): number {
  for (let c = 1; c <= ws.columnCount; c += 1) if (ws.getCell(1, c).value === header) return c;
  throw new Error(`${ws.name}: no column '${header}'`);
}
/** 1-based row of the first row whose hidden key (col 1) and member (col 2) match. */
function rowOf(ws: ExcelJS.Worksheet, key: string, member = ''): number {
  for (let r = 2; r <= ws.rowCount; r += 1) {
    if (ws.getCell(r, 1).value === key && (ws.getCell(r, 2).value ?? '') === member) return r;
  }
  throw new Error(`${ws.name}: no row ${key}|${member}`);
}
interface Protection {
  sheet?: boolean;
  sort?: boolean;
  autoFilter?: boolean;
  hashValue?: string;
  saltValue?: string;
  algorithmName?: string;
}
// ExcelJS has these on the object but not in its typings.
const protectionOf = (ws: ExcelJS.Worksheet): Protection | undefined =>
  (ws as unknown as { sheetProtection?: Protection }).sheetProtection;
const argb = (cell: ExcelJS.Cell): string | undefined =>
  cell.fill?.type === 'pattern' ? cell.fill.fgColor?.argb : undefined;
/** OOXML default: a cell is locked unless its style says otherwise. */
const isLocked = (cell: ExcelJS.Cell): boolean => cell.protection?.locked !== false;

beforeAll(async () => {
  template = ExcelTemplateSchema.parse(
    JSON.parse(readFileSync(join(specDir, 'excel_template.json'), 'utf8')),
  );
  bundle = await loadModelBundleFromDir(specDir);
  seed = await readTenantSeed(join(specDir, 'seed/aa'));
  members = seedToTenantData(seed, 'C', bundle).members;
  defs = buildTemplate(template, bundle, members);
  values = exportValues(['A', 'C']);
  meta = {
    tenantId: seed.tenant.id,
    tenantSlug: 'aa',
    modelVersion: 'mv-test',
    templateVersion: template.template_version,
    exportJobId: 'exp-0001',
    exportedAt: NOW,
    exportedBy: 'user-1',
  };
  const built = await buildOnce(values, meta);
  book = built.read;
  snapshot = built.snapshot;
  fileName = built.fileName;
});

describe('buildWorkbook: workbook, snapshot, row hashes', () => {
  it('returns an ExcelJS workbook with the 13 sheets and an export snapshot (sheet/key/member/column -> value) with row sha256 hashes', () => {
    expect(book.worksheets.map((w) => w.name)).toEqual(defs.map((d) => d.name));

    // Scalar cell: Targets / g.target_net / default and per-scenario columns.
    const cell = (column: string): SnapshotValue | undefined =>
      snapshot.cells[snapshotKey('Targets', 'g.target_net', '', column)];
    expect(cell('default')).toBe(seed.variableValues['g.target_net']);
    expect(cell(scenarioColumnId('scenario', 'C'))).toBe(
      (seed.scenarios.scenarios.find((s) => s.id === 'C')?.values['g.target_net'] as
        number | undefined) ?? null,
    );
    expect(cell('note')).toBe('agreed with finance');
    expect(cell('label')).toBe(bundle.variables.find((v) => v.id === 'g.target_net')?.label);

    // Dimensioned cells: member key in the variable's dims order.
    expect(
      snapshot.cells[snapshotKey('Corporate', 'corp.hc', 'pilots', 'iyear.fy27')] ??
        Object.keys(snapshot.cells).find((k) => k.startsWith('Corporate/')),
    ).toBeDefined();
    expect(snapshot.cells[snapshotKey('Line_Items', 'it_001', 'it_001', 'line.amount')]).toBe(72.6);
    expect(snapshot.cells[snapshotKey('Line_Items', 'it_001', 'it_001', 'pool_id')]).toBe(
      'internal_labour',
    );
    expect(snapshot.cells[snapshotKey('Lever_Timing', 'lever', 'L05', 'lev.start@C')]).toBe(
      rowsOf(seed.variableValues).find((r) => r.var_key === 'lev.start' && r.member_key === 'L05')
        ?.value ?? null,
    );
    // Org_Map: member key 'domain,vp' as stored.
    const org = Object.keys(snapshot.cells).filter((k) => k.startsWith('Org_Map/org.dom_share/'));
    expect(org.length).toBeGreaterThan(0);

    // Row hashes: sha256 hex of the editable cells of the row, equal to the hidden `_hash` cell.
    const ws = sheet('Targets');
    const row = rowOf(ws, 'g.target_net');
    const hash = snapshot.rowHashes[rowKey('Targets', 'g.target_net', '')];
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ws.getCell(row, colOf(ws, '_hash')).value).toBe(hash);
    const editable = defOf('Targets').columns.filter((c) => c.editable);
    const target = defOf('Targets').rows.find((r) => r.key === 'g.target_net');
    const cells = editable.flatMap((c) => {
      if (c.perScenario && target?.scenarioVaries === false) return [];
      const ids = c.perScenario ? ['A', 'C'].map((s) => scenarioColumnId(c.id, s)) : [c.id];
      return ids.map((id): [string, SnapshotValue] => [
        id,
        snapshot.cells[snapshotKey('Targets', 'g.target_net', '', id)] ?? null,
      ]);
    });
    expect(hash).toBe(hashRow(cells));
    expect(snapshot.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(snapshot.rowHashes).length).toBeGreaterThan(300);
    expect(snapshot.scenarioIds).toEqual(['A', 'C']);
    expect(snapshot.exportJobId).toBe('exp-0001');
  });

  it('row hash changes when an editable cell changes and not when a locked one does', () => {
    const base: [string, SnapshotValue][] = [
      ['default', 1],
      ['note', null],
    ];
    expect(hashRow(base)).not.toBe(
      hashRow([
        ['default', 2],
        ['note', null],
      ]),
    );
    expect(hashRow(base)).toBe(
      hashRow([
        ['default', 1],
        ['note', null],
      ]),
    );
  });

  it('repeats per-scenario columns once per scenario in order (scalar sheets, Lever_Timing blocks, Outputs)', () => {
    const lev = sheet('Levers');
    const headers = Array.from({ length: lev.columnCount }, (_, i) => lev.getCell(1, i + 1).value);
    const scenarioCol = defOf('Levers').columns.find((c) => c.perScenario);
    expect(scenarioCol).toBeDefined();
    expect(headers).toContain(values.scenarios[0]?.label);
    expect(headers.indexOf(values.scenarios[0]?.label ?? '')).toBe(
      headers.indexOf(values.scenarios[1]?.label ?? '') - 1,
    );
    const lt = sheet('Lever_Timing');
    const ltHeaders = Array.from({ length: lt.columnCount }, (_, i) =>
      String(lt.getCell(1, i + 1).value),
    );
    const blockCol = defOf('Lever_Timing').columns.find((c) => c.role === 'block');
    expect(blockCol).toBeDefined();
    for (const s of values.scenarios)
      expect(ltHeaders).toContain(columnHeader(blockCol as never, s));
    const out = sheet('Outputs');
    const r = rowOf(out, 'res.net');
    expect(out.getCell(r, colOf(out, 'C. Balanced (recommended)')).value).toBe(119.3);
    expect(Object.keys(snapshot.cells).some((k) => k.startsWith('Outputs/'))).toBe(false);
  });

  it('inherit: a scenario cell without a scenario_value row is blank and null in the snapshot; scenario cells of non-varying rows are locked', () => {
    const blank = Object.entries(snapshot.cells).find(
      ([k, v]) => k.startsWith('Levers/') && k.endsWith('@A') && v === null,
    );
    expect(blank).toBeDefined();
    const fixed = defOf('Targets').rows.find((r) => r.scenarioVaries === false);
    if (fixed !== undefined) {
      const ws = sheet('Targets');
      const cell = ws.getCell(
        rowOf(ws, fixed.key, fixed.member),
        colOf(ws, values.scenarios[0]?.label ?? ''),
      );
      expect(isLocked(cell)).toBe(true);
      expect(argb(cell)).not.toBe(EDITABLE_FILL);
    }
  });

  it('Overrides lists the pins of the first scenario; Line_Items and Overrides get spare unlocked rows', () => {
    const ov = sheet('Overrides');
    expect(ov.getCell(2, colOf(ov, 'Node key')).value).toBe('res.net');
    expect(ov.getCell(2, colOf(ov, 'Reason')).value).toBe('board pin');
    expect(ov.rowCount).toBe(1 + 1 + NEW_ROW_SLOTS);
    const li = sheet('Line_Items');
    const spare = 1 + defOf('Line_Items').rows.length + 1;
    const name = colOf(li, 'Name');
    expect(isLocked(li.getCell(spare, name))).toBe(false);
    expect(argb(li.getCell(spare, name))).toBe(EDITABLE_FILL);
    expect(isLocked(li.getCell(spare, 1))).toBe(true);
    expect(li.getCell(spare, colOf(li, 'Pool id')).dataValidation?.type).toBe('list');
  });
});

describe('buildWorkbook: formatting (reads the buffer back)', () => {
  it('yellow editable fill, locked cells protected without a password, protection on every sheet', () => {
    const ws = sheet('Targets');
    const r = rowOf(ws, 'g.target_net');
    const def = ws.getCell(r, colOf(ws, 'Default'));
    expect(argb(def)).toBe(EDITABLE_FILL);
    expect(isLocked(def)).toBe(false);
    for (const header of ['Input', 'Unit', 'Min', 'Max', 'Source', 'Confidence']) {
      const cell = ws.getCell(r, colOf(ws, header));
      expect(isLocked(cell)).toBe(true);
      expect(argb(cell)).not.toBe(EDITABLE_FILL);
    }
    expect(isLocked(ws.getCell(r, colOf(ws, 'Note')))).toBe(false);
    for (const w of book.worksheets) {
      expect(protectionOf(w)?.sheet).toBe(true);
      const p = protectionOf(w);
      expect(p?.hashValue).toBeUndefined();
      expect(p?.saltValue).toBeUndefined();
      expect(p?.algorithmName).toBeUndefined();
    }
    // Sorting and filtering stay possible on a protected sheet.
    expect(protectionOf(ws)?.sort).toBe(true);
    expect(protectionOf(ws)?.autoFilter).toBe(true);
    // Matrix cells that the row does not carry are locked.
    const org = sheet('Org_Map');
    expect(defOf('Org_Map').rows.some((row) => (row.cells ?? []).length === 1)).toBe(true);
    const scalarRow = defOf('Org_Map').rows.find((row) => row.cells?.length === 1);
    const orow = rowOf(org, scalarRow?.key ?? '', scalarRow?.member ?? '');
    const vpHeader = defOf('Org_Map').columns.find((c) => c.role === 'matrix_col')?.header ?? '';
    expect(isLocked(org.getCell(orow, colOf(org, vpHeader)))).toBe(true);
    expect(argb(org.getCell(orow, colOf(org, vpHeader)))).not.toBe(EDITABLE_FILL);
  });

  it('data validation from min/max (decimal, whole, one-sided), dropdowns from _lists (enum labels, booleans, pools, action)', () => {
    const ws = sheet('Targets');
    const withRange = defOf('Targets').rows.find(
      (row) =>
        row.type === 'number' &&
        row.min !== null &&
        row.min !== undefined &&
        row.max !== null &&
        row.max !== undefined,
    );
    expect(withRange).toBeDefined();
    const dv = ws.getCell(
      rowOf(ws, withRange?.key ?? '', withRange?.member ?? ''),
      colOf(ws, 'Default'),
    ).dataValidation;
    expect(dv).toMatchObject({
      type: 'decimal',
      operator: 'between',
      formulae: [withRange?.min, withRange?.max],
      allowBlank: true,
      showErrorMessage: true,
    });

    // Every editable numeric cell with a min or max has a validation with exactly those limits.
    let checked = 0;
    for (const w of ['Targets', 'Workforce', 'Levers', 'Pools']) {
      const sheetWs = sheet(w);
      for (const row of defOf(w).rows) {
        if (row.type !== 'number' && row.type !== 'int') continue;
        const cell = sheetWs.getCell(
          rowOf(sheetWs, row.key, row.member),
          colOf(sheetWs, 'Default'),
        );
        const rule = cell.dataValidation;
        const lo = row.min ?? null;
        const hi = row.max ?? null;
        if (lo === null && hi === null) {
          expect(rule?.type).toBeUndefined();
          continue;
        }
        expect(rule?.type).toBe(row.type === 'int' ? 'whole' : 'decimal');
        expect(rule?.formulae).toEqual(lo !== null && hi !== null ? [lo, hi] : [lo ?? hi]);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);

    // Dropdowns point into the hidden _lists sheet.
    const lists = defOf('_lists').lists ?? [];
    const range = (id: string, label: boolean): string => {
      const i = lists.findIndex((l) => l.id === id);
      const letter = String.fromCharCode(65 + i * 2 + (label ? 1 : 0));
      return `_lists!$${letter}$2:$${letter}$${(lists[i]?.entries.length ?? 0) + 1}`;
    };
    const boolRow =
      defOf('Targets').rows.find((row) => row.type === 'bool') ??
      defOf('Workforce').rows.find((row) => row.type === 'bool');
    expect(boolRow).toBeDefined();
    const boolSheet = defOf('Targets').rows.includes(boolRow as never) ? 'Targets' : 'Workforce';
    const bws = sheet(boolSheet);
    expect(
      bws.getCell(rowOf(bws, boolRow?.key ?? '', boolRow?.member ?? ''), colOf(bws, 'Default'))
        .dataValidation,
    ).toMatchObject({
      type: 'list',
      formulae: [range('bool', false)],
    });
    const enumRow = defOf('Targets').rows.find((row) => row.type === 'enum');
    expect(enumRow).toBeDefined();
    const eRow = rowOf(ws, enumRow?.key ?? '', enumRow?.member ?? '');
    const eCell = ws.getCell(eRow, colOf(ws, 'Default'));
    expect(eCell.dataValidation.formulae).toEqual([range(enumRow?.listRef ?? '', true)]);
    // The cell shows the dropdown label; the snapshot holds the code.
    const entries = lists.find((l) => l.id === enumRow?.listRef)?.entries ?? [];
    const code = snapshot.cells[snapshotKey('Targets', enumRow?.key ?? '', '', 'default')];
    expect(eCell.value).toBe(entries.find((e) => e.code === code)?.label);
    // _lists really holds the entries.
    const lws = sheet('_lists');
    const first = entries[0];
    const li = lists.findIndex((l) => l.id === enumRow?.listRef);
    expect(lws.getCell(2, li * 2 + 2).value).toBe(first?.label);
    expect(lws.getCell(2, li * 2 + 1).value).toBe(first?.code);

    const items = sheet('Line_Items');
    const spareRow = 1 + defOf('Line_Items').rows.length + 1;
    expect(items.getCell(spareRow, colOf(items, 'Action')).dataValidation).toMatchObject({
      type: 'list',
      formulae: ['"DELETE"'],
    });
    expect(items.getCell(2, colOf(items, 'Pool id')).dataValidation).toMatchObject({
      type: 'list',
      formulae: [range('dim.pool', false)],
    });
    expect(items.getCell(2, colOf(items, 'In scope')).dataValidation).toMatchObject({
      type: 'list',
      formulae: [range('bool', false)],
    });
  });

  it("number formats '%' '$M' 'FTE' 'x' from cell_rules, applied to default, scenario, min and max cells", () => {
    const formats = template.cell_rules.number_formats;
    const seen = new Set<string>();
    for (const w of ['Targets', 'Workforce', 'Levers', 'Pools']) {
      const ws = sheet(w);
      for (const row of defOf(w).rows) {
        if (row.numberFormat === undefined) continue;
        const r = rowOf(ws, row.key, row.member);
        for (const header of ['Default', 'Min', 'Max']) {
          const fmt = ws.getCell(r, colOf(ws, header)).numFmt;
          expect(fmt).toBe(excelNumberFormat(row.numberFormat));
        }
        expect(ws.getCell(r, colOf(ws, values.scenarios[1]?.label ?? '')).numFmt).toBe(
          excelNumberFormat(row.numberFormat),
        );
        seen.add(row.numberFormat);
      }
    }
    for (const key of ['%', '$M', 'FTE', 'x'] as const) expect(seen).toContain(formats[key]);
    expect(excelNumberFormat('0.00x')).toBe('0.00"x"');
    expect(excelNumberFormat('0.0%')).toBe('0.0%');
    expect(excelNumberFormat('0.00"x"')).toBe('0.00"x"');
    // Percentages are decimals.
    const pct = defOf('Targets').rows.find((row) => row.unit.startsWith('%'));
    const ws = sheet('Targets');
    const v = ws.getCell(rowOf(ws, pct?.key ?? '', pct?.member ?? ''), colOf(ws, 'Default')).value;
    expect(typeof v === 'number' && Math.abs(v) <= 1).toBe(true);
    // Line_Items money column and Lever_Timing blocks carry the variable's format and validation.
    const li = sheet('Line_Items');
    const amountHeader =
      defOf('Line_Items').columns.find((c) => c.id === 'line.amount')?.header ?? '';
    expect(li.getCell(2, colOf(li, amountHeader)).numFmt).toBe(excelNumberFormat(formats['$M']));
  });

  it('frozen header rows, key / member / _hash columns hidden, autofilter over the header', () => {
    for (const d of defs) {
      const ws = sheet(d.name);
      const view = ws.views[0];
      expect(view?.state, d.name).toBe('frozen');
      expect((view as { ySplit?: number } | undefined)?.ySplit, d.name).toBe(1);
      const laid = d.columns.filter((c) => !c.perScenario);
      for (const c of laid.filter(
        (x) => x.role === 'key' || x.role === 'member' || x.role === 'hash',
      )) {
        const index = d.columns.findIndex((x) => x.id === c.id) + 1;
        const before = d.columns
          .slice(0, index - 1)
          .reduce((n, x) => n + (x.perScenario ? values.scenarios.length : 1), 0);
        expect(ws.getColumn(before + 1).hidden, `${d.name}.${c.id}`).toBe(true);
      }
    }
    const ws = sheet('Targets');
    for (const header of ['key', 'member', '_hash'])
      expect(ws.getColumn(colOf(ws, header)).hidden).toBe(true);
    expect(ws.getColumn(colOf(ws, 'Input')).hidden).toBeFalsy();
    expect(ws.autoFilter).toBeTruthy();
    expect((ws.views[0] as { xSplit?: number }).xSplit).toBe(colOf(ws, 'Input'));
  });

  it('_meta hidden and protected, _lists hidden, the other eleven sheets visible', () => {
    expect(sheet('_meta').state).toBe('hidden');
    expect(protectionOf(sheet('_meta'))?.sheet).toBe(true);
    expect(sheet('_lists').state).toBe('hidden');
    expect(book.worksheets.filter((w) => w.state === 'visible')).toHaveLength(11);
    const m = sheet('_meta');
    const fields = Object.fromEntries(
      Array.from({ length: m.rowCount - 1 }, (_, i) => [
        m.getCell(i + 2, 1).value,
        m.getCell(i + 2, 2).value,
      ]),
    );
    expect(Object.keys(fields)).toEqual(template.sheets.find((s) => s.name === '_meta')?.fields);
    expect(fields).toMatchObject({
      tenant_id: seed.tenant.id,
      tenant_slug: 'aa',
      model_version: 'mv-test',
      template_version: template.template_version,
      export_job_id: 'exp-0001',
      exported_at: NOW.toISOString(),
      exported_by: 'user-1',
      scenario_keys: 'A,C',
      workbook_checksum: snapshot.checksum,
    });
  });

  it('Org_Map row check: a SUM over the VP cells of the row, shaded when it is not the rule target', () => {
    const org = sheet('Org_Map');
    const row = defOf('Org_Map').rows.find((r) => r.checked === true);
    const r = rowOf(org, row?.key ?? '', row?.member ?? '');
    const check = org.getCell(r, colOf(org, 'Row check'));
    const cellValue = check.value as { formula: string; result: number };
    expect(cellValue.formula).toMatch(/^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/);
    expect(cellValue.result).toBeCloseTo(1, 9);
    expect(isLocked(check)).toBe(true);
    expect(
      (org as unknown as { conditionalFormattings: unknown[] }).conditionalFormattings.length,
    ).toBeGreaterThan(0);
  });
});

describe('buildWorkbook: file name and README', () => {
  it('file name {tenant_slug}_it_savings_{scenario_keys}_{yyyymmdd-hhmm}.xlsx', () => {
    expect(DEFAULT_FILE_NAME_PATTERN).toBe(template.file.name_pattern);
    expect(fileName).toBe('aa_it_savings_A+C_20261204-0905.xlsx');
    expect(
      exportFileName(
        template.file.name_pattern,
        'zz tenant',
        ['C'],
        new Date(Date.UTC(2027, 0, 2, 3, 4)),
      ),
    ).toBe('zz_tenant_it_savings_C_20270102-0304.xlsx');
    expect(
      buildWorkbook(defs, values, { ...meta, fileNamePattern: 'x_{tenant_slug}.xlsx' }).fileName,
    ).toBe('x_aa.xlsx');
  });

  it('README sheet text comes from the template (no tenant prose in code), with export id and time', () => {
    const ws = sheet('README');
    const lines = Array.from(
      { length: ws.rowCount - 1 },
      (_, i) => ws.getCell(i + 2, 1).value,
    ).filter((v): v is string => typeof v === 'string');
    const readme = template.sheets.find((s) => s.name === 'README');
    expect(lines).toContain(readme?.content);
    for (const p of template.principles) expect(lines).toContain(p);
    expect(lines).toContain(template.file.units_note);
    expect(lines).toContain('Export job id: exp-0001');
    expect(lines).toContain(`Exported at: ${NOW.toISOString()}`);
    // Every line is template text or a generated "Field: value" line; nothing names the tenant.
    const templateText = JSON.stringify(template);
    const generated = lines.filter((l) => !templateText.includes(JSON.stringify(l).slice(1, -1)));
    expect(
      generated.every((l) => /^(Editable cells: |Export job id: |Exported at: )/.test(l)),
    ).toBe(true);
    const tenantWords = [seed.tenant.name, seed.tenant.id].filter((w) => w.length > 2);
    for (const w of tenantWords) expect(lines.join('\n')).not.toContain(w);
    const src = readFileSync(join(here, 'build.ts'), 'utf8');
    for (const w of tenantWords) expect(src).not.toContain(w);
    expect(src).not.toMatch(/\b(American|Airlines|AAdvantage)\b/);
  });
});

describe('buildWorkbook: input checks, tenants, styling rules', () => {
  it('rejects no scenario, duplicate scenario ids and a duplicate cell; unknown _meta fields fail', () => {
    expect(() => buildWorkbook(defs, { ...values, scenarios: [] }, meta)).toThrow(BuildError);
    const s = values.scenarios[0];
    if (s === undefined) throw new Error('no scenario');
    expect(() => buildWorkbook(defs, { ...values, scenarios: [s, s] }, meta)).toThrow(
      /duplicate scenario/,
    );
    const dupRow = (d: SheetDef): SheetDef => ({ ...d, rows: [...d.rows, ...d.rows.slice(0, 1)] });
    const dup = defs.map((d) => (d.name === 'Targets' ? dupRow(d) : d));
    expect(() => buildWorkbook(dup, values, meta)).toThrow(/duplicate cell Targets\//);
    const badMeta = defs.map((d) =>
      d.name === '_meta' ? { ...d, fields: [...(d.fields ?? []), 'nope'] } : d,
    );
    expect(() => buildWorkbook(badMeta, values, meta)).toThrow(/no value for field 'nope'/);
    const badReadme = defs.map((d) => (d.name === 'README' ? { ...d, fields: ['nope'] } : d));
    expect(() => buildWorkbook(badReadme, values, meta)).toThrow(/README: no value/);
  });

  it('a tenant with other VPs gets other Org_Map columns; a single scenario and one spare row work', async () => {
    const zz: TenantMembers = {
      ...members,
      vp: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id: `vp_${id}`, label: `VP ${id}` })),
    };
    const zzDefs = buildTemplate(template, bundle, zz);
    const built = await buildOnce(
      { ...exportValues(['C']), defaults: [] },
      { ...meta, tenantSlug: 'zz', newRowSlots: 1 },
      zzDefs,
    );
    const org = built.read.getWorksheet('Org_Map');
    expect(org).toBeDefined();
    const headers = Array.from(
      { length: org?.columnCount ?? 0 },
      (_, i) => org?.getCell(1, i + 1).value,
    );
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(headers).toContain(`VP ${id}`);
    expect(built.fileName.startsWith('zz_it_savings_C_')).toBe(true);
    expect(built.read.getWorksheet('Line_Items')?.rowCount).toBe(
      1 + zzDefs.find((d) => d.name === 'Line_Items')!.rows.length + 1,
    );
    // No defaults at all: every default cell is blank (null), not missing.
    expect(built.snapshot.cells[snapshotKey('Targets', 'g.target_net', '', 'default')]).toBeNull();
  });

  it('uses a neutral palette: no airline colours, logos or typefaces in the styling', async () => {
    const built = await buildOnce(values, meta);
    const fills = new Set<string>();
    const fonts = new Set<string>();
    for (const ws of built.read.worksheets) {
      ws.eachRow((row) =>
        row.eachCell((cell) => {
          const c = argb(cell);
          if (c !== undefined) fills.add(c);
          if (cell.font?.name !== undefined) fonts.add(cell.font.name);
        }),
      );
    }
    expect([...fills].sort()).toEqual(['FFE7E9EC', 'FFFFF2CC']);
    expect(fonts.size).toBeLessThanOrEqual(1);
    for (const ws of built.read.worksheets) expect(ws.getImages()).toHaveLength(0);
    expect(built.read.creator).toBe('Glidepath');
  });
});
