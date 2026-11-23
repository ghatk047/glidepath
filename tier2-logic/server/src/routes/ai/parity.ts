import type { TenantParity } from '@glidepath/api-contract';

/**
 * A tenant's latest parity result as the worker's `migrate --parity` stores it (`ai/parity/latest.json`,
 * `glidepath.parity/1`). The server does not import the worker, so the stored JSON is read through this narrow,
 * defensive shape; a record it cannot read is no record (the tenant has no parity line), never an error.
 */

/** Bucket `ai`, this key: a job's own objects are under `<job id>/`, so the two never meet. */
export const PARITY_KEY = 'parity/latest.json';

const decoder = new TextDecoder();
const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** The `TenantParity` of a stored record, for the tenant `slug` that holds it; null when it is not a usable record. */
export function parityOf(bytes: Uint8Array, slug: string): TenantParity | null {
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.format !== 'glidepath.parity/1' || !count(r.passed) || !count(r.total) || r.passed > r.total) return null;
  if (typeof r.recordedAt !== 'string' || Number.isNaN(Date.parse(r.recordedAt))) return null;
  return { tenant: slug as TenantParity['tenant'], passed: r.passed, total: r.total, recordedAt: new Date(r.recordedAt).toISOString() };
}
