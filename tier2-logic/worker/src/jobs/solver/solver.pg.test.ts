import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  changesetTx,
  createDb,
  createSolverRun,
  getSolverRun,
  listScenarios,
  loadResolvedInputs,
  withTenant,
} from '@glidepath/data-access';
import type { DbHandle, SolverRunRecord, TenantTx } from '@glidepath/data-access';
import { start, stop } from '@glidepath/pg-local';
import { decisionSet } from '@glidepath/solvers';
import { REFERENCE_DECISION_BOUNDS } from '@glidepath/spec';
import type { PgLocalInstance } from '@glidepath/pg-local';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findTier3Data } from '../../seed/files';
import { seedIds } from '../../seed/ids';
import { runMigrate } from '../../seed/run';
import { HandlerRegistry, runJob, silentLogger, systemClock } from '../../runtime';
import type { JobContext } from '../../runtime';
import { defaultSolverDeps } from './deps';
import { loadSolverInput } from './load';
import { runSolverJob } from './run';
import { registerSolverHandlers } from './register';
import type { SolverJobDeps, SolverJobPayload } from './types';

/**
 * JOB-03 on pg-local with the AA seed (as compose: roles glidepath_owner / glidepath_app, RLS applies): the
 * handlers run the real solvers on the model built from `v_inputs_resolved`. `runJob` (JOB-01) drives them as
 * the worker does, so run status, progress and the stored result are the runtime's.
 */

const tier3Data = findTier3Data();
const specDir = resolve(tier3Data, '../docs/spec');
const tenantId = seedIds.tenant('aa');
const userId = seedIds.seedActor();

let instance: PgLocalInstance;
let stateFile: string;
let app: DbHandle;
let deps: SolverJobDeps;
let registry: HandlerRegistry;

const asRole = (url: string, role: string): string => {
  const u = new URL(url);
  u.username = role;
  return u.toString();
};

const inTenant = <T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> => withTenant(app.db, tenantId, userId, fn);
const scenarioByKey = async (key: string) => (await inTenant((tx) => listScenarios(tx))).find((s) => s.key === key)!;

beforeAll(async () => {
  stateFile = join(tmpdir(), `gp-job03-${process.pid}.json`);
  instance = await start({ stateFile, init: resolve(tier3Data, 'postgres/init') });
  await runMigrate({ databaseUrl: asRole(instance.url, 'glidepath_owner'), seed: 'aa', tier3Data });
  app = createDb(asRole(instance.url, 'glidepath_app'));
  deps = defaultSolverDeps({ specDir });
  registry = new HandlerRegistry();
  registerSolverHandlers(registry, () => deps);
}, 300_000);

afterAll(async () => {
  await app?.close();
  if (instance) stop({ instance, stateFile });
});

// ----------------------------------------------------------------------------- helpers

const KIND = { min_risk_mix: 'optimize', vp_feasible: 'optimize', monte_carlo: 'monte_carlo' } as const;

async function newRun(problem: keyof typeof KIND, params: Record<string, number>, scenarioKey = 'C'): Promise<SolverRunRecord> {
  const scenario = await scenarioByKey(scenarioKey);
  return inTenant((tx) => createSolverRun(tx, { kind: KIND[problem], scenario_id: scenario.id, spec: { problem, params } }));
}

/** Runs the job through the runtime (status, progress, stored result), the way the worker does. */
async function work(run: SolverRunRecord, problem: string, signal?: AbortSignal): Promise<SolverRunRecord> {
  const reg = registry.get(`solver.${problem}`)!;
  await runJob(
    { db: app.db, clock: systemClock, logger: silentLogger, cancelPollMs: 50, shutdown: signal ?? new AbortController().signal },
    reg,
    { id: `job-${run.id}`, data: { tenantId, userId, runId: run.id }, signal: new AbortController().signal },
  );
  return (await inTenant((tx) => getSolverRun(tx, run.id)))!;
}

interface StoredResult {
  status: string;
  problem: string;
  ranked: { cell: string; from: number; to: number; impact: number }[];
  binding?: { constraint: string; shadowPrice: number }[];
  changes: { cell: string; value: number }[];
  resultScenarioId: string | null;
  detail: { iterations: number; seed: number; percentiles: unknown[] };
}
const resultOf = (run: SolverRunRecord): StoredResult => run.result as unknown as StoredResult;

