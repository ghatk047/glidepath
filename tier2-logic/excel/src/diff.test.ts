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
  DiffError,
  EXPORT_PRECISION_DIGITS,
  buildTemplate,
  buildWorkbook,
  cellStatus,
  columnHeader,
  diff,
  parseWorkbook,
  rowKey,
  sameValue,
  snapshotKey,
  toDeltaEntry,
  toDiffValue,
  writeWorkbook,
  type CellDiff,
  type CellStatus,
  type CurrentSnapshot,
  type DiffResult,
  type DiffValue,
  type ExportMeta,
  type ExportSnapshot,
  type ExportValues,
  type ParsedWorkbook,
  type SheetDef,
  type SnapshotValue,
} from './index';

const here = dirname(fileURLToPath(import.meta.url));
const specDir = join(here, '../../../docs/spec');
const fixturesDir = join(here, '../fixtures');
const NOW = new Date(Date.UTC(2026, 11, 4, 9, 5, 59));

let template: ExcelTemplate;
let bundle: ModelBundle;
let seed: TenantSeed;
let members: TenantMembers;
let defs: SheetDef[];
let values: ExportValues;
let meta: ExportMeta;
/** E: the export snapshot. */
let snapshot: ExportSnapshot;
let bytes: Uint8Array;
let scenarios: { id: string; label: string }[];

// ----------------------------------------------------------------------------------------------
// Fixtures and helpers
// ----------------------------------------------------------------------------------------------

const rowsOf = (v: Readonly<Record<string, InputValue>>): InputValueRow[] =>
  Object.entries(v).flatMap(([var_key, value]) =>
    typeof value === 'number'
      ? [{ var_key, member_key: '', value }]
      : Object.entries(value).map(([member_key, n]) => ({ var_key, member_key, value: n })),
  );

function exportValues(ids: readonly string[]): ExportValues {
  return {
    defaults: rowsOf(seed.variableValues),
    scenarios: ids.map((id) => {
      const s = seed.scenarios.scenarios.find((x) => x.id === id);
      if (s === undefined) throw new Error(`no scenario ${id}`);
      return {
        id,
        label: s.label,
        values: rowsOf(s.values),
        overrides: [{ node_key: 'res.net', member_key: '', value: 12.5, reason: 'board pin' }],
      };
    }),
    notes: [{ var_key: 'g.target_net', member_key: '', note: 'agreed with finance' }],
  };
}

function setRow(
  rows: readonly InputValueRow[],
  var_key: string,
  member_key: string,
  value: number,
): InputValueRow[] {
  return [
    ...rows.filter((r) => !(r.var_key === var_key && r.member_key === member_key)),
    { var_key, member_key, value },
  ];
}

/** The app's values after edits made since the export: defaults `[var, member, value]`, scenario values `[scenario, var, member, value]`. */
function appValues(edits: {
  defaults?: [string, string, number][];
  scenarios?: [string, string, string, number][];
}): ExportValues {
  return {
    ...values,
    defaults: (edits.defaults ?? []).reduce(
      (rows, [v, m, x]) => setRow(rows, v, m, x),
      values.defaults,
    ),
    scenarios: values.scenarios.map((s) => ({
      ...s,
      values: (edits.scenarios ?? [])
        .filter(([id]) => id === s.id)
        .reduce((rows, [, v, m, x]) => setRow(rows, v, m, x), s.values),
    })),
  };
}

/** D: the current database in the snapshot's form, as the worker builds it. */
const current = (v: ExportValues = values, d: readonly SheetDef[] = defs): CurrentSnapshot =>
  buildWorkbook(d, v, meta).snapshot;

async function freshBook(): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as unknown as ArrayBuffer);
  return book;
}

async function reread(book: ExcelJS.Workbook): Promise<ParsedWorkbook> {
  const out = new Uint8Array(await book.xlsx.writeBuffer());
  return parseWorkbook(out, defs, { scenarios });
}

const defOf = (name: string): SheetDef => {
  const d = defs.find((x) => x.name === name);
  if (d === undefined) throw new Error(`no def ${name}`);
  return d;
};
const sheetOf = (book: ExcelJS.Workbook, name: string): ExcelJS.Worksheet => {
  const ws = book.getWorksheet(name);
  if (ws === undefined) throw new Error(`no sheet ${name}`);
  return ws;
};
/** Header text of a column; per-scenario columns for the scenario at `index`. */
function header(sheet: string, columnId: string, index?: number): string {
  const col = defOf(sheet).columns.find((c) => c.id === columnId);
  if (col === undefined) throw new Error(`${sheet}: no column ${columnId}`);
  return columnHeader(col, index === undefined ? undefined : values.scenarios[index]);
}
function colOf(ws: ExcelJS.Worksheet, text: string): number {
  for (let c = 1; c <= ws.columnCount; c += 1) if (ws.getCell(1, c).value === text) return c;
  throw new Error(`${ws.name}: no column '${text}'`);
}
function rowOf(ws: ExcelJS.Worksheet, key: string, member = ''): number {
  for (let r = 2; r <= ws.rowCount; r += 1)
    if (ws.getCell(r, 1).value === key && (ws.getCell(r, 2).value ?? '') === member) return r;
  throw new Error(`${ws.name}: no row ${key}|${member}`);
}
/** Table sheets: the key in column 1, no member column. */
function tableRowOf(ws: ExcelJS.Worksheet, key: string): number {
  for (let r = 2; r <= ws.rowCount; r += 1) if (ws.getCell(r, 1).value === key) return r;
  throw new Error(`${ws.name}: no row ${key}`);
}
/** First blank row below the data (table sheets have spare rows there). */
function nextFreeRow(ws: ExcelJS.Worksheet): number {
  for (let r = 2; r <= ws.rowCount + 1; r += 1) {
    let blank = true;
    for (let c = 1; c <= ws.columnCount; c += 1) if (ws.getCell(r, c).value !== null) blank = false;
    if (blank) return r;
  }
  return ws.rowCount + 1;
}
const e = (sheet: string, key: string, member: string, column: string): SnapshotValue => {
  const k = snapshotKey(sheet, key, member, column);
  if (!(k in snapshot.cells)) throw new Error(`snapshot has no ${k}`);
  return snapshot.cells[k] ?? null;
};
/** A number different from an exported value. */
const bump = (v: SnapshotValue, by = 1): number => (typeof v === 'number' ? v : 0) + by;

