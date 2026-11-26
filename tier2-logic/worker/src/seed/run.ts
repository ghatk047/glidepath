import { createDb, migrate, type MigrateResult } from '@glidepath/data-access';
import { findTier3Data, readSeedInputs } from './files';
import { loadModelDefs, type ModelDefsReport } from './model-defs';
import { seedTenant, type TenantSeedReport } from './tenant';
import { join } from 'node:path';
import { seedIds } from './ids';
import { recordParity, type ParityRecord } from './parity';
import { importAiCache, type ImportAiCacheReport } from '../jobs/ai/cache';
import { defaultSolverDeps } from '../jobs/solver/deps';
import type { SolverJobDeps } from '../jobs/solver/types';
import { warmTenant, type WarmReport } from '../warm';

export interface MigrateRunOptions {
  /** DATABASE_URL_MIGRATE: the owner role. */
  readonly databaseUrl: string;
  /** Tenant seed folder to load (`aa`); none: migrations only. */
  readonly seed?: string;
  /** `--ai-cache <dir>`: a rehearsal bundle (AI-06) imported as an ai_reconfig_job in review, after the seed. */
  readonly aiCache?: string;
  /** `--ai-cache-tenant`: slug of the tenant that owns the imported job; default the bundle's `homeTenant`. */
  readonly aiCacheTenant?: string;
  /** `--parity <dir>`: the report folder of `pnpm parity:golden`, recorded as the latest parity of `parityTenant` (API-14). */
  readonly parity?: string;
  /** `--parity-tenant`: slug of the tenant the reports are for; default the seed tenant. */
  readonly parityTenant?: string;
  /** WARM=1 (demo profile, JOB-04): after the seed, pre-run the demo's solver jobs into the result cache. */
  readonly warm?: boolean;
  /** Solver dependencies of the warm step (tests pass their own); default: the spec bundle from SPEC_DIR. */
  readonly warmDeps?: SolverJobDeps;
  /** DEMO_USER_EMAIL */
  readonly demoUserEmail?: string;
  /** DEMO_USER_NAME */
  readonly demoUserName?: string;
  /** Directory holding migrations/ and seed/; default: found above this module (TIER3_DATA_DIR). */
  readonly tier3Data?: string;
  readonly log?: (message: string) => void;
}

export interface MigrateRunReport {
  readonly migrations: MigrateResult;
  readonly modelDefs: ModelDefsReport | null;
  readonly tenant: TenantSeedReport | null;
  /** The imported AI cache bundle, when `--ai-cache` was given. */
  readonly aiCache: ImportAiCacheReport | null;
  /** The recorded parity, when `--parity` was given (and a tenant seeded). */
  readonly parity?: ParityRecord;
  /** The cache warm, when `warm` was set (and a tenant seeded). */
  readonly warm?: WarmReport;
  /** Everything this run wrote: migration files, definition rows, tenant rows and changesets. 0 on a rerun. */
  readonly changes: number;
}

/**
 * What `node dist/migrate.js --seed aa` does: data-access `migrate()`, the global model definitions,
 * then the tenant seed through applyChangeset (origin `seed`). Safe to run again.
 */
export async function runMigrate(o: MigrateRunOptions): Promise<MigrateRunReport> {
  const log = o.log ?? (() => undefined);
  const tier3Data = o.tier3Data ?? findTier3Data();
  const migrations = await migrate(o.databaseUrl, { dir: join(tier3Data, 'migrations'), log });
  log(`migrate: migrations: ${migrations.applied.length} applied, ${migrations.skipped.length} already applied`);
  if (o.seed === undefined && o.aiCache === undefined && o.parity === undefined)
    return { migrations, modelDefs: null, tenant: null, aiCache: null, changes: migrations.applied.length };
  if (o.seed === undefined) {
    // Cache bundle without a seed: the home tenant must exist already.
    const handle = createDb(o.databaseUrl, { poolMax: 2 });
    try {
      const aiCache =
        o.aiCache === undefined
          ? null
          : await importAiCache(handle.db, { dir: o.aiCache, ...(o.aiCacheTenant === undefined ? {} : { homeTenant: o.aiCacheTenant }), log });
      let parity: ParityRecord | undefined;
      if (o.parity !== undefined) {
        if (o.parityTenant === undefined) throw new Error('migrate: --parity without --seed needs --parity-tenant <slug>');
        parity = await recordParity(handle.db, { dir: o.parity, tenant: o.parityTenant, log });
      }
      return {
        migrations,
        modelDefs: null,
        tenant: null,
        aiCache,
        ...(parity === undefined ? {} : { parity }),
        changes: migrations.applied.length + (aiCache?.created ? 1 : 0),
      };
    } finally {
      await handle.close();
    }
  }

  const inputs = await readSeedInputs(tier3Data, o.seed);
  const handle = createDb(o.databaseUrl, { poolMax: 2 });
  try {
    const modelDefs = await loadModelDefs(handle.db, inputs.global, inputs.tenant);
    log(`migrate: model definitions: ${modelDefs.total} rows inserted`);
    const tenant = await seedTenant(handle.db, {
      slug: inputs.slug,
      seed: inputs.tenant,
      sourcing: inputs.sourcing,
      bundle: inputs.global.bundle,
      modelVersionId: modelDefs.modelVersionId,
      ...(o.demoUserEmail === undefined ? {} : { demoUserEmail: o.demoUserEmail }),
      ...(o.demoUserName === undefined ? {} : { demoUserName: o.demoUserName }),
    });
    log(`migrate: tenant ${inputs.slug}: ${tenant.total} rows/changesets written`);
    const aiCache =
      o.aiCache === undefined
        ? null
        : await importAiCache(handle.db, { dir: o.aiCache, ...(o.aiCacheTenant === undefined ? {} : { homeTenant: o.aiCacheTenant }), log });
    const parity =
      o.parity === undefined ? undefined : await recordParity(handle.db, { dir: o.parity, tenant: o.parityTenant ?? inputs.slug, log });
    let warm: WarmReport | undefined;
    if (o.warm) {
      warm = await warmTenant({
        db: handle.db,
        tenantId: tenant.tenantId,
        userId: seedIds.seedActor(),
        deps: o.warmDeps ?? defaultSolverDeps(),
        log,
      });
      log(`migrate: warm: ${warm.ran} ran, ${warm.hits} cached, ${warm.skipped} skipped, ${warm.failed} failed`);
    }
    return {
      migrations,
      modelDefs,
      tenant,
      aiCache,
      ...(parity === undefined ? {} : { parity }),
      ...(warm === undefined ? {} : { warm }),
      changes: migrations.applied.length + modelDefs.total + tenant.total + (aiCache?.created ? 1 : 0),
    };
  } finally {
    await handle.close();
  }
}
