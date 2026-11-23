import { sha256Hex } from '@glidepath/spec';

/** Canonical JSON: object keys sorted at every depth, so equal parameters always serialise alike. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** SHA-256 of a problem's parameters in canonical form (key order and `undefined` fields do not matter). */
export const paramsHash = (params: unknown): string => sha256Hex(canonicalJson(params));
