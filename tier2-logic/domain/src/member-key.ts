import type { DimId, MemberId } from '@glidepath/spec';

/**
 * The member part of a cell's key: member ids comma-joined in the definition's dims order, `''` for
 * scalars, e.g. `'L05'`, `'pilots,fy27'`, `'commercial_applications,vp_infra'`
 * (docs/spec/01_data_model.md section 3, schema.json principles).
 */
export type MemberKey = string;

export const SCALAR_MEMBER_KEY: MemberKey = '';
const SEPARATOR = ',';

/** A variable or node definition: only its id (for messages) and ordered dims matter here. */
export interface Dimensioned {
  readonly id?: string;
  readonly dims: readonly DimId[];
}

const nameOf = (def: Dimensioned): string => def.id ?? 'variable';

function checkMember(fn: string, def: Dimensioned, dim: DimId, id: MemberId): void {
  if (id === '') throw new Error(`${fn}: empty member id for dim '${dim}' of ${nameOf(def)}`);
  if (id.includes(SEPARATOR)) {
    throw new Error(
      `${fn}: member id '${id}' for dim '${dim}' of ${nameOf(def)} contains '${SEPARATOR}'`,
    );
  }
}

/**
 * The member key of one cell of `def`. `members` binds each of the definition's dims to a member id
 * (bindings of other dims are ignored), or lists the member ids already in dims order.
 */
export function memberKey(
  def: Dimensioned,
  members: Readonly<Record<DimId, MemberId>> | readonly MemberId[],
): MemberKey {
  let ids: readonly MemberId[];
  if (Array.isArray(members)) {
    if (members.length !== def.dims.length) {
      throw new Error(
        `memberKey: ${nameOf(def)} expects ${def.dims.length} member ids (${def.dims.join(', ')}), got ${members.length}`,
      );
    }
    ids = members;
  } else {
    const binding = members as Readonly<Record<DimId, MemberId>>;
    ids = def.dims.map((d) => {
      const id = binding[d];
      if (id === undefined)
        throw new Error(`memberKey: ${nameOf(def)} has no member for dim '${d}'`);
      return id;
    });
  }
  ids.forEach((id, i) => checkMember('memberKey', def, def.dims[i]!, id));
  return ids.join(SEPARATOR);
}

/** The inverse of `memberKey`: `{ dim: memberId }` for each of the definition's dims. */
export function splitMemberKey(def: Dimensioned, key: MemberKey): Record<DimId, MemberId> {
  if (def.dims.length === 0) {
    if (key !== SCALAR_MEMBER_KEY) {
      throw new Error(
        `splitMemberKey: ${nameOf(def)} is scalar; its member key is '' (got '${key}')`,
      );
    }
    return {};
  }
  const ids = key.split(SEPARATOR);
  if (ids.length !== def.dims.length) {
    throw new Error(
      `splitMemberKey: ${nameOf(def)} expects ${def.dims.length} member ids (${def.dims.join(', ')}), got '${key}'`,
    );
  }
  const out: Record<DimId, MemberId> = {};
  def.dims.forEach((d, i) => {
    checkMember('splitMemberKey', def, d, ids[i]!);
    out[d] = ids[i]!;
  });
  return out;
}
