import { getSolverRun, updateSolverRun, withTenant } from '@glidepath/data-access';
import type { Db, SolverRunPatch, TenantTx } from '@glidepath/data-access';
import type { JsonValue } from '@glidepath/domain';
import type { Clock } from './clock';
import type { Logger } from './logger';
import { ProgressThrottle } from './progress';
import type { Registration } from './registry';
import { queueFamily } from './types';
import type { JobContext, JobPayload } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const MAX_ERROR_CHARS = 2000;

/** A job whose data lacks what the runtime needs; retrying cannot help. */
export class JobPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobPayloadError';
  }
}

/** Abort reason of a cancelled run. */
export class JobCancelledError extends Error {
  constructor() {
    super('job cancelled');
    this.name = 'JobCancelledError';
  }
}

/** The job was fetched but the worker started shutting down before it could run. */
export class WorkerStoppingError extends Error {
  constructor() {
    super('worker is shutting down');
    this.name = 'WorkerStoppingError';
  }
}

/** Validates the data of a job of `queue`: `tenantId` and `userId` always, `runId` for `solver.*`. */
export function parsePayload(queue: string, data: unknown): JobPayload {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new JobPayloadError(`${queue}: job data must be an object`);
  const d = data as Record<string, unknown>;
  for (const key of ['tenantId', 'userId'] as const) {
    if (typeof d[key] !== 'string' || !UUID.test(d[key])) throw new JobPayloadError(`${queue}: ${key} must be a uuid`);
  }
  if (queueFamily(queue) === 'solver' && (typeof d.runId !== 'string' || !UUID.test(d.runId))) {
    throw new JobPayloadError(`${queue}: runId (the solver_run id) must be a uuid`);
  }
  if (d.runId !== undefined && (typeof d.runId !== 'string' || !UUID.test(d.runId))) throw new JobPayloadError(`${queue}: runId must be a uuid`);
  return d as JobPayload;
}

export interface RunJobDeps {
  readonly db: Db;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly cancelPollMs: number;
  /** Aborted when the worker gives up draining. */
  readonly shutdown: AbortSignal;
}

export interface JobInput {
  readonly id: string;
  readonly data: unknown;
  /** pg-boss's own signal for this job. */
  readonly signal: AbortSignal;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_CHARS);

/** Marks a not-yet-started solver run failed (the worker stopped first). Never throws. */
export async function failUnstartedRun(deps: Pick<RunJobDeps, 'db' | 'logger'>, queue: string, data: unknown, reason: string): Promise<void> {
  try {
    const p = parsePayload(queue, data);
    if (queueFamily(queue) !== 'solver' || p.runId === undefined) return;
    await withTenant(deps.db, p.tenantId, p.userId, async (tx) => {
      const run = await getSolverRun(tx, p.runId!);
      if (run && !TERMINAL.has(run.status)) {
        await updateSolverRun(tx, p.runId!, { status: 'failed', result: { error: reason }, progress_note: reason });
      }
    });
  } catch (err) {
    deps.logger.warn('could not fail unstarted run', { queue, error: messageOf(err) });
  }
}

/**
 * Runs one job: everything the handler or the runtime reads or writes goes through `withTenant` of the
 * job's tenant. For `solver.*` queues the `solver_run` row follows the job: `running` at the start,
 * progress at most every 250 ms, `done` / `failed` / `cancelled` at the end. `cancel_requested` (seen
 * when a progress write returns, or by polling every `cancelPollMs`) aborts the handler's signal.
 * Rethrows the handler's error for a failed job so pg-boss records the failure; a cancelled job ends
 * normally.
 */
