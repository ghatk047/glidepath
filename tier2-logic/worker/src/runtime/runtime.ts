import { connectionConfig, createDb, dbOptionsFromEnv } from '@glidepath/data-access';
import type { DbHandle, DbOptions } from '@glidepath/data-access';
import { PgBoss } from './boss';
import type { Job } from './boss';
import { systemClock } from './clock';
import type { Clock } from './clock';
import {
  DEFAULT_BOSS_SCHEMA,
  DEFAULT_CANCEL_POLL_MS,
  DEFAULT_JOB_EXPIRE_SECONDS,
  DEFAULT_POLL_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  defaultConcurrency,
} from './config';
import { silentLogger } from './logger';
import type { Logger } from './logger';
import { defaultRegistry } from './registry';
import type { HandlerRegistry, Registration } from './registry';
import { failUnstartedRun, parsePayload, runJob, WorkerStoppingError } from './run-job';
import { Semaphore } from './semaphore';

export interface WorkerRuntimeOptions {
  /** DATABASE_URL: the app role. */
  readonly databaseUrl: string;
  /** Handlers to consume; default: the process-wide registry that `registerHandler` fills. */
  readonly registry?: HandlerRegistry;
  /** Jobs in parallel in this process over all queues. Default 2 per vCPU (JOB_CONCURRENCY). */
  readonly concurrency?: number;
  /** pg-boss schema. Default `pgboss`. */
  readonly schema?: string;
  /**
   * Let pg-boss create or migrate its own schema at start. Only for a role that may create schemas;
   * the app role may not (use `installQueueSchema` as the owner role instead). Default false.
   */
  readonly installSchema?: boolean;
  readonly pollMs?: number;
  readonly cancelPollMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly jobExpireSeconds?: number;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly dbOptions?: DbOptions;
}

type Handler = (jobs: Job<object>[]) => Promise<void>;

/**
 * The worker's job runtime (JOB-01, ADR-008): connects with DATABASE_URL, starts pg-boss, consumes
 * every registered `solver.*`, `excel.*` and `ai.*` queue with at most `concurrency` jobs running in
 * this process, runs each job inside `withTenant` of its tenant, and drains in-flight jobs on `stop()`.
 */
export class WorkerRuntime {
  readonly concurrency: number;
  private readonly registry: HandlerRegistry;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly slots: Semaphore;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly shutdown = new AbortController();
  private handle: DbHandle | null = null;
  private pgBoss: PgBoss | null = null;
  private stopping: Promise<void> | null = null;
  private queues: string[] = [];

  constructor(private readonly opts: WorkerRuntimeOptions) {
    this.concurrency = opts.concurrency ?? defaultConcurrency();
    this.registry = opts.registry ?? defaultRegistry;
    this.clock = opts.clock ?? systemClock;
    this.logger = opts.logger ?? silentLogger;
    this.slots = new Semaphore(this.concurrency);
  }

  /** The pg-boss instance (for enqueueing in tests and tools). Throws before `start()`. */
  get boss(): PgBoss {
    if (!this.pgBoss) throw new Error('worker: runtime is not started');
    return this.pgBoss;
  }

  get db(): DbHandle {
    if (!this.handle) throw new Error('worker: runtime is not started');
    return this.handle;
  }

  /** Jobs currently running in this process. */
  get active(): number {
    return this.inFlight.size;
  }

  /** Queues this runtime consumes. */
  get consuming(): readonly string[] {
    return this.queues;
  }

  async start(): Promise<this> {
    if (this.pgBoss) throw new Error('worker: runtime already started');
    const o = this.opts;
    const schema = o.schema ?? DEFAULT_BOSS_SCHEMA;
    const handle = createDb(o.databaseUrl, { poolMax: this.concurrency + 2, ...(o.dbOptions ?? dbOptionsFromEnv()) });
    const install = o.installSchema ?? false;
    const boss = new PgBoss({
      // libpq sslmode semantics (require = TLS without verification), as data-access uses.
      ...connectionConfig(o.databaseUrl),
      schema,
      application_name: 'glidepath-worker',
      max: this.concurrency + 4,
      migrate: install,
      createSchema: install,
      schedule: false,
    });
    boss.on('error', (err: Error) => this.logger.error('pg-boss error', { error: err.message }));
    boss.on('warning', (w: { message?: string }) => this.logger.warn('pg-boss warning', { message: w.message }));
    try {
      await boss.start();
      if (!install && !(await boss.isInstalled())) {
        throw new Error(
          `worker: the pg-boss schema '${schema}' is not installed; run installQueueSchema with DATABASE_URL_MIGRATE (owner role) first`,
        );
      }
      this.handle = handle;
      this.pgBoss = boss;
      const regs = this.registry.registrations();
      for (const reg of regs) await this.consume(boss, reg);
      this.queues = regs.map((r) => r.queue);
    } catch (err) {
      this.pgBoss = null;
      this.handle = null;
      await boss.stop({ graceful: false, close: true }).catch(() => undefined);
      await handle.close().catch(() => undefined);
      throw err;
    }
    this.logger.info('worker started', { queues: this.queues, concurrency: this.concurrency });
    return this;
  }

