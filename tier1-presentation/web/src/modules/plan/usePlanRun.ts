import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  type ProblemId,
  type ScenarioId,
  type SolverResult,
  type SolverRun,
  type TenantSlug,
} from '@glidepath/api-contract';
import { useApiClient } from '../../data';
import { useJob } from '../../jobs';
import { terminal, type Ask } from '../path/useSolverRun';

export interface PlanRun {
  /** The run as tier 2 last reported it; `null` = none yet. */
  run: SolverRun | null;
  /** Its result once `done`; while a newer run is active, the last finished result; else `null`. */
  result: SolverResult | null;
  /** The shown run was computed from the scenario's present inputs. */
  current: boolean;
  /** Active job id (worker runs), for `JobHeader`. */
  jobId: string | null;
  /** Tier 2's progress fraction of the active job; `null` when none was sent. */
  progress: number | null;
  busy: boolean;
  error: string | null;
  /** `POST` the question again (or a new one, e.g. other presets); never saved. */
  start(ask?: Ask): Promise<void>;
}

export interface PlanRunOptions {
  problem: ProblemId;
  /** The question asked on load and by `start()`; its `spec.problem` equals `problem`. */
  ask: Ask;
  /** Parameters JSON of the look-up key; absent = `{}` (tier 2's defaults). */
  lookupParams?: string;
}

const lineOf = (e: unknown): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : 'The run failed';

interface Held {
  /** `scenario|problem`: runs of one scope replace each other. */
  readonly scope: string;
  readonly key: string;
  readonly run: SolverRun;
  readonly current: boolean;
  /** The newest finished run of the same scenario and problem: shown (dimmed) while a newer one runs. */
  readonly last: SolverRun | null;
}

/** `run` becomes the held run; the newest `done` run of the same scope is kept for display. */
const hold = (prev: Held | null, scope: string, key: string, run: SolverRun, current: boolean): Held => {
  const same = prev !== null && prev.scope === scope;
  const last = run.status === 'done' ? run : same ? (prev.run.status === 'done' ? prev.run : prev.last) : null;
  return { scope, key, run, current, last };
};

/**
 * One solver run behind a Plan panel. On mount (per scenario, problem and look-up params) it reads what tier 2
 * already holds (`GET /solver-runs/lookup`, no side effects); when that is missing or computed from earlier
 * inputs it starts the panel's question once (`POST /solver-runs/quick` or `/solver-runs`, `save: false`), so
 * the panel fills on load. A worker job is followed through the session's `job` messages and read back when it
 * ends, as Path does. Values stay as tier 2 sent them. Needs a `JobsProvider` above it.
 */
export function usePlanRun(tenant: TenantSlug, scenarioId: ScenarioId, options: PlanRunOptions): PlanRun {
  const { problem, ask, lookupParams } = options;
  const api = useApiClient();
  const scope = `${scenarioId}|${problem}`;
  const key = `${scope}|${lookupParams ?? ''}`;
  const [held, setHeld] = useState<Held | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const looked = useRef<string | null>(null);
  const askRef = useRef(ask);
  askRef.current = ask;

  const mine = held && held.scope === scope ? held : null;
  const run = mine?.run ?? null;
  const job = useJob(run && !terminal(run.status) ? run.id : null);

  const start = useCallback(
    async (next?: Ask) => {
      const q = next ?? askRef.current;
      setStarting(true);
      setError(null);
      try {
        const answered = q.quick
          ? await api.solverRunQuick({ params: { tenant }, body: { scenarioId, spec: q.spec, save: false } })
          : await api.solverRunStart({ params: { tenant }, body: { scenarioId, spec: q.spec, save: false } });
        setHeld((prev) => hold(prev, scope, key, answered, true));
      } catch (e) {
        setError(lineOf(e));
      } finally {
        setStarting(false);
      }
    },
    [api, tenant, scenarioId, scope, key],
  );

  // Look up once per key; start the question once when tier 2 holds nothing current.
  useEffect(() => {
    if (looked.current === key) return;
    looked.current = key;
    const query = { scenarioId, problem, ...(lookupParams === undefined ? {} : { params: lookupParams }) };
    api.solverRunLookup({ params: { tenant }, query }).then(
      (found) => {
        if (looked.current !== key) return;
        if (found.run && found.run.spec.problem === problem) {
          setHeld((prev) => (prev && prev.key === key ? prev : hold(prev, scope, key, found.run!, found.current)));
          if (found.current) return;
        }
        void start();
      },
      () => {
        if (looked.current === key) void start();
      },
    );
  }, [api, tenant, scenarioId, problem, lookupParams, key, start]);

  // When the job ends, read the run with its result once.
  useEffect(() => {
    if (!mine || terminal(mine.run.status) || !terminal(job.status)) return;
    let live = true;
    api
      .solverRunGet({ params: { tenant, id: mine.run.id } })
      .then((next) => live && setHeld((prev) => hold(prev, mine.scope, mine.key, next, mine.current)))
      .catch((e: unknown) => live && setError(lineOf(e)));
    return () => {
      live = false;
    };
  }, [api, tenant, mine, job.status]);

  const active = run !== null && !terminal(run.status);
  const failed = run && terminal(run.status) && run.status !== 'done' ? (run.error?.detail ?? null) : null;
  return {
    run,
    // A newer run in flight keeps the last finished result on screen (the panel dims it).
    result: run?.status === 'done' ? run.result : (mine?.last?.result ?? null),
    current: mine?.current ?? false,
    jobId: active ? run.id : null,
    progress: active ? job.progress : null,
    busy: starting || active,
    error: error ?? failed,
    start,
  };
}
