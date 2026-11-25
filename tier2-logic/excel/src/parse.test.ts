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
  ParseError,
  buildTemplate,
  buildWorkbook,
  columnHeader,
  identifyWorkbook,
  parseLoadedWorkbook,
  parseNumberText,
  parseWorkbook,
  rowKey,
  scenarioColumnId,
  snapshotKey,
  writeWorkbook,
  type ExportMeta,
  type ExportSnapshot,
  type ExportValues,
  type ParsedRow,
  type ParsedSheet,
  type ParsedWorkbook,
  type RowDef,
  type SheetDef,
} from './index';

const here = dirname(fileURLToPath(import.meta.url));
const specDir = join(here, '../../../docs/spec');
const NOW = new Date(Date.UTC(2026, 11, 4, 9, 5, 59));

let template: ExcelTemplate;
let bundle: ModelBundle;
let seed: TenantSeed;
let members: TenantMembers;
let defs: SheetDef[];
let values: ExportValues;
let meta: ExportMeta;
let snapshot: ExportSnapshot;
let bytes: Uint8Array;

const rowsOf = (v: Readonly<Record<string, InputValue>>): InputValueRow[] =>
  Object.entries(v).flatMap(([var_key, value]) =>
    typeof value === 'number'
      ? [{ var_key, member_key: '', value }]
      : Object.entries(value).map(([member_key, n]) => ({ var_key, member_key, value: n })),
  );

function exportValues(scenarios: readonly { id: string; label?: string }[]): ExportValues {
  return {
    defaults: rowsOf(seed.variableValues),
    scenarios: scenarios.map(({ id, label }) => {
      const s = seed.scenarios.scenarios.find((x) => x.id === id);
      if (s === undefined) throw new Error(`no scenario ${id}`);
      return {
        id,
        label: label ?? s.label,
        values: rowsOf(s.values),
        overrides: [{ node_key: 'res.net', member_key: '', value: 12.5, reason: 'board pin' }],
        outputs: [{ node_key: 'res.net', member_key: '', value: 119.3 }],
      };
    }),
    notes: [{ var_key: 'g.target_net', member_key: '', note: 'agreed with finance' }],
  };
}

async function exportBook(v: ExportValues = values): Promise<{
  book: ExcelJS.Workbook;
  bytes: Uint8Array;
  snapshot: ExportSnapshot;
}> {
  const built = buildWorkbook(defs, v, meta);
  const out = await writeWorkbook(built.workbook);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(out as unknown as ArrayBuffer);
  return { book, bytes: out, snapshot: built.snapshot };
}

/** A fresh copy of the export, loaded from bytes, to edit before parsing. */
async function freshBook(): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as unknown as ArrayBuffer);
  return book;
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
function colOf(ws: ExcelJS.Worksheet, header: string): number {
  for (let c = 1; c <= ws.columnCount; c += 1) if (ws.getCell(1, c).value === header) return c;
  throw new Error(`${ws.name}: no column '${header}'`);
}
function rowOf(ws: ExcelJS.Worksheet, key: string, member = ''): number {
  for (let r = 2; r <= ws.rowCount; r += 1)
    if (ws.getCell(r, 1).value === key && (ws.getCell(r, 2).value ?? '') === member) return r;
  throw new Error(`${ws.name}: no row ${key}|${member}`);
}
/** Table sheets have the key in column 1 and no member column. */
function tableRowOf(ws: ExcelJS.Worksheet, key: string): number {
  for (let r = 2; r <= ws.rowCount; r += 1) if (ws.getCell(r, 1).value === key) return r;
  throw new Error(`${ws.name}: no row ${key}`);
}
const parsedSheet = (p: ParsedWorkbook, name: string): ParsedSheet => {
  const s = p.sheets.find((x) => x.name === name);
  if (s === undefined) throw new Error(`parsed: no sheet ${name}`);
  return s;
};
const parsedRow = (p: ParsedWorkbook, sheet: string, key: string, member = ''): ParsedRow => {
  const r = parsedSheet(p, sheet).rows.find((x) => x.key === key && x.member === member);
  if (r === undefined) throw new Error(`parsed: no row ${sheet}/${key}/${member}`);
  return r;
};
/** A Targets or Workforce row of a type, whose scenario column varies. */
function inputRow(type: RowDef['type'], unit?: string): { sheet: string; row: RowDef } {
  for (const sheet of ['Targets', 'Workforce', 'Pools', 'Levers']) {
    const row = defOf(sheet).rows.find(
      (r) => r.type === type && (unit === undefined || r.unit === unit),
    );
    if (row !== undefined) return { sheet, row };
  }
  throw new Error(`no input row of type ${String(type)}`);
}

