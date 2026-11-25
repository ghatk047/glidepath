/**
 * Tenant members per dimension (engine.py `Model.members` and `Model.attrs`): ids in tenant order,
 * which is evaluation order for aggregates (PORTING.md S06), and attribute lookup.
 */
import type { AttrValue, DimId, Member, MemberId, TenantMembers } from '@glidepath/spec';
import { EngineError } from '../errors';

export class MemberTable {
  private readonly idsByDim = new Map<DimId, readonly MemberId[]>();
  private readonly byId = new Map<DimId, ReadonlyMap<MemberId, Member>>();

  constructor(members: TenantMembers) {
    for (const [dim, list] of Object.entries(members)) {
      this.idsByDim.set(
        dim,
        list.map((m) => m.id),
      );
      // Python `{m["id"]: m for m in ms}`: a duplicate id keeps the last member's attributes.
      this.byId.set(dim, new Map(list.map((m) => [m.id, m])));
    }
  }

  /** True when the tenant has members for `dim`. */
  has(dim: DimId): boolean {
    return this.idsByDim.has(dim);
  }

  /** `self.members[dim]`: member ids in tenant order. UNKNOWN_DIMENSION when the tenant has none. */
  ids(dim: DimId): readonly MemberId[] {
    const ids = this.idsByDim.get(dim);
    if (!ids) throw new EngineError('UNKNOWN_DIMENSION', `unknown dimension '${dim}'`);
    return ids;
  }

  /**
   * `self.attrs[dim][member][name]`: the raw JSON attribute (`id` included), or `undefined` when the
   * member or the attribute does not exist (Python `KeyError`).
   */
  attr(dim: DimId, member: MemberId, name: string): AttrValue | undefined {
    const m = this.byId.get(dim)?.get(member);
    return m && Object.hasOwn(m, name) ? m[name] : undefined;
  }
}
