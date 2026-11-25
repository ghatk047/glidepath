import { checkName, ident, lit } from './ddl';
import type { FkRef, Model, ModelTable } from './model';

/**
 * Row-level security, policies and grants (DATA-02), generated from the
 * `scope` of every schema.json table. See docs/architecture/04_data_and_api.md
 * "Tenancy and row-level security" and ADR-015.
 *
 * Roles are created outside migrations (tier3-data/postgres/init locally, Neon
 * in the cloud); the migration only checks the app role and GRANTs to it.
 */

/** Runtime role (DATABASE_URL). Never SUPERUSER or BYPASSRLS. */
export const APP_ROLE = 'glidepath_app';
/** Owner role (DATABASE_URL_MIGRATE): runs migrations and seed, so it owns every object. */
export const OWNER_ROLE = 'glidepath_owner';
/** Transaction-local tenant context: `SET LOCAL app.tenant_id` / `set_config('app.tenant_id', $1, true)`. */
export const TENANT_SETTING = 'app.tenant_id';
/** Transaction-local user context, set next to the tenant (04: SET LOCAL app.user_id). */
export const USER_SETTING = 'app.user_id';
/** The policy every tenant table gets. */
export const TENANT_POLICY = 'tenant_isolation';

export type Tenancy = 'global' | 'tenant-root' | 'tenant' | 'tenant-or-global';

/** schema.json `scope` values. A new scope fails generation until it has a rule here. */
const SCOPE_TENANCY: Record<string, Tenancy> = {
  global: 'global',
  'tenant-root': 'tenant-root',
  tenant: 'tenant',
  'tenant or global': 'tenant-or-global',
};

export function tenancyOf(t: Pick<ModelTable, 'name' | 'scope'>): Tenancy {
  const x = SCOPE_TENANCY[t.scope];
  if (!x)
    throw new Error(
      `${t.name}: unknown scope "${t.scope}"; add an RLS rule for it in tools/gen-schema/src/rls.ts`,
    );
  return x;
}

/**
 * The uuid in a transaction-local setting, or NULL when it is absent (never
 * set on this connection) or reset (a SET LOCAL from an earlier transaction:
 * the value reverts to ''). NULL equals nothing, so missing context returns no
 * rows instead of an error: tenant tables fail closed.
 */
export function settingUuidSql(setting: string): string {
  return `NULLIF(current_setting(${lit(setting)}, true), '')::uuid`;
}

const CURRENT_TENANT = settingUuidSql(TENANT_SETTING);
const CURRENT_USER_ID = settingUuidSql(USER_SETTING);

/** The column that carries a row's tenant: `id` on the tenant root, `tenant_id` elsewhere. */
export function tenantKey(t: ModelTable): string {
  const tenancy = tenancyOf(t);
  if (tenancy === 'global') throw new Error(`${t.name}: global tables have no tenant key`);
  if (tenancy === 'tenant-root') {
    if (t.primaryKey.length !== 1 || t.primaryKey[0] !== 'id')
      throw new Error(`${t.name}: tenant-root needs pk (id)`);
    return 'id';
  }
  const c = t.columns.find((x) => x.name === 'tenant_id');
  if (!c || c.sqlType !== 'uuid')
    throw new Error(`${t.name}: scope ${t.scope} needs a uuid tenant_id column`);
  if (tenancy === 'tenant' && !c.notNull)
    throw new Error(`${t.name}: scope tenant needs tenant_id NOT NULL`);
  if (tenancy === 'tenant-or-global' && c.notNull)
    throw new Error(`${t.name}: scope "${t.scope}" needs a nullable tenant_id (NULL = global)`);
  return 'tenant_id';
}

/**
 * Privileges of the app role. Never TRUNCATE (it bypasses row-level security),
 * REFERENCES or TRIGGER. The tenant root has no DELETE: tenants are archived
 * (status), and removing one is an owner operation.
 */
export const APP_PRIVILEGES: Record<Tenancy, readonly string[]> = {
  global: ['SELECT'],
  'tenant-root': ['SELECT', 'INSERT', 'UPDATE'],
  tenant: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'tenant-or-global': ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
};

/** Per-table narrowing of APP_PRIVILEGES. */
export const APP_PRIVILEGE_OVERRIDES: Record<string, readonly string[]> = {
  // Append-only audit trail: tier 2 adds rows, nothing edits or removes them.
  audit_log: ['SELECT', 'INSERT'],
};

export function appPrivileges(t: ModelTable): readonly string[] {
  return APP_PRIVILEGE_OVERRIDES[t.name] ?? APP_PRIVILEGES[tenancyOf(t)];
}

/**
 * Membership lookups happen before a tenant is chosen (login, /api/me,
 * /api/tenants, resolving /api/t/:tenant): with only app.user_id set, a user
 * may read their own membership rows and the tenants they belong to. Once
 * app.tenant_id is set these policies switch off and only tenant isolation
 * applies, so nothing of another tenant is visible inside a tenant request.
 */
export const MEMBERSHIP = { table: 'tenant_membership', userColumn: 'user_id' } as const;

