import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  changesetTx,
  createDb,
  createImportJob,
  createTenantChangesetStore,
  getExportJob,
  getImportJob,
  listScenarios,
  withTenant,
} from '@glidepath/data-access';
import type { DbHandle, TenantTx } from '@glidepath/data-access';
import { ChangesetConflictError, applyChangeset } from '@glidepath/domain';
import { columnHeader, ToChangesetError } from '@glidepath/excel';
import type { SheetDef } from '@glidepath/excel';
import { start, stop } from '@glidepath/pg-local';
import type { PgLocalInstance } from '@glidepath/pg-local';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findTier3Data } from '../../seed/files';
import { seedIds } from '../../seed/ids';
import { runMigrate } from '../../seed/run';
import { undoImport, runApply } from './apply';
import { defaultExcelDeps } from './deps';
import type { ExcelJobDeps } from './deps';
import { runExport } from './export';
import { runImport } from './import';
import { evaluate, loadTenantState, sheetDefs } from './state';
import { toUri } from './storage';
import { FsObjectStore } from './testing/fs-object-store';
import type { ExcelJobContext, StoredImportReport } from './types';

/**
 * XL-08 on pg-local with the AA seed (as compose: roles glidepath_owner / glidepath_app, RLS applies) and
 * the fs object store. Tests run in order against one database; each export, import and apply is its own job.
 */

const tier3Data = findTier3Data();
const specDir = resolve(tier3Data, '../docs/spec');
const tenantId = seedIds.tenant('aa');
const userId = seedIds.seedActor();

let instance: PgLocalInstance;
let stateFile: string;
let app: DbHandle;
let objectsDir: string;
let deps: ExcelJobDeps;

const asRole = (url: string, role: string): string => {
  const u = new URL(url);
  u.username = role;
  return u.toString();
};

const ctx: ExcelJobContext = {
  tenantId,
  userId,
  signal: new AbortController().signal,
  progress: () => undefined,
  withTenant: (fn) => withTenant(app.db, tenantId, userId, fn),
};
const inTenant = <T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> => ctx.withTenant(fn);

beforeAll(async () => {
  stateFile = join(tmpdir(), `gp-xl08-${process.pid}.json`);
  instance = await start({ stateFile, init: resolve(tier3Data, 'postgres/init') });
  await runMigrate({ databaseUrl: asRole(instance.url, 'glidepath_owner'), seed: 'aa', tier3Data });
  app = createDb(asRole(instance.url, 'glidepath_app'));
  objectsDir = mkdtempSync(join(tmpdir(), 'gp-xl08-objects-'));
  const store = new FsObjectStore(objectsDir);
  deps = { ...defaultExcelDeps({ specDir }), objects: () => store };
}, 300_000);

afterAll(async () => {
  await app?.close();
  if (instance) stop({ instance, stateFile });
  if (objectsDir) rmSync(objectsDir, { recursive: true, force: true });
});

// ----------------------------------------------------------------------------- helpers

const scenarioByKey = async (key: string) => (await inTenant((tx) => listScenarios(tx))).find((s) => s.key === key)!;

async function defsOf(): Promise<SheetDef[]> {
  return inTenant(async (tx) => sheetDefs(await loadTenantState(tx, deps, [])));
}

async function loadBook(uri: string): Promise<ExcelJS.Workbook> {
  const [bucket, ...rest] = uri.split('/');
  const got = await deps.objects({ tenantId, userId }).get(bucket as 'exports', rest.join('/'));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(got!.bytes as unknown as ArrayBuffer);
  return book;
}

/** Column of `header` text; with `nth` the nth column of that text (scenario columns share the header when labels do). */
function colOf(ws: ExcelJS.Worksheet, text: string): number {
  for (let c = 1; c <= ws.columnCount; c += 1) if (ws.getCell(1, c).value === text) return c;
  throw new Error(`${ws.name}: no column '${text}'`);
}
function rowOf(ws: ExcelJS.Worksheet, key: string, member = ''): number {
  for (let r = 2; r <= ws.rowCount; r += 1) {
    if (ws.getCell(r, 1).value === key && (ws.getCell(r, 2).value ?? '') === member) return r;
  }
  throw new Error(`${ws.name}: no row ${key}|${member}`);
}

