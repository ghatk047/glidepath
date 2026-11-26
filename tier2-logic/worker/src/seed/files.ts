import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModelBundle, sha256Hex, type ModelBundle, type TenantSeed } from '@glidepath/spec';
import { readTenantSeed } from '@glidepath/spec/node';
import { readSourcingSeed, type SourcingSeed } from './sourcing';

/** The two spec files the global model definitions come from (copied from docs/spec to tier3-data/seed). */
export const GLOBAL_SEED_FILES = ['variables.json', 'formula_graph.json'] as const;
/** The five files of a tenant seed folder (copied from docs/spec/seed/<tenant>). */
export const TENANT_SEED_FILES = [
  'tenant.json',
  'dimension_members.json',
  'variable_values.json',
  'scenarios.json',
  'lever_library.json',
] as const;

/**
 * The `tier3-data` directory: `TIER3_DATA_DIR` if set, else the nearest ancestor of this module that
 * holds `tier3-data/seed` (the repository from source, `/app` in the logic image).
 */
export function findTier3Data(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const fromEnv = env.TIER3_DATA_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, 'tier3-data');
    if (existsSync(join(candidate, 'seed'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('seed: tier3-data/seed not found above this module; set TIER3_DATA_DIR');
    }
    dir = parent;
  }
}

export interface GlobalSeed {
  /** The model bundle of variables.json + formula_graph.json. */
  readonly bundle: ModelBundle;
  /** Raw variables.json (variable_def columns the bundle type does not name). */
  readonly variables: { readonly variables: readonly Record<string, unknown>[] };
  /** sha256 of the global spec files and the tenant lever library, recorded in model_version.notes. */
  readonly contentHash: string;
}

export interface SeedInputs {
  readonly global: GlobalSeed;
  readonly tenant: TenantSeed;
  /** The tenant folder's slug (`aa`). */
  readonly slug: string;
  /** The tenant folder's sourcing.json (SRC-01), null when it has none. Not in the content hash. */
  readonly sourcing: SourcingSeed | null;
}

const readText = (path: string): string => readFileSync(path, 'utf8');

/** Reads the global spec JSON and one tenant seed folder under `<tier3Data>/seed`. */
export async function readSeedInputs(tier3Data: string, slug: string): Promise<SeedInputs> {
  if (!/^[a-z][a-z0-9_-]*$/.test(slug)) throw new Error(`seed: invalid tenant slug "${slug}"`);
  const seedDir = join(tier3Data, 'seed');
  const tenantDir = join(seedDir, slug);
  if (!existsSync(tenantDir)) throw new Error(`seed: no seed folder ${tenantDir}`);

  const texts = GLOBAL_SEED_FILES.map((f) => readText(join(seedDir, f)));
  const leverText = readText(join(tenantDir, 'lever_library.json'));
  const [variablesText, graphText] = texts as [string, string];
  const variables = JSON.parse(variablesText) as GlobalSeed['variables'];
  const bundle = loadModelBundle({ variables, formulaGraph: JSON.parse(graphText) });
  const tenant = await readTenantSeed(tenantDir);
  return {
    slug,
    tenant,
    sourcing: readSourcingSeed(tenantDir),
    global: {
      bundle,
      variables,
      contentHash: sha256Hex([...texts, leverText].join('\n')),
    },
  };
}
