import type { MigrateRunOptions } from './run';

/**
 * Command line of the migrate entry: `--seed aa` (compose) or `--tenant aa` (`pnpm seed --tenant aa`),
 * also as `--seed=aa`. No seed flag: migrations only. Settings come from the environment, never flags.
 */
export function parseArgs(argv: readonly string[]): { seed: string | undefined } {
  let seed: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const m = /^--(seed|tenant)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`migrate: unknown argument ${arg} (usage: migrate.js [--seed <tenant>])`);
    const value = m[2] ?? argv[++i];
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new Error(`migrate: --${m[1]} needs a tenant slug`);
    }
    seed = value;
  }
  return { seed };
}

/** Options from the process arguments and environment (DATABASE_URL_MIGRATE, DEMO_USER_EMAIL, DEMO_USER_NAME). */
export function optionsFromEnv(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  log?: (message: string) => void,
): MigrateRunOptions {
  const url = env.DATABASE_URL_MIGRATE?.trim();
  if (!url) throw new Error('migrate: DATABASE_URL_MIGRATE is required');
  const { seed } = parseArgs(argv);
  const email = env.DEMO_USER_EMAIL?.trim();
  const name = env.DEMO_USER_NAME?.trim();
  return {
    databaseUrl: url,
    ...(seed === undefined ? {} : { seed }),
    ...(email ? { demoUserEmail: email } : {}),
    ...(name ? { demoUserName: name } : {}),
    ...(log ? { log } : {}),
  };
}