/** Cell map of a scenario's resolved inputs. */
async function resolved(scenarioId: string): Promise<Map<string, number>> {
  const r = (await inTenant((tx) => loadResolvedInputs(tx, scenarioId)))!;
  return new Map(r.values.map((v) => [v.member_key === '' ? v.var_key : `${v.var_key}[${v.member_key}]`, v.value]));
}

// ----------------------------------------------------------------------------- acceptance

describe('JOB-03 solver job handlers (pg-local, seeded tenant)', () => {
  it('handlers build a CompiledModel from v_inputs_resolved and run the pure solver with the job signal and progress', async () => {
    const run = await newRun('min_risk_mix', {});
    const c = await scenarioByKey('C');
    const reports: [number, string | undefined][] = [];
    let signalSeen: AbortSignal | undefined;
    const ctx = {
      tenantId,
      userId,
      payload: { tenantId, userId, runId: run.id, save: false } as SolverJobPayload,
      signal: (signalSeen = new AbortController().signal),
      progress: (f: number, n?: string) => void reports.push([f, n]),
      withTenant: inTenant,
    } satisfies Pick<JobContext<SolverJobPayload>, 'tenantId' | 'userId' | 'payload' | 'signal' | 'progress' | 'withTenant'>;

    const out = await runSolverJob(ctx, { problem: 'min_risk_mix' }, deps);

    expect(signalSeen.aborted).toBe(false);
    expect(['optimal', 'feasible']).toContain(out.result.status);
    // The model was built from the stored inputs of scenario C: the solver's moves start from C's own values.
    const inputs = await resolved(c.id);
    for (const ch of out.result.ranked) expect(ch.from).toBeCloseTo(inputs.get(ch.cell) ?? NaN, 9);
    // The metrics are the engine's on C plus the moves: the plan clears the bar.
    expect(out.result.metrics['res.net']!).toBeGreaterThanOrEqual(out.result.metrics['res.bar']! - 1e-6);
    // Progress goes through ctx.progress, monotone and ending in the solve share.
    expect(reports.length).toBeGreaterThan(1);
    const fractions = reports.map(([f]) => f);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(Math.max(...fractions)).toBeLessThanOrEqual(1);
    // save: false: no scenario.
    expect(out.saved).toBeNull();

    // A fired signal ends the run as cancelled, with nothing saved.
    const before = (await inTenant((tx) => listScenarios(tx))).length;
    const controller = new AbortController();
    const run2 = await newRun('min_risk_mix', {});
    const cancelled = await runSolverJob(
      { ...ctx, payload: { tenantId, userId, runId: run2.id }, signal: controller.signal, progress: () => controller.abort() },
      { problem: 'min_risk_mix' },
      deps,
    );
    expect(cancelled.result.status).toBe('cancelled');
    expect(cancelled.saved).toBeNull();
    expect((await inTenant((tx) => listScenarios(tx))).length).toBe(before);
  }, 120_000);

  it('min-risk and VP-feasible results are saved as a new scenario kind=solver via applyChangeset origin=solver, with ranked moves and binding constraints in solver_run.result', async () => {
    for (const problem of ['min_risk_mix', 'vp_feasible'] as const) {
      const before = new Set((await inTenant((tx) => listScenarios(tx))).map((s) => s.id));
      const run = await work(await newRun(problem, {}), problem);
      expect(run.status).toBe('done');
      expect(run.progress).toBe(1);
      const result = resultOf(run);
      expect(['optimal', 'feasible', 'infeasible']).toContain(result.status);
      expect(Array.isArray(result.ranked)).toBe(true);
      expect(result.ranked.length).toBeGreaterThan(0);
      if (result.status !== 'infeasible') {
        expect(Array.isArray(result.binding)).toBe(true);
        expect(result.binding?.length).toBeGreaterThan(0);
      }

      // The scenario: new, kind solver, pointed at by the run.
      expect(run.result_scenario_id).not.toBeNull();
      expect(result.resultScenarioId).toBe(run.result_scenario_id);
      const scenarios = await inTenant((tx) => listScenarios(tx));
      const created = scenarios.filter((s) => !before.has(s.id));
      expect(created.map((s) => s.id)).toEqual([run.result_scenario_id]);
      const saved = created[0]!;
      expect(saved.kind).toBe('solver');
      const c = await scenarioByKey('C');
      expect(saved.parent_id).toBe(c.parent_id);

      // Its inputs: C's, with the solver's moves on top; written by a changeset of origin solver.
      const base = await resolved(c.id);
      const got = await resolved(saved.id);
      const moves = new Map<string, number>(result.changes.map((ch) => [ch.cell, ch.value]));
      expect(moves.size).toBeGreaterThan(0);
      for (const [cell, value] of moves) expect(got.get(cell)).toBeCloseTo(value, 9);
      for (const [cell, value] of base) if (!moves.has(cell)) expect(got.get(cell), cell).toBeCloseTo(value, 9);
      const history = await inTenant((tx) => changesetTx(tx).changesSince(saved.id, 0));
      const origins = history.map((h) => h.origin);
      expect(origins).toContain('solver');
      const solverSet = history.find((h) => h.origin === 'solver' && h.changes.length === moves.size);
      expect(solverSet).toBeDefined();
    }
  }, 240_000);

  it('Monte Carlo stores its result on solver_run without creating a scenario', async () => {
    const before = (await inTenant((tx) => listScenarios(tx))).length;
    const run = await work(await newRun('monte_carlo', { iterations: 200, seed: 7 }), 'monte_carlo');
    expect(run.status).toBe('done');
    expect(run.result_scenario_id).toBeNull();
    const result = resultOf(run);
    expect(result.problem).toBe('monte_carlo');
    expect(result.detail.iterations).toBe(200);
    expect(result.detail.seed).toBe(7);
    expect(result.detail.percentiles.length).toBeGreaterThan(0);
    expect(result.resultScenarioId).toBeNull();
    expect((await inTenant((tx) => listScenarios(tx))).length).toBe(before);
  }, 120_000);

  it('a run of the wrong problem for its queue fails without saving anything', async () => {
    const run = await newRun('monte_carlo', { iterations: 10 });
    await expect(work(run, 'min_risk_mix')).rejects.toThrow(/not min_risk_mix/);
    expect((await inTenant((tx) => getSolverRun(tx, run.id)))!.status).toBe('failed');
  }, 60_000);
});

