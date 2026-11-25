import type { MigrateRunOptions } from './run';

/**
 * Command line of the migrate entry: `--seed aa` (compose) or `--tenant aa` (`pnpm seed --tenant aa`),
 * also as `--seed=aa`. No seed flag: migrations only. `--ai-cache <dir>` (AI-06) imports a rehearsal bundle as an
 * `ai_reconfig_job` in review; `--ai-cache-tenant <slug>` names the tenant that owns it (default: the bundle's).
 * `--parity <dir>` (API-14) records the totals of `pnpm parity:golden`'s reports as the tenant's latest parity;
 * `--parity-tenant <slug>` names the tenant (default: the seed tenant).
 * Settings come from the environment, never flags (`WARM=1` also runs the JOB-04 cache warm after the seed).
 */
export function parseArgs(argv: readonly string[]): {
  seed: string | undefined;
  aiCache?: string;
  aiCacheTenant?: string;
  parity?: string;
  parityTenant?: string;
} {
  let seed: string | undefined;
  let aiCache: string | undefined;
  let aiCacheTenant: string | undefined;
  let parity: string | undefined;
  let parityTenant: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const m = /^--(seed|tenant|ai-cache|ai-cache-tenant|parity|parity-tenant)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`migrate: unknown argument ${arg} (usage: migrate.js [--seed <tenant>] [--ai-cache <dir>] [--parity <dir>])`);
    const value = m[2] ?? argv[++i];
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new Error(`migrate: --${m[1]} needs ${m[1] === 'ai-cache' ? 'a bundle folder' : m[1] === 'parity' ? 'a report folder' : 'a tenant slug'}`);
    }
    if (m[1] === 'ai-cache') aiCache = value;
    else if (m[1] === 'ai-cache-tenant') aiCacheTenant = value;
    else if (m[1] === 'parity') parity = value;
    else if (m[1] === 'parity-tenant') parityTenant = value;
    else seed = value;
  }
  return {
    seed,
    ...(aiCache === undefined ? {} : { aiCache }),
    ...(aiCacheTenant === undefined ? {} : { aiCacheTenant }),
    ...(parity === undefined ? {} : { parity }),
    ...(parityTenant === undefined ? {} : { parityTenant }),
  };
}

/** Options from the process arguments and environment (DATABASE_URL_MIGRATE, DEMO_USER_EMAIL, DEMO_USER_NAME). */
export function optionsFromEnv(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  log?: (message: string) => void,
): MigrateRunOptions {
  const url = env.DATABASE_URL_MIGRATE?.trim();
  if (!url) throw new Error('migrate: DATABASE_URL_MIGRATE is required');
  const { seed, aiCache, aiCacheTenant, parity, parityTenant } = parseArgs(argv);
  const email = env.DEMO_USER_EMAIL?.trim();
  const name = env.DEMO_USER_NAME?.trim();
  return {
    databaseUrl: url,
    ...(seed === undefined ? {} : { seed }),
    ...(aiCache === undefined ? {} : { aiCache }),
    ...(aiCacheTenant === undefined ? {} : { aiCacheTenant }),
    ...(parity === undefined ? {} : { parity }),
    ...(parityTenant === undefined ? {} : { parityTenant }),
    ...(/^(1|true|yes|on)$/i.test(env.WARM?.trim() ?? '') ? { warm: true } : {}),
    ...(email ? { demoUserEmail: email } : {}),
    ...(name ? { demoUserName: name } : {}),
    ...(log ? { log } : {}),
  };
}
