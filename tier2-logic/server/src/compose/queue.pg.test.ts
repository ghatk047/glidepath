import { connectionConfig } from '@glidepath/data-access';
import { withTestDatabase } from '@glidepath/testkit';
import type { TestDatabase } from '@glidepath/testkit';
import { PgBoss } from './boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Test wiring only: the worker's installer creates the pg-boss schema and queues as the owner role, as the migrate step does.
import { installQueueSchema } from '../../../worker/src/runtime/install';
import { excelJobsOverQueue } from './excel-jobs';
import { QueueUnavailableError, createJobQueue } from './queue';
import type { JobQueue } from './queue';

/**
 * The server's pg-boss client on a real database: send, await the output of a job a worker ran, the failure a
 * handler threw (name, code and message survive), a missing schema, and the Excel port over it.
 */

const TENANT = '00000000-0000-4000-8000-000000000010';
const USER = '00000000-0000-4000-8000-0000000000e1';

let db: TestDatabase;
let appUrl: string;
let worker: PgBoss;
let queue: JobQueue;
const handled: { queue: string; data: Record<string, unknown> }[] = [];

beforeAll(async () => {
  db = await withTestDatabase();
  await installQueueSchema({ ownerUrl: db.url, queues: ['excel.export', 'excel.import', 'excel.apply', 'solver.echo'] });
  const u = new URL(db.adminUrl);
  u.pathname = `/${db.database}`;
  u.searchParams.set('options', '-c role=glidepath_app');
  appUrl = u.toString();

  worker = new PgBoss({ ...connectionConfig(appUrl), schema: 'pgboss', max: 3, migrate: false, createSchema: false, supervise: false, schedule: false });
  worker.on('error', () => undefined);
  await worker.start();
  const work = (name: string, fn: (data: Record<string, unknown>) => Promise<object>) =>
    worker.work<Record<string, unknown>>(name, { pollingIntervalSeconds: 0.5 }, async (jobs) => {
      const out = [];
      for (const job of jobs) {
        handled.push({ queue: name, data: job.data });
        out.push(await fn(job.data));
      }
      return out[0] as never;
    });
  await work('excel.export', async (d) => ({
    id: d.exportJobId,
    templateVersion: '1.0',
    scenarioIds: d.scenarioIds,
    sheets: ['Targets'],
    fileUri: 'pg://exports/x',
    snapshotUri: 'pg://snapshots/x',
    fileName: 'x.xlsx',
    checksum: 'abc',
    size: 10,
  }));
  await work('excel.apply', async (d) => {
    if (d.importJobId === 'missing') {
      throw Object.assign(new Error('That import does not exist.'), { name: 'ExcelJobError', code: 'import_not_found' });
    }
    return { importJobId: d.importJobId, changesetId: 'cs-1', applied: { scenarios: [], editsCount: 0, warnings: [] }, replayed: false };
  });
  await work('excel.import', async () => ({}));
  queue = createJobQueue({ databaseUrl: appUrl, pollMs: 20, timeoutMs: 15_000 });
}, 180_000);

afterAll(async () => {
  await queue?.close();
  await worker?.stop({ graceful: false, close: true }).catch(() => undefined);
  await db?.close();
});

describe('createJobQueue on pg-boss', () => {
  it('enqueue sends the job and returns its id', async () => {
    const id = await queue.enqueue('solver.echo', { tenantId: TENANT, userId: USER, runId: 'r1' });
    expect(typeof id).toBe('string');
  });

  it('run resolves with the output the worker returned', async () => {
    const out = await queue.run('excel.export', { tenantId: TENANT, userId: USER, exportJobId: 'e1', scenarioIds: ['s1'] });
    expect(out).toMatchObject({ id: 'e1', fileName: 'x.xlsx', scenarioIds: ['s1'] });
  });

  it('run rejects with the handler error: name, code and message are kept', async () => {
    const err = await queue.run('excel.apply', { tenantId: TENANT, userId: USER, importJobId: 'missing' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ name: 'ExcelJobError', code: 'import_not_found', message: 'That import does not exist.' });
  });

  it('run gives up after its timeout when nobody answers (503)', async () => {
    const lonely = await queue.run('solver.echo', { tenantId: TENANT, userId: USER, runId: 'r2' }, { timeoutMs: 300 }).catch((e: unknown) => e);
    expect(lonely).toBeInstanceOf(QueueUnavailableError);
    expect(lonely).toMatchObject({ status: 503 });
  });

  it('the Excel port: export awaits its result, apply maps the outcome, startImport only sends', async () => {
    const jobs = excelJobsOverQueue(queue);
    const who = { tenantId: TENANT, userId: USER };
    const exported = await jobs.exportWorkbook(who, { exportJobId: 'e2', scenarioIds: ['s1'] });
    expect(exported).toEqual({ id: 'e2', templateVersion: '1.0', scenarioIds: ['s1'], sheets: ['Targets'], fileName: 'x.xlsx', checksum: 'abc' });
    const applied = await jobs.applyImport(who, { importJobId: 'i1', accept: 'all', decisions: [] });
    expect(applied).toMatchObject({ changesetId: 'cs-1', applied: { editsCount: 0 } });
    jobs.startImport(who, 'i2');
    const seen = async (): Promise<boolean> => {
      for (let i = 0; i < 100; i++) {
        if (handled.some((h) => h.queue === 'excel.import' && h.data.importJobId === 'i2')) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    };
    expect(await seen()).toBe(true);
    expect(handled.find((h) => h.queue === 'excel.import')?.data).toMatchObject({ tenantId: TENANT, userId: USER, importJobId: 'i2' });
  });
});

describe('without the queue schema', () => {
  it('fails the job with a 503 that says what to fix, and retries on the next job', async () => {
    const bare = await withTestDatabase();
    try {
      const u = new URL(bare.adminUrl);
      u.pathname = `/${bare.database}`;
      u.searchParams.set('options', '-c role=glidepath_app');
      const q = createJobQueue({ databaseUrl: u.toString(), pollMs: 20 });
      const err = await q.enqueue('solver.echo', { tenantId: TENANT, userId: USER, runId: 'r' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(QueueUnavailableError);
      expect(err).toMatchObject({ status: 503 });
      expect((err as Error).message).toContain('not available');
      await installQueueSchema({ ownerUrl: bare.url, queues: ['solver.echo'] });
      expect(typeof (await q.enqueue('solver.echo', { tenantId: TENANT, userId: USER, runId: 'r' }))).toBe('string');
      await q.close();
    } finally {
      await bare.close();
    }
  }, 60_000);
});
