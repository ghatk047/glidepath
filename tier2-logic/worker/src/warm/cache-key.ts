import type { JsonValue } from '@glidepath/domain';
import { sha256Hex } from '@glidepath/spec';

/**
 * The result-cache key of JOB-02 (`tier2-logic/server/src/jobs/cache.ts`): `(problem, params hash, inputHash)`,
 * stored on the run as `spec.cache`. The worker does not depend on the server package, so the few lines that
 * define the key are repeated here; `warm.pg.test.ts` checks them against the server's own functions, so a
 * change on either side fails a test instead of silently missing the cache.
 */
export interface CacheKey {
  readonly problem: string;
  readonly paramsHash: string;
  readonly inputHash: string;
}

/** Canonical JSON: object keys sorted at every depth. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export const paramsHash = (params: unknown): string => sha256Hex(canonicalJson(params));

export const cacheKeyOf = (spec: { problem: string; params?: unknown }, inputHash: string): CacheKey => ({
  problem: spec.problem,
  paramsHash: paramsHash(spec.params ?? null),
  inputHash,
});

/** The spec as stored on the run: `{problem, params, cache}`. */
export const withCacheKey = (spec: { problem: string; params?: unknown }, key: CacheKey): JsonValue =>
  ({ ...(spec as unknown as Record<string, JsonValue>), cache: { paramsHash: key.paramsHash, inputHash: key.inputHash } }) as JsonValue;

/** The key a stored spec carries, or null. */
export function storedKey(spec: JsonValue): CacheKey | null {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const { problem, cache } = spec as { problem?: JsonValue; cache?: JsonValue };
  if (typeof problem !== 'string' || cache === null || typeof cache !== 'object' || Array.isArray(cache)) return null;
  const { paramsHash: p, inputHash: i } = cache as { paramsHash?: JsonValue; inputHash?: JsonValue };
  return typeof p === 'string' && typeof i === 'string' ? { problem, paramsHash: p, inputHash: i } : null;
}

export const sameKey = (a: CacheKey, b: CacheKey): boolean =>
  a.problem === b.problem && a.paramsHash === b.paramsHash && a.inputHash === b.inputHash;
