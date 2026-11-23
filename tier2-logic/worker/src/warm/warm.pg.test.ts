import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDb, getSolverRun, listScenarios, listSolverRuns, sql, withTenant } from '@glidepath/data-access';
import type { DbHandle, TenantTx } from '@glidepath/data-access';
import { start, stop } from '@glidepath/pg-local';
import type { PgLocalInstance } from '@glidepath/pg-local';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The API's side of the cache (JOB-02): the submit path the cockpit's solver route uses. Imported by path so the
// test checks the warmer against the real thing; the worker does not depend on the server at run time.
import { cacheKeyOf as serverKeyOf } from '../../../server/src/jobs/cache';
import { paramsHash as serverParamsHash } from '../../../server/src/jobs/params-hash';
import { createSolverSubmitter } from '../../../server/src/jobs/submit';
import { defaultSolverDeps } from '../jobs/solver/deps';
import type { SolverJobDeps } from '../jobs/solver/types';
import { findTier3Data } from '../seed/files';
import { seedIds } from '../seed/ids';
import { optionsFromEnv } from '../seed/args';
import { runMigrate } from '../seed/run';
import { cacheKeyOf, paramsHash } from './cache-key';
import { parseWarmArgs } from './args';
import { WARM_JOBS, warmTenant } from './warm';

/**
 * JOB-04 on pg-local with the AA seed (compose-like roles; the app role is the one RLS applies to).
 * Monte Carlo runs its default 2,000 iterations: that is what the demo pre-runs.
 */

const tier3Data = findTier3Data();
const specDir = resolve(tier3Data, '../docs/spec');
const tenantId = seedIds.tenant('aa');
const userId = seedIds.seedActor();

let instance: PgLocalInstance;
let stateFile: string;
let app: DbHandle;
let owner: DbHandle;
let ownerUrl: string;
let deps: SolverJobDeps;

const asRole = (url: string, role: string): string => {
  const u = new URL(url);
  u.username = role;
  return u.toString();
};
const inTenant = <T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> => withTenant(app.db, tenantId, userId, fn);

beforeAll(async () => {
  stateFile = join(tmpdir(), `gp-job04-${process.pid}.json`);
  instance = await start({ stateFile, init: resolve(tier3Data, 'postgres/init') });
  ownerUrl = asRole(instance.url, 'glidepath_owner');
  await runMigrate({ databaseUrl: ownerUrl, seed: 'aa', tier3Data });
  app = createDb(asRole(instance.url, 'glidepath_app'));
  owner = createDb(ownerUrl, { poolMax: 2 });
  deps = defaultSolverDeps({ specDir });
}, 300_000);

afterAll(async () => {
  await app?.close();
  await owner?.close();
  if (instance) stop({ instance, stateFile });
});

const doneRuns = async (): Promise<{ problem: string; preset: string }[]> => {
  const scenarios = await inTenant((tx) => listScenarios(tx));
  const runs = await inTenant((tx) => listSolverRuns(tx, { status: 'done', limit: 100 }));
  return runs
    .map((r) => ({
      problem: (r.spec as { problem: string }).problem,
      preset: scenarios.find((s) => s.id === r.scenario_id)!.key,
    }))
    .sort((a, b) => `${a.problem}${a.preset}`.localeCompare(`${b.problem}${b.preset}`));
};

