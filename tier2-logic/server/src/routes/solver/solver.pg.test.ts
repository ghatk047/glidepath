import { PROBLEM_CONTENT_TYPE, SolverRun, TenantId, UserId, assertContract } from '@glidepath/api-contract';
import type { QuickSolverSpec, SolverLookup } from '@glidepath/api-contract';
import { MONTE_CARLO_DEFAULTS, decisionSet } from '@glidepath/solvers';
import { REFERENCE_DECISION_BOUNDS } from '@glidepath/spec';
import { getScenario, getSolverRun, listScenarios, listSolverRuns, updateSolverRun, withTenant } from '@glidepath/data-access';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app/app';
import type { AppEnv } from '../../app/tenant';
import { bindWithTenant } from '../../app/tenant';
import { captureLogger } from '../../app/testing/fixtures';
import { createSolverSubmitter } from '../../jobs';
import { dbScenarioLoader } from '../../session';
// Test wiring only (as compose/queue.pg.test.ts): the worker's own solver handler runs the job this server enqueued.
import { defaultSolverDeps } from '../../../../worker/src/jobs/solver/deps';
import { runSolverJob } from '../../../../worker/src/jobs/solver/run';
import type { SolverJobPayload } from '../../../../worker/src/jobs/solver/types';
import { specBundleFromDir } from '../read/spec-source';
import { solverModelFor } from './model';
import { AA_ID, ANA, BOB, CAROL, MINE, asUser, presetId, startAaDatabase } from '../read/testing/aa-db';
import type { AaDatabase } from '../read/testing/aa-db';

/**
 * API-09 on the AA test database (app role, RLS applies): quick runs on the session's model, the 2 s limit and
 * the job fallback, enqueue / status / cancel of worker jobs, and the contract of every answer. The last two
 * describes are API-13: the side-effect-free lookup, and `save` on the job data (honoured by JOB-03's handler).
 */

let env: AaDatabase;
let app: Hono<AppEnv>;
let slow: Hono<AppEnv>;
let other: Hono<AppEnv>;
const sent: { queue: string; payload: { tenantId: string; userId: string; runId: string; save: boolean } }[] = [];

const ana = asUser(ANA);
const C = presetId('C');
const D = presetId('D');
const json = (headers: Record<string, string>) => ({ ...headers, 'content-type': 'application/json' });
const post = (path: string, body: unknown, who = ana, a: Hono<AppEnv> = app) =>
  a.request(path, { method: 'POST', headers: json(who.headers), body: JSON.stringify(body) });
const get = (path: string, who = ana) => app.request(path, { headers: who.headers });
const del = (path: string, who = ana) => app.request(path, { method: 'DELETE', headers: who.headers });

const quick = (spec: unknown, extra: Record<string, unknown> = {}, a: Hono<AppEnv> = app) =>
  post('/api/t/aa/solver-runs/quick', { scenarioId: C, spec, ...extra }, ana, a);

beforeAll(async () => {
  env = await startAaDatabase();
  const { logger } = captureLogger();
  const withTenantFn = bindWithTenant(env.app.db);
  const specBundle = specBundleFromDir();
  const loader = dbScenarioLoader({ withTenant: withTenantFn, specBundle });
  const submit = createSolverSubmitter({
    withTenant: withTenantFn,
    enqueue: async (queue, payload) => {
      sent.push({ queue, payload });
      return `job-${sent.length}`;
    },
    // The seed has no calc_run: a fixed hash turns the result cache on for the tests that look at it.
    inputHashOf: async () => 'input-hash-1',
  });
  const base = {
    logger,
    db: env.app,
    authenticate: (c: { req: { header(n: string): string | undefined } }) => {
      const u = c.req.header('x-test-user');
      return u ? UserId.parse(u) : null;
    },
    membership: env.membership,
    specBundle,
  };
  const solver = { loader, submit, specBundle, inputHashOf: async () => 'input-hash-1' };
  app = createApp({ ...base, solver });
  slow = createApp({ ...base, solver: { ...solver, quickLimitMs: 0 } });
  // The same tenant after its inputs changed: another input hash, so earlier runs are out of date.
  other = createApp({ ...base, solver: { ...solver, inputHashOf: async () => 'input-hash-2' } });
}, 180_000);

