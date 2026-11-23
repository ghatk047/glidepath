import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runSqlDir } from '@glidepath/pg-local';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RLS_MIGRATION, SCHEMA_MIGRATION } from './generate';
import { buildModel, type ModelTable } from './model';
import { loadSchema, migrationsDir } from './spec';
import {
  initDir,
  sqlError,
  startTestCluster,
  TEST_ROLE_PASSWORD,
  type Session,
  type TestCluster,
} from './testing/db';
import { insertSql, rowFor, type Row } from './testing/rows';

/**
 * DATA-02 acceptance, on a pg-local cluster bootstrapped with
 * tier3-data/postgres/init (`pg:local start --init`), migrated as
 * glidepath_owner, seeded with two tenants (one row per table each).
 */

const APP = 'glidepath_app';
const OWNER = 'glidepath_owner';

const schema = loadSchema();
const model = buildModel(schema);
const table = (n: string): ModelTable => model.tables.find((t) => t.name === n)!;
const names = Object.keys(schema.tables);
const scope = (n: string) => schema.tables[n]!.scope;
// Straight from schema.json, independent of the generator.
const tenantScoped = names
  .filter((n) => ['tenant', 'tenant-root', 'tenant or global'].includes(scope(n)))
  .sort();
const strictTenant = names.filter((n) => ['tenant', 'tenant-root'].includes(scope(n))).sort();
const globalTables = names.filter((n) => scope(n) === 'global').sort();
const keyOf = (n: string) => (scope(n) === 'tenant-root' ? 'id' : 'tenant_id');

const tenants = { A: randomUUID(), B: randomUUID() } as const;
type Label = 'G' | keyof typeof tenants;
const rows: Record<Label, Record<string, Row>> = { G: {}, A: {}, B: {} };
const user = { A: '', B: '' };

let db: TestCluster;

