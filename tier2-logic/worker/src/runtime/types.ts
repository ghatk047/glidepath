import type { JsonValue } from '@glidepath/domain';
import type { TenantTx } from '@glidepath/data-access';

/**
 * Queue families the worker consumes (03 section 4): `solver.*` (solver_run, progress and cancel),
 * `excel.*` (export / import) and `ai.*` (reconfiguration). A queue name is `<family>.<name>`, for
 * example `solver.min_risk_mix`.
 */
export const QUEUE_FAMILIES = ['solver', 'excel', 'ai'] as const;
export type QueueFamily = (typeof QUEUE_FAMILIES)[number];

const QUEUE_NAME = /^(solver|excel|ai)\.[a-z0-9][a-z0-9_.-]*$/;

export function isQueueName(name: unknown): name is string {
  return typeof name === 'string' && QUEUE_NAME.test(name);
}

export function queueFamily(queue: string): QueueFamily {
  if (!isQueueName(queue)) throw new Error(`worker: '${queue}' is not a queue name (solver.*, excel.* or ai.*)`);
  return queue.slice(0, queue.indexOf('.')) as QueueFamily;
}

/**
 * What every job carries in its pg-boss data. `tenantId` and `userId` become the RLS settings of the
 * job's `withTenant`; `runId` names the `solver_run` of a `solver.*` job. Other fields belong to the
 * handler (ids of scenarios, files, prompts); the runtime does not read them.
 */
export interface JobPayload {
  readonly tenantId: string;
  readonly userId: string;
  readonly runId?: string;
  readonly [field: string]: unknown;
}

/** What a handler gets for one job. */
export interface JobContext<P extends JobPayload = JobPayload> {
  /** pg-boss job id. */
  readonly jobId: string;
  readonly queue: string;
  readonly payload: P;
  readonly tenantId: string;
  readonly userId: string;
  /**
   * Fires when the run is cancelled (`solver_run.cancel_requested`), when the worker is shutting down
   * after its drain timeout, or when pg-boss gives the job up. Check it at every batch.
   */
  readonly signal: AbortSignal;
  /**
   * Runs `fn` in one transaction of this job's tenant (`withTenant`, RLS applies). A job never touches
   * the database any other way, and a repository called outside it throws `TenantScopeError`.
   */
  withTenant<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T>;
  /**
   * Reports progress, 0..1 with an optional note. Written to `solver_run.progress` / `progress_note`
   * at most every 250 ms (the latest value wins); a no-op for queues without a `solver_run`.
   */
  progress(fraction: number, note?: string): void;
  /** True once `signal` fired because of a cancel request (as opposed to a shutdown). */
  readonly cancelRequested: boolean;
}

/**
 * A job handler. Resolve with the result, which a `solver.*` job stores in `solver_run.result` (omit
 * it, resolve with `undefined`, when the handler wrote the result itself). Throw to fail the job. After
 * the signal fired, resolve with a partial result or throw: the run ends `cancelled` either way.
 */
export type JobHandler<P extends JobPayload = JobPayload> = (ctx: JobContext<P>) => Promise<JsonValue | undefined | void>;

/** Per-queue settings given when the handler is registered. */
export interface QueueSettings {
  /** pg-boss retries of a failed job. Default 0: a solver run is not silently re-run. */
  readonly retryLimit?: number;
  /** Seconds a job may stay active before pg-boss expires it. Default JOB_EXPIRE_SECONDS. */
  readonly expireInSeconds?: number;
}
