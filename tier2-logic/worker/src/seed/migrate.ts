// Entry of the `migrate` compose service (built to dist/migrate.js): migrations, model definitions
// and the tenant seed. `node dist/migrate.js --seed aa`; `pnpm seed --tenant aa` runs it from source.
import '../handlers';
import { defaultRegistry, installQueueSchema } from '../runtime';
import { optionsFromEnv } from './args';
import { runMigrate } from './run';

async function main(): Promise<void> {
  const log = (message: string): void => console.log(message);
  const report = await runMigrate(optionsFromEnv(process.argv.slice(2), process.env, log));
  log(`migrate: done, ${report.changes} changes`);
  // pg-boss schema, queues and app-role grants need the owner role; the worker runs with DATABASE_URL only.
  const ownerUrl = process.env.DATABASE_URL_MIGRATE?.trim();
  if (ownerUrl) {
    const queues = defaultRegistry.queues();
    await installQueueSchema({ ownerUrl, queues, ...(process.env.JOB_QUEUE_SCHEMA ? { schema: process.env.JOB_QUEUE_SCHEMA } : {}) });
    log(`migrate: job queue schema ready, ${queues.length} queues`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