beforeAll(async () => {
  template = ExcelTemplateSchema.parse(
    JSON.parse(readFileSync(join(specDir, 'excel_template.json'), 'utf8')),
  );
  bundle = await loadModelBundleFromDir(specDir);
  seed = await readTenantSeed(join(specDir, 'seed/aa'));
  members = seedToTenantData(seed, 'C', bundle).members;
  defs = buildTemplate(template, bundle, members);
  values = exportValues([{ id: 'A' }, { id: 'C' }]);
  meta = {
    tenantId: seed.tenant.id,
    tenantSlug: 'aa',
    modelVersion: 'mv-test',
    templateVersion: template.template_version,
    exportJobId: 'exp-0001',
    exportedAt: NOW,
    exportedBy: 'user-1',
  };
  const built = await exportBook();
  bytes = built.bytes;
  snapshot = built.snapshot;
});

// ----------------------------------------------------------------------------------------------
// Acceptance 1: sheets and columns found by header text; unknown ones reported and ignored
// ----------------------------------------------------------------------------------------------

describe('parseWorkbook: sheets and columns by header text', () => {
  it('finds sheets and columns by header text; unknown sheets and columns are reported and ignored', async () => {
    const book = await freshBook();
    // An unknown sheet, a new column inserted in front of the value columns and a column
    // dropped from the end: positions move, header text still finds everything.
    const stray = book.addWorksheet('Scratch');
    stray.getCell(1, 1).value = 'Targets';
    stray.getCell(2, 1).value = 'g.target_net';
    const ws = sheetOf(book, 'Targets');
    ws.spliceColumns(3, 0, ['Reviewer', 'someone'], ['Flag', 'x']);
    const confidence = colOf(ws, 'Confidence');
    ws.spliceColumns(confidence, 1);

    const parsed = parseLoadedWorkbook(book, defs);
    expect(parsed.unknownSheets).toEqual(['Scratch']);
    expect(parsed.issues.filter((i) => i.code === 'unknown_sheet').map((i) => i.sheet)).toEqual([
      'Scratch',
    ]);
    expect(parsed.sheets.map((s) => s.name)).toEqual(
      defs
        .filter((d) => !['README', 'Outputs', '_lists', '_meta'].includes(d.name))
        .map((d) => d.name),
    );
    expect([...parsed.ignoredSheets].sort()).toEqual(['Outputs', 'README', '_lists']);
    expect(parsedSheet(parsed, 'Org_Map').fileName).toBe('Org_Map');

    const targets = parsedSheet(parsed, 'Targets');
    expect(targets.unknownColumns.map((u) => u.header)).toEqual(['Reviewer', 'Flag']);
    expect(targets.unknownColumns.map((u) => u.position)).toEqual([3, 4]);
    expect(targets.missingColumns).toEqual(['confidence']);
    expect(
      parsed.issues.filter((i) => i.code === 'unknown_column').map((i) => `${i.sheet}:${i.column}`),
    ).toEqual(['Targets:Reviewer', 'Targets:Flag']);
    expect(parsed.issues.find((i) => i.code === 'missing_column')?.column).toBe('confidence');

    // The unknown columns' cells are not in the rows; the others are read from their new positions.
    const row = parsedRow(parsed, 'Targets', 'g.target_net');
    expect(Object.keys(row.cells).some((id) => /reviewer|flag/i.test(id))).toBe(false);
    expect(row.cells['default']).toBe(
      snapshot.cells[snapshotKey('Targets', 'g.target_net', '', 'default')],
    );
    expect(row.cells['note']).toBe('agreed with finance');
    expect('confidence' in row.cells).toBe(false);
  });

  it('matches per-scenario columns by position and _meta when scenario labels repeat, and by label when the caller lists the scenarios', async () => {
    const same = exportValues([
      { id: 'A', label: 'Same' },
      { id: 'C', label: 'Same' },
    ]);
    const built = await exportBook(same);
    const sc = same.scenarios;
    // The export really has duplicate headers.
    const targets = defOf('Targets');
    const col = targets.columns.find((c) => c.perScenario);
    expect(col === undefined ? '' : columnHeader(col, sc[0])).toBe(
      col === undefined ? '' : columnHeader(col, sc[1]),
    );

    for (const options of [undefined, { scenarios: sc.map(({ id, label }) => ({ id, label })) }]) {
      const parsed = await parseWorkbook(built.bytes, defs, options);
      expect(parsed.mode).toBe('export');
      const t = parsedSheet(parsed, 'Targets');
      const cols = t.columns.filter((c) => c.defId === 'scenario');
      expect(cols.map((c) => c.id)).toEqual([
        scenarioColumnId('scenario', 'A'),
        scenarioColumnId('scenario', 'C'),
      ]);
      expect(cols.map((c) => c.scenarioId)).toEqual(['A', 'C']);
      expect(cols[0]?.position).toBeLessThan(cols[1]?.position ?? 0);
      const lt = parsedSheet(parsed, 'Lever_Timing').columns.filter((c) => c.defId === 'lev.start');
      expect(lt.map((c) => c.id)).toEqual(['lev.start@A', 'lev.start@C']);
      // Every cell equals the snapshot, scenario by scenario.
      for (const sheet of parsed.sheets)
        for (const row of sheet.rows)
          for (const [id, v] of Object.entries(row.cells)) {
            const want = built.snapshot.cells[snapshotKey(sheet.name, row.key, row.member, id)];
            if (want !== undefined) expect(v).toBe(want);
          }
    }
  });

  it('keeps the label as column id in a foreign workbook without scenario ids, and numbers repeated labels', async () => {
    const same = exportValues([
      { id: 'A', label: 'Same' },
      { id: 'C', label: 'Same' },
    ]);
    const built = await exportBook(same);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(built.bytes as unknown as ArrayBuffer);
    book.removeWorksheet('_meta');
    const parsed = parseLoadedWorkbook(book, defs);
    expect(parsed.mode).toBe('foreign');
    const cols = parsedSheet(parsed, 'Targets').columns.filter((c) => c.defId === 'scenario');
    expect(cols.map((c) => c.id)).toEqual(['scenario@Same', 'scenario@Same#2']);
    expect(cols.every((c) => c.scenarioId === undefined && c.scenarioLabel === 'Same')).toBe(true);
  });

  it('finds the header row below title rows and ignores merged-cell copies', async () => {
    const book = await freshBook();
    const ws = sheetOf(book, 'Workforce');
    const r = rowOf(ws, 'hc.us');
    ws.mergeCells(r, colOf(ws, 'Source'), r, colOf(ws, 'Source') + 1);
    ws.spliceRows(1, 0, ['Workforce inputs, version 3'], []);
    const parsed = parseLoadedWorkbook(book, defs);
    const sheet = parsedSheet(parsed, 'Workforce');
    expect(sheet.headerRow).toBe(3);
    expect(parsedRow(parsed, 'Workforce', 'hc.us').cells['default']).toBe(
      snapshot.cells[snapshotKey('Workforce', 'hc.us', '', 'default')],
    );
    // The cell right of the merged master repeats its text in ExcelJS: it is read as blank.
    expect(parsedRow(parsed, 'Workforce', 'hc.us').cells['confidence']).toBeNull();
  });

  it('reports a sheet without any known header, a missing sheet and a sheet without its key column, and ignores them', async () => {
    const book = await freshBook();
    const junk = sheetOf(book, 'Corporate');
    for (let c = 1; c <= junk.columnCount; c += 1) junk.getCell(1, c).value = `col ${c}`;
    book.removeWorksheet('Pools');
    const noKey = sheetOf(book, 'Levers');
    noKey.getCell(1, 1).value = 'renamed key';
    const parsed = parseLoadedWorkbook(book, defs);
    expect(parsed.sheets.map((s) => s.name)).not.toContain('Corporate');
    expect(parsed.issues.find((i) => i.code === 'no_header')?.sheet).toBe('Corporate');
    expect(parsed.missingSheets).toEqual(['Pools']);
    expect(parsed.issues.find((i) => i.code === 'missing_sheet')?.sheet).toBe('Pools');
    const levers = parsedSheet(parsed, 'Levers');
    expect(levers.rows).toEqual([]);
    expect(parsed.issues.find((i) => i.code === 'missing_key_column')?.sheet).toBe('Levers');
  });

  it('throws ParseError for bytes that are not an .xlsx file', async () => {
    await expect(
      parseWorkbook(new TextEncoder().encode('a,b\n1,2\n'), defs),
    ).rejects.toBeInstanceOf(ParseError);
  });
});