afterAll(() => env?.close());

const asRun = async (res: Response): Promise<SolverRun> => assertContract('solverRunQuick', res);

describe('POST solver-runs/quick runs the short solvers on the session model', () => {
  it('goal_seek: solves one input to a target and passes assertContract', async () => {
    // The start value is the answer for its own output: a target the scan always brackets.
    const base = await asRun(await quick({ problem: 'sensitivity', params: { method: 'tornado', outputs: ['res.net[]'] } }));
    const net = base.result!.metrics['res.net[]']!;
    const run = await asRun(await quick({ problem: 'goal_seek', params: { var: 'lev.L01.cut[]', output: 'res.net[]', target: net } }));
    expect(run).toMatchObject({ quick: true, status: 'done', progress: 1, cached: false, cancelRequested: false, scenarioId: C });
    expect(run.result).toMatchObject({ problem: 'goal_seek', status: 'optimal' });
    expect(run.result!.detail).toMatchObject({ problem: 'goal_seek', reachable: true });
    expect(run.result!.changes[0]).toMatchObject({ target: 'variable', key: 'lev.L01.cut', member: '' });
    expect(run.spec.problem).toBe('goal_seek');
  });

  it('breakeven: one row per lever-intensity input, cells in the wire form', async () => {
    const run = await asRun(await quick({ problem: 'breakeven', params: {} }));
    expect(run.result!.problem).toBe('breakeven');
    const detail = run.result!.detail as Extract<NonNullable<SolverRun['result']>['detail'], { problem: 'breakeven' }>;
    expect(detail.rows.length).toBeGreaterThan(5);
    expect(detail.rows.every((r) => /^lev\.[^[]+\[[^\]]*\]$/.test(r.cell))).toBe(true);
  });

  it('scenario_blend: solves the blend of two presets for the target', async () => {
    const run = await asRun(await quick({ problem: 'scenario_blend', params: { from: C, to: D } }));
    expect(run.result!.problem).toBe('scenario_blend');
    expect(run.result!.detail).toMatchObject({ problem: 'scenario_blend' });
    expect(run.result!.metrics).toHaveProperty('lambda');
  });

  it('sensitivity (tornado): ranked inputs with the output at the low and the high input', async () => {
    const run = await asRun(await quick({ problem: 'sensitivity', params: { method: 'tornado', outputs: ['res.net[]'] } }));
    expect(run.result!.status).toBe('feasible');
    const detail = run.result!.detail as Extract<NonNullable<SolverRun['result']>['detail'], { problem: 'sensitivity' }>;
    expect(detail.output).toBe('res.net[]');
    expect(detail.rows.length).toBeGreaterThan(10);
    expect(detail.rows[0]!.low).not.toBeNull();
    expect(run.result!.ranked.length).toBeGreaterThan(10);
    expect(run.result!.ranked[0]!.cell).toMatch(/\[[^\]]*\]$/);
    // SOL-13: tier 2's category and swing, sorted by swing, on every row; the policy input leads
    expect(detail.rows.every((r) => ['lever', 'policy', 'timing'].includes(r.category!) && typeof r.swing === 'number' && r.swing >= 0)).toBe(true);
    expect(detail.rows.map((r) => r.swing)).toEqual([...detail.rows.map((r) => r.swing!)].sort((a, b) => b - a));
    expect(new Set(detail.rows.map((r) => r.category))).toEqual(new Set(['policy', 'timing', 'lever']));
  });

  it('stress_presets: the named shocks of solvers.json, outputs and deltas from the start point', async () => {
    const run = await asRun(await quick({ problem: 'stress_presets', params: { presets: ['Vendors win COLA', 'GCC hiring freeze'] } }));
    const detail = run.result!.detail as Extract<NonNullable<SolverRun['result']>['detail'], { problem: 'stress_presets' }>;
    expect(detail.presets.map((p) => p.name)).toEqual(['Vendors win COLA', 'GCC hiring freeze']);
    expect(Object.keys(detail.presets[0]!.outputs)).toEqual(expect.arrayContaining(['res.net[]', 'res.gap[]']));
  });

  it('a run is stored: GET answers it, and the worker-side rows carry the kind', async () => {
    const run = await asRun(await quick({ problem: 'stress_presets', params: { presets: ['Vendors win COLA'] } }));
    const again = await assertContract('solverRunGet', await get(`/api/t/aa/solver-runs/${run.id}`));
    expect(again).toMatchObject({ id: run.id, quick: true, status: 'done' });
    expect(again.result).toEqual(run.result);
    const row = await withTenant(env.app.db, AA_ID, ANA, (tx) => getSolverRun(tx, run.id));
    expect(row?.kind).toBe('sensitivity');
  });

  it('save: the result becomes a solver scenario below the start point (changeset origin solver)', async () => {
    const base = await asRun(await quick({ problem: 'sensitivity', params: { method: 'tornado', outputs: ['res.net[]'] } }));
    const net = base.result!.metrics['res.net[]']!;
    const run = await asRun(
      await quick({ problem: 'goal_seek', params: { var: 'lev.L01.cut[]', output: 'res.net[]', target: net } }, { save: true }),
    );
    expect(run.save).toBe(true);
    expect(run.resultScenarioId).not.toBeNull();
    const list = await assertContract('scenarios', await get('/api/t/aa/scenarios'));
    expect(list.scenarios.find((s) => s.id === run.resultScenarioId)).toMatchObject({ kind: 'solver', parentId: C });
    const history = await assertContract('changesetHistory', await get(`/api/t/aa/scenarios/${run.resultScenarioId}/changesets`));
    expect(history.changesets.map((c) => c.origin)).toContain('solver');
  });

  it('refuses what it cannot run: unknown scenario 404, bad parameters 422, outside the quick list 422', async () => {
    const spec = { problem: 'stress_presets', params: { presets: ['Vendors win COLA'] } };
    const missing = await post('/api/t/aa/solver-runs/quick', { scenarioId: '00000000-0000-4000-8000-00000000dead', spec });
    expect(missing.status).toBe(404);
    await assertContract('solverRunQuick', missing, 404);
    const unknownPreset = await quick({ problem: 'stress_presets', params: { presets: ['No such shock'] } });
    expect(unknownPreset.status).toBe(422);
    const badCell = await quick({ problem: 'goal_seek', params: { var: 'no.such[]', output: 'res.net[]', target: 1 } });
    expect(badCell.status).toBe(422);
    const notQuick = await quick({ problem: 'monte_carlo', params: {} });
    expect(notQuick.status).toBe(422);
    const sobol = await quick({ problem: 'sensitivity', params: { method: 'sobol', outputs: ['res.net[]'] } });
    expect(sobol.status).toBe(422);
    const strange = await post('/api/t/aa/solver-runs/quick', { scenarioId: C, spec: { problem: 'scenario_blend', params: { from: C, to: '00000000-0000-4000-8000-00000000dead' } } });
    expect(strange.status).toBe(404);
  });

  it('is for owners and editors; strangers get 404', async () => {
    const spec = { problem: 'stress_presets', params: { presets: ['Vendors win COLA'] } };
    expect((await post('/api/t/aa/solver-runs/quick', { scenarioId: C, spec }, asUser(BOB))).status).toBe(404);
    expect((await post('/api/t/aa/solver-runs/quick', { scenarioId: C, spec }, asUser(CAROL))).status).toBe(404);
  });
});

