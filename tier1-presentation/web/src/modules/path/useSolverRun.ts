import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  type QuickSolverSpec,
  type ScenarioId,
  type SolverRun,
  type SolverSpec,
  type TenantSlug,
} from '@glidepath/api-contract';
import { useApiClient } from '../../data';
import { useJob } from '../../jobs';

export const terminal = (s: string | null | undefined): boolean =>
  s === 'done' || s === 'failed' || s === 'cancelled';

/** What was asked, so the same question can be asked again (save as scenario). */
export type Ask =
  | { readonly quick: false; readonly spec: SolverSpec }
  | { readonly quick: true; readonly spec: QuickSolverSpec };

export interface SolverRunHandle {
  /** The run on this scenario as tier 2 last reported it; `null` = none yet. */
  run: SolverRun | null;
  /** The question behind `run`. */
  ask: Ask | null;
  /** Active job id, for `JobHeader`. */
  jobId: string | null;
  busy: boolean;
  error: string | null;
  /** `POST /solver-runs` (worker job) or `POST /solver-runs/quick`, then follow the job. */
  start(ask: Ask, options?: { save?: boolean }): Promise<void>;
}

const lineOf = (e: unknown): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : 'The run failed';

/**
 * One solver run of the Path screen. Starts it (worker or quick route of the contract), follows
 * the `job` messages the session already stores (`useJob`, no second socket) and, once tier 2
 * says the job ended, reads the run with its result (`GET /solver-runs/:id`). A quick run that
 * answers done is shown at once. Values stay as tier 2 sent them; a run belongs to the scenario
 * it started on. Needs a `JobsProvider` above it.
 */
export function useSolverRun(tenant: TenantSlug, scenarioId: ScenarioId): SolverRunHandle {
  const api = useApiClient();
  const [held, setHeld] = useState<{ scenarioId: string; run: SolverRun; ask: Ask } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = held && held.scenarioId === scenarioId ? held : null;
  const run = mine?.run ?? null;
  const job = useJob(run && !terminal(run.status) ? run.id : null);

  useEffect(() => {
    if (!mine || terminal(mine.run.status) || !terminal(job.status)) return;
    let live = true;
    api
      .solverRunGet({ params: { tenant, id: mine.run.id } })
      .then((next) => live && setHeld({ ...mine, run: next }))
      .catch((e: unknown) => live && setError(lineOf(e)));
    return () => {
      live = false;
    };
  }, [api, tenant, mine, job.status]);

  const start = useCallback(
    async (ask: Ask, options: { save?: boolean } = {}) => {
      setStarting(true);
      setError(null);
      try {
        const save = options.save ? { save: true } : {};
        const next = ask.quick
          ? await api.solverRunQuick({
              params: { tenant },
              body: { scenarioId, spec: ask.spec, ...save },
            })
          : await api.solverRunStart({
              params: { tenant },
              body: { scenarioId, spec: ask.spec, ...save },
            });
        setHeld({ scenarioId, run: next, ask });
      } catch (e) {
        setError(lineOf(e));
      } finally {
        setStarting(false);
      }
    },
    [api, tenant, scenarioId],
  );

  const active = run !== null && !terminal(run.status);
  return {
    run,
    ask: mine?.ask ?? null,
    jobId: active ? run.id : null,
    busy: starting || active,
    error,
    start,
  };
}