/** Runs `fn` in one transaction with SET LOCAL app.tenant_id (and app.user_id); rolls back unless `commit`. */
async function asTenant<T>(
  role: string,
  tenant: string | null,
  fn: (s: Session) => Promise<T>,
  opts: { commit?: boolean; userId?: string } = {},
): Promise<T> {
  return db.withSession({ role }, async (s) => {
    await s.query('BEGIN');
    try {
      if (tenant) await s.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      if (opts.userId) await s.query(`SELECT set_config('app.user_id', $1, true)`, [opts.userId]);
      const r = await fn(s);
      await s.query(opts.commit ? 'COMMIT' : 'ROLLBACK');
      return r;
    } catch (e) {
      await s.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
  });
}

/** A statement in its own savepoint, so the transaction survives its failure. */
async function attempt(s: Session, sql: string, params?: unknown[]) {
  await s.query('SAVEPOINT x');
  try {
    const r = await s.query(sql, params);
    await s.query('RELEASE SAVEPOINT x');
    return r;
  } catch (e) {
    await s.query('ROLLBACK TO SAVEPOINT x');
    throw e;
  }
}

const insert = (s: Session, t: string, row: Row) => {
  const { text, values } = insertSql(table(t), row);
  return attempt(s, text, values);
};

/** Natural-key parts that would otherwise repeat the seeded row's key. */
const freshKey = (t: string): Row =>
  t === 'change'
    ? { seq: String(Math.floor(Math.random() * 1e9)) }
    : t === 'tenant_membership'
      ? { user_id: rows.G.app_user!.id! }
      : {};

/** A fresh row for tenant `label`, keyed to that tenant's seeded parents. */
const freshRow = (t: string, label: 'A' | 'B', overrides: Row = {}): Row =>
  rowFor(
    table(t),
    `${label}${randomUUID().slice(0, 8)}`,
    { ...rows.G, ...rows[label] },
    {
      ...(scope(t) === 'tenant-root' ? { id: randomUUID() } : { tenant_id: tenants[label] }),
      ...freshKey(t),
      ...overrides,
    },
  );

beforeAll(async () => {
  db = await startTestCluster('gp_rls');
  await db.migrate([SCHEMA_MIGRATION, RLS_MIGRATION], { role: OWNER });

  // Seed as the owner. Global rows need no tenant; FORCE RLS makes the owner set the tenant like the app.
  await asTenant(
    OWNER,
    null,
    async (s) => {
      for (const t of model.tables.filter((x) => scope(x.name) === 'global')) {
        rows.G[t.name] = rowFor(t, 'G', rows.G);
        await insert(s, t.name, rows.G[t.name]!);
      }
      rows.G.source = rowFor(table('source'), 'G', {}); // tenant_id NULL: a global source
      await insert(s, 'source', rows.G.source);
      for (const label of ['A', 'B'] as const) {
        rows[label].app_user = rowFor(table('app_user'), `${label}-user`, {});
        user[label] = rows[label].app_user.id!;
        await insert(s, 'app_user', rows[label].app_user);
      }
    },
    { commit: true },
  );
  for (const label of ['A', 'B'] as const) {
    await asTenant(
      OWNER,
      tenants[label],
      async (s) => {
        for (const t of model.tables.filter((x) => scope(x.name) !== 'global')) {
          const parents = { ...rows.G, ...rows[label] };
          const own: Row =
            scope(t.name) === 'tenant-root'
              ? { id: tenants[label] }
              : { tenant_id: tenants[label] };
          rows[label][t.name] = rowFor(t, label, parents, own);
          await insert(s, t.name, rows[label][t.name]!);
        }
      },
      { commit: true },
    );
  }
}, 180_000);
afterAll(() => db?.stop());

describe('DATA-02 acceptance', () => {
  it("every table with scope tenant (and tenant-root) gets ENABLE + FORCE ROW LEVEL SECURITY and a policy USING/WITH CHECK tenant_id = current_setting('app.tenant_id')::uuid (catalog query, all tenant tables covered)", async () => {
    expect(tenantScoped).toHaveLength(names.length - globalTables.length);
    expect(tenantScoped).toContain('tenant');
    expect(tenantScoped).toContain('source');
    const rls = (
      await db.q(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r' and relname <> 'schema_migration' order by 1`,
      )
    ).split('\n');
    expect(rls).toHaveLength(names.length);
    for (const line of rls) {
      const [name, enabled, forced] = line.split('|');
      const want = tenantScoped.includes(name!) ? 't' : 'f';
      expect(`${name}:${enabled}${forced}`).toBe(`${name}:${want}${want}`);
    }

    const pol = (
      await db.q(
        `select tablename, permissive, roles::text, cmd, qual, with_check from pg_policies
       where schemaname = 'public' and policyname = 'tenant_isolation' order by 1`,
      )
    ).split('\n');
    expect(pol.map((l) => l.split('|')[0])).toEqual(tenantScoped);
    for (const line of pol) {
      const [name, permissive, roles, cmd, qual, check] = line.split('|');
      // current_setting(..., true) and NULLIF: an unset or reset app.tenant_id is NULL (no rows), not an error.
      const expected = `(${keyOf(name!)} = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`;
      expect({ name, permissive, roles, cmd, qual, check }).toEqual({
        name,
        permissive: 'PERMISSIVE',
        roles: '{public}',
        cmd: 'ALL',
        qual: expected,
        check: expected,
      });
    }

    // Any further policy on a tenant table either narrows (RESTRICTIVE) or is one of the named,
    // read-only or owner-only exceptions; none widens what the app may write.
    const others = (
      await db.q(
        `select tablename || '.' || policyname, permissive, roles::text, cmd from pg_policies
       where schemaname = 'public' and policyname <> 'tenant_isolation' order by 1`,
      )
    ).split('\n');
    for (const line of others) {
      const [id, permissive, roles, cmd] = line.split('|');
      if (permissive === 'RESTRICTIVE') continue;
      expect([
        'tenant_membership.own_memberships',
        'tenant.own_tenants',
        'source.global_rows_read',
        'source.global_rows_owner',
      ]).toContain(id);
      expect(cmd === 'SELECT' || roles === `{${OWNER}}`, line).toBe(true);
    }
  });

  it('global tables (model_version, *_def, canonical_pool, addr_tag, lever_template, app_user) are SELECT-only to glidepath_app (INSERT as app fails)', async () => {
    expect(globalTables).toEqual(
      [
        'model_version',
        'dimension_def',
        'variable_def',
        'node_def',
        'canonical_pool',
        'addr_tag',
        'lever_template',
        'app_user',
      ].sort(),
    );
    const privileges = [
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER',
    ];
    for (const t of globalTables) {
      const has = await db.q(
        `select string_agg(p, ',' order by p) from unnest($1::text[]) p where has_table_privilege($2, $3, p)`,
        { params: [privileges, APP, `public.${t}`] },
      );
      expect(`${t}:${has}`).toBe(`${t}:SELECT`);
    }
    for (const tenant of [null, tenants.A]) {
      await asTenant(APP, tenant, async (s) => {
        for (const t of globalTables) {
          expect(await s.q(`select count(*) >= 1 from ${t}`), t).toBe('t'); // readable, with or without a tenant
          const e = await sqlError(
            insert(s, t, rowFor(table(t), `x${randomUUID().slice(0, 8)}`, rows.G)),
          );
          expect(`${t}: ${e.code} ${e.message}`).toMatch(
            new RegExp(`^${t}: 42501 permission denied for table ${t}$`),
          );
          expect(
            (
              await sqlError(
                attempt(
                  s,
                  `UPDATE ${t} SET ${table(t).columns[0]!.name} = ${table(t).columns[0]!.name}`,
                ),
              )
            ).code,
          ).toBe('42501');
          expect((await sqlError(attempt(s, `DELETE FROM ${t}`))).code).toBe('42501');
        }
      });
    }
  });

  it('role bootstrap in tier3-data/postgres/init (local only): glidepath_owner (owns objects) and glidepath_app (LOGIN, NOSUPERUSER, NOBYPASSRLS); migrations assume roles exist and only GRANT (pg-local --init)', async () => {
    const attrs = `select rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
                   from pg_roles where rolname in ('${APP}', '${OWNER}') order by 1`;
    const expected = `${APP}|t|f|f|f|f|f\n${OWNER}|t|f|f|f|f|f`;
    expect(await db.q(attrs)).toBe(expected);
    // neither role is a member of any role (nothing to escalate to)
    expect(
      await db.q(
        `select count(*) from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname in ('${APP}', '${OWNER}')`,
      ),
    ).toBe('0');
    // the owner owns the database and every table; the app owns nothing
    expect(
      await db.q(
        `select pg_get_userbyid(datdba) from pg_database where datname = current_database()`,
      ),
    ).toBe(OWNER);
    expect(
      await db.q(
        `select string_agg(distinct tableowner, ',') from pg_tables where schemaname = 'public'`,
      ),
    ).toBe(OWNER);
    expect(
      await db.q(
        `select count(*) from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = '${APP}'`,
      ),
    ).toBe('0');

    // the init folder is idempotent (plain SQL, re-runnable as pg-local --init does)
    expect(await runSqlDir(db.url(db.database), initDir)).toEqual([
      '01_roles.sql',
      '02_database_owner.sql',
    ]);
    expect(await db.q(attrs)).toBe(expected);
    expect(
      await db.q(
        `select pg_get_userbyid(datdba) from pg_database where datname = current_database()`,
      ),
    ).toBe(OWNER);

    // migrations never create, alter or drop roles or memberships: they GRANT to the existing app role
    const files = readdirSync(migrationsDir, { recursive: true, encoding: 'utf8' }).filter((f) =>
      f.endsWith('.sql'),
    );
    expect(files).toContain(RLS_MIGRATION);
    for (const f of files) {
      const sql = readFileSync(resolve(migrationsDir, f), 'utf8');
      // statements (line starts), not comments or messages
      expect(sql, f).not.toMatch(/^\s*(CREATE|ALTER|DROP)\s+(ROLE|USER|GROUP)\b/im);
      // no role membership revoke (`REVOKE role FROM x`). Revoking a privilege on an object (`REVOKE ... ON ...
      // FROM PUBLIC`, OPS-09's SECURITY DEFINER function, owner-approved 2026-11-23) changes no role or membership.
      expect(sql, f).not.toMatch(/^\s*REVOKE\s+(?![^;]*\bON\b)[^;]*\bFROM\b/im);
      expect(sql, f).not.toMatch(/^\s*GRANT\s+[a-z_]+\s+TO\b/im); // role membership grant
    }
    const rlsSql = readFileSync(resolve(migrationsDir, RLS_MIGRATION), 'utf8');
    const grants = rlsSql.split('\n').filter((l) => /^GRANT\b/.test(l));
    expect(grants.length).toBeGreaterThan(names.length);
    for (const g of grants)
      expect(g).toMatch(
        new RegExp(`^GRANT [A-Z, ]+ ON (SCHEMA|TABLE|SEQUENCE) [a-z_]+ TO ${APP};$`),
      );

    // The role check runs first, so a failing check aborts the whole file (one transaction).
    const guard = /^DO \$\$\n[\s\S]*?\n\$\$;$/m.exec(rlsSql)?.[0] ?? '';
    expect(guard).toContain(`rolname = '${APP}'`);
    expect(rlsSql.indexOf(guard)).toBeLessThan(rlsSql.search(/^(GRANT|ALTER|CREATE) /m));
    // Exercise it against a throwaway role name: the real roles are shared by every test on the server.
    const probe = `gp_probe_${randomUUID().slice(0, 8)}`;
    const probeGuard = guard.split(APP).join(probe);
    const runGuard = () =>
      db.withSession({ role: OWNER }, async (s) => {
        await s.query(probeGuard);
        return s.notices;
      });
    try {
      expect((await sqlError(runGuard())).message).toBe(
        `role ${probe} does not exist. Roles are created outside migrations (ADR-015): tier3-data/postgres/init locally, in Neon in the cloud.`,
      );
      await db.q(`CREATE ROLE ${probe} LOGIN BYPASSRLS`);
      expect((await sqlError(runGuard())).message).toMatch(
        new RegExp(`^role ${probe} must be NOSUPERUSER NOBYPASSRLS`),
      );
      await db.q(`ALTER ROLE ${probe} NOBYPASSRLS`);
      expect(await runGuard()).toEqual([]);
      // a member of a BYPASSRLS role could switch to it: the migration warns
      await db.q(`CREATE ROLE ${probe}_priv NOLOGIN BYPASSRLS`);
      await db.q(`GRANT ${probe}_priv TO ${probe}`);
      expect((await runGuard()).join('\n')).toMatch(
        new RegExp(`^WARNING: role ${probe} is a member of a SUPERUSER or BYPASSRLS role`),
      );
    } finally {
      await db.q(`DROP ROLE IF EXISTS ${probe}`);
      await db.q(`DROP ROLE IF EXISTS ${probe}_priv`);
    }
  });

  it('app role with no app.tenant_id set sees 0 rows in every tenant table', async () => {
    // seeded: one row per tenant table for each of A and B (counted through the owner, per tenant)
    for (const label of ['A', 'B'] as const) {
      await asTenant(OWNER, tenants[label], async (s) => {
        for (const t of strictTenant)
          expect(`${t}:${await s.q(`select count(*) from ${t}`)}`).toBe(`${t}:1`);
      });
    }
    await db.withSession({ role: APP }, async (s) => {
      const counts = async () => {
        for (const t of strictTenant)
          expect(`${t}:${await s.q(`select count(*) from ${t}`)}`).toBe(`${t}:0`);
        // source is "tenant or global": no tenant rows, only the shared global one
        expect(
          await s.q(
            `select count(*) filter (where tenant_id is not null) || ',' || count(*) from source`,
          ),
        ).toBe('0,1');
      };
      // never set on this connection
      expect(await s.q(`select current_setting('app.tenant_id', true) is null`)).toBe('t');
      await counts();
      // set for one transaction (SET LOCAL), then gone: a pooled connection reused after it sees nothing
      await s.query('BEGIN');
      await s.query(`SET LOCAL app.tenant_id = '${tenants.A}'`);
      expect(await s.q(`select count(*) from scenario`)).toBe('1');
      await s.query('COMMIT');
      expect(await s.q(`select current_setting('app.tenant_id', true)`)).toBe('');
      await counts();
      // writes without a tenant are refused too
      const { text, values } = insertSql(table('scenario'), freshRow('scenario', 'A'));
      expect((await sqlError(s.query(text, values))).message).toBe(
        'new row violates row-level security policy for table "scenario"',
      );
    });
    // FORCE ROW LEVEL SECURITY: the owning role is filtered as well
    await db.withSession({ role: OWNER }, async (s) => {
      for (const t of strictTenant)
        expect(`${t}:${await s.q(`select count(*) from ${t}`)}`).toBe(`${t}:0`);
    });
  });
});

describe('tenant isolation beyond the acceptance lines', () => {
  it('with app.tenant_id set, the app reads and writes only that tenant', async () => {
    await asTenant(APP, tenants.A, async (s) => {
      for (const t of strictTenant) {
        expect(`${t}:${await s.q(`select count(*) from ${t}`)}`).toBe(`${t}:1`);
        expect(await s.q(`select count(*) from ${t} where ${keyOf(t)} = $1`, [tenants.B])).toBe(
          '0',
        );
      }
      expect(await s.q(`select count(*) from source`)).toBe('2'); // own + global
      for (const t of [...strictTenant, 'source']) {
        // a row of tenant B, written as tenant A
        const e = await sqlError(insert(s, t, freshRow(t, 'B')));
        expect(`${t}: ${e.code} ${e.message}`).toBe(
          `${t}: 42501 new row violates row-level security policy for table "${t}"`,
        );
        // own rows can be written (positive control); the tenant root is the tenant itself, below
        if (t !== 'tenant') expect((await insert(s, t, freshRow(t, 'A'))).rowCount, t).toBe(1);
      }
      for (const t of strictTenant.filter((x) => !['tenant', 'audit_log'].includes(x))) {
        // moving a row to another tenant, or touching B's rows
        const moved = await sqlError(attempt(s, `UPDATE ${t} SET tenant_id = $1`, [tenants.B]));
        expect(`${t}: ${moved.code}`).toBe(`${t}: 42501`);
        expect(
          (
            await attempt(s, `UPDATE ${t} SET tenant_id = tenant_id WHERE tenant_id = $1`, [
              tenants.B,
            ])
          ).rowCount,
        ).toBe(0);
        expect(
          (await attempt(s, `DELETE FROM ${t} WHERE tenant_id = $1`, [tenants.B])).rowCount,
        ).toBe(0);
      }
    });
    // creating a tenant (AI reconfiguration, through the app role): the context is the new tenant's id
    const fresh = randomUUID();
    await asTenant(APP, fresh, async (s) => {
      expect((await insert(s, 'tenant', freshRow('tenant', 'A', { id: fresh }))).rowCount).toBe(1);
      expect(await s.q(`select id from tenant`)).toBe(fresh);
    });
    // B is untouched
    await asTenant(OWNER, tenants.B, async (s) => {
      for (const t of strictTenant)
        expect(`${t}:${await s.q(`select count(*) from ${t}`)}`).toBe(`${t}:1`);
    });
  });

  it("foreign keys cannot point at another tenant's rows (FK checks bypass RLS; restrictive policies close that)", async () => {
    const guards = await db.q(
      `select tablename || '.' || policyname from pg_policies where permissive = 'RESTRICTIVE' order by 1`,
    );
    expect(guards.split('\n')).toEqual([
      'change.change_changeset_id_same_tenant',
      'line_item.line_item_source_id_same_tenant',
    ]);

    await asTenant(APP, tenants.A, async (s) => {
      const changeB = freshRow('change', 'A', { changeset_id: rows.B.changeset!.id! });
      expect((await sqlError(insert(s, 'change', changeB))).message).toMatch(
        /new row violates row-level security policy "change_changeset_id_same_tenant"/,
      );
      expect((await insert(s, 'change', freshRow('change', 'A'))).rowCount).toBe(1);
      expect(
        (await sqlError(attempt(s, `UPDATE change SET changeset_id = $1`, [rows.B.changeset!.id])))
          .code,
      ).toBe('42501');

      const line = (source_id: string | null) => freshRow('line_item', 'A', { source_id });
      expect((await sqlError(insert(s, 'line_item', line(rows.B.source!.id!)))).message).toMatch(
        /line_item_source_id_same_tenant/,
      );
      for (const ok of [null, rows.A.source!.id!, rows.G.source!.id!]) {
        expect((await insert(s, 'line_item', line(ok))).rowCount, String(ok)).toBe(1);
      }
      // the composite FK already carries the tenant: B's line item is not found for A
      const lever = freshRow('line_item_lever', 'A', { line_key: rows.B.line_item!.member_key! });
      expect((await sqlError(insert(s, 'line_item_lever', lever))).code).toBe('23503');
    });
  });

  it('global source rows are read-only to the app; the owner maintains them', async () => {
    await asTenant(APP, tenants.A, async (s) => {
      expect(
        (await sqlError(insert(s, 'source', freshRow('source', 'A', { tenant_id: null })))).code,
      ).toBe('42501');
      expect(
        (await attempt(s, `UPDATE source SET title = 'x' WHERE tenant_id IS NULL`)).rowCount,
      ).toBe(0);
      expect((await attempt(s, `DELETE FROM source WHERE tenant_id IS NULL`)).rowCount).toBe(0);
      expect(
        (
          await sqlError(
            attempt(s, `UPDATE source SET tenant_id = NULL WHERE tenant_id = $1`, [tenants.A]),
          )
        ).code,
      ).toBe('42501');
    });
    await asTenant(OWNER, null, async (s) => {
      expect(
        (await insert(s, 'source', freshRow('source', 'A', { tenant_id: null }))).rowCount,
      ).toBe(1);
      expect(
        (await attempt(s, `UPDATE source SET title = 'y' WHERE tenant_id IS NULL`)).rowCount,
      ).toBe(2);
    });
  });

  it("before a tenant is chosen, app.user_id reads only that user's memberships and tenants", async () => {
    await asTenant(APP, null, async (s) => {
      expect(await s.q(`select count(*) from tenant_membership`)).toBe('0');
      expect(await s.q(`select count(*) from tenant`)).toBe('0');
    });
    await asTenant(
      APP,
      null,
      async (s) => {
        expect(await s.q(`select tenant_id from tenant_membership`)).toBe(tenants.A);
        expect(await s.q(`select id from tenant`)).toBe(tenants.A);
        for (const t of strictTenant.filter((x) => !['tenant', 'tenant_membership'].includes(x))) {
          expect(`${t}:${await s.q(`select count(*) from ${t}`)}`).toBe(`${t}:0`);
        }
        // read-only
        expect(
          (
            await sqlError(
              insert(
                s,
                'tenant_membership',
                freshRow('tenant_membership', 'A', { user_id: user.A }),
              ),
            )
          ).code,
        ).toBe('42501');
        expect((await attempt(s, `UPDATE tenant SET name = 'x'`)).rowCount).toBe(0);
      },
      { userId: user.A },
    );
    // once a tenant is set, only that tenant: the user's other memberships are not visible
    await asTenant(
      APP,
      tenants.B,
      async (s) => {
        expect(
          await s.q(`select count(*) from tenant_membership where user_id = $1`, [user.A]),
        ).toBe('0');
        expect(await s.q(`select id from tenant`)).toBe(tenants.B);
      },
      { userId: user.A },
    );
  });

  it('glidepath_app cannot get around RLS (no TRUNCATE, not owner, no CREATE, cannot switch roles; audit_log is append-only)', async () => {
    for (const t of names) {
      expect(
        await db.q(`select has_table_privilege($1, $2, 'TRUNCATE')`, {
          params: [APP, `public.${t}`],
        }),
        t,
      ).toBe('f');
    }
    await asTenant(APP, tenants.A, async (s) => {
      for (const sql of [
        'ALTER TABLE scenario DISABLE ROW LEVEL SECURITY',
        'ALTER TABLE scenario NO FORCE ROW LEVEL SECURITY',
        'DROP POLICY tenant_isolation ON scenario',
        'TRUNCATE scenario',
        'CREATE TABLE app_scratch (x int)',
        `SET ROLE ${OWNER}`,
        'UPDATE audit_log SET action = action',
        'DELETE FROM audit_log',
      ]) {
        expect(`${sql}: ${(await sqlError(attempt(s, sql))).code}`).toBe(`${sql}: 42501`);
      }
      // row_security = off does not bypass anything for this role: the query errors instead
      await s.query('SET LOCAL row_security = off');
      expect((await sqlError(attempt(s, 'select count(*) from scenario'))).message).toMatch(
        /row-level security/,
      );
      await s.query('SET LOCAL row_security = on');
      // audit_log takes inserts (its id sequence is granted)
      expect((await insert(s, 'audit_log', freshRow('audit_log', 'A'))).rowCount).toBe(1);
    });
  });
});

describe('tier3-data/postgres/init/03_role_passwords.sh (docker entrypoint)', () => {
  const script = join(initDir, '03_role_passwords.sh');
  const runNow = (env: Record<string, string>) => {
    const u = new URL(db.url(db.database));
    const bin = process.env.PG_BIN ?? '/usr/lib/postgresql/16/bin';
    return spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PGHOST: u.hostname,
        PGPORT: u.port || '5432',
        PGPASSWORD: decodeURIComponent(u.password),
        PGSSLMODE: u.searchParams.get('sslmode') ?? 'prefer',
        POSTGRES_USER: decodeURIComponent(u.username),
        POSTGRES_DB: db.database,
        ...env,
      },
    });
  };
  const run = (env: Record<string, string>) => db.withRoleLock(() => runNow(env));
  const verifiers = () =>
    db.q(
      `select string_agg(coalesce(rolpassword, ''), ',' order by rolname) from pg_authid where rolname in ($1, $2)`,
      {
        params: [APP, OWNER],
      },
    );

  it('sets both passwords from OWNER_DB_PASSWORD / APP_DB_PASSWORD and stops when one is empty', async () => {
    const before = await verifiers();
    // The script writes the shared roles: hold the harness's role lock like every role writer here.
    const empty = await run({ OWNER_DB_PASSWORD: TEST_ROLE_PASSWORD, APP_DB_PASSWORD: '' });
    expect(empty.status).not.toBe(0);
    expect(empty.stderr).toMatch(/APP_DB_PASSWORD is empty/);
    expect(await verifiers()).toBe(before);

    // a quote in a password is data, not SQL
    const quoted = await run({
      OWNER_DB_PASSWORD: TEST_ROLE_PASSWORD,
      APP_DB_PASSWORD: `it's-${TEST_ROLE_PASSWORD}`,
    });
    expect(quoted.stderr).toBe('');
    expect(quoted.status).toBe(0);
    // Same password as the test harness uses (logins keep working on servers that check them);
    // SCRAM verifiers are salted, so each run stores new ones for both roles.
    const mid = await verifiers();
    const ok = await run({
      OWNER_DB_PASSWORD: TEST_ROLE_PASSWORD,
      APP_DB_PASSWORD: TEST_ROLE_PASSWORD,
    });
    expect(ok.status).toBe(0);
    const after = await verifiers();
    for (const v of after.split(',')) expect(v).toMatch(/^SCRAM-SHA-256\$/);
    const [b, a, m] = [before, after, mid].map((x) => x.split(','));
    expect(a![0]).not.toBe(m![0]);
    expect(a![1]).not.toBe(m![1]);
    expect(m![0]).not.toBe(b![0]);
    // and the role logs in with it
    expect(await db.q('select current_user', { role: APP })).toBe(APP);
  });
});