const cellsOf = (r: DiffResult): string[] =>
  r.cells
    .map((c) => `${c.sheet}|${c.column}|${c.key}|${c.member}|${c.scenario ?? '-'}|${c.status}`)
    .sort();

/** An export snapshot rebuilt from a parsed, untouched export (parse reads back every snapshot cell, parse.test.ts). */
function snapshotOf(parsed: ParsedWorkbook): ExportSnapshot {
  const cells: Record<string, SnapshotValue> = {};
  const rowHashes: Record<string, string> = {};
  for (const sheet of parsed.sheets)
    for (const row of sheet.rows) {
      for (const [id, v] of Object.entries(row.cells))
        cells[snapshotKey(sheet.name, row.key, row.member, id)] = v;
      if (row.hash !== null) rowHashes[rowKey(sheet.name, row.key, row.member)] = row.hash;
    }
  return {
    exportJobId: parsed.meta?.exportJobId ?? '',
    templateVersion: parsed.meta?.templateVersion ?? '',
    scenarioIds: parsed.meta?.scenarioKeys ?? [],
    cells,
    rowHashes,
    checksum: parsed.meta?.workbookChecksum ?? '',
  };
}

/** Number cells whose value differs bit for bit between two parses of the same rows. */
function bitwiseNumberChanges(a: ParsedWorkbook, b: ParsedWorkbook): number {
  let n = 0;
  for (const sheet of b.sheets) {
    const other = a.sheets.find((s) => s.name === sheet.name);
    for (const row of sheet.rows) {
      const was = other?.rows.find((r) => r.key === row.key && r.member === row.member);
      for (const [id, v] of Object.entries(row.cells))
        if (typeof v === 'number' && typeof was?.cells[id] === 'number' && was.cells[id] !== v)
          n += 1;
    }
  }
  return n;
}

beforeAll(async () => {
  template = ExcelTemplateSchema.parse(
    JSON.parse(readFileSync(join(specDir, 'excel_template.json'), 'utf8')),
  );
  bundle = await loadModelBundleFromDir(specDir);
  seed = await readTenantSeed(join(specDir, 'seed/aa'));
  members = seedToTenantData(seed, 'C', bundle).members;
  defs = buildTemplate(template, bundle, members);
  values = exportValues(['A', 'C']);
  scenarios = values.scenarios.map(({ id, label }) => ({ id, label }));
  meta = {
    tenantId: seed.tenant.id,
    tenantSlug: 'aa',
    modelVersion: 'mv-test',
    templateVersion: template.template_version,
    exportJobId: 'exp-0001',
    exportedAt: NOW,
    exportedBy: 'user-1',
  };
  const built = buildWorkbook(defs, values, meta);
  snapshot = built.snapshot;
  bytes = await writeWorkbook(built.workbook);
});

// ----------------------------------------------------------------------------------------------
// Acceptance 1: the per-cell three-way table
// ----------------------------------------------------------------------------------------------