// ----------------------------------------------------------------------------- SOL-12

/** G5 tolerances (tools/parity solvers-gate TOLERANCES): net to the reference's cents, risk exposure ± $0.5M. */
const G5 = { cents: 0.005, money: 0.5 } as const;

interface MinRiskReference {
  readonly net: number;
  readonly risk_exposure: number;
  readonly inputs_moved_from_C: Readonly<Record<string, { readonly from: number; readonly to: number }>>;
}

describe('SOL-12 production solvers use the reference decision bounds (pg-local, seeded tenant)', () => {
  it('min_risk_mix from C through the real handler gives net 143.0 and risk exposure 42.0 at the G5 tolerances', async () => {
    const reference = JSON.parse(readFileSync(resolve(specDir, 'reference/solver_demo_results.json'), 'utf8')) as {
      min_risk_total_bar: MinRiskReference;
    };
    const want = reference.min_risk_total_bar;

    // The job's own model carries the generated bounds: every DEC cell bounded as solvers_demo.py bounds it.
    const run = await newRun('min_risk_mix', {});
    const input = await inTenant((tx) => loadSolverInput(tx, run.id, deps));
    const set = decisionSet(input.model, 'lever_intensity');
    expect(set.map((d) => d.cell)).toEqual(REFERENCE_DECISION_BOUNDS.dec);
    for (const d of set) {
      expect([d.lo, d.hi], d.cell).toEqual([REFERENCE_DECISION_BOUNDS.lo[d.cell], REFERENCE_DECISION_BOUNDS.hi[d.cell]]);
    }

    const done = await work(run, 'min_risk_mix');
    expect(done.status).toBe('done');
    const result = done.result as unknown as {
      status: string;
      metrics: Record<string, number>;
      changes: { cell: string; value: number }[];
    };
    expect(result.status).toBe('feasible');
    expect(result.metrics['res.net']! - result.metrics['res.bar']!).toBeGreaterThanOrEqual(-1e-6);
    expect(Math.abs(result.metrics['res.net']! - want.net)).toBeLessThanOrEqual(G5.cents);
    expect(Math.abs(result.metrics['risk_exposure']! - want.risk_exposure)).toBeLessThanOrEqual(G5.money);
    // The plan is the reference's: the same inputs moved, to the same values (some above the registry max).
    const moved = new Map(result.changes.map((c) => [c.cell, c.value]));
    expect([...moved.keys()].sort()).toEqual(Object.keys(want.inputs_moved_from_C).sort());
    for (const [cell, { to }] of Object.entries(want.inputs_moved_from_C)) expect(moved.get(cell), cell).toBeCloseTo(to, 9);
  }, 120_000);
});
