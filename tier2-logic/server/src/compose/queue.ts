import { connectionConfig } from '@glidepath/data-access';
import { PgBoss } from './boss';
import type { Logger } from '../app/logger';
import { ApiError } from '../app/problem';

/**
 * The server's pg-boss client (ADR-008): `send` a job and, for the short jobs a request waits for, await its
 * output. pg-boss is the queue's own Postgres client (schema `pgboss`: job envelopes, never tenant rows). The
 * connection uses the plain `DATABASE_URL` (libpq `sslmode` semantics through `connectionConfig`, no session
 * state), so it works against Neon's pooler and pgbouncer in transaction mode: sending and polling are single
 * statements. It never installs or migrates the schema and runs no maintenance: the migrate step and the
 * worker own that.
 *
 * The client connects on first use, so a server whose database has no queue schema yet still starts and
 * serves everything that needs no job; the first job then fails with {@link QueueUnavailableError} (a 503).
 */

export const DEFAULT_QUEUE_SCHEMA = 'pgboss';
/** How long `run` waits for a job's output before giving up (the request would otherwise hang). */
export const DEFAULT_RUN_TIMEOUT_MS = 120_000;
export const DEFAULT_RUN_POLL_MS = 100;
const MAX_RUN_POLL_MS = 500;

/** The queue cannot take or finish the job: not installed, not reachable, or no worker answered in time. */
export class QueueUnavailableError extends ApiError {
  constructor(detail: string, options?: { cause?: unknown }) {
    super({ status: 503, title: 'Service unavailable', detail: detail.replace(/\s+/g, ' ').trim() });
    this.name = 'QueueUnavailableError';
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/** A job's data: `tenantId` and `userId` always (the worker's `withTenant`), `runId` on `solver.*`. */
export type QueuePayload = { readonly tenantId: string; readonly userId: string; readonly [field: string]: unknown };

export interface JobQueue {
  /** Sends the job; the pg-boss job id, or null when pg-boss dropped it. */
  enqueue(queue: string, payload: QueuePayload): Promise<string | null>;
  /**
   * Sends the job and resolves with the output its handler returned. A job that failed rejects with an
   * `Error` carrying the handler's `name`, `message` and `code` (pg-boss keeps the serialised error).
   */
  run(queue: string, payload: QueuePayload, options?: { readonly timeoutMs?: number }): Promise<unknown>;
  close(): Promise<void>;
}

export interface JobQueueOptions {
  readonly databaseUrl: string;
  readonly schema?: string;
  readonly logger?: Logger;
  readonly pollMs?: number;
  readonly timeoutMs?: number;
  /** Connections of the client's own pool. Default 3: it only sends and polls. */
  readonly max?: number;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The error a failed job's stored output describes (`serialize-error`: name, message, own properties). */
export function errorFromOutput(output: unknown, queue: string): Error {
  const o = output !== null && typeof output === 'object' ? (output as Record<string, unknown>) : {};
  const err = new Error(typeof o.message === 'string' && o.message !== '' ? o.message : `the ${queue} job failed`);
  if (typeof o.name === 'string' && o.name !== '') err.name = o.name;
  if (typeof o.code === 'string') Object.assign(err, { code: o.code });
  return err;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createJobQueue(options: JobQueueOptions): JobQueue {
  const schema = options.schema ?? DEFAULT_QUEUE_SCHEMA;
  const pollMs = options.pollMs ?? DEFAULT_RUN_POLL_MS;
  const defaultTimeout = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  let started: Promise<PgBoss> | null = null;
  let closed = false;

  const connect = (): Promise<PgBoss> => {
    if (closed) return Promise.reject(new QueueUnavailableError('The job queue is shut down.'));
    started ??= (async () => {
      const boss = new PgBoss({
        ...connectionConfig(options.databaseUrl),
        schema,
        application_name: 'glidepath-logic',
        max: options.max ?? 3,
        migrate: false,
        createSchema: false,
        supervise: false,
        schedule: false,
      });
      boss.on('error', (err: Error) => options.logger?.error('pg-boss error', { err }));
      try {
        await boss.start();
        if (!(await boss.isInstalled())) throw new Error(`the pg-boss schema '${schema}' is not installed`);
      } catch (err) {
        await boss.stop({ graceful: false, close: true }).catch(() => undefined);
        throw err;
      }
      return boss;
    })().catch((err: unknown) => {
      started = null; // try again on the next job
      throw new QueueUnavailableError(
        `The job queue is not available (${messageOf(err)}). Ask an administrator to check the worker and its database setup.`,
        { cause: err },
      );
    });
    return started;
  };

  const send = async (queue: string, payload: QueuePayload): Promise<string | null> => {
    const boss = await connect();
    try {
      return await boss.send(queue, payload as object);
    } catch (err) {
      throw new QueueUnavailableError(`The job could not be queued on ${queue} (${messageOf(err)}).`, { cause: err });
    }
  };

  return {
    enqueue: send,
    async run(queue, payload, opts = {}) {
      const id = await send(queue, payload);
      if (id === null) throw new QueueUnavailableError(`The ${queue} job was not accepted by the queue.`);
      const boss = await connect();
      const deadline = Date.now() + (opts.timeoutMs ?? defaultTimeout);
      let wait = pollMs;
      for (;;) {
        const job = await boss.getJobById<object>(queue, id);
        if (job === null) throw new QueueUnavailableError(`The ${queue} job ${id} disappeared from the queue.`);
        if (job.state === 'completed') return job.output;
        if (job.state === 'failed') throw errorFromOutput(job.output, queue);
        if (job.state === 'cancelled') throw new QueueUnavailableError(`The ${queue} job was cancelled.`);
        if (Date.now() >= deadline) throw new QueueUnavailableError(`The ${queue} job did not finish in time. Is the worker running?`);
        await sleep(wait);
        wait = Math.min(MAX_RUN_POLL_MS, Math.round(wait * 1.5));
      }
    },
    async close() {
      closed = true;
      const pending = started;
      started = null;
      if (pending === null) return;
      const boss = await pending.catch(() => null);
      await boss?.stop({ graceful: false, close: true }).catch(() => undefined);
    },
  };
}
