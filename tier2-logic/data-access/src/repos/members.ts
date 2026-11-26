import { SOURCING_DIMENSIONS, membersHashOf } from '@glidepath/domain';
import type { AttrValue, Member, TenantMembers } from '@glidepath/spec';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
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
 *
 * The snapshot is cached per (tenant, members version) (DATA-13): a commit that changes no member reuses
 * it, and its hash, instead of reading the view and hashing again. It is frozen all the way down and
 * shared by every caller of the same version: never change it.
 */
export async function loadMembers(tx: TenantTx): Promise<MembersSnapshot> {
  const { tenantId } = tenantScope(tx, 'loadMembers');
  return membersCache.snapshot(tx, tenantId);
}

/** Reads v_dimension_members (the query of `loadMembers`) and builds the frozen snapshot. */
async function readMembers(tx: TenantTx, tenantId: string): Promise<MembersSnapshot> {
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
  deepFreeze(rows);
  deepFreeze(members);
  // membersHashOf remembers the hash of a frozen object: the domain's ModelCache key reuses it.
  return Object.freeze({ rows, members, membersHash: membersHashOf(members) });
}

/** Members of tenant dimensions the model does not define (SRC-02), as `loadDimensionMembers` reads them. */
export interface DimensionMembersRead {
  /** Every member, active or not, in member order (`sort`, then member_key), dimension by dimension. */
  readonly rows: readonly DimensionMemberRow[];
  /** The active members per requested dimension, `{ id, label, ...attrs }`, in member order; [] when none. */
  readonly members: Readonly<Record<string, readonly Member[]>>;
}

/**
 * The current tenant's own members (dimension_member) of `dims`, whether or not the pinned model
 * defines them. `loadMembers` serves only the model's dimensions (the engine's members and the members
 * hash); this read is for the data-only dimensions, such as the sourcing ones (`loadSourcingMembers`).
 * Not cached: a few dozen rows by primary key prefix.
 */
export async function loadDimensionMembers(tx: TenantTx, dims: readonly string[]): Promise<DimensionMembersRead> {
  const { tenantId } = tenantScope(tx, 'loadDimensionMembers');
  const members: Record<string, Member[]> = Object.fromEntries(dims.map((d) => [d, []]));
  if (dims.length === 0) return { rows: [], members };
  const res = await tx.execute<Raw>(sql`
    select m.dim_key, m.member_key, m.label, m.attrs, m.sort, m.active, 'tenant' as origin
    from dimension_member m
    where m.tenant_id = ${tenantId}::uuid
      and m.dim_key in (${sql.join(dims.map((d) => sql`${d}`), sql`, `)})
    order by m.dim_key collate "C", m.sort, m.member_key collate "C"`);
  const rows: DimensionMemberRow[] = res.rows.map((r) => ({
    dim_key: r.dim_key,
    member_key: r.member_key,
    label: r.label,
    attrs: r.attrs ?? {},
    sort: num(r.sort),
    active: r.active,
    origin: 'tenant',
  }));
  for (const r of rows) if (r.active) members[r.dim_key]!.push({ ...r.attrs, id: r.member_key, label: r.label });
  return { rows, members };
}

/** The current tenant's `contract`, `benchmark` and `sourcing_param` members (SRC-02; @glidepath/domain SOURCING_DIMENSIONS). */
export async function loadSourcingMembers(tx: TenantTx): Promise<DimensionMembersRead> {
  tenantScope(tx, 'loadSourcingMembers');
  return loadDimensionMembers(tx, SOURCING_DIMENSIONS);
}

/** Freezes `v` and everything it holds (plain objects and arrays, as JSON from the driver). */
function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

// ---------------------------------------------------------------------------------- members version

/** A table's part of the members version: its row count and the sum of its row xmins. */
const tableVersion = (table: SQL, where: SQL = sql`true`): SQL =>
  sql`(select json_build_array(count(*), coalesce(sum(xmin::text::bigint), 0)) from ${table} where ${where})`;

/**
 * The members version of the current tenant as this transaction sees it, with the tenant of the
 * connection's RLS context (`app.tenant_id`). It changes whenever anything `loadMembers` reads changes:
 * a row of dimension_member, line_item, line_item_lever or source inserted, updated or deleted (a write
 * gives the row a new xmin, a delete changes the count), the global members (canonical_pool, addr_tag),
 * the dimensions of the pinned model version, or the pin itself. MVCC-exact: a transaction that wrote a
 * member sees its own version, the others the committed one. One round trip over the tenant's member
 * rows, against the view's union, joins and JSON plus a SHA-256 over every member.
 */
