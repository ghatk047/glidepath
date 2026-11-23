/**
 * The oracle of the route-level leak test (QA-03, G7): what each tenant really has stored, read by a superuser
 * (RLS bypassed), and what an answer to tenant A must never contain.
 *
 * - Tenant tables are found in the live catalog, not listed: every table with a `tenant_id` column (plus the
 *   tenant root, keyed `id`), so a table a later migration adds is covered as soon as it exists.
 * - `digest(tenant)`: per tenant table, the row count and an md5 over the tenant's rows. Compared before and
 *   after every call, it tells whether a call changed (wrote, updated, deleted) anything of that tenant.
 * - Markers: the values found in the rows of tenants B and C and in no row of tenant A and no global model row
 *   (catalog-wide, nested JSON included): uuids, strings of 3 or more characters, and numbers with 5 or more
 *   significant digits (shorter numbers such as 12, 0.3 or 2200 recur by coincidence; a row of another tenant
 *   that leaks also carries its ids and keys). For the copy of tenant A only its ids and its own edits are markers,
 *   which is the point of the copy: a leak of it can only be told by ids.
 */
import type { DbHandle } from '@glidepath/data-access';
import { TENANT_ID, tenantNameOf } from './stack';
import type { TenantName } from './stack';

export interface TenantTable {
  readonly schema: string;
  readonly name: string;
  /** `tenant_id`, or `id` on the tenant root. */
  readonly key: string;
  readonly sql: string;
}

const quote = (s: string): string => `"${s.replace(/"/g, '""')}"`;
const SYSTEM = `n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'`;

/**
 * Global rows that are not model definitions: people and their sign-in state. Their values (a user's id, an
 * e-mail) are not tenant data, but they must not hide another tenant's references to its users either, so they
 * are not counted as "global" when markers are chosen.
 */
const IDENTITY_TABLES = new Set(['app_user', 'auth_token', 'auth_session', 'passkey', 'schema_migration']);

export async function tenantTables(admin: DbHandle): Promise<{ tenant: TenantTable[]; global: TenantTable[] }> {
  const res = await admin.pool.query<{ schema: string; name: string; has_tenant_id: boolean }>(
    `select n.nspname as schema, c.relname as name,
            exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped) as has_tenant_id
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and ${SYSTEM}
      order by 1, 2`,
  );
  const tenant: TenantTable[] = [];
  const global: TenantTable[] = [];
  for (const r of res.rows) {
    const sql = `${quote(r.schema)}.${quote(r.name)}`;
    if (r.schema === 'public' && r.name === 'tenant') tenant.push({ schema: r.schema, name: r.name, key: 'id', sql });
    else if (r.has_tenant_id) tenant.push({ schema: r.schema, name: r.name, key: 'tenant_id', sql });
    else if (!IDENTITY_TABLES.has(r.name)) global.push({ schema: r.schema, name: r.name, key: '', sql });
  }
  return { tenant, global };
}

/** Per tenant table: `count:md5` of the tenant's rows. */
export async function digest(admin: DbHandle, tables: readonly TenantTable[], tenantId: string): Promise<Map<string, string>> {
  const parts = tables.map(
    (t, i) =>
      `select ${i} as i, count(*)::int as n, md5(coalesce(string_agg(x::text, E'\\n' order by x::text), '')) as h from ${t.sql} x where x.${quote(t.key)} = $1::uuid`,
  );
  const res = await admin.pool.query<{ i: number; n: number; h: string }>(parts.join(' union all '), [tenantId]);
  const out = new Map<string, string>();
  for (const r of res.rows) out.set(tables[r.i]!.name, `${r.n}:${r.h}`);
  return out;
}

/** The tables whose digest differs. */
export const changedTables = (before: Map<string, string>, after: Map<string, string>): string[] =>
  [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k));

/** Every row of the tenant, per table, as JSON. */
export async function rowsOf(admin: DbHandle, tables: readonly TenantTable[], tenantId: string): Promise<Map<string, unknown[]>> {
  const out = new Map<string, unknown[]>();
  for (const t of tables) {
    const res = await admin.pool.query<{ j: unknown }>(`select row_to_json(x) as j from ${t.sql} x where x.${quote(t.key)} = $1::uuid`, [tenantId]);
    out.set(t.name, res.rows.map((r) => r.j));
  }
  return out;
}

export async function globalRowsOf(admin: DbHandle, tables: readonly TenantTable[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const t of tables) out.push(...(await admin.pool.query<{ j: unknown }>(`select row_to_json(x) as j from ${t.sql} x`)).rows.map((r) => r.j));
  return out;
}

