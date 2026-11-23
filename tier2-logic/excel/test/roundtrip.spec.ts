/**
 * Round-trip suite (XL-07, G6): the eight tests of docs/spec/05_excel_template.md section 4 (excel_template.json
 * `round_trip_tests`), run on real ExcelJS buffers of an export of the AA seed, plus the re-save fixtures
 * (LibreOffice, Excel for Mac) and a one-sheet CSV import.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ToChangesetError,
  buildReport,
  buildWorkbook,
  diff,
  rowKey,
  snapshotKey,
  parseWorkbook,
  sameValue,
  toChangeset,
  validateParsed,
  type BuiltReport,
  type ChangesetOptions,
  type ExportSnapshot,
  type ParsedWorkbook,
  type SnapshotValue,
} from '../src/index';
import {
  appValues,
  freshBook,
  header,
  makeFixture,
  put,
  putAt,
  report,
  rowOf,
  sheetOf,
  spareRow,
  type Fixture,
} from '../src/test-support/fixture';

const here = dirname(fileURLToPath(import.meta.url));
const testkitExcel = join(here, '../../../tools/testkit/fixtures/excel');
const HEAVY = 120_000;

let fx: Fixture;
beforeAll(async () => {
  fx = await makeFixture();
}, HEAVY);

const OPTIONS: ChangesetOptions = {
  defaultsVersion: 7,
  scenarios: { A: { id: 'uuid-A', version: 3 }, C: { id: 'uuid-C', version: 5 } },
};

const zeroChanges = (b: BuiltReport): void => {
  expect(b.report.changes).toEqual([]);
  expect(b.unmatched).toEqual([]);
  expect(b.warnings).toEqual([]);
  expect(b.report.summary).toMatchObject({
    changed_in_excel: 0,
    changed_in_app: 0,
    conflict: 0,
    invalid: 0,
    new_rows: 0,
    deleted_rows: 0,
    ignored: 0,
  });
  expect(b.report.summary.unchanged).toBeGreaterThan(3000);
};

/** Reverse the keyed data rows of a sheet in place (a user sorting descending). */
function reverseRows(ws: ExcelJS.Worksheet): void {
  const rows: number[] = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const k = ws.getCell(r, 1).value;
    if (k !== null && k !== '') rows.push(r);
  }
  const copies = rows.map((r) => {
    const out: ExcelJS.CellValue[] = [];
    for (let c = 1; c <= ws.columnCount; c += 1) out.push(ws.getCell(r, c).value);
    return out;
  });
  copies.reverse();
  rows.forEach((r, i) => {
    (copies[i] ?? []).forEach((v, c) => {
      ws.getCell(r, c + 1).value = v;
    });
  });
}

