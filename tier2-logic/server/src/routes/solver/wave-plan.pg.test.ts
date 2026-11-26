import { SolverRun, UserId, assertContract } from '@glidepath/api-contract';
import type { SolverLookup } from '@glidepath/api-contract';
import { getSolverRun, listScenarios, updateSolverRun, withTenant } from '@glidepath/data-access';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app/app';
import type { AppEnv } from '../../app/tenant';
import { bindWithTenant } from '../../app/tenant';
import { captureLogger } from '../../app/testing/fixtures';
import { createSolverSubmitter } from '../../jobs';
import { dbScenarioLoader } from '../../session';
// Test wiring only (as solver.pg.test.ts): the worker's own solver handler runs the job this server enqueued.
import { defaultSolverDeps } from '../../../../worker/src/jobs/solver/deps';
import { registerSolverHandlers } from '../../../../worker/src/jobs/solver/register';
import { runSolverJob } from '../../../../worker/src/jobs/solver/run';
import type { SolverJobPayload } from '../../../../worker/src/jobs/solver/types';
import { HandlerRegistry } from '../../../../worker/src/runtime';
import { specBundleFromDir } from '../read/spec-source';
import { AA_ID, ANA, asUser, presetId, startAaDatabase } from '../read/testing/aa-db';
import type { AaDatabase } from '../read/testing/aa-db';
import { seedAaSourcing } from '../sourcing/testing/sourcing-seed';
import type { SourcingSeedDims } from '../sourcing/testing/sourcing-seed';
import { WAVE_PLAN_PARAMS } from './wave-plan';

/**
 * SRC-15 on the AA test database (app role, RLS applies) with the AA sourcing members: a `wave_plan` run is queued on
 * `solver.wave_plan` with the tenant's `sourcing_param` defaults filled in, the worker's handler runs it with progress,
 * a feasible plan is saved as a `solver` scenario with its ranked moves (preset C under the seed caps is feasible).
 */

let env: AaDatabase;
let app: Hono<AppEnv>;
let dims: SourcingSeedDims;
const sent: { queue: string; payload: SolverJobPayload }[] = [];
let defaultsRun: { id: string; stored: unknown } | undefined;

