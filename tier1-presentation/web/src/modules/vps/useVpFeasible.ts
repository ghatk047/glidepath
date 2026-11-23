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
  /** Active job id for the panel's progress header. */
  jobId: string | null;
  busy: boolean;
  error: string | null;
  start(): Promise<void>;
}

/**
 * The "Every VP clears?" solver run (`POST /solver-runs`, then the `job` messages of the session,
 * then `GET /solver-runs/:id` for the result). Needs a `JobsProvider` above it. Values are kept
 * as tier 2 sent them; a run belongs to the scenario it started on.
 */
export function useVpFeasible(tenant: TenantSlug, scenarioId: ScenarioId): VpFeasible {
  const api = useApiClient();
  const [held, setHeld] = useState<{ scenarioId: string; run: SolverRun } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = held && held.scenarioId === scenarioId ? held.run : null;
  const job = useJob(run && !terminal(run.status) ? run.id : null);

  useEffect(() => {
    if (!run || terminal(run.status) || !terminal(job.status)) return;
    let live = true;
    api
      .solverRunGet({ params: { tenant, id: run.id } })
      .then((next) => live && setHeld({ scenarioId, run: next }))
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
      setHeld({ scenarioId, run: next });
    } catch (e) {
      setError(lineOf(e));
    } finally {
      setStarting(false);
    }
  }, [api, tenant, scenarioId]);

  const active = run !== null && !terminal(run.status);
  return { run, jobId: active ? run.id : null, busy: starting || active, error, start };
}

const lineOf = (e: unknown): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : 'The run failed';
