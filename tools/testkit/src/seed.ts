import { readTenantSeed, loadModelBundleFromDir } from '@glidepath/spec/node';
import { seedToTenantData } from '@glidepath/spec';
import type { ModelBundle, TenantData, TenantSeed } from '@glidepath/spec';
import { aaSeedDir, specDir } from './paths';

let seedCache: Promise<TenantSeed> | undefined;
let bundleCache: Promise<ModelBundle> | undefined;

/** The validated AA tenant seed (`docs/spec/seed/aa`). Cached per process. */
export function aaSeed(): Promise<TenantSeed> {
  seedCache ??= readTenantSeed(aaSeedDir);
  return seedCache;
}

/** The spec model bundle (`docs/spec`). Cached per process. */
export function specBundle(): Promise<ModelBundle> {
  bundleCache ??= loadModelBundleFromDir(specDir);
  return bundleCache;
}

/** Scenario ids of the AA seed (`rates`, `A`, `B`, `C`, `D`). */
export async function aaScenarioIds(): Promise<string[]> {
  return (await aaSeed()).scenarios.scenarios.map((s) => s.id);
}

/** The AA seed's default scenario id. */
export async function aaDefaultScenario(): Promise<string> {
  return String((await aaSeed()).scenarios.default_scenario);
}

/** Member ids of one dimension of the AA seed (`pool`, `vp`, `lever`, ...). */
export async function aaMembers(dim: string): Promise<string[]> {
  const members = (await aaSeed()).dimensionMembers[dim];
  if (!members) throw new Error(`aaSeed: unknown dimension '${dim}'`);
  return members.map((m) => m.id);
}

/** Resolved inputs and overrides of an AA scenario (as `Model.input_cells`), checked against the bundle. */
export async function aaTenantData(scenarioId?: string): Promise<TenantData> {
  return seedToTenantData(await aaSeed(), scenarioId, await specBundle());
}
