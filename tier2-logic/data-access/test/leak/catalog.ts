/**
 * G7 catalog support for the leak tests (DATA-10): which relations hold tenant rows, read from the
 * live catalog (and from docs/spec/schema.json), and whether row-level security really isolates them.
 * Nothing here lists tables by hand, so a table added by a later migration is checked as soon as it
 * exists, and a tenant table without RLS, FORCE or a tenant policy is a violation.
 */
import { APP_ROLE, TENANT_SETTING, loadSchema, tenancyOf } from '@glidepath/gen-schema';

/** node-postgres `query`, as `pg.Client` / `pg.PoolClient` have it. */
export type Query = (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;

export { APP_ROLE };

/** A relation that holds rows of tenants. */
export interface TenantTable {
  readonly schema: string;
  readonly name: string;
  /** `schema.name`, quoted for SQL. */
  readonly sql: string;
  /** The column that carries the row's tenant: `id` on the tenant root, `tenant_id` elsewhere. */
  readonly key: string;
  /** schema.json scope, or null for a table found only in the catalog (a manual migration). */
  readonly scope: string | null;
}

export const quoteIdent = (s: string): string => `"${s.replace(/"/g, '""')}"`;
const qualified = (schema: string, name: string): string => `${quoteIdent(schema)}.${quoteIdent(name)}`;

/** How Postgres prints `NULLIF(current_setting('<setting>', true), '')::uuid` back (pg_get_expr). */
const setting = (name: string): string => `(NULLIF(current_setting('${name}'::text, true), ''::text))::uuid`;
const CURRENT_TENANT = setting(TENANT_SETTING);
/** The tenant isolation predicate as pg_get_expr prints it: `key = current tenant`. */
export const isolationExpr = (key: string): string => `(${key} = ${CURRENT_TENANT})`;

const SYSTEM_SCHEMAS = `n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'`;

/** schema.json tables by name, with their scope. */
export function specTables(): Map<string, string> {
  const s = loadSchema() as { tables: Record<string, { scope: string }> };
  return new Map(Object.entries(s.tables).map(([name, t]) => [name, t.scope]));
}

/**
 * Every tenant relation: the schema.json tables whose scope is not `global` (tenant root included),
 * plus every ordinary or partitioned table in a non-system schema that has a `tenant_id` column (so the
 * manual tables such as stored_object, and any table added later, are found without a list).
 */
export async function tenantTables(q: Query, spec = specTables()): Promise<{ tables: TenantTable[]; missing: string[] }> {
  const found = await q(
    `select n.nspname as schema, c.relname as name,
            exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped) as has_tenant_id
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and ${SYSTEM_SCHEMAS}
      order by 1, 2`,
  );
  const tables: TenantTable[] = [];
  const missing: string[] = [];
  const inCatalog = new Set(found.rows.filter((r) => r.schema === 'public').map((r) => String(r.name)));
  for (const [name, scope] of spec) {
    const tenancy = tenancyOf({ name, scope });
    if (tenancy === 'global') continue;
    if (!inCatalog.has(name)) {
      missing.push(name);
      continue;
    }
    tables.push({ schema: 'public', name, sql: qualified('public', name), key: tenancy === 'tenant-root' ? 'id' : 'tenant_id', scope });
  }
  for (const r of found.rows) {
    const schema = String(r.schema);
    const name = String(r.name);
    if (!r.has_tenant_id || (schema === 'public' && spec.has(name))) continue;
    tables.push({ schema, name, sql: qualified(schema, name), key: 'tenant_id', scope: null });
  }
  return { tables, missing };
}

/** The global tables of schema.json (scope `global`): SELECT-only to the app role (04 §Tenancy). */
export function globalSpecTables(spec = specTables()): string[] {
  return [...spec].filter(([name, scope]) => tenancyOf({ name, scope }) === 'global').map(([name]) => name);
}

interface PolicyRow {
  name: string;
  permissive: boolean;
  /** pg_policy.polcmd: `*` ALL, `r` SELECT, `a` INSERT, `w` UPDATE, `d` DELETE. */
  cmd: string;
  applies: boolean;
  qual: string | null;
  with_check: string | null;
}

const COMMANDS = { SELECT: 'r', INSERT: 'a', UPDATE: 'w', DELETE: 'd' } as const;
type Command = keyof typeof COMMANDS;
const covers = (p: PolicyRow, c: Command): boolean => p.cmd === '*' || p.cmd === COMMANDS[c];
/** The WITH CHECK Postgres applies: the policy's own, else its USING. */
const effectiveCheck = (p: PolicyRow): string | null => p.with_check ?? p.qual;

/**
 * A permissive policy the app role gets that may not widen what tenant isolation shows:
 * - the isolation predicate itself (USING and WITH CHECK);
 * - a SELECT policy that switches off once a tenant is set (`app.tenant_id IS NULL AND ...`, the
 *   pre-tenant membership reads of withUser);
 * - a SELECT policy on global rows only (`key IS NULL`, scope `tenant or global`).
 */
function harmless(p: PolicyRow, key: string): boolean {
  const iso = isolationExpr(key);
  const isolated =
    p.cmd === COMMANDS.SELECT || p.cmd === COMMANDS.DELETE
      ? p.qual === iso
      : p.cmd === COMMANDS.INSERT
        ? p.with_check === iso
        : p.qual === iso && effectiveCheck(p) === iso;
  if (isolated) return true;
  if (p.cmd !== COMMANDS.SELECT || p.qual === null) return false;
  return p.qual.startsWith(`((${CURRENT_TENANT} IS NULL) AND `) || p.qual === `(${key} IS NULL)`;
}

/**
 * G7 catalog check. Returns one line per violation (empty = isolated):
 * - every tenant table (see tenantTables) has ENABLE and FORCE ROW LEVEL SECURITY;
 * - for every command the app role is granted, a permissive policy limits it to `key = app.tenant_id`
 *   (USING for SELECT/UPDATE/DELETE, WITH CHECK for INSERT/UPDATE): a missing policy is a violation;
 * - no other permissive policy the app gets lets rows of another tenant through (e.g. USING (true));
 * - a foreign key between tenant tables carries the tenant or has a restrictive same-tenant policy
 *   (FK checks bypass RLS, so a plain FK would accept another tenant's row);
 * - every uuid reference column between tenant tables (tenantReferences) is a composite (tenant_id, x)
 *   foreign key or has a restrictive same-tenant policy, and every uuid column resolves to a table (DATA-12);
 * - the app role owns no tenant table and has no TRUNCATE (bypasses RLS), REFERENCES or TRIGGER on one;
 * - glidepath_app exists, is not SUPERUSER, has no BYPASSRLS and is not a member of a role that has;
 * - every view or materialized view the app can read that (transitively) reads a tenant table is a
 *   view with security_invoker (a definer view, or a matview, would read as its owner, without RLS);
 * - the schema.json tenant tables exist, and its global tables are SELECT-only to the app.
 */
export async function rlsViolations(q: Query): Promise<string[]> {
  const out: string[] = [];
  const spec = specTables();
  const { tables, missing } = await tenantTables(q, spec);
  for (const name of missing) out.push(`${name}: schema.json tenant table is missing from the database`);

  // ---- the app role
  const role = await q(`select rolsuper, rolbypassrls from pg_roles where rolname = $1`, [APP_ROLE]);
  const r = role.rows[0];
  if (!r) out.push(`${APP_ROLE}: role does not exist`);
  else {
    if (r.rolsuper) out.push(`${APP_ROLE}: is SUPERUSER (row-level security does not apply)`);
    if (r.rolbypassrls) out.push(`${APP_ROLE}: has BYPASSRLS`);
    const escalate = await q(
      `select rolname from pg_roles r
        where (r.rolsuper or r.rolbypassrls) and r.rolname <> $1 and pg_has_role($1, r.oid, 'MEMBER')
        order by 1`,
      [APP_ROLE],
    );
    for (const e of escalate.rows) out.push(`${APP_ROLE}: member of ${String(e.rolname)}, which is SUPERUSER or BYPASSRLS`);
  }
  if (!r) return out;

  // ---- each tenant table
  const keyOf = new Map<string, string>();
  for (const t of tables) {
    const rel = await q(
      `select c.oid::int8 as oid, c.relrowsecurity, c.relforcerowsecurity, pg_has_role($2, c.relowner, 'MEMBER') as app_owns,
              has_table_privilege($2, c.oid, 'SELECT') as "SELECT", has_table_privilege($2, c.oid, 'INSERT') as "INSERT",
              has_table_privilege($2, c.oid, 'UPDATE') as "UPDATE", has_table_privilege($2, c.oid, 'DELETE') as "DELETE",
              has_table_privilege($2, c.oid, 'TRUNCATE') as "TRUNCATE", has_table_privilege($2, c.oid, 'REFERENCES') as "REFERENCES",
              has_table_privilege($2, c.oid, 'TRIGGER') as "TRIGGER"
         from pg_class c where c.oid = $1::regclass`,
      [t.sql, APP_ROLE],
    );
    const c = rel.rows[0]!;
    keyOf.set(String(c.oid), t.key);
    const label = t.schema === 'public' ? t.name : `${t.schema}.${t.name}`;
    if (!c.relrowsecurity) out.push(`${label}: row level security is not enabled`);
    if (!c.relforcerowsecurity) out.push(`${label}: row level security is not forced (FORCE ROW LEVEL SECURITY)`);
    if (c.app_owns) out.push(`${label}: owned by ${APP_ROLE} (an owner can turn row level security off)`);
    for (const p of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      if (c[p]) out.push(`${label}: ${APP_ROLE} has ${p}${p === 'TRUNCATE' ? ' (TRUNCATE ignores row level security)' : ''}`);
    }
    const pol = await q(
      `select p.polname as name, p.polpermissive as permissive, p.polcmd::text as cmd,
              (0 = any(p.polroles) or exists (select 1 from unnest(p.polroles) x where x <> 0 and pg_has_role($2, x, 'MEMBER'))) as applies,
              pg_get_expr(p.polqual, p.polrelid) as qual, pg_get_expr(p.polwithcheck, p.polrelid) as with_check
         from pg_policy p where p.polrelid = $1::regclass order by p.polname`,
      [t.sql, APP_ROLE],
    );
    const policies = (pol.rows as unknown as PolicyRow[]).filter((p) => p.applies);
    const permissive = policies.filter((p) => p.permissive);
    const iso = isolationExpr(t.key);
    for (const cmd of Object.keys(COMMANDS) as Command[]) {
      if (!c[cmd]) continue;
      const needUsing = cmd !== 'INSERT';
      const needCheck = cmd === 'INSERT' || cmd === 'UPDATE';
      const ok = permissive.some(
        (p) => covers(p, cmd) && (!needUsing || p.qual === iso) && (!needCheck || effectiveCheck(p) === iso),
      );
      if (!ok) out.push(`${label}: no permissive policy limits ${cmd} by ${APP_ROLE} to ${t.key} = ${TENANT_SETTING}`);
    }
    for (const p of permissive) {
      if (!harmless(p, t.key)) {
        out.push(`${label}: permissive policy ${p.name} may let ${APP_ROLE} reach rows of other tenants (USING ${p.qual ?? '-'}, WITH CHECK ${p.with_check ?? '-'})`);
      }
    }
  }

  // ---- foreign keys between tenant tables
  const guardedBy = async (ref: { table: TenantTable; ref: TenantTable; columns: readonly string[] }): Promise<boolean> =>
    (await sameTenantPolicies(q, ref.table)).some((w) => policyGuards(w, ref.table, ref.ref, ref.columns));
  for (const fk of await crossTenantForeignKeys(q, tables)) {
    if (!(await guardedBy(fk))) {
      out.push(`${fk.table.name}: foreign key ${fk.name} (${fk.columns.join(', ')}) -> ${fk.ref.name} does not carry the tenant and has no restrictive same-tenant policy (FK checks bypass RLS)`);
    }
  }

  // ---- reference columns between tenant tables that no foreign key covers (DATA-12)
  const refs = await tenantReferences(q, tables);
  for (const u of refs.unresolved) {
    out.push(`${u.table.name}: uuid column ${u.column} references no known table (name it <table>_id or list it in REFERENCE_NAMES)`);
  }
  for (const r of refs.references) {
    if (r.foreignKey) continue; // a composite FK carries the tenant; a plain one is checked above
    if (!(await guardedBy({ table: r.table, ref: r.ref, columns: [r.column] }))) {
      out.push(`${r.table.name}: column ${r.column} references ${r.ref.name} with no composite (${r.table.key}, ${r.column}) foreign key and no restrictive same-tenant policy (a row could carry another tenant's id)`);
    }
  }

  // ---- views over tenant tables
  const deps = await q(
    `select distinct v.oid::int8 as view, d.refobjid::int8 as ref
       from pg_class v join pg_rewrite rw on rw.ev_class = v.oid
       join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = rw.oid and d.refclassid = 'pg_class'::regclass
      where v.relkind in ('v', 'm') and d.refobjid <> v.oid`,
  );
  const reads = new Set(keyOf.keys());
  for (let grew = true; grew; ) {
    grew = false;
    for (const d of deps.rows) {
      if (reads.has(String(d.ref)) && !reads.has(String(d.view))) {
        reads.add(String(d.view));
        grew = true;
      }
    }
  }
  const views = await q(
    `select v.oid::int8 as oid, v.oid::regclass::text as name, v.relkind::text as kind, coalesce(v.reloptions, '{}') as options
       from pg_class v join pg_namespace n on n.oid = v.relnamespace
      where v.relkind in ('v', 'm') and ${SYSTEM_SCHEMAS} and has_table_privilege($1, v.oid, 'SELECT')
      order by 2`,
    [APP_ROLE],
  );
  for (const v of views.rows) {
    if (!reads.has(String(v.oid))) continue;
    const invoker = (v.options as string[]).some((o) => /^security_invoker=(true|on|yes|1)$/i.test(o));
    if (v.kind === 'm') out.push(`${String(v.name)}: materialized view over tenant tables readable by ${APP_ROLE} (no row level security on it)`);
    else if (!invoker) out.push(`${String(v.name)}: view over tenant tables readable by ${APP_ROLE} without security_invoker (reads as its owner)`);
  }

  // ---- schema.json global tables: SELECT-only to the app
  for (const name of globalSpecTables(spec)) {
    const g = await q(
      `select has_table_privilege($2, c.oid, 'INSERT') as "INSERT", has_table_privilege($2, c.oid, 'UPDATE') as "UPDATE",
              has_table_privilege($2, c.oid, 'DELETE') as "DELETE", has_table_privilege($2, c.oid, 'TRUNCATE') as "TRUNCATE"
         from pg_class c where c.oid = to_regclass($1)`,
      [qualified('public', name), APP_ROLE],
    );
    const p = g.rows[0];
    if (!p) continue;
    for (const priv of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      if (p[priv]) out.push(`${name}: global table, but ${APP_ROLE} has ${priv} (global rows are shared by every tenant)`);
    }
  }
  return out;
}

/** A foreign key from one tenant table to another that does not carry the tenant key. */
export interface CrossTenantForeignKey {
  readonly name: string;
  readonly table: TenantTable;
  readonly ref: TenantTable;
  readonly columns: readonly string[];
  readonly refColumns: readonly string[];
}

/**
 * Foreign keys between tenant tables whose columns do not map the table's tenant key onto the referenced
 * table's: Postgres checks them without RLS, so only a restrictive same-tenant policy stops a row that
 * points at another tenant's row (0002_rls.sql `*_same_tenant`).
 */
export async function crossTenantForeignKeys(q: Query, tables: readonly TenantTable[]): Promise<CrossTenantForeignKey[]> {
  const byOid = new Map<string, TenantTable>();
  const oids = await q(`select x.name, x.name::regclass::oid::int8 as oid from unnest($1::text[]) as x(name)`, [tables.map((t) => t.sql)]);
  for (const r of oids.rows) byOid.set(String(r.oid), tables.find((t) => t.sql === r.name)!);
  const fks = await q(
    `select con.conname as name, con.conrelid::int8 as rel, con.confrelid::int8 as ref,
            array(select a.attname::text from unnest(con.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.i) as cols,
            array(select a.attname::text from unnest(con.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.i) as ref_cols
       from pg_constraint con where con.contype = 'f' order by 1`,
  );
  const out: CrossTenantForeignKey[] = [];
  for (const fk of fks.rows) {
    const table = byOid.get(String(fk.rel));
    const ref = byOid.get(String(fk.ref));
    if (!table || !ref) continue;
    const columns = fk.cols as string[];
    const refColumns = fk.ref_cols as string[];
    if (columns.some((col, i) => col === table.key && refColumns[i] === ref.key)) continue;
    out.push({ name: String(fk.name), table, ref, columns, refColumns });
  }
  return out;
}

/**
 * WITH CHECK of the restrictive policies on `table` that apply to the app role on INSERT and on UPDATE
 * (a guard on one command only would let the other write through).
 */
async function sameTenantPolicies(q: Query, table: TenantTable): Promise<string[]> {
  const res = await q(
    `select p.polcmd::text as cmd, pg_get_expr(p.polwithcheck, p.polrelid) as with_check from pg_policy p
      where p.polrelid = $1::regclass and not p.polpermissive and p.polcmd in ('*', 'a', 'w')
        and (0 = any(p.polroles) or exists (select 1 from unnest(p.polroles) x where x <> 0 and pg_has_role($2, x, 'MEMBER')))`,
    [table.sql, APP_ROLE],
  );
  const all = res.rows.filter((r) => r.cmd === '*').map((r) => String(r.with_check ?? ''));
  const ins = res.rows.filter((r) => r.cmd === 'a').map((r) => String(r.with_check ?? ''));
  const upd = new Set(res.rows.filter((r) => r.cmd === 'w').map((r) => String(r.with_check ?? '')));
  return [...all, ...ins.filter((w) => upd.has(w))];
}

/** A same-tenant WITH CHECK: reads the referenced table and ties the row's tenant key and columns to it. */
const policyGuards = (w: string, table: TenantTable, ref: TenantTable, columns: readonly string[]): boolean =>
  w.includes(`FROM ${ref.name} `) && w.includes(`${table.name}.${table.key}`) && columns.every((col) => w.includes(`${table.name}.${col}`));

/**
 * uuid columns whose name does not say which table they reference (`<table>_id` does, also with a prefix:
 * `result_scenario_id`, `applied_changeset_id`). `null` = the column's own table.
 */
export const REFERENCE_NAMES: Readonly<Record<string, string | null>> = {
  parent_id: null,
  reverts_id: null,
  user_id: 'app_user',
  created_by: 'app_user',
  actor: 'app_user',
};

/** A uuid (or uuid[]) column of a tenant table that holds the id of a row of another (or the same) tenant table. */
export interface TenantReference {
  readonly table: TenantTable;
  readonly column: string;
  readonly ref: TenantTable;
  /** Name of a foreign key on the column, when one exists (its tenant handling is crossTenantForeignKeys'). */
  readonly foreignKey: string | null;
  readonly array: boolean;
}

/**
 * Every reference between tenant tables held in a uuid or uuid[] column (DATA-12), read from the catalog:
 * the target is the column's foreign key when it has one, else its name (REFERENCE_NAMES, then the longest
 * `_`-suffix of `<stem>_id(s)` that names a table). The tenant key and a single-column primary key are not
 * references. A uuid column whose target cannot be told is `unresolved` (the catalog check fails it).
 */
export async function tenantReferences(
  q: Query,
  tables: readonly TenantTable[],
): Promise<{ references: TenantReference[]; unresolved: { table: TenantTable; column: string }[] }> {
  const all = await q(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and n.nspname = 'public'`,
  );
  const tableNames = new Set(all.rows.map((r) => String(r.name)));
  const tenantByName = new Map(tables.filter((t) => t.schema === 'public').map((t) => [t.name, t]));
  const references: TenantReference[] = [];
  const unresolved: { table: TenantTable; column: string }[] = [];
  for (const t of tables) {
    const cols = await q(
      `select a.attname::text as name, t.typname::text as type,
              (select con.conname::text from pg_constraint con where con.conrelid = a.attrelid and con.contype = 'f' and a.attnum = any(con.conkey) order by con.conname limit 1) as fk,
              (select con.confrelid::regclass::text from pg_constraint con where con.conrelid = a.attrelid and con.contype = 'f' and a.attnum = any(con.conkey) order by con.conname limit 1) as fk_ref,
              exists (select 1 from pg_constraint con where con.conrelid = a.attrelid and con.contype = 'p' and con.conkey = array[a.attnum]) as sole_pk
         from pg_attribute a join pg_type t on t.oid = a.atttypid
        where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped and t.typname in ('uuid', '_uuid')
        order by a.attnum`,
      [t.sql],
    );
    for (const c of cols.rows) {
      const column = String(c.name);
      if (column === t.key || column === 'tenant_id' || c.sole_pk) continue;
      let target: string | null | undefined;
      if (c.fk_ref !== null && c.fk_ref !== undefined) target = String(c.fk_ref).replace(/^public\./, '');
      else if (column in REFERENCE_NAMES) target = REFERENCE_NAMES[column] ?? t.name;
      else {
        const m = /^(.+)_ids?$/.exec(column);
        const parts = m ? m[1]!.split('_') : [];
        target = parts.map((_, i) => parts.slice(i).join('_')).find((n) => tableNames.has(n));
      }
      if (target === undefined || target === null) {
        unresolved.push({ table: t, column });
        continue;
      }
      const ref = tenantByName.get(target);
      if (!ref) continue; // a global table (app_user, model_version, ...): shared by every tenant
      references.push({ table: t, column, ref, foreignKey: c.fk === null ? null : String(c.fk), array: c.type === '_uuid' });
    }
  }
  return { references, unresolved };
}

// -------------------------------------------------------------------------------------- row snapshots

/** Every row of `tenantId` in every tenant table, as `to_jsonb` text, sorted: run as a role that bypasses RLS. */
export async function tenantSnapshot(q: Query, tables: readonly TenantTable[], tenantId: string): Promise<Map<string, string[]>> {
  const parts = tables.map(
    (t, i) => `select ${i} as t, to_jsonb(x)::text as j from ${t.sql} x where x.${quoteIdent(t.key)} = $1::uuid`,
  );
  const res = await q(`${parts.join(' union all ')} order by 1, 2`, [tenantId]);
  const out = new Map(tables.map((t) => [t.name, [] as string[]]));
  for (const row of res.rows) out.get(tables[Number(row.t)]!.name)!.push(String(row.j));
  return out;
}

/** Rows of every non-tenant table (global data every tenant may read), as `to_jsonb`. */
export async function globalRows(q: Query, tables: readonly TenantTable[]): Promise<unknown[]> {
  const tenant = new Set(tables.map((t) => `${t.schema}.${t.name}`));
  const all = await q(
    `select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and ${SYSTEM_SCHEMAS} order by 1, 2`,
  );
  const out: unknown[] = [];
  for (const r of all.rows) {
    if (tenant.has(`${String(r.schema)}.${String(r.name)}`)) continue;
    const rows = await q(`select to_jsonb(x) as j from ${qualified(String(r.schema), String(r.name))} x`);
    out.push(...rows.rows.map((x) => x.j));
  }
  return out;
}

/** The string and number leaves of a JSON value. */
export function leaves(v: unknown, into: Set<string | number> = new Set()): Set<string | number> {
  if (typeof v === 'string' || typeof v === 'number') into.add(v);
  else if (Array.isArray(v)) for (const x of v) leaves(x, into);
  else if (v !== null && typeof v === 'object') for (const x of Object.values(v)) leaves(x, into);
  return into;
}