describe('diff: per-cell three-way table', () => {
  it('per cell: W=E unchanged; W≠E, D=E changed_in_excel; W=E, D≠E changed_in_app; W≠E, D≠E, W≠D conflict; W≠E, W=D already_applied (test table, all five)', () => {
    const cases: [string, DiffValue, DiffValue, DiffValue, CellStatus][] = [
      // name, E, W, D, status
      ['W=E, D=E', 0.35, 0.35, 0.35, 'unchanged'],
      ['W≠E, D=E', 0.35, 0.4, 0.35, 'changed_in_excel'],
      ['W=E, D≠E', 0.35, 0.35, 0.5, 'changed_in_app'],
      ['W≠E, D≠E, W≠D', 0.35, 0.4, 0.5, 'conflict'],
      ['W≠E, W=D', 0.35, 0.5, 0.5, 'already_applied'],
      // Blank (= inherit the default) is a value like any other.
      ['blank everywhere', null, null, null, 'unchanged'],
      ['cleared in Excel', 0.35, null, 0.35, 'changed_in_excel'],
      ['filled in Excel', null, 0.2, null, 'changed_in_excel'],
      ['cleared in the app', 0.35, 0.35, null, 'changed_in_app'],
      ['cleared in both', 0.35, null, null, 'already_applied'],
      ['cleared in Excel, edited in the app', 0.35, null, 0.5, 'conflict'],
      ['text', 'old', 'mine', 'theirs', 'conflict'],
      ['enum codes', 2, 1, 1, 'already_applied'],
      ['a number never equals a text', 1, '1', 1, 'changed_in_excel'],
      ['re-saved at 15 digits', 0.1 + 0.2, 0.3, 0.1 + 0.2, 'unchanged'],
      ['app value re-saved at 15 digits', 0.3, 0.3, 0.1 + 0.2, 'unchanged'],
    ];
    for (const [name, E, W, D, want] of cases)
      expect([name, cellStatus(E, W, D)]).toEqual([name, want]);
  });

  it('places all five statuses of an exported workbook by variable, member key and scenario', async () => {
    const book = await freshBook();
    const set = (sheet: string, r: number, text: string, v: ExcelJS.CellValue): void => {
      const ws = sheetOf(book, sheet);
      ws.getCell(r, colOf(ws, text)).value = v;
    };
    const tg = sheetOf(book, 'Targets');
    const lv = sheetOf(book, 'Levers');
    const lt = sheetOf(book, 'Lever_Timing');
    const om = sheetOf(book, 'Org_Map');
    const co = sheetOf(book, 'Corporate');
    const li = sheetOf(book, 'Line_Items');
    const ov = sheetOf(book, 'Overrides');

    const cut = e('Levers', 'lev.L01.cut', '', 'scenario@C');
    const gdp = e('Corporate', 'corp.gdp', '', 'iyear.fy26');
    const hc = e('Workforce', 'hc.us', '', 'default');
    // Excel side.
    set(
      'Targets',
      rowOf(tg, 'g.target_net'),
      header('Targets', 'default'),
      bump(e('Targets', 'g.target_net', '', 'default')),
    );
    set(
      'Targets',
      rowOf(tg, 'g.target_net'),
      header('Targets', 'note'),
      'agreed with finance, revised',
    );
    set('Levers', rowOf(lv, 'lev.L01.cut'), header('Levers', 'scenario', 1), bump(cut, 0.01));
    set(
      'Lever_Timing',
      rowOf(lt, 'lever', 'L01'),
      header('Lever_Timing', 'lev.start', 0),
      bump(e('Lever_Timing', 'lever', 'L01', 'lev.start@A')),
    );
    set(
      'Org_Map',
      rowOf(om, 'org.dom_share', 'commercial_applications'),
      header('Org_Map', 'vp.vp_operations'),
      0.25,
    );
    set('Corporate', rowOf(co, 'corp.gdp'), header('Corporate', 'iyear.fy26'), bump(gdp, 0.005));
    set('Line_Items', tableRowOf(li, 'it_001'), header('Line_Items', 'name'), 'Renamed line');
    set(
      'Line_Items',
      tableRowOf(li, 'it_001'),
      header('Line_Items', 'line.amount'),
      bump(e('Line_Items', 'it_001', 'it_001', 'line.amount')),
    );
    set('Overrides', tableRowOf(ov, 'res.net'), header('Overrides', 'value'), 13);
    const W = await reread(book);
    // App side, since the export.
    const D = current(
      appValues({
        defaults: [
          ['hc.us', '', bump(hc, 100)],
          ['corp.gdp', 'fy26', bump(gdp, 0.005)],
        ],
        scenarios: [['C', 'lev.L01.cut', '', bump(cut, 0.02)]],
      }),
    );

    const base = diff(snapshot, await parseWorkbook(bytes, defs, { scenarios }), snapshot, defs);
    const r = diff(snapshot, W, D, defs);
    expect(r.mode).toBe('three_way');
    expect(cellsOf(r)).toEqual(
      [
        'Targets|default|g.target_net||-|changed_in_excel',
        'Targets|note|g.target_net||-|changed_in_excel',
        'Workforce|default|hc.us||-|changed_in_app',
        'Levers|scenario@C|lev.L01.cut||C|conflict',
        'Lever_Timing|lev.start@A|lev.start|L01|A|changed_in_excel',
        'Org_Map|vp.vp_operations|org.dom_share|commercial_applications,vp_operations|-|changed_in_excel',
        'Corporate|iyear.fy26|corp.gdp|fy26|-|already_applied',
        'Line_Items|name|it_001|it_001|-|changed_in_excel',
        'Line_Items|line.amount|line.amount|it_001|-|changed_in_excel',
        'Overrides|value|res.net||A|changed_in_excel',
      ].sort(),
    );
    expect(r.rows).toEqual([]);
    expect(r.unmatched).toEqual([]);
    expect(r.counts).toMatchObject({
      changed_in_excel: 7,
      changed_in_app: 1,
      conflict: 1,
      already_applied: 1,
      new_row: 0,
      deleted_row: 0,
      missing_row: 0,
    });
    // Unchanged cells are counted, not listed: together with the changes they are every editable cell.
    expect(r.counts.unchanged + r.cells.length).toBe(base.counts.unchanged);
    expect(base.counts.unchanged).toBeGreaterThan(3000);

    const byColumn = (sheet: string, column: string): CellDiff => {
      const c = r.cells.find((x) => x.sheet === sheet && x.column === column);
      if (c === undefined) throw new Error(`no diff ${sheet}/${column}`);
      return c;
    };
    const conflict = byColumn('Levers', 'scenario@C');
    expect(conflict).toMatchObject({
      key: 'lev.L01.cut',
      member: '',
      scenario: 'C',
      export: toDiffValue(cut),
      workbook: bump(cut, 0.01),
      current: bump(cut, 0.02),
      target: { kind: 'value', var_key: 'lev.L01.cut', member_key: '', scenario: 'C' },
      messages: [],
    });
    expect(conflict.rowNumber).toBe(rowOf(lv, 'lev.L01.cut'));
    expect(byColumn('Workforce', 'default')).toMatchObject({
      export: hc,
      workbook: hc,
      current: bump(hc, 100),
    });
    expect(byColumn('Targets', 'note')).toMatchObject({
      export: 'agreed with finance',
      workbook: 'agreed with finance, revised',
      target: { kind: 'note', var_key: 'g.target_net', member_key: '' },
    });
    expect(byColumn('Org_Map', 'vp.vp_operations').target).toEqual({
      kind: 'value',
      var_key: 'org.dom_share',
      member_key: 'commercial_applications,vp_operations',
      scenario: null,
    });
    expect(byColumn('Line_Items', 'name').target).toEqual({
      kind: 'attr',
      member_key: 'it_001',
      attr: 'name',
    });
    expect(byColumn('Overrides', 'value').target).toEqual({
      kind: 'override',
      node_key: 'res.net',
      member_key: '',
      field: 'value',
      scenario: 'A',
    });
  });

  it('ignores edits to locked columns (validate.ts reports them) and throws DiffError for another export', async () => {
    const book = await freshBook();
    const ws = sheetOf(book, 'Targets');
    const r = rowOf(ws, 'g.target_net');
    ws.getCell(r, colOf(ws, header('Targets', 'label'))).value = 'my label';
    ws.getCell(r, colOf(ws, header('Targets', 'max'))).value = 1e9;
    const W = await reread(book);
    const res = diff(snapshot, W, snapshot, defs);
    expect(res.cells).toEqual([]);
    expect(() => diff({ ...snapshot, exportJobId: 'exp-other' }, W, snapshot, defs)).toThrow(
      DiffError,
    );
  });
});

