import { listSolverRuns } from '@glidepath/data-access';
import type { SolverRunRecord, TenantTx } from '@glidepath/data-access';
import type { JsonValue } from '@glidepath/domain';
import { paramsHash } from './params-hash';

/**
 * The result cache key (03 section 4): `(problem, params hash, inputHash)`. `inputHash` is the engine's hash of
 * the scenario's inputs plus model version, so an unchanged scenario hashes alike.
 */
export interface CacheKey {
  readonly problem: string;
  readonly paramsHash: string;
  readonly inputHash: string;
}

/** A solver spec as stored in `solver_run.spec`: `{problem, params}`. */
export interface SpecLike {
  readonly problem: string;
  readonly params?: unknown;
}

export const cacheKeyOf = (spec: SpecLike, inputHash: string): CacheKey => ({
  problem: spec.problem,
  paramsHash: paramsHash(spec.params ?? null),
  inputHash,
});

/** How many of a scenario's newest finished runs a lookup looks through. */
export const CACHE_SCAN_LIMIT = 200;

/**
 * The key is stored on the run itself, next to the spec (`spec.cache`): `solver_run` has no column for it and
 * the cache is nothing but its finished runs. The contract's `SolverSpec` ignores the extra field.
 */
export function withCacheKey(spec: SpecLike, key: CacheKey, cachedFrom?: string): JsonValue {
  return {
    ...(spec as unknown as Record<string, JsonValue>),
    cache: { paramsHash: key.paramsHash, inputHash: key.inputHash, ...(cachedFrom ? { cachedFrom } : {}) },
  };
}

/** The key a stored spec carries, or null (a run enqueued without one). */
export function storedKey(spec: JsonValue): CacheKey | null {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const { problem, cache } = spec as { problem?: JsonValue; cache?: JsonValue };
  if (typeof problem !== 'string' || cache === null || typeof cache !== 'object' || Array.isArray(cache)) return null;
  const { paramsHash: p, inputHash: i } = cache as { paramsHash?: JsonValue; inputHash?: JsonValue };
  return typeof p === 'string' && typeof i === 'string' ? { problem, paramsHash: p, inputHash: i } : null;
}

const same = (a: CacheKey, b: CacheKey): boolean =>
  a.problem === b.problem && a.paramsHash === b.paramsHash && a.inputHash === b.inputHash;

/**
 * The newest finished (`done`) run of the tenant's scenario that carries `key`, or null. Failed and cancelled
 * runs are never reused. Runs that were themselves answered from the cache hold the same result, so they count.
 */
export async function findCachedRun(tx: TenantTx, scenarioId: string, key: CacheKey): Promise<SolverRunRecord | null> {
  const runs = await listSolverRuns(tx, { scenarioId, status: 'done', limit: CACHE_SCAN_LIMIT });
  return (
    runs.find((r) => {
      const k = storedKey(r.spec);
      return k !== null && same(k, key);
    }) ?? null
  );
}