export interface PolicySpec {
  table: string;
  name: string;
  restrictive: boolean;
  command: 'ALL' | 'SELECT';
  /** PUBLIC, or CURRENT_USER (the role running migrations: the owner). */
  roles: 'PUBLIC' | 'CURRENT_USER';
  using: string;
  withCheck?: string;
  why: string;
}

function isTenantScoped(t: ModelTable): boolean {
  return tenancyOf(t) !== 'global';
}

/** True when the FK carries the tenant key into the referenced table's tenant key (composite or the tenant FK itself). */
function fkCarriesTenant(t: ModelTable, fk: FkRef, ref: ModelTable): boolean {
  const own = tenantKey(t);
  const theirs = tenantKey(ref);
  return fk.columns.some((c, i) => c === own && fk.refColumns[i] === theirs);
}

/**
 * Foreign key checks bypass row-level security, so a plain FK to another
 * tenant-scoped table would accept a row of another tenant. Each such FK gets a
 * restrictive policy: the referenced row must belong to the same tenant (or be
 * global, for tenant-or-global targets).
 */
function sameTenantGuard(t: ModelTable, fk: FkRef & { name: string }, ref: ModelTable): PolicySpec {
  const q = (c: string) => `${ident(t.name)}.${ident(c)}`;
  const match = fk.columns.map((c, i) => `r.${ident(fk.refColumns[i]!)} = ${q(c)}`);
  const own = q(tenantKey(t));
  const refTenancy = tenancyOf(ref);
  if (refTenancy === 'tenant-root') match.push(`r.id = ${own}`);
  else if (refTenancy === 'tenant') match.push(`r.tenant_id = ${own}`);
  else match.push(`(r.tenant_id = ${own} OR r.tenant_id IS NULL)`);
  const exists = `EXISTS (SELECT 1 FROM ${ident(ref.name)} r WHERE ${match.join(' AND ')})`;
  const nullable = fk.columns.filter((c) => !t.columns.find((x) => x.name === c)!.notNull);
  const check = nullable.length
    ? `${nullable.map((c) => `${q(c)} IS NULL`).join(' OR ')} OR ${exists}`
    : exists;
  return {
    table: t.name,
    name: checkName(`${fk.name.replace(/_fkey$/, '')}_same_tenant`),
    restrictive: true,
    command: 'ALL',
    roles: 'PUBLIC',
    using: 'true',
    withCheck: check,
    why: `${fk.columns.join(', ')} must reference a ${ref.name} row of the same tenant${refTenancy === 'tenant-or-global' ? ' or a global one' : ''} (FK checks bypass RLS)`,
  };
}

/** Every policy, per table in model order. */
export function policiesFor(model: Model): PolicySpec[] {
  const byName = new Map(model.tables.map((t) => [t.name, t]));
  const root = model.tables.filter((t) => tenancyOf(t) === 'tenant-root');
  if (root.length !== 1)
    throw new Error(`expected exactly one tenant-root table, found ${root.length}`);
  const membership = byName.get(MEMBERSHIP.table);
  if (
    !membership ||
    tenancyOf(membership) !== 'tenant' ||
    !membership.columns.some((c) => c.name === MEMBERSHIP.userColumn)
  ) {
    throw new Error(
      `${MEMBERSHIP.table}.${MEMBERSHIP.userColumn}: membership table missing or not tenant-scoped`,
    );
  }

  const out: PolicySpec[] = [];
  for (const t of model.tables) {
    const tenancy = tenancyOf(t);
    if (tenancy === 'global') {
      for (const fk of t.fks) {
        if (isTenantScoped(byName.get(fk.refTable)!))
          throw new Error(`${t.name}: global table references tenant-scoped ${fk.refTable}`);
      }
      continue;
    }
    const key = tenantKey(t);
    const isolation = `${ident(key)} = ${CURRENT_TENANT}`;
    out.push({
      table: t.name,
      name: TENANT_POLICY,
      restrictive: false,
      command: 'ALL',
      roles: 'PUBLIC',
      using: isolation,
      withCheck: isolation,
      why: `rows of the tenant in ${TENANT_SETTING} only; none when it is not set`,
    });
    if (tenancy === 'tenant-or-global') {
      out.push({
        table: t.name,
        name: 'global_rows_read',
        restrictive: false,
        command: 'SELECT',
        roles: 'PUBLIC',
        using: `${ident(key)} IS NULL`,
        why: 'global rows (tenant_id NULL) are shared and read-only to tenants',
      });
      out.push({
        table: t.name,
        name: 'global_rows_owner',
        restrictive: false,
        command: 'ALL',
        roles: 'CURRENT_USER',
        using: `${ident(key)} IS NULL`,
        withCheck: `${ident(key)} IS NULL`,
        why: 'the owner (the role running migrations) maintains the global rows',
      });
    }
    if (t.name === MEMBERSHIP.table) {
      out.push({
        table: t.name,
        name: 'own_memberships',
        restrictive: false,
        command: 'SELECT',
        roles: 'PUBLIC',
        using: `${CURRENT_TENANT} IS NULL AND ${ident(MEMBERSHIP.userColumn)} = ${CURRENT_USER_ID}`,
        why: `before a tenant is chosen, the user in ${USER_SETTING} reads their own memberships`,
      });
    }
    if (tenancy === 'tenant-root') {
      out.push({
        table: t.name,
        name: 'own_tenants',
        restrictive: false,
        command: 'SELECT',
        roles: 'PUBLIC',
        using:
          `${CURRENT_TENANT} IS NULL AND ${ident(key)} IN ` +
          `(SELECT m.tenant_id FROM ${ident(MEMBERSHIP.table)} m WHERE m.${ident(MEMBERSHIP.userColumn)} = ${CURRENT_USER_ID})`,
        why: `before a tenant is chosen, the user in ${USER_SETTING} reads the tenants they belong to`,
      });
    }
    for (const fk of t.fks) {
      const ref = byName.get(fk.refTable)!;
      if (!isTenantScoped(ref) || fkCarriesTenant(t, fk, ref)) continue;
      out.push(sameTenantGuard(t, fk, ref));
    }
  }
  return out;
}