const ana = asUser(ANA);
const C = presetId('C');
const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { ...ana.headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (path: string) => app.request(path, { headers: ana.headers });
const inTenant = <T>(fn: Parameters<typeof withTenant<T>>[3]) => withTenant(env.app.db, AA_ID, ANA, fn);

const seedValue = (id: string): number => dims.sourcing_param.find((m) => m.id === id)!.value as number;

/** Runs an enqueued job through the worker's own handler, recording progress. */
async function work(payload: SolverJobPayload, progress: number[] = []) {
  return runSolverJob(
    {
      tenantId: AA_ID,
      userId: ANA,
      payload,
      signal: new AbortController().signal,
      progress: (f) => void progress.push(f),
      withTenant: (fn) => inTenant(fn),
    },
    { problem: 'wave_plan' },
    defaultSolverDeps(),
  );
}

beforeAll(async () => {
  env = await startAaDatabase();
  dims = await seedAaSourcing(env.database.url, AA_ID, ANA);
  const { logger } = captureLogger();
  const withTenantFn = bindWithTenant(env.app.db);
  const specBundle = specBundleFromDir();
  const submit = createSolverSubmitter({
    withTenant: withTenantFn,
    enqueue: async (queue, payload) => {
      sent.push({ queue, payload: payload as SolverJobPayload });
      return `job-${sent.length}`;
    },
    inputHashOf: async () => 'input-hash-1',
  });
  app = createApp({
    logger,
    db: env.app,
    authenticate: (c: { req: { header(n: string): string | undefined } }) => {
      const u = c.req.header('x-test-user');
      return u ? UserId.parse(u) : null;
    },
    membership: env.membership,
    specBundle,
    solver: { loader: dbScenarioLoader({ withTenant: withTenantFn, specBundle }), submit, specBundle, inputHashOf: async () => 'input-hash-1' },
  });
}, 180_000);

afterAll(() => env?.close());

describe('SRC-15 wave_plan runs as a solver job', () => {
  it('the worker serves solver.wave_plan on a core queue (no flag)', () => {
    const reg = new HandlerRegistry();
    registerSolverHandlers(reg, () => defaultSolverDeps());
    expect(reg.get('solver.wave_plan')).toBeDefined();
  });

  it('POST with params omitted: queued on solver.wave_plan, the tenant caps filled in from sourcing_param; the job reports progress; a feasible plan is saved as a solver scenario', async () => {
    const before = sent.length;
    const res = await post('/api/t/aa/solver-runs', { scenarioId: C, spec: { problem: 'wave_plan', params: {} } });
    const run = await assertContract('solverRunStart', res);
    expect(run).toMatchObject({ status: 'queued', scenarioId: C });
    expect((await inTenant((tx) => getSolverRun(tx, run.id)))?.kind).toBe('optimize');
    const filled = {
      quarterlyOneTimeCap: seedValue(WAVE_PLAN_PARAMS.quarterlyOneTimeCap),
      maxLaunchesPerQuarter: seedValue(WAVE_PLAN_PARAMS.maxLaunchesPerQuarter),
      window: { from: seedValue(WAVE_PLAN_PARAMS.earliestStart), to: seedValue(WAVE_PLAN_PARAMS.latestStart) },
    };
    expect(run.spec).toEqual({ problem: 'wave_plan', params: filled });
    expect(sent[before]).toEqual({ queue: 'solver.wave_plan', payload: { tenantId: AA_ID, userId: ANA, runId: run.id, save: false } });

    const progress: number[] = [];
    const out = await work({ ...sent[before]!.payload, save: true }, progress);
    defaultsRun = { id: run.id, stored: out.stored };
    expect(progress.length).toBeGreaterThan(2);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    const detail = out.result.detail as { readonly quarters: readonly { cap: number | null; launchCap: number | null; launches: number }[] };
    expect(detail.quarters.map((q) => [q.cap, q.launchCap])).toEqual(
      Array.from({ length: 4 }, () => [filled.quarterlyOneTimeCap, filled.maxLaunchesPerQuarter]),
    );
    for (const q of detail.quarters) expect(q.launches).toBeLessThanOrEqual(filled.maxLaunchesPerQuarter);
    // Preset C under the seed caps (one-time charged to IT): a feasible plan, saved, the caps that bind named.
    expect(['optimal', 'feasible']).toContain(out.result.status);
    expect(out.saved).not.toBeNull();
    expect(out.result.binding!.length).toBeGreaterThan(0);
    expect(out.result.ranked.length).toBe(out.result.changes.length);
  }, 120_000);

  it('a feasible plan with save: true becomes a solver scenario with the ranked start-month moves; GET answers the contract result', async () => {
    const before = sent.length;
    const count = (await inTenant((tx) => listScenarios(tx))).length;
    const params = { quarterlyOneTimeCap: 20, maxLaunchesPerQuarter: 5 };
    const run = await assertContract('solverRunStart', await post('/api/t/aa/solver-runs', { scenarioId: C, spec: { problem: 'wave_plan', params }, save: true }));
    // Fields the request sent win; the window is the tenant's.
    expect(run.spec.params).toMatchObject({ ...params, window: { from: 1, to: 12 } });
    const out = await work(sent[before]!.payload);
    expect(['optimal', 'feasible']).toContain(out.result.status);
    expect(out.result.ranked.length).toBe(out.result.changes.length);
    expect(out.result.ranked.length).toBeGreaterThan(0);
    for (const m of out.result.ranked) expect(m.cell).toMatch(/^lev\.start\[L\d\d\]$/);
    expect(out.saved).not.toBeNull();

    const scenarios = await inTenant((tx) => listScenarios(tx));
    expect(scenarios.length).toBe(count + 1);
    const saved = scenarios.find((s) => s.id === out.saved!.id)!;
    expect(saved).toMatchObject({ kind: 'solver' });
    expect(saved.label).toMatch(/^Wave plan/);

    const row = (await inTenant((tx) => getSolverRun(tx, run.id)))!;
    expect(row.result_scenario_id).toBe(out.saved!.id);
    expect(row.result).toMatchObject({ problem: 'wave_plan', resultScenarioId: out.saved!.id });
    // The worker runtime marks the finished job done; here the test does.
    await inTenant((tx) => updateSolverRun(tx, run.id, { status: 'done', progress: 1 }));
    const answered = await assertContract('solverRunGet', await get(`/api/t/aa/solver-runs/${run.id}`));
    expect(answered.result?.problem).toBe('wave_plan');
    expect(answered.result?.detail).toMatchObject({ problem: 'wave_plan' });
    expect(answered.result?.ranked[0]?.cell).toMatch(/^lev\.start\[L\d\d\]$/);
    SolverRun.parse(answered);
  }, 120_000);

  it('lookup with params omitted finds the run filed with the tenant defaults', async () => {
    // The worker runtime marks a finished job done with its stored result; here the test does.
    await inTenant((tx) => updateSolverRun(tx, defaultsRun!.id, { status: 'done', progress: 1, result: defaultsRun!.stored as never }));
    const res = await get(`/api/t/aa/solver-runs/lookup?scenarioId=${C}&problem=wave_plan`);
    expect(res.status).toBe(200);
    const answer = (await res.json()) as SolverLookup;
    expect(answer.run?.id).toBe(defaultsRun!.id);
    expect(answer.current).toBe(true);
    expect(answer.run?.result?.problem).toBe('wave_plan');
  });

  it('a request value out of range is 422', async () => {
    const res = await post('/api/t/aa/solver-runs', { scenarioId: C, spec: { problem: 'wave_plan', params: { maxLaunchesPerQuarter: 0 } } });
    expect(res.status).toBe(422);
  });
});