describe('over the quick limit: 202 and a job id', () => {
  it('stops the run at the limit and enqueues the same problem as a job (202, queued, id is the job)', async () => {
    const before = sent.length;
    const res = await quick({ problem: 'sensitivity', params: { method: 'elasticity', outputs: ['res.gap[]'] } }, {}, slow);
    expect(res.status).toBe(202);
    // 202 is not the route's 200: the body is still the contract's SolverRun.
    const run = SolverRun.parse(await res.json());
    expect(run).toMatchObject({ quick: false, status: 'queued', progress: 0, result: null, scenarioId: C });
    expect(run.spec.problem).toBe('sensitivity');
    expect(sent).toHaveLength(before + 1);
    expect(sent[before]).toEqual({ queue: 'solver.sensitivity', payload: { tenantId: AA_ID, userId: ANA, runId: run.id, save: false } });
    // The id is the job's: GET answers it.
    const status = await assertContract('solverRunGet', await get(`/api/t/aa/solver-runs/${run.id}`));
    expect(status.status).toBe('queued');
  });
});

describe('over the limit with an identical result already held', () => {
  it('answers 200 from the cache instead of enqueueing again', async () => {
    const spec = { problem: 'breakeven', params: {} }; // run (and stored) by the breakeven test above
    const before = sent.length;
    const res = await quick(spec, {}, slow);
    expect(res.status).toBe(200);
    expect(SolverRun.parse(await res.json())).toMatchObject({ cached: true, status: 'done' });
    expect(sent).toHaveLength(before);
  });
});