// ----------------------------------------------------------------------------------------------
// Acceptance 2: rows
// ----------------------------------------------------------------------------------------------

describe('diff: rows', () => {
  it('rows: blank key → new; DELETE → delete; missing row → warning, never a delete', async () => {
    const book = await freshBook();
    const li = sheetOf(book, 'Line_Items');
    const action = header('Line_Items', 'action');
    // DELETE on it_002, with an edit that must not become a cell change.
    const r2 = tableRowOf(li, 'it_002');
    li.getCell(r2, colOf(li, action)).value = 'DELETE';
    li.getCell(r2, colOf(li, header('Line_Items', 'name'))).value = 'about to go';
    // A new line in the first spare row, and a blank-key row marked DELETE (adds nothing, deletes nothing).
    const fresh = nextFreeRow(li);
    li.getCell(fresh, colOf(li, header('Line_Items', 'name'))).value = 'New platform';
    li.getCell(fresh, colOf(li, header('Line_Items', 'line.amount'))).value = 1.5;
    li.getCell(fresh + 1, colOf(li, header('Line_Items', 'name'))).value = 'never mind';
    li.getCell(fresh + 1, colOf(li, action)).value = 'DELETE';
    // Rows removed from the sheet without DELETE: a line, an input row and a pin.
    li.spliceRows(tableRowOf(li, 'it_003'), 1);
    const tg = sheetOf(book, 'Targets');
    tg.spliceRows(rowOf(tg, 'g.head_start'), 1);
    const ov = sheetOf(book, 'Overrides');
    ov.spliceRows(tableRowOf(ov, 'res.net'), 1);
    const W = await reread(book);

    const r = diff(snapshot, W, snapshot, defs);
    expect(r.cells).toEqual([]);
    const rows = r.rows.map((x) => `${x.status}|${x.sheet}|${x.key}|${x.member}`).sort();
    expect(rows).toEqual(
      [
        'deleted_row|Line_Items|it_002|it_002',
        'missing_row|Line_Items|it_003|it_003',
        'missing_row|Overrides|res.net|',
        'missing_row|Targets|g.head_start|',
        'new_row|Line_Items||',
      ].sort(),
    );
    // Never a delete: only the DELETE row is deleted.
    expect(r.rows.filter((x) => x.status === 'deleted_row').map((x) => x.key)).toEqual(['it_002']);
    expect(r.counts).toMatchObject({ new_row: 1, deleted_row: 1, missing_row: 3 });

    const added = r.rows.find((x) => x.status === 'new_row');
    expect(added).toMatchObject({ key: '', inExport: false, inApp: false, messages: [] });
    expect(added?.cells['name']).toBe('New platform');
    expect(added?.cells['line.amount']).toBe(1.5);
    expect(added?.cells).not.toHaveProperty('action');
    const deleted = r.rows.find((x) => x.status === 'deleted_row');
    expect(deleted).toMatchObject({ inExport: true, inApp: true, messages: [] });
    expect(deleted?.rowNumber).toBe(r2);

    const missing = r.rows.filter((x) => x.status === 'missing_row');
    expect(missing.every((x) => x.rowNumber === null && x.inApp && x.inExport)).toBe(true);
    const line = missing.find((x) => x.sheet === 'Line_Items');
    expect(line?.messages[0]).toContain('nothing is deleted');
    expect(line?.messages[0]).toContain(`DELETE in the ${action} column`);
    expect(line?.cells['name']).toBe(e('Line_Items', 'it_003', 'it_003', 'name'));
    expect(missing.find((x) => x.sheet === 'Targets')?.messages[0]).toContain('keeps its values');
    expect(missing.find((x) => x.sheet === 'Overrides')?.scenario).toBe('A');
    // Each delta report entry of a row carries no cell values.
    expect(toDeltaEntry(deleted ?? missing[0]!)).toMatchObject({
      export: null,
      workbook: null,
      current: null,
    });
  });

  it('rows deleted in the app, unknown keys, duplicate keys and a new pin', async () => {
    // The app deleted it_004 and it_005 after the export; it_006 is gone from both sides.
    const gone = new Set(['it_004', 'it_005', 'it_006']);
    const defsNow = defs.map((d) =>
      d.name === 'Line_Items' ? { ...d, rows: d.rows.filter((r) => !gone.has(r.key)) } : d,
    );
    const D = current(values, defsNow);
    const book = await freshBook();
    const li = sheetOf(book, 'Line_Items');
    li.getCell(tableRowOf(li, 'it_004'), colOf(li, header('Line_Items', 'action'))).value =
      'delete';
    li.getCell(tableRowOf(li, 'it_005'), colOf(li, header('Line_Items', 'name'))).value =
      'kept in Excel';
    li.spliceRows(tableRowOf(li, 'it_006'), 1);
    // A made-up key in a spare row.
    const spare = nextFreeRow(li);
    li.getCell(spare, 1).value = 'it_made_up';
    li.getCell(spare, colOf(li, header('Line_Items', 'name'))).value = 'typed key';
    // A duplicated input row.
    const wf = sheetOf(book, 'Workforce');
    const src = rowOf(wf, 'hc.us');
    const dup = wf.rowCount + 1;
    for (let c = 1; c <= wf.columnCount; c += 1)
      wf.getCell(dup, c).value = wf.getCell(src, c).value;
    wf.getCell(dup, colOf(wf, header('Workforce', 'default'))).value = 1;
    // A pin added on the Overrides sheet.
    const ov = sheetOf(book, 'Overrides');
    const pin = nextFreeRow(ov);
    ov.getCell(pin, colOf(ov, header('Overrides', 'node_key'))).value = 'res.gap';
    ov.getCell(pin, colOf(ov, header('Overrides', 'value'))).value = -3;
    ov.getCell(pin, colOf(ov, header('Overrides', 'reason'))).value = 'board ask';
    const W = await reread(book);

    const r = diff(snapshot, W, D, defsNow);
    const deleted = r.rows.find((x) => x.status === 'deleted_row');
    expect(deleted).toMatchObject({ key: 'it_004', inExport: true, inApp: false });
    expect(deleted?.messages).toEqual(['Already deleted in the app.']);
    // Edited in Excel, deleted in the app: a conflict on the edit, the other cells keep the app (deleted) state.
    const it5 = r.cells.filter((c) => c.sheet === 'Line_Items' && c.member === 'it_005');
    expect(it5.find((c) => c.column === 'name')).toMatchObject({
      status: 'conflict',
      current: null,
      messages: ['Row is no longer in the app.'],
    });
    expect(it5.find((c) => c.column === 'line.amount')).toMatchObject({
      key: 'line.amount',
      status: 'changed_in_app',
      target: { kind: 'value', var_key: 'line.amount', member_key: 'it_005', scenario: null },
    });
    // it_006: removed in the app and in the sheet, nothing to report.
    expect(r.rows.some((x) => x.key === 'it_006')).toBe(false);
    expect(r.cells.some((x) => x.member === 'it_006')).toBe(false);

    expect(r.unmatched.map((u) => `${u.reason}|${u.sheet}|${u.key}`).sort()).toEqual(
      ['duplicate_row|Workforce|hc.us', 'unknown_row|Line_Items|it_made_up'].sort(),
    );
    expect(r.unmatched.find((u) => u.reason === 'duplicate_row')?.rowNumber).toBe(dup);
    expect(r.cells.some((c) => c.sheet === 'Workforce')).toBe(false);

    const pinRow = r.rows.find((x) => x.sheet === 'Overrides');
    expect(pinRow).toMatchObject({
      status: 'new_row',
      key: 'res.gap',
      member: '',
      scenario: 'A',
      inApp: false,
    });
    expect(pinRow?.cells).toMatchObject({ value: -3, reason: 'board ask' });
  });
});

