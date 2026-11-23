import { membersHash } from '@glidepath/spec';
import type { AttrValue, Member, TenantMembers } from '@glidepath/spec';
import { sql } from 'drizzle-orm';
import { tenantScope } from '../scope';
import type { TenantTx } from '../tenant';
import { num } from './rows';

/** One row of v_dimension_members (DATA-03) for the current tenant. */
export interface DimensionMemberRow {
  readonly dim_key: string;
  readonly member_key: string;
  readonly label: string;
  readonly attrs: Readonly<Record<string, AttrValue>>;
  readonly sort: number;
  readonly active: boolean;
  /** global (canonical_pool, addr_tag) | system | tenant (dimension_member) | line_item */
  readonly origin: 'global' | 'system' | 'tenant' | 'line_item';
}

export interface MembersSnapshot {
  /** Every member, active or not, per dimension in member order (`sort`, then member_key). */
  readonly rows: readonly DimensionMemberRow[];
  /**
   * The active members as the engine takes them: `{ dim: [{ id, label, ...attrs }] }`, each list in
   * member order, which is evaluation order (SUM adds in it; engine PORTING.md S06).
   */
  readonly members: TenantMembers;
  /** `membersHash(members)` (@glidepath/spec): the members part of the ModelCache key. */
  readonly membersHash: string;
}

interface Raw extends Record<string, unknown> {
  dim_key: string;
  member_key: string;
  label: string;
  attrs: Record<string, AttrValue> | null;
  sort: number | string;
  active: boolean;
  origin: DimensionMemberRow['origin'];
}

/**
 * Dimension members of the current tenant via v_dimension_members: global and system members plus the
 * tenant's own (dimension_member, line_item), for the dimensions of the model version the tenant pins
 * (dimension_def), like v_inputs_resolved keeps only the pinned variables.
 *
 * Member order is the spec's: `sort`, which the seed writes from the member's position in
 * dimension_members.json (canonical_pool.sort for pools, the model's order for system dimensions),
 * then member_key in code-point order (lines, whose table has no sort, and addr_tag). Never sorted by
 * key alone: the engine sums in this order, so it must match the spec seed for parity.
 */
export async function loadMembers(tx: TenantTx): Promise<MembersSnapshot> {
  const { tenantId } = tenantScope(tx, 'loadMembers');
  const res = await tx.execute<Raw>(sql`
    select m.dim_key, m.member_key, m.label, m.attrs, m.sort, m.active, m.origin
    from v_dimension_members m
    join tenant t on t.id = ${tenantId}::uuid
    join dimension_def d on d.model_version_id = t.model_version_id and d.dim_key = m.dim_key
    where m.tenant_id is null or m.tenant_id = ${tenantId}::uuid
    order by m.dim_key collate "C", m.sort, m.member_key collate "C"`);

  const rows: DimensionMemberRow[] = res.rows.map((r) => ({
    dim_key: r.dim_key,
    member_key: r.member_key,
    label: r.label,
    attrs: r.attrs ?? {},
    sort: num(r.sort),
    active: r.active,
    origin: r.origin,
  }));

  const members: Record<string, Member[]> = {};
  for (const r of rows) {
    const list = (members[r.dim_key] ??= []);
    // id and label from their columns; attribute names as expressions use them (line.pool, ...).
    if (r.active) list.push({ ...r.attrs, id: r.member_key, label: r.label });
  }
  return { rows, members, membersHash: membersHash(members) };
}