  private async consume(boss: PgBoss, reg: Registration): Promise<void> {
    const o = this.opts;
    const known = await boss.getQueue(reg.queue);
    if (!known) {
      await boss.createQueue(reg.queue, {
        retryLimit: reg.settings.retryLimit ?? 0,
        expireInSeconds: reg.settings.expireInSeconds ?? o.jobExpireSeconds ?? DEFAULT_JOB_EXPIRE_SECONDS,
      });
    }
    const handler: Handler = async (jobs) => {
      await Promise.all(jobs.map((job) => this.execute(reg, job)));
    };
    await boss.work(
      reg.queue,
      {
        localConcurrency: this.concurrency,
        pollingIntervalSeconds: Math.max(0.5, (o.pollMs ?? DEFAULT_POLL_MS) / 1000),
        batchSize: 1,
      },
      handler,
    );
  }

  private execute(reg: Registration, job: Job<object>): Promise<void> {
    const run = async (): Promise<void> => {
      let release: () => void;
      try {
        release = await this.slots.acquire();
      } catch {
        await failUnstartedRun(this.deps(), reg.queue, job.data, 'worker stopped before the run started');
        throw new WorkerStoppingError();
      }
      try {
        if (this.stopping) {
          await failUnstartedRun(this.deps(), reg.queue, job.data, 'worker stopped before the run started');
          throw new WorkerStoppingError();
        }
        await runJob(this.deps(), reg, { id: job.id, data: job.data, signal: job.signal });
      } finally {
        release();
      }
    };
    const p = run();
    const tracked = p.then(
      () => undefined,
      () => undefined,
    );
    this.inFlight.add(tracked);
    void tracked.then(() => this.inFlight.delete(tracked));
    return p;
  }

  private deps() {
    return {
      db: this.db.db,
      clock: this.clock,
      logger: this.logger,
      cancelPollMs: this.opts.cancelPollMs ?? DEFAULT_CANCEL_POLL_MS,
      shutdown: this.shutdown.signal,
    };
  }

  /**
   * Graceful shutdown (SIGTERM): stops fetching, lets in-flight jobs finish for up to
   * `shutdownTimeoutMs`, then aborts the signals of what is still running, closes pg-boss and the
   * pool. Safe to call twice.
   */
  stop(): Promise<void> {
    this.stopping ??= this.doStop();
    return this.stopping;
  }

  private async doStop(): Promise<void> {
    const boss = this.pgBoss;
    if (!boss) return;
    const timeoutMs = this.opts.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.logger.info('worker stopping', { inFlight: this.inFlight.size });
    this.slots.rejectWaiters(new WorkerStoppingError());
    await Promise.all(this.queues.map((q) => boss.offWork(q, { wait: false }).catch(() => undefined)));

    const settled = (): Promise<void> => (this.inFlight.size === 0 ? Promise.resolve() : Promise.allSettled([...this.inFlight]).then(() => settled()));
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const outcome = await Promise.race([settled().then(() => 'drained' as const), timedOut]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      this.logger.warn('drain timeout: aborting running jobs', { inFlight: this.inFlight.size });
      this.shutdown.abort(new WorkerStoppingError());
      // Handlers that honour their signal get a moment to write their final state.
      await Promise.race([settled(), new Promise<void>((r) => setTimeout(r, Math.min(5000, timeoutMs)).unref())]);
    }
    await boss.stop({ graceful: true, close: true, timeout: 5000 }).catch((err: unknown) => {
      this.logger.warn('pg-boss stop failed', { error: err instanceof Error ? err.message : String(err) });
    });
    await this.handle?.close().catch(() => undefined);
    this.logger.info('worker stopped');
  }
}

/** Creates and starts a runtime. */
export async function startWorker(opts: WorkerRuntimeOptions): Promise<WorkerRuntime> {
  return new WorkerRuntime(opts).start();
}

export { parsePayload };