// ----------------------------------------------------------------------------------------------
// Acceptance 3: foreign mode
// ----------------------------------------------------------------------------------------------

describe('diff: foreign mode', () => {
  it('foreign mode: W vs D two-way by key columns', async () => {
    const cut = e('Levers', 'lev.L01.cut', '', 'scenario@C');
    const hc = e('Workforce', 'hc.us', '', 'default');
    const net = e('Targets', 'g.target_net', '', 'default');
    // The app moved on since this file was written: hc.us and the C value of lev.L01.cut changed.
    const D = current(
      appValues({
        defaults: [['hc.us', '', bump(hc, 100)]],
        scenarios: [['C', 'lev.L01.cut', '', bump(cut, 0.02)]],
      }),
    );
    const book = await freshBook();
    book.removeWorksheet('_meta');
    // Sorted rows: the key columns move with them.
    const tg = sheetOf(book, 'Targets');
    const grid: ExcelJS.CellValue[][] = [];
    for (let r = 2; r <= tg.rowCount; r += 1) {
      const line: ExcelJS.CellValue[] = [];
      for (let c = 1; c <= tg.columnCount; c += 1) line.push(tg.getCell(r, c).value);
      grid.push(line);
    }
    grid.reverse().forEach((line, i) =>
      line.forEach((v, c) => {
        tg.getCell(i + 2, c + 1).value = v;
      }),
    );
    tg.getCell(rowOf(tg, 'g.target_net'), colOf(tg, header('Targets', 'default'))).value = bump(
      net,
      7,
    );
    const wf = sheetOf(book, 'Workforce');
    wf.getCell(rowOf(wf, 'hc.us'), colOf(wf, header('Workforce', 'default'))).value = bump(hc, 100);
    const W = await reread(book);
    expect(W.mode).toBe('foreign');

    const r = diff(null, W, D, defs);
    expect(r.mode).toBe('foreign');
    expect(cellsOf(r)).toEqual(
      [
        'Levers|scenario@C|lev.L01.cut||C|changed_in_excel',
        'Targets|default|g.target_net||-|changed_in_excel',
      ].sort(),
    );
    expect(r.cells.every((c) => c.export === null)).toBe(true);
    expect(r.cells.find((c) => c.key === 'lev.L01.cut')).toMatchObject({
      workbook: toDiffValue(cut),
      current: bump(cut, 0.02),
    });
    expect(r.counts).toMatchObject({ changed_in_app: 0, conflict: 0, already_applied: 0 });
    expect(r.rows).toEqual([]);
    expect(r.unmatched).toEqual([]);
    // Rows equal to the app are settled by their hash.
    expect(r.stats.rowsSkipped).toBeGreaterThan(r.stats.rows / 2);
  });

  it('foreign mode: rows missing from the sheet are warnings, scenario columns of unknown scenarios are not placed', async () => {
    const book = await freshBook();
    book.removeWorksheet('_meta');
    const tg = sheetOf(book, 'Targets');
    tg.spliceRows(rowOf(tg, 'g.head_start'), 1);
    const out = new Uint8Array(await book.xlsx.writeBuffer());
    // Parsed without the tenant's scenarios: the scenario columns keep their labels as ids.
    const W = await parseWorkbook(out, defs);
    expect(W.mode).toBe('foreign');
    const r = diff(null, W, snapshot, defs);
    expect(r.cells).toEqual([]);
    expect(r.rows.map((x) => `${x.status}|${x.sheet}|${x.key}`)).toEqual([
      'missing_row|Targets|g.head_start',
    ]);
    expect(r.rows[0]).toMatchObject({ inExport: false, inApp: true });
    const unplaced = r.unmatched.filter((u) => u.reason === 'unknown_cell');
    expect(unplaced.length).toBeGreaterThan(0);
    expect(
      unplaced.every(
        (u) => u.column?.startsWith('scenario@') === true || u.column?.startsWith('lev.') === true,
      ),
    ).toBe(true);
  });
});

