import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  type ProblemId,
  type QuickSolverSpec,
  type ScenarioId,
  type SolverResult,
  type SolverRun,
  type SolverSpec,
  type TenantSlug,
} from '@glidepath/api-contract';
import { useApiClient } from '../../data';
import { useJob } from '../../jobs';
import { terminal } from './useSolverRun';

/**
 * One analysis run behind a Path II panel (savings vs risk, odds, tornado). It learns its run two
 * ways, both tier 2's:
 *  1. A side-effect-free look-up on mount (`GET /solver-runs/lookup`, API-13): the newest finished
 *     run tier 2 holds for `(scenario, problem, params)`. Reading never enqueues, runs, saves or
 *     writes a row, and it also carries the trial count a Monte Carlo "Run N trials" prints.
 *  2. The run the viewer starts (`POST /solver-runs` or `/quick`, `save: false`: an analysis panel
 *     never writes a scenario). Then the `job` messages the session already stores are followed.
 * Values stay as tier 2 sent them; nothing is derived here.
 */
export interface Analysis {
  /** The run as tier 2 last reported it; `null` when the scenario has none. */
  run: SolverRun | null;
  /** Its result once `done`; `null` otherwise. */
  result: SolverResult | null;
  /** The look-up's run was computed from the scenario's present inputs (API-13 `current`). */
  current: boolean;
  /** Draws a Monte Carlo run of these params would make, as the look-up answered; `null` otherwise. */
  trials: number | null;
  /** Active job id, for `JobHeader`. */
  jobId: string | null;
  busy: boolean;
  error: string | null;
  /** `POST` the panel's spec for this scenario (never saved); follow the job. */
  start(): Promise<void>;
}

const lineOf = (e: unknown): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : 'The run failed';

type Ask = { readonly quick: false; readonly spec: SolverSpec } | { readonly quick: true; readonly spec: QuickSolverSpec };

export interface AnalysisOptions {
  /** The problem the look-up and the run ask for. */
  problem: ProblemId;
  /** The run the "Run" action starts; its `problem` must equal `problem`. */
  ask: Ask;
  /** Parameters JSON for the look-up key (tier 2's defaults when absent, the warmer's key). */
  lookupParams?: string;
}

interface Held {
  readonly scenarioId: string;
  readonly problem: ProblemId;
  readonly run: SolverRun;
}

/** The analysis of one panel for a scenario. Needs a `JobsProvider` above it. */
export function useAnalysis(
  tenant: TenantSlug,
  scenarioId: ScenarioId,
  options: AnalysisOptions,
): Analysis {
  const { problem, ask, lookupParams } = options;
  const api = useApiClient();
  const [held, setHeld] = useState<Held | null>(null);
  const [current, setCurrent] = useState(false);
  const [trials, setTrials] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const looked = useRef<string | null>(null);

  const mine = held && held.scenarioId === scenarioId && held.problem === problem ? held : null;
  const run = mine?.run ?? null;
  const job = useJob(run && !terminal(run.status) ? run.id : null);

  // Look-up once per scenario, problem and params on this screen session (a read; nothing stored).
  const lookKey = `${scenarioId}|${problem}|${lookupParams ?? ''}`;
  useEffect(() => {
    if (looked.current === lookKey) return;
    looked.current = lookKey;
    api
      .solverRunLookup({
        params: { tenant },
        query: { scenarioId, problem, ...(lookupParams === undefined ? {} : { params: lookupParams }) },
      })
      .then((found) => {
        if (looked.current !== lookKey) return;
        setTrials(found.trials);
        if (found.run && found.run.spec.problem === problem) {
          // A run the viewer started meanwhile wins; otherwise show what tier 2 holds.
          setHeld((prev) =>
            prev && prev.scenarioId === scenarioId && prev.problem === problem
              ? prev
              : { scenarioId, problem, run: found.run! },
          );
          setCurrent(found.current);
        }
      })
      .catch(() => undefined);
  }, [api, tenant, scenarioId, problem, lookupParams, lookKey]);

  // When the job ends, read the run with its result (once), as the Path result does.
  useEffect(() => {
    if (!mine || terminal(mine.run.status) || !terminal(job.status)) return;
    let live = true;
    api
      .solverRunGet({ params: { tenant, id: mine.run.id } })
      .then((next) => live && setHeld({ scenarioId, problem, run: next }))
      .catch((e: unknown) => live && setError(lineOf(e)));
    return () => {
      live = false;
    };
  }, [api, tenant, scenarioId, problem, mine, job.status]);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const next = ask.quick
        ? await api.solverRunQuick({ params: { tenant }, body: { scenarioId, spec: ask.spec, save: false } })
        : await api.solverRunStart({ params: { tenant }, body: { scenarioId, spec: ask.spec, save: false } });
      setHeld({ scenarioId, problem, run: next });
      setCurrent(true);
    } catch (e) {
      setError(lineOf(e));
    } finally {
      setStarting(false);
    }
  }, [api, tenant, scenarioId, problem, ask]);

  const active = run !== null && !terminal(run.status);
  return {
    run,
    result: run?.status === 'done' ? run.result : null,
    current,
    trials,
    jobId: active ? run.id : null,
    busy: starting || active,
    error,
    start,
  };
}
