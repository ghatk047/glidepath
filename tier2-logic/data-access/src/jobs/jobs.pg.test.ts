import { getTestDatabaseUrl } from '@glidepath/pg-local';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db';
import type { DbHandle } from '../db';
import { migrate } from '../migrate';
import { ai_reconfig_job, export_job, import_job, solver_run } from '../schema';
import { TenantScopeError } from '../scope';
import { withTenant } from '../tenant';
import type { TenantTx } from '../tenant';
import { createAppRoleDb } from '../testing/app-db';
import { ANA, BOB, CS, SCN, TENANT_A, TENANT_B, seedMinimal, twinB } from '../testing/minimal-seed';
import { createOwnedDatabase } from '../testing/owner-db';
import type { OwnedDatabase } from '../testing/owner-db';
import {
  createAiReconfigJob,
  createExportJob,
  createImportJob,
  createSolverRun,
  deleteAiReconfigJob,
  deleteExportJob,
  deleteImportJob,
  deleteSolverRun,
  getAiReconfigJob,
  getExportJob,
  getImportJob,
  getSolverRun,
  listAiReconfigJobs,
  listExportJobs,
  listImportJobs,
  listSolverRuns,
  updateAiReconfigJob,
  updateExportJob,
  updateImportJob,
  updateSolverRun,
} from './index';

/** DATA-06 job repositories on pg-local: CRUD per job table, tenant scope, RLS (as glidepath_app). */

let owned: OwnedDatabase;
let owner: DbHandle;
let app: DbHandle;

beforeAll(async () => {
  const adminUrl = await getTestDatabaseUrl();
  owned = await createOwnedDatabase(adminUrl);
  await migrate(owned.url);
  owner = createDb(owned.url);
  await seedMinimal(owner.db);
  app = createAppRoleDb(adminUrl, owned.database);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await owned?.drop();
});

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super('rollback');
  }
}
/** Runs `fn` in a withTenant transaction that is rolled back; returns what `fn` returned. */
async function scratch<T>(tenantId: string, userId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  try {
    await withTenant(app.db, tenantId, userId, async (tx) => {
      throw new Rollback(await fn(tx));
    });
  } catch (e) {
    if (e instanceof Rollback) return e.value as T;
    throw e;
  }
  throw new Error('unreachable');
}
const asA = <T>(fn: (tx: TenantTx) => Promise<T>) => scratch(TENANT_A, ANA, fn);

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GC = SCN.grandchild!;

