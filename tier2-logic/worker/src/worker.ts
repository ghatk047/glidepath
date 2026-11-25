/**
 * Worker entry (`node dist/worker.js`, JOB-01). Environment only: DATABASE_URL (required),
 * JOB_CONCURRENCY (default 2 per vCPU), DATABASE_URL_MIGRATE (optional: installs the pg-boss schema and
 * its grants before starting), LOG_LEVEL and the JOB_* timings of `runtime/config.ts`.
 *
 * Job handlers register themselves with `registerHandler(queue, fn)` from their own modules; import
 * those modules here (one line each) when they exist.
 */
import './handlers';
import { installQueueSchema, installShutdownHandlers, jsonLogger, startWorker, workerConfigFromEnv, defaultRegistry } from './runtime';

async function main(): Promise<void> {
  const config = workerConfigFromEnv();
  const logger = jsonLogger(config.logLevel);
  if (config.databaseUrlMigrate !== null) {
    await installQueueSchema({ ownerUrl: config.databaseUrlMigrate, schema: config.bossSchema, queues: defaultRegistry.queues() });
  }
  const runtime = await startWorker({
    databaseUrl: config.databaseUrl,
    registry: defaultRegistry,
    concurrency: config.concurrency,
    schema: config.bossSchema,
    pollMs: config.pollMs,
    cancelPollMs: config.cancelPollMs,
    shutdownTimeoutMs: config.shutdownTimeoutMs,
    jobExpireSeconds: config.jobExpireSeconds,
    logger,
  });
  installShutdownHandlers(runtime, (code) => process.exit(code), process, logger);
}

main().catch((err: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', svc: 'worker', msg: 'worker failed to start', error: err instanceof Error ? err.message : String(err) })}\n`);
  process.exit(1);
});
