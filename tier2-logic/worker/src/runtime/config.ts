import { availableParallelism } from 'node:os';

/**
 * Worker settings (JOB-01). Everything comes from the environment (CLAUDE.md rule 10); the defaults
 * below are operational settings (timings, pool sizes), not business numbers.
 */

/** pg-boss schema that holds the queues. */
export const DEFAULT_BOSS_SCHEMA = 'pgboss';
/** Jobs in parallel per vCPU when JOB_CONCURRENCY is not set (03_engine_and_solvers.md section 4). */
export const JOBS_PER_VCPU = 2;
/** Solver jobs write progress to solver_run at most this often (03_engine_and_solvers.md section 4). */
export const PROGRESS_INTERVAL_MS = 250;
/** How often a running job looks at `cancel_requested` when it reports no progress. */
export const DEFAULT_CANCEL_POLL_MS = 500;
/** pg-boss polling interval for new jobs. */
export const DEFAULT_POLL_MS = 1000;
/** How long SIGTERM waits for in-flight jobs before their signals are aborted. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;
/** A job that stays `active` longer than this is expired by pg-boss. */
export const DEFAULT_JOB_EXPIRE_SECONDS = 3600;

export interface WorkerConfig {
  /** DATABASE_URL: the app role (RLS applies). */
  readonly databaseUrl: string;
  /** DATABASE_URL_MIGRATE: owner role, used only to install the pg-boss schema when set. */
  readonly databaseUrlMigrate: string | null;
  /** Jobs running in parallel in this process, over all queues. */
  readonly concurrency: number;
  readonly bossSchema: string;
  readonly pollMs: number;
  readonly cancelPollMs: number;
  readonly shutdownTimeoutMs: number;
  readonly jobExpireSeconds: number;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

type Env = Readonly<Record<string, string | undefined>>;

function present(env: Env, name: string): string | undefined {
  const v = env[name];
  return v === undefined || v.trim() === '' ? undefined : v.trim();
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = present(env, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`worker: ${name} must be a positive integer, got '${raw}'`);
  return n;
}

/** The default JOB_CONCURRENCY: 2 per vCPU. */
export function defaultConcurrency(vcpus: number = availableParallelism()): number {
  return JOBS_PER_VCPU * Math.max(1, vcpus);
}

/** Reads and validates the worker settings; throws one Error naming the first bad or missing variable. */
export function workerConfigFromEnv(env: Env = process.env, vcpus: number = availableParallelism()): WorkerConfig {
  const databaseUrl = present(env, 'DATABASE_URL');
  if (databaseUrl === undefined) throw new Error('worker: DATABASE_URL is required');
  const level = present(env, 'LOG_LEVEL') ?? 'info';
  if (level !== 'debug' && level !== 'info' && level !== 'warn' && level !== 'error') {
    throw new Error(`worker: LOG_LEVEL must be debug, info, warn or error, got '${level}'`);
  }
  return {
    databaseUrl,
    databaseUrlMigrate: present(env, 'DATABASE_URL_MIGRATE') ?? null,
    concurrency: positiveInt(env, 'JOB_CONCURRENCY', defaultConcurrency(vcpus)),
    bossSchema: present(env, 'JOB_QUEUE_SCHEMA') ?? DEFAULT_BOSS_SCHEMA,
    pollMs: positiveInt(env, 'JOB_POLL_MS', DEFAULT_POLL_MS),
    cancelPollMs: positiveInt(env, 'JOB_CANCEL_POLL_MS', DEFAULT_CANCEL_POLL_MS),
    shutdownTimeoutMs: positiveInt(env, 'JOB_SHUTDOWN_TIMEOUT_MS', DEFAULT_SHUTDOWN_TIMEOUT_MS),
    jobExpireSeconds: positiveInt(env, 'JOB_EXPIRE_SECONDS', DEFAULT_JOB_EXPIRE_SECONDS),
    logLevel: level,
  };
}
