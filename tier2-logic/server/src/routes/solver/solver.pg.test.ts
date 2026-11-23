import { PROBLEM_CONTENT_TYPE, SolverRun, UserId, assertContract } from '@glidepath/api-contract';
import { getSolverRun, updateSolverRun, withTenant } from '@glidepath/data-access';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app/app';
import type { AppEnv } from '../../app/tenant';
import { bindWithTenant } from '../../app/tenant';
import { captureLogger } from '../../app/testing/fixtures';
import { createSolverSubmitter } from '../../jobs';
import { dbScenarioLoader } from '../../session';
import { specBundleFromDir } from '../read/spec-source';
import { AA_ID, ANA, BOB, CAROL, MINE, asUser, presetId, startAaDatabase } from '../read/testing/aa-db';
import type { AaDatabase } from '../read/testing/aa-db';

/**
 * API-09 on the AA test database (app role, RLS applies): quick runs on the session's model, the 2 s limit and
 * the job fallback, enqueue / status / cancel of worker jobs, and the contract of every answer.
 */

let env: AaDatabase;
let app: Hono<AppEnv>;
let slow: Hono<AppEnv>;
const sent: { queue: string; payload: { tenantId: string; userId: string; runId: string } }[] = [];

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
}, 180_000);

afterAll(() => env?.close());

const asRun = async (res: Response): Promise<SolverRun> => assertContract('solverRunQuick', res);

describe('POST solver-runs/quick runs the short solvers on the session model', () => {
  it('goal_seek: solves one input to a target and passes assertContract', async () => {
    // The start value is the answer for its own output: a target the scan always brackets.
    const base = await asRun(await quick({ problem: 'sensitivity', params: { method: 'tornado', outputs: ['res.net[]'] } }));
    const net = base.result!.metrics['res.net']!;
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
    const net = base.result!.metrics['res.net']!;
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
    expect(sent[before]).toEqual({ queue: 'solver.sensitivity', payload: { tenantId: AA_ID, userId: ANA, runId: run.id } });
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
    expect(sent[before]).toEqual({ queue: 'solver.min_risk_mix', payload: { tenantId: AA_ID, userId: ANA, runId: id } });
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