describe('job repositories (DATA-06): solver_run, export_job, import_job, ai_reconfig_job CRUD on pg-local', () => {
  it('solver_run: create (queued, empty result, progress 0), get, list newest first with filters, update (progress, status, result, cancel), delete', async () => {
    await asA(async (tx) => {
      const spec = { goal: 'net', target: 120, nested: { a: [1, 2, null] } };
      const run = await createSolverRun(tx, { kind: 'goal_seek', scenario_id: GC, spec, created_at: '2026-11-20T10:00:00.000Z' });
      expect(run).toMatchObject({
        kind: 'goal_seek', scenario_id: GC, spec, status: 'queued', result: {}, result_scenario_id: null, progress: 0,
        progress_note: null, cancel_requested: false, created_at: '2026-11-20T10:00:00.000Z',
      });
      expect(run.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await getSolverRun(tx, run.id)).toEqual(run);

      const second = await createSolverRun(tx, { id: uuid(0xa1), kind: 'monte_carlo', scenario_id: GC, spec: null, created_at: '2026-11-21T10:00:00.000Z' });
      expect(second.id).toBe(uuid(0xa1));
      expect(second.spec).toBeNull(); // JSON null survives a NOT NULL jsonb column
      await createSolverRun(tx, { kind: 'blend', scenario_id: SCN.child!, spec: {}, status: 'running', created_at: '2026-11-19T10:00:00.000Z' });
      expect((await listSolverRuns(tx)).map((r) => r.kind)).toEqual(['monte_carlo', 'goal_seek', 'blend']);
      expect((await listSolverRuns(tx, { status: 'running' })).map((r) => r.kind)).toEqual(['blend']);
      expect((await listSolverRuns(tx, { scenarioId: GC })).map((r) => r.kind)).toEqual(['monte_carlo', 'goal_seek']);
      expect((await listSolverRuns(tx, { limit: 1 })).map((r) => r.kind)).toEqual(['monte_carlo']);
      expect(await listSolverRuns(tx, { scenarioId: 'nope' })).toEqual([]);

      const upd = await updateSolverRun(tx, run.id, { status: 'running', progress: 0.5, progress_note: 'iteration 3' });
      expect(upd).toMatchObject({ status: 'running', progress: 0.5, progress_note: 'iteration 3', result: {} });
      expect(new Date(upd!.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(run.updated_at).getTime());
      expect(await updateSolverRun(tx, run.id, { cancel_requested: true })).toMatchObject({ cancel_requested: true, status: 'running' });
      const done = await updateSolverRun(tx, run.id, { status: 'done', progress: 1, result: { x: 1 }, result_scenario_id: SCN.root!, progress_note: null });
      expect(done).toMatchObject({ status: 'done', progress: 1, result: { x: 1 }, result_scenario_id: SCN.root, progress_note: null });
      expect(await getSolverRun(tx, run.id)).toEqual(done);
      expect(await updateSolverRun(tx, uuid(0xdead), { progress: 1 })).toBeNull();
      expect(await updateSolverRun(tx, 'nope', { progress: 1 })).toBeNull();

      expect(await deleteSolverRun(tx, run.id)).toBe(true);
      expect(await deleteSolverRun(tx, run.id)).toBe(false);
      expect(await getSolverRun(tx, run.id)).toBeNull();
      expect(await getSolverRun(tx, 'nope')).toBeNull();
      expect(await deleteSolverRun(tx, 'nope')).toBe(false);
    });
  });

  it('export_job: create, get, list newest first, update (file, checksum, snapshot), delete', async () => {
    await asA(async (tx) => {
      const input = {
        template_version: '1.0.0', scenario_ids: [GC, SCN.child!], snapshot: { 'g.target_net[]': 130 }, file_uri: 'exports/a.xlsx',
        checksum: 'sha256:abc', created_by: ANA, created_at: '2026-11-20T10:00:00.000Z',
      };
      const job = await createExportJob(tx, input);
      expect(job).toMatchObject(input);
      expect(await getExportJob(tx, job.id)).toEqual(job);
      const later = await createExportJob(tx, { ...input, id: uuid(0xb1), scenario_ids: [], created_at: '2026-11-21T10:00:00.000Z' });
      expect(later.scenario_ids).toEqual([]);
      expect((await listExportJobs(tx)).map((j) => j.id)).toEqual([later.id, job.id]);
      expect((await listExportJobs(tx, 1)).map((j) => j.id)).toEqual([later.id]);
      const upd = await updateExportJob(tx, job.id, { file_uri: 'exports/b.xlsx', checksum: 'sha256:def', snapshot: null });
      expect(upd).toMatchObject({ file_uri: 'exports/b.xlsx', checksum: 'sha256:def', snapshot: null, template_version: '1.0.0' });
      expect(await updateExportJob(tx, job.id, {})).toEqual(upd);
      expect(await updateExportJob(tx, uuid(0xdead), { checksum: 'x' })).toBeNull();
      expect(await deleteExportJob(tx, job.id)).toBe(true);
      expect(await deleteExportJob(tx, job.id)).toBe(false);
      expect(await getExportJob(tx, job.id)).toBeNull();
      expect(await getExportJob(tx, 'nope')).toBeNull();
    });
  });

  it('import_job: create (parsed, empty report), get, list by status, update (status, changeset, report), delete', async () => {
    await asA(async (tx) => {
      const exportJob = await createExportJob(tx, { template_version: '1', scenario_ids: [], snapshot: {}, file_uri: 'e', checksum: 'c', created_by: ANA });
      const job = await createImportJob(tx, { id: uuid(0xc1), file_uri: 'imports/a.xlsx', export_job_id: exportJob.id });
      expect(job).toEqual({ id: uuid(0xc1), export_job_id: exportJob.id, file_uri: 'imports/a.xlsx', status: 'parsed', changeset_id: null, report: {} });
      expect(await getImportJob(tx, job.id)).toEqual(job);
      const foreign = await createImportJob(tx, { id: uuid(0xc2), file_uri: 'imports/b.xlsx', status: 'failed', report: { error: 'bad sheet' } });
      expect(foreign.export_job_id).toBeNull();
      expect((await listImportJobs(tx)).map((j) => j.id)).toEqual([uuid(0xc1), uuid(0xc2)]);
      expect((await listImportJobs(tx, 'failed')).map((j) => j.id)).toEqual([uuid(0xc2)]);
      const upd = await updateImportJob(tx, job.id, { status: 'applied', changeset_id: CS.c1, report: { rows: 12, conflicts: [] } });
      expect(upd).toMatchObject({ status: 'applied', changeset_id: CS.c1, report: { rows: 12, conflicts: [] }, file_uri: 'imports/a.xlsx' });
      expect(await updateImportJob(tx, job.id, { changeset_id: null })).toMatchObject({ changeset_id: null, status: 'applied' });
      expect(await updateImportJob(tx, job.id, {})).toMatchObject({ status: 'applied' });
      expect(await updateImportJob(tx, uuid(0xdead), { status: 'failed' })).toBeNull();
      expect(await deleteImportJob(tx, job.id)).toBe(true);
      expect(await deleteImportJob(tx, job.id)).toBe(false);
      expect(await getImportJob(tx, job.id)).toBeNull();
      expect(await getImportJob(tx, 'nope')).toBeNull();
    });
  });

  it('ai_reconfig_job: create, get, list by status, update (plan, status, changeset), delete', async () => {
    await asA(async (tx) => {
      const job = await createAiReconfigJob(tx, { id: uuid(0xd1), prompt: 'Make me an airline', status: 'running' });
      expect(job).toEqual({ id: uuid(0xd1), prompt: 'Make me an airline', plan: {}, status: 'running', changeset_id: null });
      expect(await getAiReconfigJob(tx, job.id)).toEqual(job);
      await createAiReconfigJob(tx, { id: uuid(0xd2), prompt: 'p2', plan: { members: ['a'] }, status: 'done' });
      expect((await listAiReconfigJobs(tx)).map((j) => j.id)).toEqual([uuid(0xd1), uuid(0xd2)]);
      expect((await listAiReconfigJobs(tx, 'done')).map((j) => j.id)).toEqual([uuid(0xd2)]);
      const upd = await updateAiReconfigJob(tx, job.id, { plan: { members: [], values: { 'g.target_net': 1 } }, status: 'applied', changeset_id: CS.c1 });
      expect(upd).toMatchObject({ plan: { members: [], values: { 'g.target_net': 1 } }, status: 'applied', changeset_id: CS.c1, prompt: 'Make me an airline' });
      expect(await updateAiReconfigJob(tx, job.id, {})).toEqual(upd);
      expect(await updateAiReconfigJob(tx, uuid(0xdead), { status: 'x' })).toBeNull();
      expect(await deleteAiReconfigJob(tx, job.id)).toBe(true);
      expect(await deleteAiReconfigJob(tx, job.id)).toBe(false);
      expect(await getAiReconfigJob(tx, job.id)).toBeNull();
      expect(await getAiReconfigJob(tx, 'nope')).toBeNull();
    });
  });

  it('tenant scope: jobs of another tenant are neither visible, changed nor deleted; tenant_id always comes from the scope', async () => {
    const ids = {
      solver: uuid(0xe1), exp: uuid(0xe2), imp: uuid(0xe3), ai: uuid(0xe4),
    };
    // committed rows of tenant B
    await withTenant(app.db, TENANT_B, BOB, async (tx) => {
      await createSolverRun(tx, { id: ids.solver, kind: 'goal_seek', scenario_id: twinB(GC), spec: { b: true } });
      await createExportJob(tx, { id: ids.exp, template_version: '1', scenario_ids: [], snapshot: {}, file_uri: 'f', checksum: 'c', created_by: BOB });
      await createImportJob(tx, { id: ids.imp, file_uri: 'f' });
      await createAiReconfigJob(tx, { id: ids.ai, prompt: 'p', status: 's' });
    });
    try {
      await asA(async (tx) => {
        expect(await getSolverRun(tx, ids.solver)).toBeNull();
        expect(await getExportJob(tx, ids.exp)).toBeNull();
        expect(await getImportJob(tx, ids.imp)).toBeNull();
        expect(await getAiReconfigJob(tx, ids.ai)).toBeNull();
        expect(await listSolverRuns(tx)).toEqual([]);
        expect(await listExportJobs(tx)).toEqual([]);
        expect(await listImportJobs(tx)).toEqual([]);
        expect(await listAiReconfigJobs(tx)).toEqual([]);
        expect(await updateSolverRun(tx, ids.solver, { status: 'cancelled' })).toBeNull();
        expect(await updateExportJob(tx, ids.exp, { checksum: 'x' })).toBeNull();
        expect(await updateImportJob(tx, ids.imp, { status: 'failed' })).toBeNull();
        expect(await updateAiReconfigJob(tx, ids.ai, { status: 'x' })).toBeNull();
        expect(await deleteSolverRun(tx, ids.solver)).toBe(false);
        expect(await deleteExportJob(tx, ids.exp)).toBe(false);
        expect(await deleteImportJob(tx, ids.imp)).toBe(false);
        expect(await deleteAiReconfigJob(tx, ids.ai)).toBe(false);
        // a row created here carries the scope's tenant, whatever else is passed
        const mine = await createImportJob(tx, { id: uuid(0xe5), file_uri: 'mine' });
        const [raw] = await tx.select().from(import_job).where(eq(import_job.id, mine.id));
        expect(raw?.tenant_id).toBe(TENANT_A);
        // an id that exists in B cannot be taken over by creating it here (the primary key sees it)
        await expect(createImportJob(tx, { id: ids.imp, file_uri: 'x' })).rejects.toThrow();
      });
      // B's rows are intact
      await withTenant(app.db, TENANT_B, BOB, async (tx) => {
        expect((await getSolverRun(tx, ids.solver))?.status).toBe('queued');
        expect((await getExportJob(tx, ids.exp))?.checksum).toBe('c');
        expect((await getImportJob(tx, ids.imp))?.status).toBe('parsed');
        expect((await getAiReconfigJob(tx, ids.ai))?.status).toBe('s');
      });
    } finally {
      await withTenant(app.db, TENANT_B, BOB, async (tx) => {
        await tx.delete(solver_run).where(eq(solver_run.id, ids.solver));
        await tx.delete(export_job).where(eq(export_job.id, ids.exp));
        await tx.delete(import_job).where(eq(import_job.id, ids.imp));
        await tx.delete(ai_reconfig_job).where(eq(ai_reconfig_job.id, ids.ai));
      });
    }
  });

  it('refuses a transaction that is not the one of a live withTenant (TenantScopeError)', async () => {
    await app.db.transaction(async (bare) => {
      await expect(createSolverRun(bare, { kind: 'goal_seek', scenario_id: GC, spec: {} })).rejects.toThrow(TenantScopeError);
      await expect(listExportJobs(bare)).rejects.toThrow(TenantScopeError);
      await expect(getImportJob(bare, uuid(1))).rejects.toThrow(TenantScopeError);
      await expect(deleteAiReconfigJob(bare, uuid(1))).rejects.toThrow(TenantScopeError);
    });
  });

  it('writing a job row with another tenant_id fails the RLS WITH CHECK', async () => {
    const msg = (e: unknown): string => `${(e as Error).message} ${(e as { cause?: Error }).cause?.message ?? ''}`;
    const attempts: Record<string, (tx: TenantTx) => PromiseLike<unknown>> = {
      solver_run: (tx) => tx.insert(solver_run).values({ tenant_id: TENANT_B, id: uuid(0xf1), kind: 'goal_seek', scenario_id: GC, spec: {}, status: 'queued', result: {}, result_scenario_id: null, created_at: new Date() }),
      export_job: (tx) => tx.insert(export_job).values({ tenant_id: TENANT_B, id: uuid(0xf2), template_version: '1', scenario_ids: [], snapshot: {}, file_uri: 'f', checksum: 'c', created_by: ANA, created_at: new Date() }),
      import_job: (tx) => tx.insert(import_job).values({ tenant_id: TENANT_B, id: uuid(0xf3), export_job_id: null, file_uri: 'f', status: 'parsed', changeset_id: null, report: {} }),
      ai_reconfig_job: (tx) => tx.insert(ai_reconfig_job).values({ tenant_id: TENANT_B, id: uuid(0xf4), prompt: 'p', plan: {}, status: 's', changeset_id: null }),
    };
    for (const [table, attempt] of Object.entries(attempts)) {
      const err = await withTenant(app.db, TENANT_A, ANA, async (tx) => attempt(tx).then(() => null, (e: unknown) => e));
      expect(err, `${table} accepted a row of another tenant`).not.toBeNull();
      expect(msg(err)).toMatch(/row-level security/);
    }
    // moving one of A's own rows to B (UPDATE ... SET tenant_id) fails the WITH CHECK as well
    const err = await withTenant(app.db, TENANT_A, ANA, async (tx) => {
      const job = await createImportJob(tx, { file_uri: 'mine' });
      return tx.update(import_job).set({ tenant_id: TENANT_B }).where(eq(import_job.id, job.id)).then(() => null, (e: unknown) => e);
    });
    expect(msg(err)).toMatch(/row-level security/);
  });
});
