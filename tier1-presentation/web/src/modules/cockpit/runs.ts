import { useCallback, useEffect } from 'react';
import { createStore, useStore } from 'zustand';
import {
  ApiError,
  type SolverResult,
  type SolverRun,
  type SolverSpec,
  type TenantSlug,
} from '@glidepath/api-contract';
import { useBindContext } from '../../bind';
import { useApiClient } from '../../data';
import { useJob, type JobHandle } from '../../jobs';

/**
 * The `solver_run`s behind the Odds and Fastest path tiles, per tenant, scenario and problem.
 *
 * The contract has no "latest run of this scenario" lookup and no cache-only request (reported
 * as a gap in MOD-02). So a tile learns its run three ways:
 * 1. Cache look-up on mount: `POST /solver-runs` with the tile's spec and `params: {}` (tier 2's
 *    defaults, the key the JOB-04 warmer files C and D under). A hit answers `done` at once.
 *    A miss queues a fresh run: the tile cancels it straight away (`DELETE`), so looking at the
 *    Cockpit never runs a simulation, nor saves a min-risk scenario, by itself.
 * 2. The run the user starts ("Run 2,000 trials", same spec; also cache first).
 * 3. Any solver job that ends on this session (`job` messages reach every session of the tenant
 *    and scenario, JOB-02), fetched once with `GET /solver-runs/:id`.
 * Runs are kept as tier 2 sent them; nothing is derived.
 */

/** Problems a Cockpit tile shows. */
export type TileProblem = 'monte_carlo' | 'min_risk_mix';

/**
 * What each tile asks tier 2 for: the problem with `params: {}`, i.e. every parameter left to
 * tier 2's defaults (2,000 seeded trials; lowest risk exposure, total bar). Tier 1 chooses none.
 */
export const TILE_SPECS: { readonly [P in TileProblem]: SolverSpec & { problem: P } } = {
  monte_carlo: { problem: 'monte_carlo', params: {} },
  min_risk_mix: { problem: 'min_risk_mix', params: {} },
};

interface RunsState {
  /** Latest run per `runKey`, as tier 2 last answered it. */
  readonly runs: Readonly<Record<string, SolverRun>>;
  /** A start request is in flight. */
  readonly starting: Readonly<Record<string, true>>;
  /** One-line cause of the last failed start (tier 2's `detail`). */
  readonly errors: Readonly<Record<string, string>>;
  /** Ended jobs already fetched (or being fetched), by job id. */
  readonly fetched: Readonly<Record<string, true>>;
  /** Tiles whose cache look-up was sent, by `runKey`. */
  readonly looked: Readonly<Record<string, true>>;
  /** Runs a cache look-up queued and cancelled, by id: never shown. */
  readonly probes: Readonly<Record<string, true>>;
}

const initial = (): RunsState => ({
  runs: {},
  starting: {},
  errors: {},
  fetched: {},
  looked: {},
  probes: {},
});

/** View state of the Cockpit tiles: which run each tile shows. No business values computed. */
export const cockpitRuns = createStore<RunsState>()(initial);

/** Forget every run (tests; a tenant switch keeps them apart by key already). */
export const resetCockpitRuns = () => cockpitRuns.setState(initial(), true);

/** Job states after which a run no longer changes. */
const ENDED: ReadonlySet<string> = new Set(['done', 'failed', 'cancelled']);

const runKey = (tenant: string, scenarioId: string, problem: TileProblem) =>
  `${tenant}|${scenarioId}|${problem}`;

/**
 * Whether a run feeds a tile: every Monte Carlo run, and the min-risk mix on its default
 * objective (lowest risk exposure; absent = tier 2's default, the same objective).
 */
function tileProblem(run: SolverRun): TileProblem | null {
  const { spec } = run;
  if (spec.problem === 'monte_carlo') return 'monte_carlo';
  if (spec.problem === 'min_risk_mix') {
    const objective = spec.params.objective;
    return objective === undefined || objective === 'min_risk_exposure' ? 'min_risk_mix' : null;
  }
  return null;
}

/** Keeps `run` as its tile's latest (the last one tier 2 reported wins). */
function remember(tenant: string, run: SolverRun) {
  const problem = tileProblem(run);
  if (!problem) return;
  const key = runKey(tenant, run.scenarioId, problem);
  cockpitRuns.setState((s) => {
    if (s.probes[run.id]) return s;
    const had = s.runs[key];
    // A late POST answer (queued) never replaces the same run already fetched as ended.
    if (had?.id === run.id && ENDED.has(had.status) && !ENDED.has(run.status)) return s;
    return { runs: { ...s.runs, [key]: run } };
  });
}

