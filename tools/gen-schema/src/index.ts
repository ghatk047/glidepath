export const packageName = '@glidepath/gen-schema';

export { buildModel } from './model';
export type { Model, ModelTable, ModelColumn } from './model';
export { renderSchemaSql, INDEXES } from './ddl';
export { generateMigrations, checkMigrations, writeMigrations, SCHEMA_MIGRATION, RLS_MIGRATION } from './generate';
export {
  renderRlsSql,
  policiesFor,
  tenancyOf,
  tenantKey,
  appPrivileges,
  settingUuidSql,
  APP_ROLE,
  OWNER_ROLE,
  TENANT_SETTING,
  USER_SETTING,
  TENANT_POLICY,
  APP_PRIVILEGES,
  APP_PRIVILEGE_OVERRIDES,
  MEMBERSHIP,
} from './rls';
export type { Tenancy, PolicySpec } from './rls';
export { loadSchema, schemaJsonPath, migrationsDir } from './spec';