describe('JOB-04 demo cache warmer (pg-local, seeded tenant)', () => {
  it('pre-runs Monte Carlo for C and D, min-risk and VP-feasible from C; a second run is all cache hits', async () => {
    const first = await warmTenant({ db: app.db, tenantId, userId, deps });
    expect(first.entries.map((e) => `${e.problem}:${e.preset}:${e.status}`)).toEqual([
      'monte_carlo:C:ran',
      'monte_carlo:D:ran',
      'min_risk_mix:C:ran',
      'vp_feasible:C:ran',
    ]);
    expect([first.ran, first.hits, first.failed, first.skipped]).toEqual([4, 0, 0, 0]);
    expect(await doneRuns()).toEqual([
      { problem: 'min_risk_mix', preset: 'C' },
      { problem: 'monte_carlo', preset: 'C' },
      { problem: 'monte_carlo', preset: 'D' },
      { problem: 'vp_feasible', preset: 'C' },
    ]);
    // Each finished run carries a result; the demo tenant is left as seeded (no scenario saved).
    const scenarios = await inTenant((tx) => listScenarios(tx));
    expect(scenarios.some((s) => s.kind === 'solver')).toBe(false);
    for (const e of first.entries) {
      const run = (await inTenant((tx) => getSolverRun(tx, e.runId!)))!;
      expect(run.status).toBe('done');
      expect(run.result_scenario_id).toBeNull();
      expect((run.result as { problem: string }).problem).toBe(e.problem);
    }

    const second = await warmTenant({ db: app.db, tenantId, userId, deps });
    expect(second.entries.map((e) => e.status)).toEqual(['hit', 'hit', 'hit', 'hit']);
    expect([second.ran, second.hits]).toEqual([0, 4]);
    expect(second.entries.map((e) => e.runId)).toEqual(first.entries.map((e) => e.runId));
    expect((await doneRuns()).length).toBe(4);
  }, 300_000);

  it('migrate runs it when WARM=1 (demo profile)', async () => {
    // Without WARM nothing is pre-run; with it the warm step follows the seed and a rerun is all hits.
    await inTenant((tx) => tx.execute(sql`delete from solver_run`));
    const opts = (env: Record<string, string>) =>
      ({ ...optionsFromEnv(['--seed', 'aa'], { DATABASE_URL_MIGRATE: ownerUrl, ...env }), tier3Data, warmDeps: deps });
    expect(opts({}).warm).toBeUndefined();
    expect(opts({ WARM: '0' }).warm).toBeUndefined();
    expect(opts({ WARM: '1' }).warm).toBe(true);

    const cold = await runMigrate(opts({}));
    expect(cold.warm).toBeUndefined();
    expect(await doneRuns()).toEqual([]);

    const warm = await runMigrate(opts({ WARM: '1' }));
    expect(warm.warm?.ran).toBe(4);
    expect(warm.warm?.failed).toBe(0);
    expect((await doneRuns()).length).toBe(4);

    const again = await runMigrate(opts({ WARM: '1' }));
    expect([again.warm?.ran, again.warm?.hits]).toEqual([0, 4]);
  }, 300_000);

  it('Cockpit odds and fastest-path data load from cache in < 200 ms via the API', async () => {
    // Leave the cache warm (the previous test did), then ask the way the cockpit's solver route does.
    const submit = createSolverSubmitter({
      withTenant: (t, u, fn) => withTenant(app.db, t, u, fn),
      enqueue: () => Promise.reject(new Error('a cache hit must not enqueue a job')),
    });
    const scenarios = await inTenant((tx) => listScenarios(tx));
    const idOf = (key: string): string => scenarios.find((s) => s.key === key)!.id;
    for (const job of WARM_JOBS) {
      const t0 = performance.now();
      const out = await submit({
        tenantId: tenantId as never,
        userId: userId as never,
        scenarioId: idOf(job.preset) as never,
        kind: job.kind,
        spec: { problem: job.problem, params: job.params },
      });
      const ms = performance.now() - t0;
      expect(out.cached, `${job.problem} from ${job.preset}`).toBe(true);
      expect(out.jobId).toBeNull();
      expect(out.run.status).toBe('done');
      expect(ms, `${job.problem} from ${job.preset}`).toBeLessThan(200);
      const result = out.run.result as { problem: string; status: string; detail: { iterations: number } };
      expect(result.problem).toBe(job.problem);
      if (job.problem === 'monte_carlo') expect(result.detail.iterations).toBeGreaterThan(0);
      else expect(['optimal', 'feasible', 'infeasible']).toContain(result.status);
    }
  }, 120_000);

  it('files results under the same key the server computes', () => {
    for (const params of [{}, { iterations: 500, seed: 3 }, { b: 1, a: { y: 2, x: [1, undefined] } }, null]) {
      expect(paramsHash(params)).toBe(serverParamsHash(params));
    }
    const spec = { problem: 'monte_carlo', params: { seed: 1, iterations: 10 } };
    expect(cacheKeyOf(spec, 'abc')).toEqual(serverKeyOf(spec, 'abc'));
  });

  it('parses the command line: pnpm warm --tenant aa', () => {
    expect(parseWarmArgs(['--tenant', 'aa'])).toEqual({ tenant: 'aa' });
    expect(parseWarmArgs(['--tenant=aa'])).toEqual({ tenant: 'aa' });
    expect(() => parseWarmArgs([])).toThrow(/--tenant/);
    expect(() => parseWarmArgs(['--tenant'])).toThrow(/slug/);
    expect(() => parseWarmArgs(['--bogus'])).toThrow(/unknown argument/);
  });
});