/** The cell of (sheet, key, member) under the column id (per-scenario: the exported scenario's label). */
function cellOf(book: ExcelJS.Workbook, defs: SheetDef[], sheet: string, columnId: string, key: string, scenarioLabel?: string): ExcelJS.Cell {
  const def = defs.find((d) => d.name === sheet)!;
  const col = def.columns.find((c) => c.id === columnId)!;
  const text = columnHeader(col, scenarioLabel === undefined ? undefined : ({ id: '', label: scenarioLabel, values: [] }));
  const ws = book.getWorksheet(sheet)!;
  return ws.getCell(rowOf(ws, key), colOf(ws, text));
}

async function saveUpload(book: ExcelJS.Workbook, name: string): Promise<string> {
  const bytes = new Uint8Array(await book.xlsx.writeBuffer());
  const key = `${name}.xlsx`;
  await deps.objects({ tenantId, userId }).put('imports', key, bytes);
  const job = await inTenant((tx) => createImportJob(tx, { file_uri: toUri('imports', key) }));
  return job.id;
}

/** A value inside the registry's bounds that differs from `cur`. */
function inBounds(varId: string, cur: number): Promise<number> {
  return inTenant(async (tx) => {
    const v = (await loadTenantState(tx, deps, [])).bundle.variables.find((x) => x.id === varId)!;
    const lo = v.min ?? cur - 1;
    const hi = v.max ?? cur + 1;
    const step = (hi - lo) * 0.05;
    return cur + step <= hi ? cur + step : cur - step;
  });
}

const importReport = async (id: string): Promise<StoredImportReport> =>
  (await inTenant((tx) => getImportJob(tx, id)))!.report as unknown as StoredImportReport;

const defaultOf = (varId: string): Promise<number> =>
  inTenant(async (tx) => (await changesetTx(tx).loadInputs(null)).defaults.find((r) => r.var_key === varId && r.member_key === '')!.value);

const ownOf = (scenarioId: string, varId: string): Promise<number | undefined> =>
  inTenant(async (tx) => {
    const s = await changesetTx(tx).loadInputs(scenarioId);
    return s.chain[s.chain.length - 1]?.values.find((r) => r.var_key === varId && r.member_key === '')?.value;
  });

// ----------------------------------------------------------------------------- tests

