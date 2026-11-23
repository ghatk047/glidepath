import { createRequire } from 'node:module';
import { PROBLEM_CONTENT_TYPE, UserId, assertContract } from '@glidepath/api-contract';
import type { ExportResult, ImportApplyResult, ImportJob } from '@glidepath/api-contract';
import { changesetTx, createTenantChangesetStore, withTenant } from '@glidepath/data-access';
import { applyChangeset } from '@glidepath/domain';
import { specBundle } from '@glidepath/testkit';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app/app';
import type { AppEnv } from '../../app/tenant';
import { captureLogger } from '../../app/testing/fixtures';
import { specBundleFromDir } from '../read/spec-source';
import { AA_ID, ANA, CAROL, asUser, presetId, startAaDatabase } from '../read/testing/aa-db';
import type { AaDatabase } from '../read/testing/aa-db';
import { DEFAULT_IMPORT_MAX_BYTES, importMaxBytes } from './limits';
import { safeFileName } from './routes';
import { workerJobs } from './testing/worker-jobs';

// ExcelJS is a dependency of the excel and worker packages, not of the server: load it from the excel package.
interface Cell {
  value: unknown;
}
interface Sheet {
  rowCount: number;
  columnCount: number;
  getCell(row: number, col: number): Cell;
}
interface Book {
  xlsx: { load(b: ArrayBuffer): Promise<unknown>; writeBuffer(): Promise<ArrayBuffer> };
  getWorksheet(name: string): Sheet | undefined;
}
const requireFromExcel = createRequire(new URL('../../../../excel/package.json', import.meta.url));
const ExcelJS = requireFromExcel('exceljs') as { Workbook: new () => Book };

/**
 * API-10 on the AA test database (app role, RLS applies) with the real XL-08 jobs run in-process and the Postgres
 * object store (ADR-025). Tests run in order against one database.
 */

let env: AaDatabase;
let app: Hono<AppEnv>;
let tiny: Hono<AppEnv>;
let jobs: ReturnType<typeof workerJobs>;

const ana = asUser(ANA);
const A = presetId('A');
const json = (headers: Record<string, string>) => ({ ...headers, 'content-type': 'application/json' });
const post = (path: string, body: unknown, who = ana, a: Hono<AppEnv> = app) =>
  a.request(path, { method: 'POST', headers: json(who.headers), body: JSON.stringify(body) });