export async function runJob(deps: RunJobDeps, reg: Registration, job: JobInput): Promise<JsonValue | undefined> {
  const { db, clock, logger } = deps;
  const payload = parsePayload(reg.queue, job.data);
  const { tenantId, userId } = payload;
  const runId = queueFamily(reg.queue) === 'solver' ? payload.runId! : null;

  const tenantTx = <T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> => withTenant(db, tenantId, userId, fn);

  if (runId !== null) {
    const start = await tenantTx(async (tx) => {
      const run = await getSolverRun(tx, runId);
      if (run === null) return 'missing' as const;
      if (TERMINAL.has(run.status)) return 'finished' as const;
      if (run.cancel_requested) {
        await updateSolverRun(tx, runId, { status: 'cancelled' });
        return 'cancelled' as const;
      }
      await updateSolverRun(tx, runId, { status: 'running' });
      return 'run' as const;
    });
    if (start === 'missing') throw new JobPayloadError(`${reg.queue}: solver_run ${runId} does not exist for this tenant`);
    if (start !== 'run') {
      logger.info('solver run not started', { queue: reg.queue, jobId: job.id, runId, state: start });
      return;
    }
  }

  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, job.signal, deps.shutdown]);
  let cancelRequested = false;
  const requestCancel = (): void => {
    if (cancelRequested) return;
    cancelRequested = true;
    controller.abort(new JobCancelledError());
  };

  let throttle: ProgressThrottle | null = null;
  let poll: unknown = null;
  if (runId !== null) {
    throttle = new ProgressThrottle(
      async ({ fraction, note }) => {
        const patch: SolverRunPatch = note === undefined ? { progress: fraction } : { progress: fraction, progress_note: note };
        const row = await tenantTx((tx) => updateSolverRun(tx, runId, patch));
        if (row?.cancel_requested) requestCancel();
      },
      clock,
      (err) => logger.warn('progress write failed', { queue: reg.queue, jobId: job.id, runId, error: messageOf(err) }),
    );
    let polling = false;
    poll = clock.setInterval(() => {
      if (polling || cancelRequested) return;
      polling = true;
      tenantTx((tx) => getSolverRun(tx, runId))
        .then((row) => {
          if (row?.cancel_requested) requestCancel();
        })
        .catch((err: unknown) => logger.warn('cancel poll failed', { queue: reg.queue, jobId: job.id, runId, error: messageOf(err) }))
        .finally(() => {
          polling = false;
        });
    }, deps.cancelPollMs);
  }

  const ctx: JobContext = {
    jobId: job.id,
    queue: reg.queue,
    payload,
    tenantId,
    userId,
    signal,
    withTenant: tenantTx,
    progress: (fraction, note) => throttle?.report(fraction, note),
    get cancelRequested() {
      return cancelRequested;
    },
  };

  let result: JsonValue | undefined;
  let failure: { error: unknown } | null = null;
  try {
    const out = await (reg.handler as (c: JobContext) => Promise<JsonValue | undefined | void>)(ctx);
    result = out === undefined ? undefined : (out as JsonValue);
  } catch (err) {
    failure = { error: err };
  } finally {
    if (poll !== null) clock.clearInterval(poll);
    await throttle?.close();
  }

  if (runId === null) {
    if (failure) throw failure.error;
    return result; // excel.* / ai.*: the output pg-boss stores, which the server's queue.run awaits (INT-04)
  }

  if (cancelRequested) {
    await tenantTx((tx) => updateSolverRun(tx, runId, { status: 'cancelled', ...(result === undefined ? {} : { result }) }));
    logger.info('solver run cancelled', { queue: reg.queue, jobId: job.id, runId });
    return;
  }
  if (failure || deps.shutdown.aborted) {
    const reason = deps.shutdown.aborted ? 'worker stopped before the run finished' : messageOf(failure!.error);
    await tenantTx((tx) => updateSolverRun(tx, runId, { status: 'failed', result: { error: reason }, progress_note: reason }));
    logger.warn('solver run failed', { queue: reg.queue, jobId: job.id, runId, error: reason });
    throw failure?.error ?? new WorkerStoppingError();
  }
  await tenantTx((tx) =>
    updateSolverRun(tx, runId, { status: 'done', progress: 1, ...(result === undefined ? {} : { result }) }),
  );
}