describe('POST/GET/DELETE solver-runs: worker jobs', () => {
  const spec = { problem: 'min_risk_mix', params: { objective: 'min_risk_exposure', constraints: [{ id: 'total' }] } };
  let id = '';

  it('POST enqueues solver.<problem> with tenant, user and run id, and answers the queued run (201)', async () => {
    const before = sent.length;
    const res = await post('/api/t/aa/solver-runs', { scenarioId: MINE, spec, save: true });
    expect(res.status).toBe(201);
    const run = await assertContract('solverRunStart', res);
    id = run.id;
    expect(run).toMatchObject({ status: 'queued', progress: 0, quick: false, save: true, cached: false, scenarioId: MINE, scenarioVersion: 4, result: null, error: null, cancelRequested: false });
    expect(run.spec).toEqual(spec);
    expect(sent).toHaveLength(before + 1);
    expect(sent[before]).toEqual({ queue: 'solver.min_risk_mix', payload: { tenantId: AA_ID, userId: ANA, runId: id, save: true } });
    const row = await withTenant(env.app.db, AA_ID, ANA, (tx) => getSolverRun(tx, id));
    expect(row).toMatchObject({ kind: 'optimize', status: 'queued', scenario_id: MINE });
  });

  it('GET returns status and progress while it runs, and the result once done', async () => {
    await withTenant(env.app.db, AA_ID, ANA, (tx) => updateSolverRun(tx, id, { status: 'running', progress: 0.4, progress_note: 'step 12' }));
    const running = await assertContract('solverRunGet', await get(`/api/t/aa/solver-runs/${id}`));
    expect(running).toMatchObject({ status: 'running', progress: 0.4, progressNote: 'step 12', result: null });

    // A worker stores the solver's own shape: engine cells and `{target, cell, value}` moves.
    await withTenant(env.app.db, AA_ID, ANA, (tx) =>
      updateSolverRun(tx, id, {
        status: 'done',
        progress: 1,
        result: {
          problem: 'min_risk_mix',
          status: 'optimal',
          changes: [{ target: 'variable', cell: 'lev.L01.cut', value: 0.2 }],
          ranked: [{ cell: 'lev.L01.cut', from: 0.1, to: 0.2, impact: 3.5 }],
          metrics: { 'res.net': 101.5, nan: Number.NaN as never },
          diagnostics: { iterations: 3, ms: 12 },
          detail: {},
        },
      }),
    );
    const done = await assertContract('solverRunGet', await get(`/api/t/aa/solver-runs/${id}`));
    expect(done.status).toBe('done');
    expect(done.result).toMatchObject({
      problem: 'min_risk_mix',
      status: 'optimal',
      changes: [{ target: 'variable', key: 'lev.L01.cut', member: '', value: 0.2 }],
      ranked: [{ cell: 'lev.L01.cut[]', from: 0.1, to: 0.2, impact: 3.5 }],
    });
    // the stored solver key `res.net` is served as the wire cell key
    expect(done.result!.metrics).toEqual({ 'res.net[]': 101.5 });
  });

  it('a failed run answers its error as a problem', async () => {
    const res = await post('/api/t/aa/solver-runs', { scenarioId: MINE, spec: { problem: 'pareto', params: {} } });
    const run = await assertContract('solverRunStart', res);
    await withTenant(env.app.db, AA_ID, ANA, (tx) => updateSolverRun(tx, run.id, { status: 'failed', result: { error: 'the solver\nfailed' } }));
    const failed = await assertContract('solverRunGet', await get(`/api/t/aa/solver-runs/${run.id}`));
    expect(failed).toMatchObject({ status: 'failed', result: null, error: { status: 500, detail: 'the solver failed' } });
  });

  it('DELETE sets cancel_requested on a live run, and is idempotent', async () => {
    const res = await post('/api/t/aa/solver-runs', { scenarioId: MINE, spec: { problem: 'vp_feasible', params: {} } });
    const run = await assertContract('solverRunStart', res);
    const cancelled = await del(`/api/t/aa/solver-runs/${run.id}`);
    expect(cancelled.status).toBe(200);
    const body = await assertContract('solverRunCancel', cancelled);
    expect(body).toMatchObject({ id: run.id, cancelRequested: true, status: 'queued' });
    const row = await withTenant(env.app.db, AA_ID, ANA, (tx) => getSolverRun(tx, run.id));
    expect(row?.cancel_requested).toBe(true);
    expect((await assertContract('solverRunCancel', await del(`/api/t/aa/solver-runs/${run.id}`))).cancelRequested).toBe(true);
  });

  it('DELETE of a finished run changes nothing', async () => {
    const run = await assertContract('solverRunCancel', await del(`/api/t/aa/solver-runs/${id}`));
    expect(run).toMatchObject({ status: 'done', cancelRequested: false });
  });

  it('404 for a run that is not this tenant\'s; 404 for an unknown scenario; 422 for a bad body', async () => {
    const missing = await get('/api/t/aa/solver-runs/00000000-0000-4000-8000-00000000beef');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    await assertContract('solverRunGet', missing, 404);
    expect((await del('/api/t/aa/solver-runs/not-a-uuid')).status).toBe(404);
    expect((await post('/api/t/aa/solver-runs', { scenarioId: '00000000-0000-4000-8000-00000000dead', spec })).status).toBe(404);
    expect((await post('/api/t/aa/solver-runs', { scenarioId: MINE, spec: { problem: 'nope', params: {} } })).status).toBe(422);
  });

  it('an identical finished quick run answers a job from the result cache: cached, nothing enqueued', async () => {
    const quickSpec = { problem: 'stress_presets', params: { presets: ['Vendors win COLA'] } };
    const first = await asRun(await quick(quickSpec));
    expect(first.inputHash).toBe('input-hash-1');
    const before = sent.length;
    const res = await post('/api/t/aa/solver-runs', { scenarioId: C, spec: quickSpec });
    const hit = await assertContract('solverRunStart', res);
    expect(hit).toMatchObject({ cached: true, status: 'done', inputHash: 'input-hash-1' });
    expect(hit.id).not.toBe(first.id);
    expect(hit.result).toEqual(first.result);
    expect(sent).toHaveLength(before);
  });
});