async function membersVersion(tx: TenantTx, tenantId: string): Promise<{ version: string; context: string }> {
  const t = sql`${tenantId}::uuid`;
  const pinned = sql`(select model_version_id from tenant where id = ${t})`;
  const res = await tx.execute<{ version: string | null; context: string | null }>(sql`
    select current_setting('app.tenant_id', true) as context, json_build_array(
      ${pinned},
      ${tableVersion(sql`dimension_member`, sql`tenant_id = ${t}`)},
      ${tableVersion(sql`line_item`, sql`tenant_id = ${t}`)},
      ${tableVersion(sql`line_item_lever`, sql`tenant_id = ${t}`)},
      ${tableVersion(sql`source`)},
      ${tableVersion(sql`canonical_pool`)},
      ${tableVersion(sql`addr_tag`)},
      ${tableVersion(sql`dimension_def`, sql`model_version_id = ${pinned}`)}
    )::text as version`);
  const row = res.rows[0];
  return { version: row?.version ?? '', context: row?.context ?? '' };
}

// ---------------------------------------------------------------------------------- the cache

/** What the process's members cache did since it started (or was cleared). */
export interface MembersCacheStats {
  /** Snapshots answered from the cache. */
  readonly hits: number;
  /** Snapshots read from v_dimension_members (and hashed): one per (tenant, members version) seen. */
  readonly loads: number;
  /** Reads that bypassed the cache: the scope's tenant was not the connection's RLS tenant. */
  readonly bypassed: number;
  /** Snapshots held. */
  readonly size: number;
}

/** (tenant, members version) snapshots kept at once, least recently used dropped first. */
const MAX_SNAPSHOTS = 32;

/**
 * Members snapshots per (tenant, members version), process wide (DATA-13). Each lookup costs the small
 * version query; the view is read and the members hashed only for a version not seen before.
 * `invalidate(tenantId)` drops a tenant's snapshots: `ChangesetTx.writeMember` calls it, so a structural
 * changeset never reuses a snapshot, whatever the version query would say.
 *
 * Isolation: the key's tenant is the scope's, and the cache is used only when the connection's RLS
 * context (`app.tenant_id`) is that same tenant; otherwise the view is read uncached under RLS. So a
 * snapshot only ever reaches a transaction that could have read it itself.
 */
class MembersCache {
  private readonly entries = new Map<string, Promise<MembersSnapshot>>();
  private counts = { hits: 0, loads: 0, bypassed: 0 };

  async snapshot(tx: TenantTx, tenantId: string): Promise<MembersSnapshot> {
    const { version, context } = await membersVersion(tx, tenantId);
    if (context !== tenantId) {
      this.counts.bypassed += 1;
      return readMembers(tx, tenantId);
    }
    const key = JSON.stringify([tenantId, version]);
    const found = this.entries.get(key);
    if (found) {
      this.counts.hits += 1;
      this.entries.delete(key); // most recently used last
      this.entries.set(key, found);
      return found;
    }
    this.counts.loads += 1;
    const loading = readMembers(tx, tenantId);
    this.entries.set(key, loading);
    loading.catch(() => {
      if (this.entries.get(key) === loading) this.entries.delete(key);
    });
    while (this.entries.size > MAX_SNAPSHOTS) this.entries.delete(this.entries.keys().next().value as string);
    return loading;
  }

  invalidate(tenantId: string): void {
    for (const key of [...this.entries.keys()]) {
      if ((JSON.parse(key) as [string, string])[0] === tenantId) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.counts = { hits: 0, loads: 0, bypassed: 0 };
  }

  stats(): MembersCacheStats {
    return { ...this.counts, size: this.entries.size };
  }
}

const membersCache = new MembersCache();

/** Drops the cached members snapshots of a tenant (a structural write: `ChangesetTx.writeMember`). */
export function invalidateMembersCache(tenantId: string): void {
  membersCache.invalidate(tenantId);
}

/** Hits, loads and bypasses of the process's members cache (tests, diagnostics). */
export function membersCacheStats(): MembersCacheStats {
  return membersCache.stats();
}

/** Empties the process's members cache and resets its counters (tests). */
export function clearMembersCache(): void {
  membersCache.clear();
}
