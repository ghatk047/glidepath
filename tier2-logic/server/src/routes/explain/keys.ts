/**
 * Cell keys: the contract spells every cell `id[member]` (`res.net[]` for a scalar, `hc.rate[pilots,fy27]`),
 * the engine spells a scalar `id` and a dimensioned cell `id[m1,m2]`. Both name the same cell.
 */

const CONTRACT_KEY = /^([^[\]\s]+)\[([^[\]]*)\]$/;

/** The engine's key of a contract cell key (`res.net[]` -> `res.net`). Null when it is not `id[member]`. */
export function toEngineKey(cell: string): { key: string; id: string; member: string } | null {
  const m = CONTRACT_KEY.exec(cell);
  if (!m) return null;
  const id = m[1]!;
  const member = m[2]!;
  return { key: member === '' ? id : `${id}[${member}]`, id, member };
}

/** The contract's key of an engine cell key (`res.net` -> `res.net[]`). */
export function toContractKey(key: string): string {
  return key.includes('[') ? key : `${key}[]`;
}

/** The spec id (node or variable) of an engine cell key. */
export function symbolOfKey(key: string): string {
  const i = key.indexOf('[');
  return i < 0 ? key : key.slice(0, i);
}

/** The member part of an engine cell key (`''` for a scalar). */
export function memberOfKey(key: string): string {
  const i = key.indexOf('[');
  return i < 0 ? '' : key.slice(i + 1, -1);
}
