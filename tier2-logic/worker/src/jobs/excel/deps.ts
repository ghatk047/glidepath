import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresObjectStore, createDb } from '@glidepath/data-access';
import type { DbHandle, ObjectStore } from '@glidepath/data-access';
import type { ModelCache, ModelCacheKey } from '@glidepath/domain';
import type { CompiledModel } from '@glidepath/engine';
import type { ModelBundle } from '@glidepath/spec';
import { loadModelBundleFromDir } from '@glidepath/spec/node';
import { ExcelTemplateSchema } from '@glidepath/spec/generated';
import type { ExcelTemplate } from '@glidepath/spec/generated';

/**
 * Hero outputs of the impact preview (05 section 3 step 5: net, gap, risk-adjusted net, VP gaps, EPS and
 * share price). Node ids of the spec, not numbers; a node with dimensions contributes one entry per cell
 * (`vp.gap[<vp>]`). A deployment can change the list through `ExcelJobDeps.impactNodes`.
 */
export const DEFAULT_IMPACT_NODES: readonly string[] = [
  'res.net',
  'res.gap',
  'res.risk',
  'res.gap_risk',
  'vp.gap',
  'br.eps27',
  'val.px',
];

/** Scenarios an import previews at most (a change of the tenant defaults touches every scenario). */
export const DEFAULT_MAX_IMPACT_SCENARIOS = 8;

/** Everything the three handlers take from outside the database: spec files, object store, clock, ids. */
export interface ExcelJobDeps {
  /** `docs/spec/excel_template.json`, parsed. */
  template(): Promise<ExcelTemplate>;
  /** The spec bundle of a pinned `model_version.semver`; null when this worker has none for it. */
  bundle(semver: string): Promise<ModelBundle | null>;
  /** The object store of one tenant (ADR-025): `exports/`, `export-snapshots/`, `imports/`. */
  objects(who: { readonly tenantId: string; readonly userId: string }): ObjectStore;
  /** Compiled models shared by the jobs of this process. */
  readonly cache: ModelCache<CompiledModel>;
  now(): Date;
  newId(): string;
  readonly impactNodes: readonly string[];
  readonly maxImpactScenarios: number;
}

/** In-process cache of compiled models keyed by (tenant, model version, members hash). */
export class CompiledModelCache implements ModelCache<CompiledModel> {
  private readonly models = new Map<string, CompiledModel>();
  constructor(private readonly keep = 8) {}

  getOrCompile(key: ModelCacheKey, compileModel: () => CompiledModel): CompiledModel {
    const id = `${key.tenant_id}|${key.model_version_id}|${key.members_hash}`;
    const hit = this.models.get(id);
    if (hit) {
      this.models.delete(id);
      this.models.set(id, hit);
      return hit;
    }
    const model = compileModel();
    this.models.set(id, model);
    while (this.models.size > this.keep) this.models.delete(this.models.keys().next().value as string);
    return model;
  }
}

/** `SPEC_DIR`, else the `docs/spec` above this module (source checkouts), else `tier3-data/seed`'s parent spec copy. */
export function findSpecDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const fromEnv = env.SPEC_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, 'docs', 'spec');
    if (existsSync(join(candidate, 'excel_template.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('excel jobs: docs/spec/excel_template.json not found above this module; set SPEC_DIR');
    dir = parent;
  }
}

export interface DefaultDepsOptions {
  /** Directory with excel_template.json, variables.json and formula_graph.json. */
  readonly specDir?: string;
  /** App-role URL for the object store; default `DATABASE_URL`. */
  readonly databaseUrl?: string;
}

/** Production wiring: spec files from `SPEC_DIR`, object store on Postgres (`stored_object`). Loaded on first use. */
export function defaultExcelDeps(options: DefaultDepsOptions = {}): ExcelJobDeps {
  let template: Promise<ExcelTemplate> | undefined;
  let bundle: Promise<ModelBundle> | undefined;
  let handle: DbHandle | undefined;
  const specDir = (): string => options.specDir ?? findSpecDir();
  return {
    template: () => {
      template ??= readFile(join(specDir(), 'excel_template.json'), 'utf8').then((s) =>
        ExcelTemplateSchema.parse(JSON.parse(s)),
      );
      template.catch(() => (template = undefined));
      return template;
    },
    bundle: async (semver) => {
      bundle ??= loadModelBundleFromDir(specDir());
      try {
        const b = await bundle;
        return b.specVersion === semver ? b : null;
      } catch (err) {
        bundle = undefined;
        throw err;
      }
    },
    objects: ({ tenantId, userId }) => {
      const url = options.databaseUrl ?? process.env.DATABASE_URL;
      if (!url) throw new Error('excel jobs: DATABASE_URL is not set');
      handle ??= createDb(url);
      return new PostgresObjectStore(handle.db, tenantId, userId);
    },
    cache: new CompiledModelCache(),
    now: () => new Date(),
    newId: () => randomUUID(),
    impactNodes: DEFAULT_IMPACT_NODES,
    maxImpactScenarios: DEFAULT_MAX_IMPACT_SCENARIOS,
  };
}