// ----------------------------------------------------------------------------------------------
// Acceptance 2: normalisation table
// ----------------------------------------------------------------------------------------------

describe('parseWorkbook: cell normalisation', () => {
  it('normalises 35% to 0.35, 0.35, blank = inherit, TRUE/FALSE and dropdown labels to ids (test table)', async () => {
    const book = await freshBook();
    const num = inputRow('number');
    const flag = inputRow('bool');
    const enumRow = inputRow('enum');
    const labels = defs
      .find((d) => d.kind === 'lists')
      ?.lists?.find((l) => l.id === `enum.${enumRow.row.key}`)?.entries;
    expect(labels !== undefined && labels.length >= 2).toBe(true);
    const [first, second] = labels ?? [];
    const set = (s: { sheet: string; row: RowDef }, header: string, v: ExcelJS.CellValue): void => {
      const ws = sheetOf(book, s.sheet);
      ws.getCell(rowOf(ws, s.row.key, s.row.member), colOf(ws, header)).value = v;
    };
    const cases: [string, { sheet: string; row: RowDef }, ExcelJS.CellValue, unknown][] = [
      ['35% text', num, '35%', 0.35],
      ['0.35 text', num, '0.35', 0.35],
      ['0.35 number', num, 0.35, 0.35],
      ['padded percent', num, '  35 % ', 0.35],
      ['negative percent', num, '-12.5%', -0.125],
      ['fraction of a percent', num, '0.1%', 0.001],
      ['grouped thousands', num, '1,234.5', 1234.5],
      ['exponent', num, '1e-3', 0.001],
      ['blank = inherit', num, null, null],
      ['whitespace = blank', num, '   ', null],
      ['not a number is kept for validate', num, 'abc', 'abc'],
      ['error cell', num, { error: '#DIV/0!' }, '#DIV/0!'],
      ['formula result', num, { formula: '0.2+0.15', result: 0.35 }, 0.35],
      ['rich text', num, { richText: [{ text: '35' }, { text: '%' }] }, 0.35],
      ['TRUE', flag, true, 1],
      ['FALSE', flag, false, 0],
      ['true text', flag, ' true ', 1],
      ['False text', flag, 'False', 0],
      ['1', flag, 1, 1],
      ['0 text', flag, '0', 0],
      ['blank bool', flag, null, null],
      ['bool nonsense is kept for validate', flag, 'maybe', 'maybe'],
      ['enum label', enumRow, second?.label, second?.code],
      [
        'enum label, case and spacing',
        enumRow,
        ` ${(first?.label ?? '').toUpperCase()} `,
        first?.code,
      ],
      ['enum code number', enumRow, second?.code, second?.code],
      ['enum code text', enumRow, String(second?.code), second?.code],
      ['enum unknown label is kept for validate', enumRow, 'no such mode', 'no such mode'],
    ];
    const results: [string, unknown, unknown][] = [];
    for (const [name, target, input, want] of cases) {
      set(target, 'Default', input);
      const parsed = parseLoadedWorkbook(book, defs);
      results.push([
        name,
        parsedRow(parsed, target.sheet, target.row.key, target.row.member).cells['default'],
        want,
      ]);
    }
    for (const [name, got, want] of results) expect([name, got]).toEqual([name, want]);
  });

  it('reads scenario cells as the same kinds: blank scenario cell = inherit', async () => {
    const book = await freshBook();
    const { sheet, row } = inputRow('number');
    const ws = sheetOf(book, sheet);
    const r = rowOf(ws, row.key, row.member);
    const cols = parsedSheet(parseLoadedWorkbook(book, defs), sheet).columns.filter(
      (c) => c.defId === 'scenario',
    );
    const [first, second] = cols;
    ws.getCell(r, first?.position ?? 0).value = '5%';
    ws.getCell(r, second?.position ?? 0).value = null;
    const parsed = parseLoadedWorkbook(book, defs);
    const cells = parsedRow(parsed, sheet, row.key, row.member).cells;
    expect(cells[first?.id ?? '']).toBe(0.05);
    expect(cells[second?.id ?? '']).toBeNull();
  });

  it('maps dropdown labels of Line_Items lists to ids, booleans to 1/0 and the action to DELETE', async () => {
    const book = await freshBook();
    const ws = sheetOf(book, 'Line_Items');
    const r = tableRowOf(ws, 'it_001');
    const lists = defs.find((d) => d.kind === 'lists')?.lists ?? [];
    const pool = lists
      .find((l) => l.id === 'dim.pool')
      ?.entries.find((e) => e.code !== 'internal_labour');
    expect(pool).toBeDefined();
    ws.getCell(r, colOf(ws, 'Pool id')).value = pool?.label;
    ws.getCell(r, colOf(ws, 'In scope')).value = false;
    ws.getCell(r, colOf(ws, 'Action')).value = ' delete ';
    ws.getCell(r, colOf(ws, 'Notes')).value = 2027;
    const parsed = parseLoadedWorkbook(book, defs);
    const row = parsedRow(parsed, 'Line_Items', 'it_001', 'it_001');
    expect(row.cells['pool_id']).toBe(pool?.code);
    expect(row.cells['in_scope']).toBe(0);
    expect(row.action).toBe('DELETE');
    expect(row.cells['action']).toBe('DELETE');
    expect(row.cells['notes']).toBe('2027');
    expect(row.isNew).toBe(false);
  });

  it('parseNumberText: percent shifts the decimal text, so 35% is exactly 0.35', () => {
    expect(parseNumberText('35%')).toBe(0.35);
    expect(parseNumberText('7%')).toBe(0.07);
    expect(parseNumberText('1e2%')).toBe(1);
    expect(parseNumberText('−5%')).toBe(-0.05);
    expect(parseNumberText('+.5')).toBe(0.5);
    expect(parseNumberText('1,23')).toBeNull();
    expect(parseNumberText('')).toBeNull();
    expect(parseNumberText('3 x')).toBeNull();
  });
});

