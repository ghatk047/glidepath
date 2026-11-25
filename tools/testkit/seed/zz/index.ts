import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedToTenantData } from '@glidepath/spec';
import type { TenantData, TenantSeed } from '@glidepath/spec';
import { readTenantSeed } from '@glidepath/spec/node';
import { specBundle } from '../../src/seed';

/** The synthetic tenant seed directory (five JSON files in the shape of the reference tenant seed). */
export const zzSeedDir = dirname(fileURLToPath(import.meta.url));

let seedCache: Promise<TenantSeed> | undefined;

/** The validated seed of the fictional tenant `zz`. Cached per process. */
export function zzSeed(): Promise<TenantSeed> {
  seedCache ??= readTenantSeed(zzSeedDir);
  return seedCache;
}

/** Resolved inputs and overrides of a `zz` scenario (defaults only without one), checked against the spec bundle. */
export async function zzTenantData(scenarioId?: string): Promise<TenantData> {
  return seedToTenantData(await zzSeed(), scenarioId, await specBundle());
}