const runRows = () => withTenant(env.app.db, AA_ID, ANA, (tx) => listSolverRuns(tx, { limit: 500 }));
const lookupUrl = (scenarioId: string, problem: string, params?: unknown) =>
  `/api/t/aa/solver-runs/lookup?scenarioId=${scenarioId}&problem=${problem}${params === undefined ? '' : `&params=${encodeURIComponent(JSON.stringify(params))}`}`;
const lookup = async (url: string, a: Hono<AppEnv> = app): Promise<SolverLookup> =>
  assertContract('solverRunLookup', await a.request(url, { headers: ana.headers }));

/** A Monte Carlo result as a worker stores it (engine cells). */
const mcResult = {
  problem: 'monte_carlo',
  status: 'feasible',
  changes: [],
  ranked: [],
  metrics: { 'res.net.p50': 80, p_clear_bar: 0.25 },
  diagnostics: { iterations: 2000, ms: 9, seed: 1 },
  detail: {
    iterations: 2000,
    seed: 1,
    percentiles: [{ cell: 'res.net', p10: 60, p50: 80, p90: 100 }],
    probabilities: [{ cell: 'res.net', against: 'res.bar', p: 0.25 }],
    histograms: [],
    contributions: [],
  },
};

const noCancelled = (rows: { status: string; cancel_requested: boolean }[]) =>
  rows.filter((r) => r.status === 'cancelled' || r.cancel_requested);