// ---------------------------------------------------------------------------------- values

export const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Timestamps are not tenant data (and differ in format between a row and an answer). */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;
/** A cell key `id[m1,m2]`: its members are values too (`vp.gap[vp_x]` carries the member `vp_x`). */
const CELL = /^[^[\]]+\[([^[\]]*)\]$/;

/** Significant digits of a number as JS prints it (2200 -> 2, 0.012345 -> 5, 834123456.7 -> 10). */
export function significantDigits(n: number): number {
  const digits = Math.abs(n)
    .toExponential()
    .split('e')[0]!
    .replace('.', '');
  return digits.replace(/0+$/, '').length;
}

export type Leaf = string | number;

/**
 * Every primitive in `values` (nested objects and arrays), strings also split into the members of a cell key.
 *
 * `keys: false` leaves out the keys of JSON objects. A stored row's keys are schema vocabulary, the same for
 * every tenant (`detail`, `scenarioId`, `application/json`), so they are no marker of the tenant that holds the
 * row; what belongs to a tenant is in the values. Keys are kept when an answer is read, where a leaked value
 * can sit in a key (a cell key, a member key, an id).
 */
export function leaves(values: Iterable<unknown>, { keys = true }: { keys?: boolean } = {}): Set<Leaf> {
  const out = new Set<Leaf>();
  const addString = (s: string): void => {
    out.add(s);
    const m = CELL.exec(s);
    if (m && m[1]) for (const part of m[1].split(',')) if (part !== '') out.add(part);
  };
  const walk = (v: unknown): void => {
    if (v === null || v === undefined || typeof v === 'boolean') return;
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out.add(v);
      return;
    }
    if (typeof v === 'string') return addString(v);
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (keys) addString(k);
        walk(x);
      }
    }
  };
  for (const v of values) walk(v);
  return out;
}

/** Where a marker was found: tenant and table. */
export interface MarkerSource {
  readonly tenant: TenantName;
  readonly table: string;
}

export class Markers {
  readonly uuids = new Map<string, MarkerSource>();
  readonly strings = new Map<string, MarkerSource>();
  readonly numbers = new Map<number, MarkerSource>();

  /** Values of `others`' rows that are in no row of `own` and no global row. */
  static build(own: Set<Leaf>, global: Set<Leaf>, others: { tenant: TenantName; rows: Map<string, unknown[]> }[]): Markers {
    const m = new Markers();
    for (const { tenant, rows } of others) {
      for (const [table, list] of rows) {
        for (const v of leaves(list, { keys: false })) {
          if (own.has(v) || global.has(v)) continue;
          const at = { tenant, table };
          if (typeof v === 'number') {
            if (significantDigits(v) >= 5 && !m.numbers.has(v)) m.numbers.set(v, at);
          } else if (UUID.test(v)) {
            if (!m.uuids.has(v.toLowerCase())) m.uuids.set(v.toLowerCase(), at);
          } else if (v.length >= 3 && !TIMESTAMP.test(v) && !m.strings.has(v)) {
            m.strings.set(v, at);
          }
        }
      }
    }
    return m;
  }

  get size(): number {
    return this.uuids.size + this.strings.size + this.numbers.size;
  }

  /**
   * The markers in an answer: uuids anywhere in its text, strings and numbers as whole values of its JSON (or of
   * `values`, e.g. the cells of a workbook). `echoed` are the caller's own arguments (an id it asked for, echoed
   * in a 404 detail, is not a leak).
   */
  find(text: string, values: Iterable<unknown>, echoed: ReadonlySet<string> = new Set()): { value: Leaf; source: MarkerSource }[] {
    const hits = new Map<Leaf, MarkerSource>();
    for (const u of text.match(UUID_G) ?? []) {
      const k = u.toLowerCase();
      const src = this.uuids.get(k);
      if (src && !echoed.has(k)) hits.set(k, src);
    }
    for (const v of leaves(values)) {
      if (typeof v === 'number') {
        const src = this.numbers.get(v);
        if (src) hits.set(v, src);
      } else if (!echoed.has(v)) {
        const src = this.strings.get(v) ?? this.uuids.get(v.toLowerCase());
        if (src && !echoed.has(v.toLowerCase())) hits.set(v, src);
      }
    }
    return [...hits].map(([value, source]) => ({ value, source }));
  }
}

/** All rows of tenant `t`. */
export const rowsOfTenant = (admin: DbHandle, tables: readonly TenantTable[], t: TenantName): Promise<Map<string, unknown[]>> =>
  rowsOf(admin, tables, TENANT_ID[t]);

export { tenantNameOf };
