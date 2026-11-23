import {
  QuickSolverRunRequest,
  SolverRunParams,
  SolverRunRequest,
  TenantParams,
  problemTypes,
} from '@glidepath/api-contract';
import type { QuickSolverSpec, SolverSpec } from '@glidepath/api-contract';
import { createSolverRun, getScenario, getSolverRun, updateSolverRun } from '@glidepath/data-access';
import type { SolverRunRecord, TenantTx } from '@glidepath/data-access';
import { applyChangeset, createScenario } from '@glidepath/domain';
import type { Change as DomainChange, JsonValue } from '@glidepath/domain';
import { EngineError } from '@glidepath/engine';
import { SolverError, runSolver } from '@glidepath/solvers';
import type { Context, Hono } from 'hono';
import { ApiError } from '../../app/problem';
import type { AppEnv } from '../../app/tenant';
import type { ScenarioLoader } from '../../session';
import { cacheKeyOf, latestCalcInputHash, withCacheKey } from '../../jobs';
import type { SpecLike, InputHashOf, SolverSubmit, SolverSubmitted } from '../../jobs';
import { loadScenario, writeContext } from '../write/support';
import { guarded } from '../write/errors';
import { afterCommit } from '../write/hub';
import type { SessionHub as CommitNotifier } from '../write/hub';
import { LruModelCache } from '../write/model-cache';
import type { SpecBundleSource } from '../read/spec-source';
import { solverKind } from './kinds';
import { solverModelFor, stressPresetsFromDir } from './model';
import type { StressPresets } from './model';
import { toEngineSpec } from './params';
import { toContractResult } from './result';
import { toSolverRun } from './run';
import type { RunMeta } from './run';

/** 03 section 2: a short solver runs inside the `logic` process with a time limit of 2 s; longer is a worker job. */
export const QUICK_LIMIT_MS = 2000;

export interface SolverRoutesDeps {
  /**
   * The sessions' scenario loader (`dbScenarioLoader`): its `ModelCache` is the model a what-if session holds, so
   * a quick run starts from the same compiled model and committed evaluation, with no recompile.
   */
  readonly loader: ScenarioLoader;
  /** Starts a worker job: the result cache, the `solver_run` row, the pg-boss send (`createSolverSubmitter`). */
  readonly submit: (request: SolverSubmit) => Promise<SolverSubmitted>;
  /** Needed to save a quick result as a scenario (`save: true`): the registry the changeset is checked against. */
  readonly specBundle: SpecBundleSource;
  /** Told when a saved result created a scenario (the scenario list is stale then). */
  readonly hub?: CommitNotifier;
  /** The named shocks of `solvers.json`; default: read from `SPEC_DIR` (else `docs/spec`) on first use. */
  readonly stressPresets?: () => Promise<StressPresets>;
  /** The quick limit in ms; default {@link QUICK_LIMIT_MS}. */
  readonly quickLimitMs?: number;
  /** The scenario's input hash for the result cache key; default the latest `calc_run` (as the submitter's). */
  readonly inputHashOf?: InputHashOf;
  /** Replaces `runSolver` (tests). */
  readonly solve?: typeof runSolver;
  /** Wall clock in ms (tests). */
  readonly now?: () => number;
}

const SOLVER_STATUS: Readonly<Record<string, number>> = {
  BAD_PARAMS: 422,
  ILLEGAL_MOVE: 422,
  BAD_MODEL: 422,
  NOT_IMPLEMENTED: 501,
};

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Solver and engine errors the caller can fix, as problems; anything else is returned as is. */
function solverProblem(err: unknown): unknown {
  if (err instanceof SolverError) {
    const status = SOLVER_STATUS[err.code] ?? 422;
    return new ApiError({
      status,
      title: status === 501 ? 'Not implemented' : 'Validation failed',
      detail: oneLine(err.message),
      type: status === 501 ? 'about:blank' : problemTypes.validation,
    });
  }
  if (err instanceof EngineError) {
    return new ApiError({ status: 422, title: 'Validation failed', detail: oneLine(err.message), type: problemTypes.validation });
  }
  return err;
}