describe('round trip: the eight tests', () => {
  it(
    '(1) export then import unchanged = 0 changes',
    async () => {
      const built = await report(fx, await freshBook(fx));
      zeroChanges(built);
      const plan = toChangeset(built, { accept: 'all', decisions: [] }, OPTIONS);
      expect(plan.drafts).toEqual([]);
      expect(plan.applied).toEqual([]);
    },
    HEAVY,
  );

  it(
    '(2) one cell edited = exactly 1 change',
    async () => {
      const book = await freshBook(fx);
      put(book, 'Targets', 'g.target_net', '', header(fx, 'Targets', 'default'), 101);
      const built = await report(fx, book);
      expect(built.report.changes).toHaveLength(1);
      expect(built.report.changes[0]).toMatchObject({
        sheet: 'Targets',
        key: 'g.target_net',
        member: '',
        scenario: null,
        export: 100,
        workbook: 101,
        current: 100,
        status: 'changed_in_excel',
      });
      expect(built.report.summary).toMatchObject({
        changed_in_excel: 1,
        changed_in_app: 0,
        conflict: 0,
        invalid: 0,
        new_rows: 0,
        deleted_rows: 0,
        ignored: 0,
      });
      const plan = toChangeset(built, { accept: 'all', decisions: [] }, OPTIONS);
      expect(plan.drafts).toHaveLength(1);
      expect(plan.drafts[0]).toMatchObject({ origin: 'excel_import', scenario_id: null });
      expect(plan.drafts[0]?.changes).toHaveLength(1);
      expect(plan.drafts[0]?.changes[0]).toMatchObject({
        target: 'variable',
        key: 'g.target_net',
        new_value: 101,
      });
    },
    HEAVY,
  );

  it(
    '(3) rows sorted and filtered = 0 changes',
    async () => {
      const book = await freshBook(fx);
      for (const name of ['Levers', 'Line_Items', 'Workforce', 'Targets']) {
        const ws = sheetOf(book, name);
        reverseRows(ws);
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
        for (let r = 3; r <= Math.min(ws.rowCount, 40); r += 3) ws.getRow(r).hidden = true;
      }
      zeroChanges(await report(fx, book));
    },
    HEAVY,
  );

  it(
    '(4) same cell edited in app and in Excel = 1 conflict',
    async () => {
      const book = await freshBook(fx);
      put(book, 'Workforce', 'hc.us', '', header(fx, 'Workforce', 'default'), 2800);
      const app = appValues(fx, { defaults: [['hc.us', '', 2700]] });
      const built = await report(fx, book, app);
      expect(built.report.changes).toHaveLength(1);
      expect(built.report.changes[0]).toMatchObject({
        key: 'hc.us',
        export: 3000,
        workbook: 2800,
        current: 2700,
        status: 'conflict',
      });
      expect(built.report.summary.conflict).toBe(1);
      // A conflict is never applied without a decision.
      expect(() => toChangeset(built, { accept: 'all', decisions: [] }, OPTIONS)).toThrow(
        ToChangesetError,
      );
      const take = (t: 'excel' | 'app') =>
        toChangeset(
          built,
          {
            accept: 'all',
            decisions: [{ sheet: 'Workforce', key: 'hc.us', member: '', scenario: null, take: t }],
          },
          OPTIONS,
        );
      expect(take('excel').drafts[0]?.changes[0]).toMatchObject({ key: 'hc.us', new_value: 2800 });
      expect(take('app').drafts).toEqual([]);
    },
    HEAVY,
  );

  it(
    '(5) new line-item row = insert with a new key',
    async () => {
      const book = await freshBook(fx);
      const li = sheetOf(book, 'Line_Items');
      const fresh = spareRow(li);
      putAt(li, fresh, header(fx, 'Line_Items', 'name'), 'New platform');
      putAt(li, fresh, header(fx, 'Line_Items', 'line.amount'), 1.5);
      const built = await report(fx, book);
      expect(built.report.changes).toHaveLength(1);
      expect(built.report.changes[0]).toMatchObject({ sheet: 'Line_Items', status: 'new_row' });
      expect(built.report.summary.new_rows).toBe(1);
      const plan = toChangeset(
        built,
        { accept: 'all', decisions: [] },
        { ...OPTIONS, newMemberKey: () => 'it_new_001' },
      );
      const inserts = plan.drafts
        .flatMap((d) => d.changes)
        .filter((c) => c.target === 'structural' && c.op === 'insert');
      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toMatchObject({ key: 'line', member_key: 'it_new_001' });
      // The key is the app's to assign: without it nothing is written.
      const without = toChangeset(built, { accept: 'all', decisions: [] }, OPTIONS);
      expect(without.drafts).toEqual([]);
      expect(without.skipped.map((s) => s.reason)).toContain('needs_member_key');
    },
    HEAVY,
  );

  it(
    "(6) '35%' typed in a decimal cell = 0.35",
    async () => {
      const book = await freshBook(fx);
      const id = 'wf.change_share'; // a percent input, bounds 0.2 to 0.7
      expect(fx.values.defaults.find((v) => v.var_key === id)?.value).not.toBe(0.35);
      put(book, 'Workforce', id, '', header(fx, 'Workforce', 'default'), '35%');
      const bytes = new Uint8Array(await book.xlsx.writeBuffer());
      const parsed = await parseWorkbook(bytes, fx.defs, { scenarios: fx.scenarios });
      const row = parsed.sheets.find((s) => s.name === 'Workforce')?.rows.find((r) => r.key === id);
      expect(row?.cells['default']).toBe(0.35);
      const built = await report(fx, book);
      expect(built.report.changes).toHaveLength(1);
      expect(built.report.changes[0]).toMatchObject({
        key: id,
        workbook: 0.35,
        status: 'changed_in_excel',
      });
    },
    HEAVY,
  );

  it(
    '(7) value out of range = invalid, not applied',
    async () => {
      const book = await freshBook(fx);
      put(book, 'Levers', 'lev.L08.cut', '', header(fx, 'Levers', 'scenario', 1), 99);
      const built = await report(fx, book);
      expect(built.report.changes).toHaveLength(1);
      expect(built.report.changes[0]).toMatchObject({
        key: 'lev.L08.cut',
        scenario: 'C',
        workbook: 99,
        status: 'invalid',
      });
      expect(built.report.summary.invalid).toBe(1);
      const plan = toChangeset(built, { accept: 'all', decisions: [] }, OPTIONS);
      expect(plan.drafts).toEqual([]);
      expect(plan.applied).toEqual([]);
      expect(plan.skipped.map((s) => s.reason)).toEqual(['invalid']);
    },
    HEAVY,
  );

  it(
    '(8) row deleted without DELETE = warning, no delete',
    async () => {
      const book = await freshBook(fx);
      const li = sheetOf(book, 'Line_Items');
      li.spliceRows(rowOf(li, 'it_003'), 1);
      const built = await report(fx, book);
      const missing = built.report.changes.filter((c) => c.status === 'missing_row');
      expect(missing).toHaveLength(1);
      expect(missing[0]).toMatchObject({ sheet: 'Line_Items' });
      expect(built.report.changes.filter((c) => c.status === 'deleted_row')).toEqual([]);
      expect(built.report.summary.deleted_rows).toBe(0);
      expect(built.report.summary.ignored).toBeGreaterThanOrEqual(1);
      const plan = toChangeset(built, { accept: 'all', decisions: [] }, OPTIONS);
      expect(plan.drafts).toEqual([]);
      expect(plan.skipped.map((s) => s.reason)).toEqual(['missing_row']);
    },
    HEAVY,
  );
});

