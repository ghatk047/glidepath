/** Small, pure conversions from node-postgres values to the row types the repositories return. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True for a uuid. Ids reach the repositories as plain strings (the API contract brands them but does
 * not fix their format); one that is not a uuid cannot name a row, and casting it in SQL would abort
 * the caller's whole transaction, so lookups answer "not found" without querying.
 */
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** timestamptz (a Date from node-postgres, or text) as an ISO 8601 string. */
export function iso(v: unknown): string {
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new Error(`data-access: not a timestamp: ${String(v)}`);
  return d.toISOString();
}

/** numeric (text from node-postgres) or int as a number. */
export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (typeof v === 'boolean' || v === null || v === '' || !Number.isFinite(n)) {
    throw new Error(`data-access: not a finite number: ${String(v)}`);
  }
  return n;
}

/** Nullable numeric as number | null. */
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));

/** Nullable text as string | null (char(n) included). */
export const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
