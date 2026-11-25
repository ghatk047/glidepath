import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  type ScenarioId,
  type SolverRun,
  type SolverSpec,
  type TenantSlug,
} from '@glidepath/api-contract';
import { useApiClient } from '../../data';
import { useJob } from '../../jobs';

const terminal = (s: string | null | undefined) =>
  s === 'done' || s === 'failed' || s === 'cancelled';

/** Problem asked of tier 2: `min_risk_mix` with every VP bar as a constraint (solvers.json). */
const SPEC: SolverSpec = { problem: 'vp_feasible', params: { constraints: [{ id: 'per_vp' }] } };

export interface VpFeasible {
  /** The run on this scenario as tier 2 last reported it; `null` = none yet (empty state). */
  run: SolverRun | null;
  /**
   * The run is from this scenario's present inputs (tier 2's `current`). `false`: a result of earlier inputs,
   * shown dimmed. A run started or finished on this screen is current.
   */
  current: boolean;
  /** Active job id for the panel's progress header. */
  jobId: string | null;
  busy: boolean;
  error: string | null;
  start(): Promise<void>;
}

/**
 * The "Every VP clears?" solver run. On mount `GET /solver-runs/lookup` for this scenario and spec
 * reads what tier 2 holds (API-13: never enqueues, runs or writes), so a run done earlier shows at
 * once. "Find a plan" starts one (`POST /solver-runs`, then the `job` messages of the session, then
 * `GET /solver-runs/:id` for the result). Needs a `JobsProvider` above it. Values are kept as tier 2
 * sent them; a run belongs to the scenario it was found or started on.
 */
export function useVpFeasible(tenant: TenantSlug, scenarioId: ScenarioId): VpFeasible {
  const api = useApiClient();
  const [held, setHeld] = useState<{
    scenarioId: string;
    run: SolverRun;
    current: boolean;
  } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = held && held.scenarioId === scenarioId ? held.run : null;
  const job = useJob(run && !terminal(run.status) ? run.id : null);

  // Look-up, once per scenario on this screen. A read: nothing is queued or stored. A run started or ended
  // meanwhile is newer than what was held, so it is never replaced.
  useEffect(() => {
    let live = true;
    api
      .solverRunLookup({
        params: { tenant },
        query: { scenarioId, problem: SPEC.problem, params: JSON.stringify(SPEC.params) },
      })
      .then(
        (found) => {
          const { run: stored, current } = found;
          if (!live || stored === null) return;
          setHeld((cur) => (cur?.scenarioId === scenarioId ? cur : { scenarioId, run: stored, current }));
        },
        // No answer (tier 2 is away): the empty state stays; "Find a plan" still works.
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [api, tenant, scenarioId]);

  useEffect(() => {
    if (!run || terminal(run.status) || !terminal(job.status)) return;
    let live = true;
    api
      .solverRunGet({ params: { tenant, id: run.id } })
      .then((next) => live && setHeld({ scenarioId, run: next, current: true }))
      .catch((e: unknown) => live && setError(lineOf(e)));
    return () => {
      live = false;
    };
  }, [api, tenant, scenarioId, run, job.status]);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const next = await api.solverRunStart({
        params: { tenant },
        body: { scenarioId, spec: SPEC },
      });
      setHeld({ scenarioId, run: next, current: true });
    } catch (e) {
      setError(lineOf(e));
    } finally {
      setStarting(false);
    }
  }, [api, tenant, scenarioId]);

  const active = run !== null && !terminal(run.status);
  return { run, current: run === null || held?.current !== false, jobId: active ? run.id : null, busy: starting || active, error, start };
}

const lineOf = (e: unknown): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : 'The run failed';