describe('API-13 GET solver-runs/lookup: a result lookup without side effects', () => {
  let doneId = '';

  it('answers null when nothing is held, with the Monte Carlo trial count from tier 2, and writes nothing', async () => {
    const before = await runRows();
    const sentBefore = sent.length;
    const none = await lookup(lookupUrl(C, 'monte_carlo'));
    // the solver's default (solvers.json: 2,000), not a number tier 1 holds
    expect(none).toEqual({ run: null, current: false, trials: MONTE_CARLO_DEFAULTS.iterations });
    expect(await lookup(lookupUrl(C, 'monte_carlo', { iterations: 500 }))).toMatchObject({ trials: 500 });
    expect(await lookup(lookupUrl(C, 'min_risk_mix'))).toEqual({ run: null, current: false, trials: null });
    // a miss never enqueues and leaves no run behind, cancelled or otherwise
    expect(sent).toHaveLength(sentBefore);
    expect(await runRows()).toEqual(before);
  });

  it('returns the newest finished run of (scenario, problem, params): the one for the present inputs, with the scenario version it is valid for', async () => {
    const started = await assertContract('solverRunStart', await post('/api/t/aa/solver-runs', { scenarioId: C, spec: { problem: 'monte_carlo', params: {} } }));
    doneId = started.id;
    // queued and running runs are not results
    expect((await lookup(lookupUrl(C, 'monte_carlo'))).run).toBeNull();
    await withTenant(env.app.db, AA_ID, ANA, (tx) => updateSolverRun(tx, doneId, { status: 'done', progress: 1, result: mcResult as never }));

    const rows = await runRows();
    const sentBefore = sent.length;
    const hit = await lookup(lookupUrl(C, 'monte_carlo'));
    const version = (await withTenant(env.app.db, AA_ID, ANA, (tx) => getScenario(tx, C)))!.version;
    expect(hit).toMatchObject({ current: true, trials: 2000, run: { id: doneId, status: 'done', scenarioId: C, scenarioVersion: version } });
    expect(hit.run!.result!.metrics).toEqual({ 'res.net.p50': 80, p_clear_bar: 0.25 });
    expect(hit.run!.result!.detail).toMatchObject({ percentiles: [{ cell: 'res.net[]' }], probabilities: [{ cell: 'res.net[]', against: 'res.bar[]' }] });
    // explicit params key like the start request's; other params are another key, another scenario another run
    expect((await lookup(lookupUrl(C, 'monte_carlo', {}))).run?.id).toBe(doneId);
    expect((await lookup(lookupUrl(C, 'monte_carlo', { iterations: 500 }))).run).toBeNull();
    expect((await lookup(lookupUrl(MINE, 'monte_carlo'))).run).toBeNull();
    // reading changes nothing: no job, no row, nothing cancelled
    expect(sent).toHaveLength(sentBefore);
    const after = await runRows();
    expect(after).toEqual(rows);
    expect(noCancelled(after)).toEqual(noCancelled(rows)); // no run cancelled (or asked to be) by looking
  });

  it('after the inputs changed it still returns the latest result, as out of date (current: false, as stored)', async () => {
    const stale = await lookup(lookupUrl(C, 'monte_carlo'), other);
    expect(stale.current).toBe(false);
    expect(stale.run).toMatchObject({ id: doneId, status: 'done' });
    // the version it was computed for, not the scenario's present one
    expect(stale.run!.scenarioVersion).toBeLessThanOrEqual(
      (await withTenant(env.app.db, AA_ID, ANA, (tx) => getScenario(tx, C)))!.version,
    );
  });

  it('is a read for members: a stranger and an unknown scenario get 404, a bad query 422', async () => {
    expect((await app.request(lookupUrl(C, 'monte_carlo'), { headers: asUser(CAROL).headers })).status).toBe(404);
    expect((await app.request(lookupUrl(C, 'monte_carlo'), { headers: asUser(BOB).headers })).status).toBe(404);
    const unknown = await app.request(lookupUrl('00000000-0000-4000-8000-00000000dead', 'monte_carlo'), { headers: ana.headers });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    expect((await app.request(lookupUrl(C, 'nope'), { headers: ana.headers })).status).toBe(422);
    expect((await app.request(`/api/t/aa/solver-runs/lookup?scenarioId=${C}&problem=monte_carlo&params=%5B1%5D`, { headers: ana.headers })).status).toBe(422);
    // `lookup` is not a run id: the route is not shadowed by `:id`
    expect((await app.request(`/api/t/aa/solver-runs/lookup?scenarioId=${C}`, { headers: ana.headers })).status).toBe(422);
  });
});