// ----------------------------------------------------------------------------------------------
// Acceptance 4: exported precision and the row _hash fast path
// ----------------------------------------------------------------------------------------------

describe('diff: exported precision and the _hash fast path', () => {
  it('numbers compared at exported precision: a LibreOffice re-save of an export (fixture) re-imports with 0 changes', async () => {
    // fixtures/make_fixtures.ts: an export with 17-digit values, and the same file saved by LibreOffice headless.
    const original = await parseWorkbook(
      readFileSync(join(fixturesDir, 'precision_export.xlsx')),
      defs,
    );
    const resaved = await parseWorkbook(
      readFileSync(join(fixturesDir, 'precision_export_libreoffice.xlsx')),
      defs,
    );
    expect(original.mode).toBe('export');
    expect(resaved.mode).toBe('export');
    expect(resaved.issues.filter((i) => i.severity === 'error')).toEqual([]);
    // LibreOffice really rewrote the numbers (15 significant digits) ...
    expect(bitwiseNumberChanges(original, resaved)).toBeGreaterThan(100);
    const E = snapshotOf(original);
    // ... yet nothing changed.
    const r = diff(E, resaved, E, defs);
    expect(r.cells).toEqual([]);
    expect(r.rows).toEqual([]);
    expect(r.unmatched).toEqual([]);
    // Every editable cell of the export is accounted for as unchanged.
    expect(r.counts.unchanged).toBe(diff(E, original, E, defs).counts.unchanged);
    expect(r.counts.unchanged).toBeGreaterThan(300);
    // Rows whose numbers were rewritten have another hash: they went through the cell compare.
    expect(r.stats.rowsSkipped).toBeLessThan(r.stats.rows);
    expect(r.stats.cellsCompared).toBeGreaterThan(0);
    // The text survived the re-save, line breaks included.
    expect(
      resaved.sheets.find((s) => s.name === 'Targets')?.rows.find((x) => x.key === 'g.target_net')
        ?.cells['note'],
    ).toBe('agreed with finance\nsecond line');
  });

  it('numbers compared at exported precision: an Excel-style 15-digit re-save gives 0 changes, a real edit still shows', async () => {
    const numeric = new Set<string>();
    for (const d of defs) {
      for (const r of d.rows)
        if (r.varId !== undefined && r.type === 'number') numeric.add(r.varId);
      for (const c of d.columns)
        if (c.varId !== undefined && c.type === 'number') numeric.add(c.varId);
    }
    const third = (rows: readonly InputValueRow[]): InputValueRow[] =>
      rows.map((x) => (numeric.has(x.var_key) ? { ...x, value: x.value * (1 + 1e-12 / 3) } : x));
    const v17: ExportValues = {
      ...values,
      defaults: third(values.defaults),
      scenarios: values.scenarios.map((s) => ({ ...s, values: third(s.values) })),
    };
    const built = buildWorkbook(defs, v17, meta);
    const exported = await writeWorkbook(built.workbook);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(exported as unknown as ArrayBuffer);
    // Excel keeps 15 significant digits: every number comes back rounded.
    let rounded = 0;
    for (const ws of book.worksheets)
      ws.eachRow((row) =>
        row.eachCell((cell) => {
          if (typeof cell.value === 'number') {
            const r = Number(cell.value.toPrecision(EXPORT_PRECISION_DIGITS));
            if (r !== cell.value) rounded += 1;
            cell.value = r;
          }
        }),
      );
    expect(rounded).toBeGreaterThan(500);
    const W = await reread(book);
    const r = diff(built.snapshot, W, built.snapshot, defs);
    expect(r.cells).toEqual([]);
    expect(r.unmatched).toEqual([]);
    expect(r.stats.cellsCompared).toBeGreaterThan(500);

    // A real edit (at the 4th significant digit) is still a change.
    const tg = sheetOf(book, 'Targets');
    const at = tg.getCell(rowOf(tg, 'g.target_net'), colOf(tg, header('Targets', 'default')));
    at.value = (at.value as number) * 1.001;
    const edited = diff(built.snapshot, await reread(book), built.snapshot, defs);
    expect(cellsOf(edited)).toEqual(['Targets|default|g.target_net||-|changed_in_excel']);
  });

  it('row _hash fast path skips unchanged rows', async () => {
    const W = await parseWorkbook(bytes, defs, { scenarios });
    const hashed = W.sheets.flatMap((s) => s.rows).filter((x) => x.hash !== null).length;
    const fast = diff(snapshot, W, snapshot, defs);
    expect(fast.cells).toEqual([]);
    expect(fast.rows).toEqual([]);
    expect(fast.stats).toEqual({ rows: hashed, rowsSkipped: hashed, cellsCompared: 0 });
    // The slow path reaches the same verdict, cell by cell.
    const slow = diff(snapshot, W, snapshot, defs, { fastPath: false });
    expect(slow.counts).toEqual(fast.counts);
    expect(slow.stats).toEqual({
      rows: hashed,
      rowsSkipped: 0,
      cellsCompared: fast.counts.unchanged,
    });

    // A row changed in the app is not skipped: its hash differs from the app's.
    const hc = e('Workforce', 'hc.us', '', 'default');
    const D = current(appValues({ defaults: [['hc.us', '', bump(hc, 100)]] }));
    const app = diff(snapshot, W, D, defs);
    expect(app.stats.rowsSkipped).toBe(hashed - 1);
    expect(cellsOf(app)).toEqual(['Workforce|default|hc.us||-|changed_in_app']);

    // Proof that matching rows are not read cell by cell: a parsed row whose cells no longer match its (exported)
    // hash is still taken as unchanged by the fast path; without it, the cell compare finds the edit.
    const tampered: ParsedWorkbook = {
      ...W,
      sheets: W.sheets.map((s) =>
        s.name !== 'Targets'
          ? s
          : {
              ...s,
              rows: s.rows.map((x) =>
                x.key === 'g.target_net' ? { ...x, cells: { ...x.cells, default: -1 } } : x,
              ),
            },
      ),
    };
    expect(diff(snapshot, tampered, snapshot, defs).cells).toEqual([]);
    expect(cellsOf(diff(snapshot, tampered, snapshot, defs, { fastPath: false }))).toEqual([
      'Targets|default|g.target_net||-|changed_in_excel',
    ]);
  });

  it('a row whose hidden _hash belongs to other values is flagged', async () => {
    const book = await freshBook();
    const ws = sheetOf(book, 'Targets');
    const a = rowOf(ws, 'g.target_net');
    const hashCol = colOf(ws, header('Targets', 'hash'));
    // The row got another row's _hash (sorted without its key), and its value differs from the export.
    ws.getCell(a, hashCol).value = 'f'.repeat(64);
    ws.getCell(a, colOf(ws, header('Targets', 'default'))).value = bump(
      e('Targets', 'g.target_net', '', 'default'),
    );
    const r = diff(snapshot, await reread(book), snapshot, defs);
    expect(r.cells).toHaveLength(1);
    expect(r.cells[0]?.messages[0]).toContain('_hash');
  });

  it('sameValue: numbers to 15 significant digits, text with line ends normalised, types kept apart', () => {
    expect(sameValue(0.1 + 0.2, 0.3)).toBe(true);
    expect(sameValue(128.57142857142858, 128.571428571429)).toBe(true);
    expect(sameValue(2506.6666666666665, 2506.66666666667)).toBe(true);
    expect(sameValue(0.35, 0.3501)).toBe(false);
    expect(sameValue(1e-20, 0)).toBe(false);
    expect(sameValue(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(true);
    expect(sameValue(Number.POSITIVE_INFINITY, 1)).toBe(false);
    expect(sameValue('a\r\nb', 'a\nb')).toBe(true);
    expect(sameValue('a', 'b')).toBe(false);
    expect(sameValue(1, '1')).toBe(false);
    expect(sameValue(null, 0)).toBe(false);
    expect(sameValue(null, '')).toBe(false);
    expect(toDiffValue(true)).toBe(1);
    expect(toDiffValue(false)).toBe(0);
    expect(toDiffValue(undefined)).toBeNull();
  });
});

// ----------------------------------------------------------------------------------------------
// The delta report entry mirrors excel_template.json delta_report_schema
// ----------------------------------------------------------------------------------------------

describe('diff: delta report entries', () => {
  it('CellDiff and RowDiff entries mirror delta_report_schema.changes[] of excel_template.json (keys, value types, statuses, mode)', async () => {
    const raw = JSON.parse(readFileSync(join(specDir, 'excel_template.json'), 'utf8')) as {
      delta_report_schema: {
        mode: string;
        summary: Record<string, string>;
        changes: Record<string, unknown>[];
      };
      import_pipeline: { name: string; do: string }[];
    };
    const schema = raw.delta_report_schema;
    const sample = schema.changes[0] ?? {};

    const book = await freshBook();
    const ws = sheetOf(book, 'Levers');
    ws.getCell(rowOf(ws, 'lev.L01.cut'), colOf(ws, header('Levers', 'scenario', 1))).value = 0.05;
    const tg = sheetOf(book, 'Targets');
    tg.getCell(rowOf(tg, 'g.target_net'), colOf(tg, header('Targets', 'note'))).value =
      'text value';
    tg.spliceRows(rowOf(tg, 'g.head_start'), 1);
    const r = diff(snapshot, await reread(book), snapshot, defs);
    const entries = [...r.cells, ...r.rows].map(toDeltaEntry);
    expect(entries.length).toBe(3);

    for (const entry of entries) {
      // Same keys as the spec, nothing more (the contract's DeltaChange is strict).
      expect(Object.keys(entry).sort()).toEqual(Object.keys(sample).sort());
      for (const [k, want] of Object.entries(sample)) {
        const got = (entry as unknown as Record<string, unknown>)[k];
        if (Array.isArray(want)) {
          expect(Array.isArray(got)).toBe(true);
          expect((got as unknown[]).every((m) => typeof m === 'string')).toBe(true);
        } else if (typeof want === 'number') {
          // Cell values: numbers, text for text cells, null for blanks and foreign mode.
          expect(got === null || typeof got === 'number' || typeof got === 'string').toBe(true);
        } else if (k === 'scenario') {
          // A scenario column's id; null for the Default and tenant-wide columns.
          expect(got === null || typeof got === 'string').toBe(true);
        } else expect([k, typeof got]).toEqual([k, typeof want]);
      }
    }
    const levers = entries.find((x) => x.sheet === 'Levers');
    expect(levers).toMatchObject({ key: 'lev.L01.cut', member: '', scenario: 'C', workbook: 0.05 });
    expect(typeof sample['status']).toBe('string');
    expect(levers?.status).toBe(sample['status']);

    // Cell statuses are the spec's words, verbatim; row statuses are counted by summary keys.
    const step4 = raw.import_pipeline.find((s) => s.name === 'diff')?.do ?? '';
    const cellStatuses: CellStatus[] = [
      'unchanged',
      'changed_in_excel',
      'changed_in_app',
      'conflict',
      'already_applied',
    ];
    for (const s of cellStatuses) expect([s, step4.includes(s)]).toEqual([s, true]);
    for (const s of ['new_row', 'deleted_row'] as const)
      expect(Object.keys(schema.summary)).toContain(`${s}s`);
    expect(step4).toContain('missing');
    expect(Object.keys(r.counts).sort()).toEqual(
      [...cellStatuses, 'new_row', 'deleted_row', 'missing_row'].sort(),
    );
    // Diff counts cover the summary keys that are not validation's (invalid) or the report's (ignored).
    for (const k of Object.keys(schema.summary).filter((k) => k !== 'invalid' && k !== 'ignored'))
      expect(Object.keys(r.counts)).toContain(k.replace(/_rows$/, '_row'));

    // Modes, verbatim.
    expect(schema.mode.split('|')).toEqual(['three_way', 'foreign']);
    expect(schema.mode.split('|')).toContain(r.mode);
    expect(schema.mode.split('|')).toContain(diff(null, await reread(book), snapshot, defs).mode);
  });
});