/** A copy of `record` without `key`. */
function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

const problemLine = (e: unknown, fallback: string): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : fallback;

/**
 * Mount once on the screen: every solver job that ends on the session is fetched once
 * (`GET /solver-runs/:id`) and, when it feeds a tile, kept as that tile's run.
 */
export function useSolverRunDiscovery(): void {
  const { tenant, session } = useBindContext();
  const api = useApiClient();
  const jobs = useStore(session.store, (s) => s.jobs);

  useEffect(() => {
    const { fetched, probes } = cockpitRuns.getState();
    const todo = [...jobs.values()].filter(
      (j) =>
        (j.kind ?? 'solver') === 'solver' && ENDED.has(j.status) && !fetched[j.id] && !probes[j.id],
    );
    if (!todo.length) return;
    cockpitRuns.setState((s) => ({
      fetched: { ...s.fetched, ...Object.fromEntries(todo.map((j) => [j.id, true as const])) },
    }));
    for (const j of todo) {
      api.solverRunGet({ params: { tenant, id: j.id } }).then(
        (run) => remember(tenant, run),
        () => {
          // Not a run this viewer can read (or tier 2 is away): let a later message retry.
          cockpitRuns.setState((s) => ({ fetched: without(s.fetched, j.id) }));
        },
      );
    }
  }, [api, tenant, jobs]);
}

export interface TileRun {
  /** The run as tier 2 last reported it; `undefined` when this scenario has none yet. */
  readonly run: SolverRun | undefined;
  /** Its result once `done`; `null` otherwise. */
  readonly result: SolverResult | null;
  /** Live progress of the run (`job` messages). */
  readonly job: JobHandle;
  /** The run started from another scenario version than the one on screen. */
  readonly stale: boolean;
  readonly starting: boolean;
  /** One line when the last start failed. */
  readonly error: string | null;
  /** `POST /solver-runs` of the tile's spec for this scenario (cache first, else a job). */
  start(): Promise<void>;
}

/** The run of one tile for the scenario on screen. */
export function useTileRun(problem: TileProblem): TileRun {
  const { tenant, scenarioId, session } = useBindContext();
  const api = useApiClient();
  const key = runKey(tenant, scenarioId, problem);
  const run = useStore(cockpitRuns, (s) => s.runs[key]);
  const starting = useStore(cockpitRuns, (s) => s.starting[key] === true);
  const error = useStore(cockpitRuns, (s) => s.errors[key] ?? null);
  const version = useStore(session.store, (s) => (s.scenarioId === scenarioId ? s.version : null));
  const job = useJob(run?.id);

  // Cache look-up, once per tile and scenario on this screen session.
  useEffect(() => {
    const s = cockpitRuns.getState();
    if (s.looked[key] || s.runs[key]) return;
    cockpitRuns.setState((st) => ({ looked: { ...st.looked, [key]: true } }));
    const t = tenant as TenantSlug;
    api
      .solverRunStart({ params: { tenant: t }, body: { scenarioId, spec: TILE_SPECS[problem] } })
      .then(
        (next) => {
          if (next.status === 'done' || next.cached) {
            remember(tenant, next);
            return;
          }
          if (next.status !== 'queued' && next.status !== 'running') return;
          // A miss: this look-up queued a fresh run. Stop it; the tile keeps its empty state.
          cockpitRuns.setState((st) => ({ probes: { ...st.probes, [next.id]: true } }));
          api.solverRunCancel({ params: { tenant: t, id: next.id } }).catch(() => undefined);
        },
        // No answer (a viewer may not start runs, or tier 2 is away): the empty state stays.
        () => undefined,
      );
  }, [api, tenant, scenarioId, key, problem]);

  const start = useCallback(async () => {
    cockpitRuns.setState((s) => ({
      starting: { ...s.starting, [key]: true },
      errors: without(s.errors, key),
    }));
    try {
      const next = await api.solverRunStart({
        params: { tenant: tenant as TenantSlug },
        body: { scenarioId, spec: TILE_SPECS[problem] },
      });
      remember(tenant, next);
    } catch (e) {
      const line = problemLine(e, 'Start failed');
      cockpitRuns.setState((s) => ({ errors: { ...s.errors, [key]: line } }));
    } finally {
      cockpitRuns.setState((s) => ({ starting: without(s.starting, key) }));
    }
  }, [api, tenant, scenarioId, key, problem]);

  return {
    run,
    result: run?.status === 'done' ? run.result : null,
    job,
    stale: run !== undefined && version !== null && run.scenarioVersion !== version,
    starting,
    error,
    start,
  };
}