describe('API-13 save on the job: submissions carry it, the worker honours it', () => {
  const spec = { problem: 'min_risk_mix', params: {} };
  const scenarios = async () => (await withTenant(env.app.db, AA_ID, ANA, (tx) => listScenarios(tx))).length;

  /** Runs the enqueued job through the worker's own solver handler, as the worker would. */
  const work = (payload: SolverJobPayload) =>
    runSolverJob(
      {
        tenantId: AA_ID,
        userId: ANA,
        payload,
        signal: new AbortController().signal,
        progress: () => undefined,
        withTenant: (fn) => withTenant(env.app.db, AA_ID, ANA, fn),
      },
      { problem: 'min_risk_mix' },
      defaultSolverDeps(),
    );

  it('a job submitted without save is sent save: false, and the worker saves no scenario for it (Cockpit tiles)', async () => {
    const before = sent.length;
    const run = await assertContract('solverRunStart', await post('/api/t/aa/solver-runs', { scenarioId: C, spec }));
    expect(run.save).toBe(false);
    expect(sent[before]!.payload).toEqual({ tenantId: AA_ID, userId: ANA, runId: run.id, save: false });
    const count = await scenarios();
    const out = await work(sent[before]!.payload as SolverJobPayload);
    expect(out.saved).toBeNull();
    expect(await scenarios()).toBe(count);
  }, 120_000);

  it('a job submitted with save: true is sent save: true, is never answered from the cache, and the worker saves its scenario', async () => {
    // a finished identical run is held: a request without save is answered from it
    const first = await assertContract('solverRunStart', await post('/api/t/aa/solver-runs', { scenarioId: C, spec }));
    await withTenant(env.app.db, AA_ID, ANA, (tx) =>
      updateSolverRun(tx, first.id, {
        status: 'done',
        progress: 1,
        result: { problem: 'min_risk_mix', status: 'optimal', changes: [], ranked: [], metrics: {}, diagnostics: { iterations: 1, ms: 1 } },
      }),
    );
    const before = sent.length;
    const cached = await assertContract('solverRunStart', await post('/api/t/aa/solver-runs', { scenarioId: C, spec }));
    expect(cached).toMatchObject({ cached: true, status: 'done' });
    expect(sent).toHaveLength(before);

    const run = await assertContract('solverRunStart', await post('/api/t/aa/solver-runs', { scenarioId: C, spec, save: true }));
    expect(run).toMatchObject({ save: true, cached: false, status: 'queued' });
    expect(sent).toHaveLength(before + 1);
    expect(sent[before]!.payload).toEqual({ tenantId: AA_ID, userId: ANA, runId: run.id, save: true });
    const count = await scenarios();
    const out = await work(sent[before]!.payload as SolverJobPayload);
    expect(out.saved).not.toBeNull();
    expect(await scenarios()).toBe(count + 1);
  }, 240_000);
});

describe('SOL-12 quick runs build the SolverModel with the reference decision bounds', () => {
  it('the quick-run model of every short problem bounds each DEC cell as solvers_demo.py does', async () => {
    const withTenantFn = bindWithTenant(env.app.db);
    const loader = dbScenarioLoader({ withTenant: withTenantFn, specBundle: specBundleFromDir() });
    const tenantId = TenantId.parse(AA_ID);
    const userId = UserId.parse(ANA);
    const state = (await loader.load({ tenantId, userId }, C))!;
    const b = REFERENCE_DECISION_BOUNDS;
    const specs = [
      { problem: 'breakeven', params: {} },
      { problem: 'goal_seek', params: { var: 'lev.L01.cut[]', output: 'res.net[]', target: 0 } },
      { problem: 'sensitivity', params: { method: 'tornado' } },
    ] as unknown as QuickSolverSpec[];
    for (const spec of specs) {
      const model = await withTenantFn(tenantId, userId, (tx) => solverModelFor(tx, state, spec, { stressPresets: async () => [] }));
      const set = decisionSet(model, 'lever_intensity');
      expect(set.map((d) => d.cell), spec.problem).toEqual(b.dec);
      for (const d of set) expect([d.lo, d.hi], `${spec.problem} ${d.cell}`).toEqual([b.lo[d.cell], b.hi[d.cell]]);
    }
  }, 60_000);
});
