// DATA-08: the migrate entry. Migrations, global model definitions and a tenant seed through
// applyChangeset (origin `seed`). Entry file: ./migrate.ts.
export { runMigrate } from './run';
export type { MigrateRunOptions, MigrateRunReport } from './run';
export { optionsFromEnv, parseArgs } from './args';
export { loadModelDefs, ModelDefsChangedError } from './model-defs';
export type { ModelDefsReport } from './model-defs';
export { seedTenant, parseDemoEmail } from './tenant';
export type { TenantSeedOptions, TenantSeedReport } from './tenant';
export { findTier3Data, readSeedInputs, GLOBAL_SEED_FILES, TENANT_SEED_FILES } from './files';
export type { GlobalSeed, SeedInputs } from './files';
export { seedIds, uuidV5 } from './ids';
