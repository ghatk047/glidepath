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
export { withTenant, withUser } from './tenant';
export type { TenantTx, UserTx } from './tenant';
export { TenantScopeError } from './scope';
// Read repositories (DATA-05): only inside withTenant / withUser.
export * from './repos';
export { DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT, InvalidCursorError } from './repos/changesets';
export type { ChangesetPage, ChangesetRecord, HistoryOptions } from './repos/changesets';
export type { ResolvedFrom, ResolvedInputRecord, ResolvedInputsRecord } from './repos/inputs';
export type { DimensionMemberRow, MembersSnapshot } from './repos/members';
export type {
  AppUserRow,
  MembershipRole,
  TenantMemberRow,
  TenantRow,
  UserMembership,
} from './repos/memberships';
export type {
  DimensionDefRow,
  LeverTemplateRow,
  ModelDefs,
  ModelVersionRow,
  NodeDefRow,
  VariableDefRow,
} from './repos/model';
export type { ScenarioRecord } from './repos/scenarios';
/** Raw SQL fragments for callers that hold a transaction or Db but may not import drizzle (G13). */
export { sql } from 'drizzle-orm';
export * as schema from './schema';
