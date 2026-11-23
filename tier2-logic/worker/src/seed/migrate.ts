// Entry of the `migrate` compose service (built to dist/migrate.js): migrations, model definitions
// and the tenant seed. `node dist/migrate.js --seed aa`; `pnpm seed --tenant aa` runs it from source.
import { optionsFromEnv } from './args';
import { runMigrate } from './run';

async function main(): Promise<void> {
  const log = (message: string): void => console.log(message);
  const report = await runMigrate(optionsFromEnv(process.argv.slice(2), process.env, log));
  log(`migrate: done, ${report.changes} changes`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
