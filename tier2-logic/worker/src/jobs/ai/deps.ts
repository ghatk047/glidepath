import { randomUUID } from 'node:crypto';
import { createClaudeModelClient, loadAiConfig, type AiConfig, type AuditSink, type ModelClient } from '@glidepath/ai';
import { PostgresObjectStore, createDb } from '@glidepath/data-access';
import type { Db, DbHandle, ObjectStore } from '@glidepath/data-access';
import type { ModelBundle, TenantSeed } from '@glidepath/spec';
import { findTier3Data, readSeedInputs } from '../../seed/files';

/** The seed folder step 3 copies the scenario presets and lever library from, and takes default years from. */
export const REFERENCE_TENANT = 'aa';

/** What the model pipeline reads of the spec: the registry bundle and the reference tenant's seed. */
export interface AiSpec {
  readonly bundle: ModelBundle;
  readonly reference: TenantSeed;
}

/** Everything the handlers take from outside the database: spec files, model client, object store, clock, ids. */
export interface AiJobDeps {
  /** The process environment; the only place settings and the API key come from (CLAUDE.md rule 10). */
  readonly env: Readonly<Record<string, string | undefined>>;
  spec(): Promise<AiSpec>;
  /** AI client settings (`loadAiConfig(env)`): throws `AiConfigError` (variable names only) when the key is missing. */
  config(): AiConfig;
  /** The ModelClient of one job; `audit` is where it writes `ai/<job-id>/` objects. */
  client(job: { readonly jobId: string; readonly config: AiConfig; readonly audit: AuditSink }): ModelClient;
  /** The object store of one tenant (ADR-025), where `ai/<job-id>/` lives. */
  objects(who: { readonly tenantId: string; readonly userId: string }): ObjectStore;
  /** The app-role database, for the apply (a new tenant is created in its own tenant context). */
  db(): Db;
  now(): Date;
  newId(): string;
}

export interface DefaultAiDepsOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly tier3Data?: string;
  /** App-role URL; default `DATABASE_URL`. */
  readonly databaseUrl?: string;
}

/**
 * Production wiring: the Claude client with the key from the environment, spec files from `tier3-data/seed`, the
 * Postgres object store. Nothing is read or opened until the first job needs it.
 */
export function defaultAiDeps(options: DefaultAiDepsOptions = {}): AiJobDeps {
  const env = options.env ?? process.env;
  let spec: Promise<AiSpec> | undefined;
  let handle: DbHandle | undefined;
  const database = (): Db => {
    const url = options.databaseUrl ?? env.DATABASE_URL;
    if (!url) throw new Error('ai jobs: DATABASE_URL is not set');
    handle ??= createDb(url);
    return handle.db;
  };
  return {
    env,
    spec: () => {
      spec ??= readSeedInputs(options.tier3Data ?? findTier3Data(env), REFERENCE_TENANT).then((s) => ({
        bundle: s.global.bundle,
        reference: s.tenant,
      }));
      spec.catch(() => (spec = undefined));
      return spec;
    },
    config: () => loadAiConfig(env),
    client: ({ jobId, config, audit }) => createClaudeModelClient({ jobId, config, audit }),
    objects: ({ tenantId, userId }) => new PostgresObjectStore(database(), tenantId, userId),
    db: database,
    now: () => new Date(),
    newId: () => randomUUID(),
  };
}
