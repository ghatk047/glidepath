import type { ScenarioId, TenantId, UserId } from '@glidepath/api-contract';
import { createSolverRun, getLatestCalcRun, updateSolverRun } from '@glidepath/data-access';
import type { SolverRunKind, SolverRunRecord, TenantTx } from '@glidepath/data-access';
import type { Logger } from '../app/logger';
import type { WithTenant } from '../app/tenant';
import { cacheKeyOf, findCachedRun, withCacheKey } from './cache';
import type { SpecLike } from './cache';

/** Sends a job to pg-boss (the worker's `enqueueJob` bound to a started boss); returns the job id or null. */
export type EnqueueJob = (
  queue: string,
  payload: { tenantId: string; userId: string; runId: string; save: boolean },
) => Promise<string | null>;

/**
 * The inputHash of a scenario's committed inputs (engine hash of cells plus model version), or null when none
 * is known (the run is then enqueued without a cache key). Runs in the submit transaction.
 */
export type InputHashOf = (tx: TenantTx, scenarioId: string) => Promise<string | null>;

/** Default: the hash of the scenario's latest `calc_run` (written with every commit). */
export const latestCalcInputHash: InputHashOf = async (tx, scenarioId) =>
  (await getLatestCalcRun(tx, scenarioId))?.input_hash ?? null;

export interface SolverSubmitDeps {
  readonly withTenant: WithTenant;
  readonly enqueue: EnqueueJob;
  readonly inputHashOf?: InputHashOf;
  readonly logger?: Logger;
}

export interface SolverSubmit {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly scenarioId: ScenarioId;
  /** `solver_run.kind` (the enum of the table; the route maps problem ids to it). */
  readonly kind: SolverRunKind;
  readonly spec: SpecLike;
  /**
   * The request's `save`: sent to the worker in the job data (JOB-03 saves a result as a scenario only for
   * `save !== false`). Absent = false. A saving request is never answered from the cache.
   */
  readonly save?: boolean;
}

export interface SolverSubmitted {
  readonly run: SolverRunRecord;
  /** True: answered from the cache, nothing was enqueued. */
  readonly cached: boolean;
  /** pg-boss job id; null when cached (or pg-boss dropped the job). */
  readonly jobId: string | null;
}

/** The pg-boss queue of a problem: `solver.<problem>`. */
export const solverQueue = (problem: string): string => `solver.${problem}`;

/**
 * Starts a solver run with the result cache in front (03 section 4, JOB-02): when a finished run of the same
 * scenario has the same `(problem, params hash, inputHash)`, a new `done` run holding the same result is
 * written and nothing is enqueued. Otherwise the run is created `queued` with its key and sent to
 * `solver.<problem>` after the transaction committed (so the worker finds the row).
 *
 * A hit does not copy `result_scenario_id`: saving a result as a scenario is a separate step per run, so a request
 * with `save: true` skips the cache and always runs (the job saves; a cached run would save nothing). The job data
 * carries `save` either way, so a job started without it never adds a scenario.
 */
export function createSolverSubmitter(deps: SolverSubmitDeps): (request: SolverSubmit) => Promise<SolverSubmitted> {
  const inputHashOf = deps.inputHashOf ?? latestCalcInputHash;
  return async (request) => {
    const { tenantId, userId, scenarioId, kind, spec } = request;
    const save = request.save === true;
    const staged = await deps.withTenant(tenantId, userId, async (tx) => {
      const inputHash = await inputHashOf(tx, scenarioId);
      if (inputHash === null) {
        return { hit: false as const, run: await createSolverRun(tx, { kind, scenario_id: scenarioId, spec: spec as never }) };
      }
      const key = cacheKeyOf(spec, inputHash);
      const found = save ? null : await findCachedRun(tx, scenarioId, key);
      if (!found) {
        return { hit: false as const, run: await createSolverRun(tx, { kind, scenario_id: scenarioId, spec: withCacheKey(spec, key) }) };
      }
      const created = await createSolverRun(tx, {
        kind,
        scenario_id: scenarioId,
        spec: withCacheKey(spec, key, found.id),
      });
      const run = await updateSolverRun(tx, created.id, { status: 'done', progress: 1, result: found.result });
      return { hit: true as const, run: run ?? created };
    });
    if (staged.hit) {
      deps.logger?.debug('solver run answered from cache', { run: staged.run.id, scenario: scenarioId });
      return { run: staged.run, cached: true, jobId: null };
    }
    try {
      const jobId = await deps.enqueue(solverQueue(spec.problem), { tenantId, userId, runId: staged.run.id, save });
      return { run: staged.run, cached: false, jobId };
    } catch (err) {
      // The run would sit `queued` for ever: end it and let the caller see the failure.
      await deps
        .withTenant(tenantId, userId, (tx) =>
          updateSolverRun(tx, staged.run.id, { status: 'failed', result: { error: 'the job could not be queued' } }),
        )
        .catch((e: unknown) => deps.logger?.warn('queue failure could not be recorded', { err: e, run: staged.run.id }));
      throw err;
    }
  };
}