/** The spec a job is submitted with: the request's `{problem, params}` and its flags. */
const withRun = (spec: SolverSpec, run: RunMeta): SpecLike & { readonly run: RunMeta } => ({ ...spec, run });

const noScenario = (): ApiError => ApiError.notFound('No such scenario in this tenant. Check the scenario id.');

/** A short, readable name for a saved result: `Goal seek result`. */
const resultLabel = (problem: string): string => {
  const words = problem.replace(/_/g, ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} result`;
};

/**
 * Solver routes of 04 section 3 on `/api/t/:tenant/*`, after the tenant middleware (every POST and DELETE is
 * owner or editor by the role guard):
 *
 * - `POST solver-runs/quick`: goal seek, breakeven, scenario blend, tornado/elasticity/spider and stress presets on the
 *   session's model, 2 s limit. Within it: 200 with the finished `SolverRun` (`quick: true`). Over it, the run
 *   stops and the same spec is enqueued as a job (`solver.<problem>`): 202 with the queued `SolverRun`, whose id is the
 *   job id (an identical earlier result answers 200 at once, as `cached`).
 * - `POST solver-runs`: any problem, enqueued (cache first), 201 with the `SolverRun`; progress follows as WS `job`.
 * - `GET solver-runs/:id`: status, progress and, once finished, the result.
 * - `DELETE solver-runs/:id`: sets `cancel_requested`; the worker stops at its next batch (idempotent, 200).
 */
export function registerSolverRoutes(app: Hono<AppEnv>, deps: SolverRoutesDeps): void {
  const limit = deps.quickLimitMs ?? QUICK_LIMIT_MS;
  const solve = deps.solve ?? runSolver;
  const now = deps.now ?? (() => performance.now());
  const inputHashOf = deps.inputHashOf ?? latestCalcInputHash;
  const presets = deps.stressPresets ?? stressPresetsFromDir();
  const cache = new LruModelCache();

  const guard = (c: Context<AppEnv>, fn: () => Promise<Response>): Promise<Response> =>
    guarded(c, async () => {
      try {
        return await fn();
      } catch (err) {
        throw solverProblem(err);
      }
    });

  /** The spec to store: what was sent, the request's flags, and the cache key when the scenario's inputs are hashed. */
  async function storedSpec(tx: TenantTx, scenarioId: string, spec: SolverSpec, meta: RunMeta): Promise<JsonValue> {
    const withMeta = withRun(spec, meta);
    const hash = await inputHashOf(tx, scenarioId);
    return hash === null ? (withMeta as unknown as JsonValue) : withCacheKey(withMeta, cacheKeyOf(withMeta, hash));
  }

  /** The `save: true` of a quick run: a `solver` scenario below the start point with the result's moves, origin `solver`. */
  async function saveResult(c: Context<AppEnv>, scenarioId: string, problem: string, changes: readonly { key: string; member: string; value: number | null }[]): Promise<string> {
    const t = c.get('tenant');
    const ctx = await writeContext(c, { specBundle: deps.specBundle, cache });
    const created = await createScenario(
      ctx.store,
      { mode: 'child', parent_id: scenarioId, kind: 'solver', label: resultLabel(problem) },
      { actor: t.userId, bundle: ctx.bundle, recompute: ctx.recompute, origin: 'solver' },
    );
    const draft: DomainChange[] = changes.map((ch) => ({
      target: 'variable',
      key: ch.key,
      member_key: ch.member,
      op: ch.value === null ? 'unset' : 'set',
      new_value: ch.value,
    }));
    await applyChangeset(
      ctx.store,
      { origin: 'solver', scenario_id: created.scenario.id, base_scenario_version: created.scenario.version, changes: draft },
      { actor: t.userId, bundle: ctx.bundle, recompute: ctx.recompute },
    );
    const scenario = await loadScenario(t.tx, created.scenario.id);
    if (deps.hub) {
      const hub = deps.hub;
      afterCommit(c, () => hub.scenarioChanged({ tenantId: t.tenantId, change: 'created', scenario }));
    }
    return created.scenario.id;
  }

  // ------------------------------------------------------------------------------------------ quick

  app.post('/api/t/:tenant/solver-runs/quick', (c) =>
    guard(c, async () => {
      TenantParams.parse(c.req.param());
      const req = QuickSolverRunRequest.parse(await c.req.json());
      const t = c.get('tenant');
      const spec: QuickSolverSpec = req.spec;
      const state = await deps.loader.load({ tenantId: t.tenantId, userId: t.userId }, req.scenarioId);
      if (state === null) throw noScenario();
      const meta: RunMeta = { quick: true, save: req.save === true, scenarioVersion: state.version };

      const model = await solverModelFor(t.tx, state, spec, { stressPresets: presets });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), limit);
      const started = now();
      let result;
      try {
        result = await solve(model, toEngineSpec(spec), { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      const overLimit = result.status === 'cancelled' || controller.signal.aborted || now() - started > limit;

      if (overLimit) {
        // Too long for the session: the same problem as a worker job. The client follows it over WS or GET.
        const submitted = await deps.submit({
          tenantId: t.tenantId,
          userId: t.userId,
          scenarioId: req.scenarioId,
          kind: solverKind(spec.problem),
          spec: withRun(spec, { ...meta, quick: false }),
        });
        return c.json(toSolverRun(submitted.run), submitted.cached ? 200 : 202);
      }

      const contract = toContractResult(result);
      const run = await createSolverRun(t.tx, {
        kind: solverKind(spec.problem),
        scenario_id: req.scenarioId,
        spec: await storedSpec(t.tx, req.scenarioId, spec, meta),
      });
      let resultScenarioId: string | null = null;
      if (meta.save && (contract.status === 'optimal' || contract.status === 'feasible') && contract.changes.length > 0) {
        resultScenarioId = await saveResult(
          c,
          req.scenarioId,
          spec.problem,
          contract.changes.flatMap((ch) => (ch.target === 'variable' ? [{ key: ch.key, member: ch.member, value: ch.value }] : [])),
        );
      }
      const done = await updateSolverRun(t.tx, run.id, {
        status: 'done',
        progress: 1,
        result: contract as unknown as JsonValue,
        ...(resultScenarioId === null ? {} : { result_scenario_id: resultScenarioId }),
      });
      return c.json(toSolverRun(done ?? run), 200);
    }),
  );

  // ------------------------------------------------------------------------------------------ jobs

  app.post('/api/t/:tenant/solver-runs', (c) =>
    guard(c, async () => {
      TenantParams.parse(c.req.param());
      const req = SolverRunRequest.parse(await c.req.json());
      const t = c.get('tenant');
      const scenario = await getScenario(t.tx, req.scenarioId);
      if (scenario === null) throw noScenario();
      const meta: RunMeta = { quick: false, save: req.save === true, scenarioVersion: scenario.version };
      const submitted = await deps.submit({
        tenantId: t.tenantId,
        userId: t.userId,
        scenarioId: req.scenarioId,
        kind: solverKind(req.spec.problem),
        spec: withRun(req.spec, meta),
      });
      return c.json(toSolverRun(submitted.run), 201);
    }),
  );

  const runOf = async (c: Context<AppEnv>): Promise<SolverRunRecord> => {
    const { id } = SolverRunParams.parse(c.req.param());
    const run = await getSolverRun(c.get('tenant').tx, id);
    if (run === null) throw ApiError.notFound('No such solver run in this tenant. Check the run id.');
    return run;
  };

  app.get('/api/t/:tenant/solver-runs/:id', (c) =>
    guard(c, async () => c.json(toSolverRun(await runOf(c)), 200, { 'cache-control': 'private, no-cache' })),
  );

  app.delete('/api/t/:tenant/solver-runs/:id', (c) =>
    guard(c, async () => {
      const run = await runOf(c);
      const live = run.status === 'queued' || run.status === 'running';
      if (!live || run.cancel_requested) return c.json(toSolverRun(run), 200);
      const updated = await updateSolverRun(c.get('tenant').tx, run.id, { cancel_requested: true });
      return c.json(toSolverRun(updated ?? run), 200);
    }),
  );
}
