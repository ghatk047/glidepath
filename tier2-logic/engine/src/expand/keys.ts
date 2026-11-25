/**
 * Cell keys and member combinations: `Model.key` (engine.py L133) and `Model.combos` (L136). PORTING.md
 * S09, S19.
 */
import type { DimId, MemberId } from '@glidepath/spec';
import type { CellKey } from '../types';
import type { MemberTable } from './members';

/** `Model.key`: `name` for a scalar, `name[m1,m2]` (comma, no spaces) otherwise. */
export function cellKey(name: string, members: readonly MemberId[]): CellKey {
  return members.length > 0 ? `${name}[${members.join(',')}]` : name;
}

/**
 * `Model.combos`: the cartesian product of `dims`, first dim outermost. A dim listed in `subset` with a
 * non-empty list expands over that list in the listed order (ids not checked against the tenant); any
 * other dim, or an empty list, uses all tenant members (Python `or`). No dims → one empty combo.
 */
export function combos(
  dims: readonly DimId[],
  table: MemberTable,
  subset?: Readonly<Record<DimId, readonly MemberId[]>>,
): MemberId[][] {
  let out: MemberId[][] = [[]];
  for (const d of dims) {
    const listed = subset && Object.hasOwn(subset, d) ? subset[d]! : undefined;
    const ms = listed && listed.length > 0 ? listed : table.ids(d);
    const next: MemberId[][] = [];
    for (const c of out) for (const m of ms) next.push([...c, m]);
    out = next;
  }
  return out;
}
