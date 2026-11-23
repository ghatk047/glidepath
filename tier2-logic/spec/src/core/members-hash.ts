import { sha256Hex } from './sha256';
import type { AttrValue, TenantMembers } from './types';

const HASH_DOMAIN = 'glidepath.members.v1';

function canonicalValue(v: AttrValue, where: string): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError(`membersHash: non-finite number at ${where}`);
    return v;
  }
  return v.map((x, i) => canonicalValue(x, `${where}[${i}]`));
}

/**
 * SHA-256 (lowercase hex) over a tenant's dimension members: dimensions sorted by id, members sorted by id,
 * attributes sorted by name. Independent of dimension, member and attribute order; any change to a member id,
 * an attribute name or an attribute value (including array order within a value) changes the hash.
 * Attributes whose value is `undefined` count as absent. Duplicate member ids in a dimension throw.
 * Used as the `members_hash` part of the ModelCache key `(tenant, model_version, members_hash)`.
 */
export function membersHash(members: TenantMembers): string {
  const dims = Object.keys(members).sort();
  const canonical = dims.map((dim) => {
    const list = members[dim] ?? [];
    const rows = list.map((m) => {
      const attrs = Object.keys(m)
        .filter((k) => k !== 'id' && m[k] !== undefined)
        .sort()
        .map((k) => [k, canonicalValue(m[k] as AttrValue, `${dim}.${m.id}.${k}`)] as const);
      return [m.id, attrs] as const;
    });
    rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]![0] === rows[i - 1]![0]) throw new Error(`membersHash: duplicate member '${rows[i]![0]}' in dimension '${dim}'`);
    }
    return [dim, rows] as const;
  });
  return sha256Hex(`${HASH_DOMAIN}\n${JSON.stringify(canonical)}`);
}