function renderPolicy(p: PolicySpec): string {
  let s = `CREATE POLICY ${p.name} ON ${ident(p.table)}`;
  if (p.restrictive) s += ' AS RESTRICTIVE';
  s += ` FOR ${p.command} TO ${p.roles}\n  USING (${p.using})`;
  if (p.withCheck !== undefined) s += `\n  WITH CHECK (${p.withCheck})`;
  return `-- ${p.why}\n${s};`;
}

/** Serial columns own a sequence named <table>_<column>_seq; inserting needs USAGE on it. */
function serialSequences(t: ModelTable): string[] {
  return t.columns
    .filter((c) => c.sqlType === 'bigserial')
    .map((c) => checkName(`${t.name}_${c.name}_seq`));
}

function renderGuard(): string {
  const app = lit(APP_ROLE);
  return `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${app}) THEN
    RAISE EXCEPTION 'role ${APP_ROLE} does not exist. Roles are created outside migrations (ADR-015): tier3-data/postgres/init locally, in Neon in the cloud.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${app} AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'role ${APP_ROLE} must be NOSUPERUSER NOBYPASSRLS: row-level security does not apply to it otherwise.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE (r.rolsuper OR r.rolbypassrls) AND r.rolname <> ${app} AND pg_has_role(${app}, r.oid, 'MEMBER')
  ) THEN
    RAISE WARNING 'role ${APP_ROLE} is a member of a SUPERUSER or BYPASSRLS role and could switch to it, escaping row-level security. Revoke that membership.';
  END IF;
END
$$;
`;
}

/** Renders migration 0002: role check, RLS + policies on every tenant-scoped table, grants to the app role. */
export function renderRlsSql(model: Model): string {
  const policies = policiesFor(model);
  const out: string[] = [];
  out.push(
    `-- GENERATED by tools/gen-schema from docs/spec/schema.json (spec_version ${model.specVersion}). Do not edit.\n` +
      `-- Regenerate: pnpm --filter @glidepath/gen-schema generate\n` +
      `-- Row-level security, policies and grants (DATA-02; docs/architecture/04_data_and_api.md, ADR-015).\n` +
      `-- Runs as the owner role, which owns every table. Roles are NOT created here: they must exist\n` +
      `-- (tier3-data/postgres/init locally, Neon in the cloud); this file only checks ${APP_ROLE} and grants to it.\n` +
      `-- FORCE ROW LEVEL SECURITY: the owner is filtered too, so seeding sets the tenant like the app does.\n` +
      `-- Tenant context, per transaction only (transaction-pooler safe):\n` +
      `--   SELECT set_config('${TENANT_SETTING}', $1, true), set_config('${USER_SETTING}', $2, true);  -- = SET LOCAL\n` +
      `-- Without ${TENANT_SETTING}, every tenant table returns no rows.\n`,
  );
  out.push(renderGuard());
  out.push(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE};\n`);
  for (const t of model.tables) {
    const tenancy = tenancyOf(t);
    const lines: string[] = [`-- ${t.name}: scope ${t.scope}`];
    if (tenancy !== 'global') {
      lines.push(`ALTER TABLE ${ident(t.name)} ENABLE ROW LEVEL SECURITY;`);
      lines.push(`ALTER TABLE ${ident(t.name)} FORCE ROW LEVEL SECURITY;`);
      for (const p of policies.filter((x) => x.table === t.name)) lines.push(renderPolicy(p));
    }
    lines.push(`GRANT ${appPrivileges(t).join(', ')} ON TABLE ${ident(t.name)} TO ${APP_ROLE};`);
    if (appPrivileges(t).includes('INSERT')) {
      for (const s of serialSequences(t))
        lines.push(`GRANT USAGE ON SEQUENCE ${ident(s)} TO ${APP_ROLE};`);
    }
    out.push(lines.join('\n') + '\n');
  }
  return out.join('\n');
}