// ----------------------------------------------------------------------------------------------
// Acceptance 3: _meta, foreign mode, sorted / filtered / hidden rows and comments
// ----------------------------------------------------------------------------------------------

describe('parseWorkbook: _meta and harmless edits', () => {
  it('reads _meta: tenant, versions, export id, time, user, scenarios and checksum', async () => {
    const parsed = await parseWorkbook(bytes, defs);
    expect(parsed.mode).toBe('export');
    expect(parsed.meta).toMatchObject({
      tenantId: seed.tenant.id,
      tenantSlug: 'aa',
      modelVersion: 'mv-test',
      templateVersion: template.template_version,
      exportJobId: 'exp-0001',
      exportedBy: 'user-1',
      scenarioKeys: ['A', 'C'],
      workbookChecksum: snapshot.checksum,
    });
    expect(parsed.meta?.exportedAt?.getTime()).toBe(NOW.getTime());
    expect(Object.keys(parsed.meta?.fields ?? {})).toEqual(
      defs.find((d) => d.kind === 'meta')?.fields,
    );
    expect(parsed.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(parsed.issues.filter((i) => i.code.startsWith('meta'))).toEqual([]);
  });

  it('a workbook without _meta is a foreign workbook: key columns still parse', async () => {
    const book = await freshBook();
    book.removeWorksheet('_meta');
    const parsed = parseLoadedWorkbook(book, defs);
    expect(parsed.mode).toBe('foreign');
    expect(parsed.meta).toBeNull();
    expect(parsed.issues.map((i) => i.code)).toContain('meta_missing');
    expect(parsed.sheets).toHaveLength(9);
    expect(parsedRow(parsed, 'Targets', 'g.target_net').cells['default']).toBe(
      snapshot.cells[snapshotKey('Targets', 'g.target_net', '', 'default')],
    );
    expect(identifyWorkbook(parsed, { tenantId: seed.tenant.id, templateVersion: '1.0' })).toEqual({
      mode: 'foreign',
      tenantMatches: null,
      templateCompatible: null,
      problems: [],
    });
  });

  it('an empty or incomplete _meta also means foreign mode', async () => {
    const book = await freshBook();
    const ws = sheetOf(book, '_meta');
    for (let r = 2; r <= ws.rowCount; r += 1)
      if (ws.getCell(r, 1).value === 'export_job_id') ws.getCell(r, 2).value = null;
    const parsed = parseLoadedWorkbook(book, defs);
    expect(parsed.mode).toBe('foreign');
    expect(parsed.meta?.exportJobId).toBe('');
    expect(parsed.issues.find((i) => i.code === 'meta_incomplete')?.message).toContain(
      'export_job_id',
    );

    const empty = await freshBook();
    const ews = sheetOf(empty, '_meta');
    for (let r = 1; r <= ews.rowCount; r += 1)
      for (let c = 1; c <= 2; c += 1) if (r > 1) ews.getCell(r, c).value = null;
    const p2 = parseLoadedWorkbook(empty, defs);
    expect(p2.mode).toBe('foreign');
    expect(p2.issues.find((i) => i.code === 'meta_missing')?.message).toContain(
      'could not be read',
    );
  });

  it('identifyWorkbook: tenant must match and minor template versions are compatible', async () => {
    const parsed = await parseWorkbook(bytes, defs);
    const same = { tenantId: seed.tenant.id, templateVersion: template.template_version };
    expect(identifyWorkbook(parsed, same)).toEqual({
      mode: 'export',
      tenantMatches: true,
      templateCompatible: true,
      problems: [],
    });
    const minor = identifyWorkbook(parsed, { ...same, templateVersion: '1.7' });
    expect(minor.templateCompatible).toBe(true);
    const major = identifyWorkbook(parsed, { tenantId: 'other', templateVersion: '2.0' });
    expect(major).toMatchObject({ tenantMatches: false, templateCompatible: false });
    expect(major.problems).toHaveLength(2);
    expect(identifyWorkbook(parsed, { ...same, templateVersion: 'x' }).templateCompatible).toBe(
      false,
    );
  });

  it('sorted, filtered, hidden rows and cell comments are harmless', async () => {
    const baseline = await parseWorkbook(bytes, defs);
    const book = await freshBook();
    for (const name of ['Targets', 'Line_Items', 'Lever_Timing', 'Corporate']) {
      const ws = sheetOf(book, name);
      const last = ws.rowCount;
      // Sort: reverse the data rows (cell values, as Excel moves them).
      const grid: ExcelJS.CellValue[][] = [];
      for (let r = 2; r <= last; r += 1) {
        const line: ExcelJS.CellValue[] = [];
        for (let c = 1; c <= ws.columnCount; c += 1) line.push(ws.getCell(r, c).value);
        grid.push(line);
      }
      grid.reverse().forEach((line, i) =>
        line.forEach((v, c) => {
          ws.getCell(i + 2, c + 1).value = v;
        }),
      );
      // Filter + hide rows and a column, add comments.
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: last, column: ws.columnCount } };
      for (let r = 3; r <= last; r += 3) ws.getRow(r).hidden = true;
      ws.getColumn(3).hidden = true;
      ws.getCell(2, 3).note = 'checked with finance';
      ws.getCell(4, 4).note = { texts: [{ text: 'looks high' }] };
    }
    const out = new Uint8Array(await book.xlsx.writeBuffer());
    const parsed = await parseWorkbook(out, defs);
    expect(parsed.issues).toEqual(baseline.issues);
    const byKey = (rows: readonly ParsedRow[]): Map<string, ParsedRow> =>
      new Map(rows.map((r) => [rowKey('x', r.key, r.member), { ...r, rowNumber: 0 }]));
    for (const sheet of baseline.sheets) {
      const after = parsedSheet(parsed, sheet.name);
      expect(after.rows.length).toBe(sheet.rows.length);
      expect(byKey(after.rows)).toEqual(byKey(sheet.rows));
    }
    // The order really changed.
    expect(parsedSheet(parsed, 'Line_Items').rows[0]?.key).not.toBe(
      parsedSheet(baseline, 'Line_Items').rows[0]?.key,
    );
  });
});

