export const packageName = '@glidepath/data-access';

export { createDb } from './db';
export type { Db, DbHandle } from './db';
export { migrate, listMigrations, defaultMigrationsDir, TRACKING_TABLE } from './migrate';
export type { MigrateOptions, MigrateResult, MigrationFile } from './migrate';
export {
  poolConfig,
  connectionConfig,
  resolveDbOptions,
  dbOptionsFromEnv,
  DEFAULT_POOL_MAX,
} from './config';
export type { DbOptions, ResolvedDbOptions } from './config';
export * from './objects';
export { withTenant } from './tenant';
export type { TenantTx } from './tenant';
/** Raw SQL fragments for callers that hold a transaction or Db but may not import drizzle (G13). */
export { sql } from 'drizzle-orm';
export * as schema from './schema';