const get = (path: string, who = ana) => app.request(path, { headers: who.headers });
const upload = (name: string, bytes: Uint8Array, who = ana, a: Hono<AppEnv> = app) =>
  a.request(`/api/t/aa/imports?filename=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { ...who.headers, 'content-type': 'application/octet-stream' },
    body: bytes as unknown as RequestInit['body'],
  });

beforeAll(async () => {
  env = await startAaDatabase();
  jobs = workerJobs(env.app);
  const { logger } = captureLogger();
  const base = {
    logger,
    db: env.app,
    authenticate: (c: { req: { header(n: string): string | undefined } }) => {
      const u = c.req.header('x-test-user');
      return u ? UserId.parse(u) : null;
    },
    membership: env.membership,
    specBundle: specBundleFromDir(),
  };
  app = createApp({ ...base, excel: { jobs: jobs.jobs, objects: jobs.objects, maxUploadBytes: 5 * 1024 * 1024 } });
  tiny = createApp({ ...base, excel: { jobs: jobs.jobs, objects: jobs.objects, maxUploadBytes: 64 } });
}, 180_000);

afterAll(() => env?.close());

// ----------------------------------------------------------------------------- helpers

const loadBook = async (bytes: Uint8Array): Promise<Book> => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return book;
};
const bytesOf = async (book: Book): Promise<Uint8Array> => new Uint8Array(await book.xlsx.writeBuffer());

/** A superuser connection with the tenant's RLS context set (the tables are FORCE RLS). */
function asTenant<T>(fn: (q: <R extends object>(sql: string, args?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
  return env.database.withClient(async (c) => {
    await c.query('begin');
    try {
      await c.query(`select set_config('app.tenant_id', $1, true)`, [AA_ID]);
      const out = await fn(async (sql, args) => (await c.query(sql, args)).rows as never);
      await c.query('commit');
      return out;
    } catch (err) {
      await c.query('rollback');
      throw err;
    }
  });
}

const defaultOf = async (varId: string): Promise<number> =>
  asTenant(async (q) => Number((await q<{ value: string }>(`select value from variable_value where var_key = $1 and member_key = ''`, [varId]))[0]!.value));

const changesetCount = (origin: string): Promise<number> =>
  asTenant(async (q) => Number((await q<{ n: string }>(`select count(*) n from changeset where origin = $1`, [origin]))[0]!.n));

/** A value inside the registry bounds that differs from `cur`. */
const nudge = (cur: number, lo: number, hi: number): number => {
  const step = (hi - lo) * 0.05;
  return cur + step <= hi ? cur + step : cur - step;
};
const BOUNDS = { 'g.target_net': [50, 150], 'g.target_pct': [0.02, 0.2] } as const;

/** Exports sheet Targets of preset A and returns the result and the workbook. */
async function exportTargets(): Promise<{ result: ExportResult; book: Book }> {
  const res = await post('/api/t/aa/exports', { scenarioIds: [A], sheets: ['Targets'] });
  expect(res.status).toBe(201);
  const result = await assertContract('exportCreate', res);
  const dl = await get(`/api/t/aa/files/${result.file.id}`);
  expect(dl.status).toBe(200);
  return { result, book: await loadBook(new Uint8Array(await dl.arrayBuffer())) };
}

/** Sets the Default cell of a Targets row (key in column A, header 'Default'). */
function setDefault(book: Book, key: string, value: number): void {
  const ws = book.getWorksheet('Targets')!;
  let col = 0;
  for (let c = 1; c <= ws.columnCount; c += 1) if (ws.getCell(1, c).value === 'Default') col = c;
  for (let r = 2; r <= ws.rowCount; r += 1) {
    if (ws.getCell(r, 1).value === key) {
      ws.getCell(r, col).value = value;
      return;
    }
  }
  throw new Error(`no row ${key}`);
}

/** The app edits a tenant default after the export (a write that is not through the workbook). */
async function appEditsDefault(key: keyof typeof BOUNDS, value: number): Promise<void> {
  const bundle = await specBundle();
  const base = await withTenant(env.app.db, AA_ID, ANA, async (tx) => (await changesetTx(tx).changesSince(null, 0)).length);
  await applyChangeset(
    createTenantChangesetStore(env.app.db, AA_ID, ANA),
    { origin: 'ui', scenario_id: null, base_scenario_version: base, changes: [{ target: 'variable', key, member_key: '', op: 'set', new_value: value }] },
    { actor: ANA, bundle },
  );
}

/** Uploads a workbook, waits for the preview job and returns the job as GET answers it. */
async function importBook(book: Book, name = 'edited.xlsx'): Promise<ImportJob> {
  const res = await upload(name, await bytesOf(book));
  expect(res.status).toBe(201);
  const started = await assertContract('importCreate', res);
  expect(started.status).toBeNull();
  await jobs.settled();
  const done = await get(`/api/t/aa/imports/${started.id}`);
  expect(done.status).toBe(200);
  return assertContract('importGet', done);
}

const apply = (id: string, body: unknown) => post(`/api/t/aa/imports/${id}/apply`, body);

// ----------------------------------------------------------------------------- acceptance

describe('API-10 Excel and file routes', () => {
  it('export -> job -> files/:id streams the xlsx; no storage URL in any response', async () => {
    const res = await post('/api/t/aa/exports', { scenarioIds: [A, presetId('C')] });
    expect(res.status).toBe(201);
    const raw = await res.clone().text();
    const result = await assertContract('exportCreate', res);
    expect(result).toMatchObject({ format: 'xlsx', scenarioIds: [A, presetId('C')], createdBy: ANA });
    expect(result.sheets).toEqual(expect.arrayContaining(['README', 'Targets', 'Levers', '_lists', '_meta']));
    expect(result.file).toMatchObject({ id: result.id, contentType: expect.stringContaining('spreadsheetml') });
    expect(result.file.size).toBeGreaterThan(1000);
    expect(result.file.expiresAt).not.toBeNull();
    // no bucket, key, file_uri or URL in the answer
    expect(raw).not.toMatch(/https?:|s3:|exports\/|imports\/|export-snapshots|file_uri|bucket/);

    const dl = await get(`/api/t/aa/files/${result.file.id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toContain('spreadsheetml');
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment; filename="aa_it_savings_.*\.xlsx"/);
    expect(dl.headers.get('cache-control')).toContain('no-store');
    const download = await assertContract('fileDownload', dl.clone());
    expect(download.size).toBe(result.file.size);
    expect(download.filename).toBe(result.file.filename);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]); // a zip: xlsx
    expect(bytes.byteLength).toBe(result.file.size);
    const book = await loadBook(bytes);
    expect(book.getWorksheet('Targets')).toBeDefined();
    expect(book.getWorksheet('_meta')).toBeDefined();

    // a stranger to the tenant and an unknown id never get bytes
    expect((await get(`/api/t/aa/files/${result.file.id}`, asUser(CAROL))).status).toBe(404);
    const unknown = await get('/api/t/aa/files/00000000-0000-4000-8000-00000000dead');
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
  }, 120_000);

  it('export refuses what the job refuses with a problem (csv, unknown scenario), and needs a session', async () => {
    const csv = await post('/api/t/aa/exports', { scenarioIds: [A], sheets: ['Targets'], format: 'csv' });
    expect(csv.status).toBe(422);
    const ghost = await post('/api/t/aa/exports', { scenarioIds: ['00000000-0000-4000-8000-00000000beef'] });
    expect(ghost.status).toBe(404);
    const anon = await app.request('/api/t/aa/exports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(anon.status).toBe(401);
  }, 120_000);

  it('import upload (size limit from env) -> preview job; GET returns a contract-valid delta report; apply with decisions creates one changeset', async () => {
    // the limit comes from IMPORT_MAX_BYTES
    expect(importMaxBytes({ IMPORT_MAX_BYTES: '4096' })).toBe(4096);
    expect(importMaxBytes({})).toBe(DEFAULT_IMPORT_MAX_BYTES);
    expect(() => importMaxBytes({ IMPORT_MAX_BYTES: 'big' })).toThrow(/IMPORT_MAX_BYTES/);
    const tooBig = await upload('big.xlsx', new Uint8Array(65), ana, tiny);
    expect(tooBig.status).toBe(413);
    expect(tooBig.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    expect((await upload('empty.xlsx', new Uint8Array(0))).status).toBe(400);

    const { result, book } = await exportTargets();
    const net = nudge(await defaultOf('g.target_net'), ...BOUNDS['g.target_net']);
    setDefault(book, 'g.target_net', net);

    const before = await changesetCount('excel_import');
    const job = await importBook(book);
    expect(job).toMatchObject({ status: 'awaiting_review', exportId: result.id, filename: 'edited.xlsx', changesetId: null, error: null });
    expect(job.progress).toBe(1);
    expect(job.report).toMatchObject({ mode: 'three_way', export_job_id: result.id, import_job_id: job.id });
    expect(job.report!.summary).toMatchObject({ changed_in_excel: 1, changed_in_app: 0, conflict: 0, invalid: 0 });
    expect(job.report!.changes.find((c) => c.status === 'changed_in_excel')).toMatchObject({ sheet: 'Targets', key: 'g.target_net', workbook: net });
    expect(Object.keys(job.report!.impact)).toContain('scenario');
    // nothing is written before the apply
    expect(await defaultOf('g.target_net')).not.toBe(net);
    expect(await changesetCount('excel_import')).toBe(before);

    const res = await apply(job.id, { accept: 'all', decisions: [] });
    expect(res.status).toBe(200);
    const applied: ImportApplyResult = await assertContract('importApply', res);
    expect(applied).toMatchObject({ importId: job.id, editsCount: 1 });
    expect(await defaultOf('g.target_net')).toBe(net);
    expect(await changesetCount('excel_import')).toBe(before + 1); // one changeset

    const after = await assertContract('importGet', await get(`/api/t/aa/imports/${job.id}`));
    expect(after).toMatchObject({ status: 'applied', changesetId: applied.changesetId });
    // applying again writes nothing new
    const again = await assertContract('importApply', await apply(job.id, { accept: 'all', decisions: [] }));
    expect(again.changesetId).toBe(applied.changesetId);
    expect(await changesetCount('excel_import')).toBe(before + 1);
  }, 180_000);

  it('File/App conflict decisions are honoured (and a conflict without a decision is refused)', async () => {
    // --- App wins on the conflicting cell, the other edit still goes in
    const one = await exportTargets();
    const fileNet = nudge(await defaultOf('g.target_net'), ...BOUNDS['g.target_net']);
    const filePct = nudge(await defaultOf('g.target_pct'), ...BOUNDS['g.target_pct']);
    setDefault(one.book, 'g.target_net', fileNet);
    setDefault(one.book, 'g.target_pct', filePct);
    const appNet = nudge(fileNet + 20, ...BOUNDS['g.target_net']);
    await appEditsDefault('g.target_net', appNet); // the same cell changes in the app after the export
    const job = await importBook(one.book, 'conflict-app.xlsx');
    expect(job.report!.summary).toMatchObject({ conflict: 1, changed_in_excel: 1 });
    const conflict = job.report!.changes.find((c) => c.status === 'conflict')!;
    expect(conflict).toMatchObject({ sheet: 'Targets', key: 'g.target_net', workbook: fileNet, current: appNet });

    const refused = await apply(job.id, { accept: 'all', decisions: [] });
    expect(refused.status).toBe(422);
    expect(refused.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    expect(await defaultOf('g.target_pct')).not.toBe(filePct);

    const keepApp = { sheet: conflict.sheet, key: conflict.key, member: conflict.member, scenario: conflict.scenario, take: 'app' as const };
    const ok = await assertContract('importApply', await apply(job.id, { accept: 'all', decisions: [keepApp] }));
    expect(ok.editsCount).toBe(1);
    expect(await defaultOf('g.target_net')).toBe(appNet); // App kept
    expect(await defaultOf('g.target_pct')).toBe(filePct); // the clean edit applied

    // --- File wins on a fresh conflict
    const two = await exportTargets();
    const fileNet2 = nudge(await defaultOf('g.target_net'), ...BOUNDS['g.target_net']);
    setDefault(two.book, 'g.target_net', fileNet2);
    await appEditsDefault('g.target_net', nudge(fileNet2 + 20, ...BOUNDS['g.target_net']));
    const job2 = await importBook(two.book, 'conflict-file.xlsx');
    const c2 = job2.report!.changes.find((c) => c.status === 'conflict')!;
    const takeFile = { sheet: c2.sheet, key: c2.key, member: c2.member, scenario: c2.scenario, take: 'excel' as const };
    await assertContract('importApply', await apply(job2.id, { accept: 'selected', decisions: [takeFile] }));
    expect(await defaultOf('g.target_net')).toBe(fileNet2); // File won
  }, 240_000);

  it('a file that is not a workbook ends the preview failed with a one-line problem; unknown imports are 404', async () => {
    const res = await upload('notes.xlsx', new TextEncoder().encode('this is not a workbook'));
    const started = await assertContract('importCreate', res);
    await jobs.settled();
    const job = await assertContract('importGet', await get(`/api/t/aa/imports/${started.id}`));
    expect(job.status).toBe('failed');
    expect(job.report).toBeNull();
    expect(job.error).toMatchObject({ status: 422, title: 'Import failed' });
    // a failed import cannot be applied
    expect((await apply(started.id, { accept: 'all', decisions: [] })).status).toBe(409);
    expect((await get('/api/t/aa/imports/00000000-0000-4000-8000-00000000dead')).status).toBe(404);
    expect((await apply('00000000-0000-4000-8000-00000000dead', { accept: 'all', decisions: [] })).status).toBe(404);
  }, 120_000);

  it('safeFileName keeps a name safe as a key tail', () => {
    expect(safeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeFileName('a"b\u0000.xlsx')).toBe('ab.xlsx');
    expect(safeFileName('..')).toBe('upload');
  });
});