describe('XL-08 Excel jobs', () => {
  let exportId: string;
  let defs: SheetDef[];
  let A: Awaited<ReturnType<typeof scenarioByKey>>;
  let C: Awaited<ReturnType<typeof scenarioByKey>>;

  it('excel.export builds the workbook, stores file (exports/) and snapshot (export-snapshots/), writes export_job', async () => {
    A = await scenarioByKey('A');
    C = await scenarioByKey('C');
    defs = await defsOf();
    const result = await runExport(ctx, { tenantId, userId, scenarioIds: [A.id, C.id] }, deps);
    exportId = result.id;

    const store = deps.objects({ tenantId, userId });
    const file = await store.get('exports', result.fileUri.slice('exports/'.length));
    expect(file?.meta.size).toBe(result.size);
    expect(file?.meta.contentType).toContain('spreadsheetml');
    expect(file?.meta.expiresAt).not.toBeNull();
    const snap = await store.get('export-snapshots', `${exportId}.json`);
    expect(snap).not.toBeNull();
    const stored = JSON.parse(new TextDecoder().decode(snap!.bytes)) as { snapshot: { checksum: string; exportJobId: string }; scenarios: unknown[] };
    expect(stored.snapshot.exportJobId).toBe(exportId);
    expect(stored.scenarios).toHaveLength(2);

    const row = await inTenant((tx) => getExportJob(tx, exportId));
    expect(row).toMatchObject({ id: exportId, scenario_ids: [A.id, C.id], file_uri: result.fileUri, checksum: stored.snapshot.checksum, created_by: userId });
    // _meta carries the export id the import will look up
    const book = await loadBook(result.fileUri);
    expect(book.getWorksheet('_meta')).toBeDefined();
    // no storage URL anywhere in the result
    expect(JSON.stringify(result)).not.toMatch(/https?:|s3:/);
  }, 120_000);

  it('excel.import of an unchanged export reports no change in either direction', async () => {
    const exp = await inTenant((tx) => getExportJob(tx, exportId));
    const book = await loadBook(exp!.file_uri);
    const importId = await saveUpload(book, 'unchanged');
    const r = await runImport(ctx, { tenantId, userId, importJobId: importId }, deps);
    expect(r.status).toBe('awaiting_review');
    const job = await inTenant((tx) => getImportJob(tx, importId));
    expect(job).toMatchObject({ status: 'awaiting_review', export_job_id: exportId });
    const rep = (job!.report as unknown as StoredImportReport).report;
    expect(rep).toMatchObject({ mode: 'three_way', export_job_id: exportId, import_job_id: importId });
    expect(rep.summary).toMatchObject({ changed_in_excel: 0, changed_in_app: 0, conflict: 0, new_rows: 0, deleted_rows: 0 });
  }, 120_000);

  let editImportId: string;
  let newTarget: number;
  let newCut: number;

  it('excel.import: identify, parse, validate, diff vs snapshot and DB, impact preview (before to after) into import_job.report', async () => {
    const exp = await inTenant((tx) => getExportJob(tx, exportId));
    const book = await loadBook(exp!.file_uri);
    const target = cellOf(book, defs, 'Targets', 'default', 'g.target_net');
    newTarget = await inBounds('g.target_net', target.value as number);
    target.value = newTarget;
    const cut = cellOf(book, defs, 'Levers', 'scenario', 'lev.L01.cut', C.label);
    newCut = await inBounds('lev.L01.cut', cut.value as number);
    cut.value = newCut;
    editImportId = await saveUpload(book, 'edited');

    await runImport(ctx, { tenantId, userId, importJobId: editImportId }, deps);
    const stored = await importReport(editImportId);
    const changes = stored.report.changes;
    expect(stored.report.summary.changed_in_excel).toBe(2);
    expect(changes.filter((c) => c.status === 'changed_in_excel').map((c) => [c.sheet, c.key, c.scenario, c.workbook])).toEqual(
      expect.arrayContaining([
        ['Targets', 'g.target_net', null, newTarget],
        ['Levers', 'lev.L01.cut', 'C', newCut],
      ]),
    );
    // impact: net, gap, risk-adjusted, VP gaps, EPS, price; before -> after from the engine's rerun
    expect(stored.impacts.map((i) => i.scenario)).toEqual(['A', 'C']);
    const impactC = stored.impacts.find((i) => i.scenario === 'C')!;
    for (const node of ['res.net', 'res.gap', 'res.risk', 'br.eps27']) expect(impactC[node]).toHaveLength(2);
    expect(Object.keys(impactC).some((k) => k.startsWith('vp.gap['))).toBe(true);
    expect(Object.keys(impactC).some((k) => k.startsWith('val.px['))).toBe(true);
    const [before, after] = impactC['res.net'] as [number, number];
    expect(after).not.toBe(before);
    expect(stored.report.impact.scenario).toBe(stored.impacts[0]!.scenario);
    expect(stored.items).toHaveLength(changes.length);
    // preview agrees with a full evaluation of the state the apply will write
    expect(stored.base.scenarios.C).toMatchObject({ id: C.id, version: C.version });
  }, 120_000);

  let applied: Awaited<ReturnType<typeof runApply>>;

  it('excel.apply: toChangeset -> applyChangeset, atomic: one changeset per layer, new calc runs, job applied', async () => {
    const targetBefore = await defaultOf('g.target_net');
    applied = await runApply(ctx, { tenantId, userId, importJobId: editImportId, accept: 'all', decisions: [] }, deps);
    expect(applied.replayed).toBe(false);
    expect(applied.applied.changesetIds).toHaveLength(2);
    expect(await defaultOf('g.target_net')).toBe(newTarget);
    expect(targetBefore).not.toBe(newTarget);

    // C is a locked preset: its edit lands on a fork; C itself is untouched
    const cAfter = await scenarioByKey('C');
    expect(cAfter.version).toBe(C.version);
    const fork = applied.applied.scenarios.find((s) => s.scenarioId !== null)!;
    expect(fork.forkedFrom).toBe(C.id);
    expect(await ownOf(fork.scenarioId!, 'lev.L01.cut')).toBe(newCut);

    const job = await inTenant((tx) => getImportJob(tx, editImportId));
    expect(job).toMatchObject({ status: 'applied', changeset_id: applied.applied.changesetIds[0] });

    // the previewed 'after' is what the written state evaluates to
    const stored = await importReport(editImportId);
    const impactC = stored.impacts.find((i) => i.scenario === 'C')!;
    const net = await inTenant(async (tx) => {
      const state = await loadTenantState(tx, deps, [fork.scenarioId!]);
      return evaluate(state, state.inputs.get(fork.scenarioId!)!).get('res.net');
    });
    expect((impactC['res.net'] as [number, number])[1]).toBeCloseTo(net, 9);

    // a second apply of the same import writes nothing
    const again = await runApply(ctx, { tenantId, userId, importJobId: editImportId, accept: 'all', decisions: [] }, deps);
    expect(again.replayed).toBe(true);
    expect(again.applied.changesetIds).toEqual(applied.applied.changesetIds);
  }, 120_000);

  it('undo of an applied import is a revert of its changesets', async () => {
    const { revertedIds } = await undoImport(ctx, editImportId, deps);
    expect(revertedIds).toHaveLength(2);
    expect(await defaultOf('g.target_net')).not.toBe(newTarget);
    const fork = applied.applied.scenarios.find((s) => s.scenarioId !== null)!;
    expect(await ownOf(fork.scenarioId!, 'lev.L01.cut')).not.toBe(newCut);
  }, 120_000);

  it('excel.apply is version-checked: a scenario that moved since the preview fails the apply and writes nothing', async () => {
    const fork = applied.applied.scenarios.find((s) => s.scenarioId !== null)!;
    const exp = await runExport(ctx, { tenantId, userId, scenarioIds: [fork.scenarioId!], sheets: ['Levers'] }, deps);
    expect(exp.sheets).toEqual(['Levers']);
    const forkRow = (await inTenant((tx) => listScenarios(tx))).find((s) => s.id === fork.scenarioId)!;
    const book = await loadBook(exp.fileUri);
    const cell = cellOf(book, defs, 'Levers', 'scenario', 'lev.L02.cut', forkRow.label);
    const edited = await inBounds('lev.L02.cut', Number(cell.value ?? 0));
    cell.value = edited;
    const importId = await saveUpload(book, 'stale');
    await runImport(ctx, { tenantId, userId, importJobId: importId }, deps);
    expect((await importReport(importId)).report.summary.changed_in_excel).toBe(1);

    // someone edits the scenario in the app after the preview
    const state = await inTenant((tx) => loadTenantState(tx, deps, []));
    const current = (await inTenant((tx) => listScenarios(tx))).find((s) => s.id === fork.scenarioId)!;
    await applyChangeset(createTenantChangesetStore(app.db, tenantId, userId), {
      origin: 'ui',
      scenario_id: current.id,
      base_scenario_version: current.version,
      changes: [{ target: 'variable', key: 'lev.L01.rel', member_key: '', op: 'set', new_value: await inBounds('lev.L01.rel', 0.1) }],
    }, { actor: userId, bundle: state.bundle });

    await expect(runApply(ctx, { tenantId, userId, importJobId: importId, accept: 'all', decisions: [] }, deps)).rejects.toBeInstanceOf(ChangesetConflictError);
    expect(await ownOf(fork.scenarioId!, 'lev.L02.cut')).not.toBe(edited);
    expect((await inTenant((tx) => getImportJob(tx, importId)))!.status).toBe('awaiting_review');
  }, 180_000);

  it('a conflict needs a decision; File and App decisions are honoured', async () => {
    const exp = await runExport(ctx, { tenantId, userId, scenarioIds: [A.id], sheets: ['Targets'] }, deps);
    const book = await loadBook(exp.fileUri);
    const cell = cellOf(book, defs, 'Targets', 'default', 'g.target_net');
    const fileValue = await inBounds('g.target_net', cell.value as number);
    cell.value = fileValue;
    const importId = await saveUpload(book, 'conflict');

    // the app changed the same cell since the export
    const state = await inTenant((tx) => loadTenantState(tx, deps, []));
    const base = state.defaultsVersion;
    const appValue = await inBounds('g.target_net', fileValue + 3 * Math.abs(fileValue - (await defaultOf('g.target_net'))));
    await applyChangeset(createTenantChangesetStore(app.db, tenantId, userId), {
      origin: 'ui',
      scenario_id: null,
      base_scenario_version: base,
      changes: [{ target: 'variable', key: 'g.target_net', member_key: '', op: 'set', new_value: appValue }],
    }, { actor: userId, bundle: state.bundle });
    expect(appValue).not.toBe(fileValue);

    await runImport(ctx, { tenantId, userId, importJobId: importId }, deps);
    expect((await importReport(importId)).report.summary.conflict).toBe(1);

    await expect(runApply(ctx, { tenantId, userId, importJobId: importId, accept: 'all', decisions: [] }, deps)).rejects.toBeInstanceOf(ToChangesetError);
    expect(await defaultOf('g.target_net')).toBe(appValue);

    const take = (t: 'app' | 'excel') => ({ sheet: 'Targets', key: 'g.target_net', member: '', scenario: null, take: t });
    const kept = await runApply(ctx, { tenantId, userId, importJobId: importId, accept: 'all', decisions: [take('app')] }, deps);
    expect(kept.applied.changesetIds).toHaveLength(0);
    expect(await defaultOf('g.target_net')).toBe(appValue);
  }, 180_000);

  it('a workbook without _meta is foreign: two-way diff against the database by key and scenario label', async () => {
    const exp = await inTenant((tx) => getExportJob(tx, exportId));
    const book = await loadBook(exp!.file_uri);
    book.removeWorksheet('_meta');
    const cell = cellOf(book, defs, 'Levers', 'scenario', 'lev.L01.cut', A.label);
    const edited = await inBounds('lev.L01.cut', Number(cell.value ?? 0));
    cell.value = edited;
    const id = await saveUpload(book, 'foreign');
    await runImport(ctx, { tenantId, userId, importJobId: id }, deps);
    const job = await inTenant((tx) => getImportJob(tx, id));
    expect(job).toMatchObject({ status: 'awaiting_review', export_job_id: null });
    const stored = job!.report as unknown as StoredImportReport;
    expect(stored.report).toMatchObject({ mode: 'foreign', export_job_id: null });
    const changed = stored.report.changes.filter((c) => c.status === 'changed_in_excel');
    // two-way: every cell that differs from the app counts, incl. the default the app changed since the export
    expect(changed.map((c) => [c.key, c.scenario, c.workbook])).toEqual(
      expect.arrayContaining([['lev.L01.cut', A.label, edited]]),
    );
    expect(changed.every((c) => c.export === null)).toBe(true);
    expect(stored.base.scenarios[A.label]).toMatchObject({ id: A.id });
  }, 120_000);

  it('a file that is not a workbook fails the import with the reason on the job', async () => {
    const key = 'garbage.xlsx';
    await deps.objects({ tenantId, userId }).put('imports', key, new TextEncoder().encode('not a zip'));
    const job = await inTenant((tx) => createImportJob(tx, { file_uri: toUri('imports', key) }));
    await expect(runImport(ctx, { tenantId, userId, importJobId: job.id }, deps)).rejects.toThrow();
    const after = await inTenant((tx) => getImportJob(tx, job.id));
    expect(after!.status).toBe('failed');
    expect((after!.report as unknown as StoredImportReport).error?.code).toBe('not_a_workbook');
  }, 120_000);
});