/** An export snapshot rebuilt from a parsed, untouched export (the same as diff.test.ts). */
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

async function cellsOf(file: string): Promise<Map<string, ExcelJS.CellValue>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out = new Map<string, ExcelJS.CellValue>();
  for (const ws of wb.worksheets)
    ws.eachRow((row, r) => row.eachCell((cell, c) => out.set(`${ws.name}!${r}:${c}`, cell.value)));
  return out;
}

const changedCells = (
  a: Map<string, ExcelJS.CellValue>,
  b: Map<string, ExcelJS.CellValue>,
): string[] =>
  [...a]
    .filter(([k, v]) => {
      const w = b.get(k);
      return typeof v === 'number' && typeof w === 'number' ? !sameValue(v, w) : v !== w;
    })
    .map(([k]) => k);

describe('round trip: re-saved workbooks and CSV', () => {
  const soffice = ((): string | null => {
    try {
      return execFileSync('which', ['soffice'], { encoding: 'utf8' }).trim() || null;
    } catch {
      return null;
    }
  })();

  it.skipIf(soffice === null)(
    'a workbook re-saved by LibreOffice (headless) re-imports with 0 changes',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'gp-xl07-'));
      try {
        mkdirSync(join(dir, 'out'));
        writeFileSync(join(dir, 'export.xlsx'), fx.bytes);
        execFileSync(
          soffice as string,
          [
            `-env:UserInstallation=file://${join(dir, 'profile')}`,
            '--headless',
            '--convert-to',
            'xlsx',
            '--outdir',
            join(dir, 'out'),
            join(dir, 'export.xlsx'),
          ],
          { stdio: 'ignore', timeout: HEAVY },
        );
        const resaved = readFileSync(join(dir, 'out', 'export.xlsx'));
        expect(resaved.equals(Buffer.from(fx.bytes))).toBe(false);
        const W = await parseWorkbook(resaved, fx.defs, { scenarios: fx.scenarios });
        expect(W.mode).toBe('export');
        const D = buildWorkbook(fx.defs, fx.values, fx.meta).snapshot;
        const built = buildReport(diff(fx.snapshot, W, D, fx.defs), validateParsed(W, fx.vb), {
          exportJobId: fx.meta.exportJobId,
        });
        zeroChanges(built);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    HEAVY,
  );

  it(
    'the LibreOffice re-save fixture of an export re-imports with 0 changes',
    async () => {
      const dirF = join(here, '../fixtures');
      const E = await parseWorkbook(readFileSync(join(dirF, 'precision_export.xlsx')), fx.defs);
      const W = await parseWorkbook(
        readFileSync(join(dirF, 'precision_export_libreoffice.xlsx')),
        fx.defs,
      );
      expect(E.mode).toBe('export');
      expect(W.mode).toBe('export');
      const snap = snapshotOf(E);
      const e2e = diff(snap, W, snap, fx.defs);
      expect(e2e.cells).toEqual([]);
      expect(e2e.rows).toEqual([]);
    },
    HEAVY,
  );

  it(
    'testkit: a LibreOffice re-save of the small baseline has the same cells (0 changes)',
    async () => {
      const base = await cellsOf(join(testkitExcel, 'inputs_small.xlsx'));
      const resaved = await cellsOf(join(testkitExcel, 'inputs_small_libreoffice.xlsx'));
      expect([...resaved.keys()].sort()).toEqual([...base.keys()].sort());
      expect(changedCells(base, resaved)).toEqual([]);
      // Control: the same comparison sees the one edited cell.
      const edited = await cellsOf(join(testkitExcel, 'inputs_small_edited.xlsx'));
      expect(changedCells(base, edited)).toHaveLength(1);
    },
    HEAVY,
  );

  // PENDING: the owner saves inputs_small.xlsx once in Excel for Mac and drops it in tools/testkit/fixtures/excel
  // (index.json `pending` says so). The test runs by itself as soon as the file exists.
  const macFile = join(testkitExcel, 'inputs_small_excel_mac.xlsx');
  it.skipIf(!existsSync(macFile))(
    'an Excel-for-Mac fixture re-imports with 0 changes (pending: file saved by the owner on the Mac)',
    async () => {
      const base = await cellsOf(join(testkitExcel, 'inputs_small.xlsx'));
      expect(changedCells(base, await cellsOf(macFile))).toEqual([]);
    },
    HEAVY,
  );

  it(
    'a CSV of one sheet imports via two-way diff',
    async () => {
      const book = await freshBook(fx);
      const csv = Buffer.from(await book.csv.writeBuffer({ sheetName: 'Workforce' })).toString(
        'utf8',
      );
      expect(csv).toContain('hc.us');
      const fromCsv = async (text: string): Promise<Uint8Array> => {
        const wb = new ExcelJS.Workbook();
        await wb.csv.read(Readable.from([text]), { sheetName: 'Workforce' });
        return new Uint8Array(await wb.xlsx.writeBuffer());
      };
      const D = buildWorkbook(fx.defs, fx.values, fx.meta).snapshot;

      // The CSV as exported: foreign (no _meta), nothing differs from the database.
      const same = await parseWorkbook(await fromCsv(csv), fx.defs, { scenarios: fx.scenarios });
      expect(same.mode).toBe('foreign');
      const r0 = diff(null, same, D, fx.defs);
      expect(r0.mode).toBe('foreign');
      expect(r0.cells).toEqual([]);

      // One value edited in the CSV text: one change against the database.
      const lines = csv.split('\n');
      const col = (lines[0] ?? '').split(',').indexOf(header(fx, 'Workforce', 'default'));
      expect(col).toBeGreaterThan(-1);
      const edited = lines
        .map((ln) => {
          if (!ln.startsWith('hc.us,')) return ln;
          const f = ln.split(',');
          f[col] = '2800';
          return f.join(',');
        })
        .join('\n');
      const W = await parseWorkbook(await fromCsv(edited), fx.defs, { scenarios: fx.scenarios });
      const built = buildReport(diff(null, W, D, fx.defs), validateParsed(W, fx.vb), {});
      expect(built.report.mode).toBe('foreign');
      expect(built.report.changes).toHaveLength(1);
      expect(built.report.changes[0]).toMatchObject({
        sheet: 'Workforce',
        key: 'hc.us',
        workbook: 2800,
        current: 3000,
        status: 'changed_in_excel',
      });
    },
    HEAVY,
  );
});
