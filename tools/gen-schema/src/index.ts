export const packageName = '@glidepath/gen-schema';

export { buildModel } from './model';
export type { Model, ModelTable, ModelColumn } from './model';
export { renderSchemaSql, INDEXES } from './ddl';
export { generateMigrations, checkMigrations, writeMigrations, SCHEMA_MIGRATION, RLS_MIGRATION, VIEWS_MIGRATION } from './generate';
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
export {
  renderViewsSql,
  modelDimensions,
  INPUTS_VIEW,
  MEMBERS_VIEW,
  LINE_ATTRIBUTES,
  GLOBAL_DIM_TABLES,
  LINE_DIM,
} from './views';
export { loadSchema, loadViewInputs, schemaJsonPath, migrationsDir } from './spec';
export type { ViewInputs, SpecDimension, SpecMember } from './spec';