// ----------------------------------------------------------------------------------------------
// Rows: new, duplicate, missing key, blank spare rows, hashes
// ----------------------------------------------------------------------------------------------

describe('parseWorkbook: rows', () => {
  it('skips the blank spare rows, reads a typed blank-key row of a table sheet as new and a blank-key row elsewhere as an issue', async () => {
    const baseline = await parseWorkbook(bytes, defs);
    const book = await freshBook();
    const li = sheetOf(book, 'Line_Items');
    const next = li.rowCount + 1;
    li.getCell(next, colOf(li, 'Name')).value = 'New platform';
    li.getCell(next, colOf(li, 'Pool id')).value = 'internal_labour';
    li.getCell(next, colOf(li, 'CY26 normalized outlay per line (opex + cash capex)')).value =
      '12%';
    const tg = sheetOf(book, 'Targets');
    tg.getCell(tg.rowCount + 1, colOf(tg, 'Note')).value = 'orphan note';
    const parsed = parseLoadedWorkbook(book, defs);

    const rows = parsedSheet(parsed, 'Line_Items').rows;
    expect(rows.length).toBe(parsedSheet(baseline, 'Line_Items').rows.length + 1);
    const added = rows[rows.length - 1] as ParsedRow;
    expect(added).toMatchObject({
      key: '',
      isNew: true,
      action: null,
      exportedHash: null,
      rowNumber: next,
    });
    expect(added.cells['name']).toBe('New platform');
    expect(added.cells['line.amount']).toBe(0.12);
    expect(rows.filter((r) => r.isNew)).toHaveLength(1);
    expect(parsedSheet(parsed, 'Targets').rows.length).toBe(
      parsedSheet(baseline, 'Targets').rows.length,
    );
    expect(parsed.issues.find((i) => i.code === 'missing_key')).toMatchObject({
      sheet: 'Targets',
      row: tg.rowCount,
    });
  });

  it('reports a key that appears twice and still returns both rows', async () => {
    const book = await freshBook();
    const ws = sheetOf(book, 'Workforce');
    const r = rowOf(ws, 'hc.us');
    const dup = ws.rowCount + 1;
    for (let c = 1; c <= ws.columnCount; c += 1) ws.getCell(dup, c).value = ws.getCell(r, c).value;
    const parsed = parseLoadedWorkbook(book, defs);
    expect(parsedSheet(parsed, 'Workforce').rows.filter((x) => x.key === 'hc.us')).toHaveLength(2);
    expect(parsed.issues.find((i) => i.code === 'duplicate_row')).toMatchObject({
      sheet: 'Workforce',
      row: dup,
    });
  });

  it('reads Overrides pins by node and member, and the Org_Map row check is not a cell', async () => {
    const parsed = await parseWorkbook(bytes, defs);
    const pin = parsedRow(parsed, 'Overrides', 'res.net', '');
    expect(pin.cells).toMatchObject({
      node_key: 'res.net',
      member_key: null,
      value: 12.5,
      reason: 'board pin',
    });
    expect(pin.isNew).toBe(false);
    const dom = parsedSheet(parsed, 'Org_Map').rows[0] as ParsedRow;
    expect(Object.keys(dom.cells)).not.toContain('row_check');
    expect(parsedSheet(parsed, 'Org_Map').columns.some((c) => c.id === 'row_check')).toBe(true);
  });

  it('export then parse unchanged: every snapshot cell and every row hash is read back equal', async () => {
    const parsed = await parseWorkbook(bytes, defs);
    const found = new Map<string, unknown>();
    const hashes = new Map<string, { exported: string | null; computed: string | null }>();
    for (const sheet of parsed.sheets)
      for (const row of sheet.rows) {
        for (const [id, v] of Object.entries(row.cells))
          found.set(snapshotKey(sheet.name, row.key, row.member, id), v);
        hashes.set(rowKey(sheet.name, row.key, row.member), {
          exported: row.exportedHash,
          computed: row.hash,
        });
      }
    const misses = Object.entries(snapshot.cells).filter(
      ([k, v]) => !found.has(k) || found.get(k) !== v,
    );
    expect(misses.slice(0, 5)).toEqual([]);
    expect(Object.keys(snapshot.cells).length).toBeGreaterThan(3000);
    const bad = Object.entries(snapshot.rowHashes).filter(([k, h]) => {
      const got = hashes.get(k);
      return got?.exported !== h || got.computed !== h;
    });
    expect(bad.slice(0, 5)).toEqual([]);
    expect(Object.keys(snapshot.rowHashes).length).toBeGreaterThan(300);
  });

  it('an edited cell changes that row hash and no other', async () => {
    const baseline = await parseWorkbook(bytes, defs);
    const book = await freshBook();
    const ws = sheetOf(book, 'Targets');
    const r = rowOf(ws, 'g.target_net');
    ws.getCell(r, colOf(ws, 'Default')).value = '35%';
    const parsed = parseLoadedWorkbook(book, defs);
    const changed: string[] = [];
    for (const sheet of parsed.sheets)
      for (const row of sheet.rows) {
        const was = parsedRow(baseline, sheet.name, row.key, row.member);
        if (row.hash !== was.hash) changed.push(`${sheet.name}/${row.key}`);
        expect(row.exportedHash).toBe(was.exportedHash);
      }
    expect(changed).toEqual(['Targets/g.target_net']);
    expect(parsedRow(parsed, 'Targets', 'g.target_net').cells['default']).toBe(0.35);
  });
});
