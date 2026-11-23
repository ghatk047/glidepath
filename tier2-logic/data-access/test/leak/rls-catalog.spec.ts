import { clientConfig } from '@glidepath/pg-local';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANA, TENANT_A, TENANT_B } from '../../src/testing/minimal-seed';
import { APP_ROLE, crossTenantForeignKeys, quoteIdent, rlsViolations, specTables, tenantTables } from './catalog';
import type { Query, TenantTable } from './catalog';
import { openLeakDb } from './seed';
import type { LeakDb } from './seed';

/**
 * G7, catalog side (DATA-10): row-level security on every tenant table, read from the live catalog of
 * a fully migrated database (generated and manual migrations), then probed as glidepath_app with two
 * seeded tenants. Tables are discovered (schema.json scope + any table with a tenant_id column), so a
 * table added later is checked without touching this file.
 */

let db: LeakDb;
let tables: TenantTable[];

beforeAll(async () => {
  db = await openLeakDb();
  tables = (await tenantTables(db.adminQuery)).tables;
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const message = (e: unknown): string => {
  const x = e as { message?: string; cause?: { message?: string } };
  return `${x?.message ?? String(e)} ${x?.cause?.message ?? ''}`;
};

/** Runs `sql` in a savepoint that is always rolled back: the outcome, never the effect. */
async function probe(q: Query, sql: string, values?: unknown[]): Promise<{ rowCount: number | null; rows: Record<string, unknown>[] } | { error: string }> {
  await q('savepoint probe');
  try {
    return await q(sql, values);
  } catch (e) {
    return { error: message(e) };
  } finally {
    await q('rollback to savepoint probe');
  }
}

describe('G7 row-level security catalog check (pg-local, fully migrated)', () => {
  it('catalog: every scope=tenant table has relrowsecurity and relforcerowsecurity; glidepath_app has no BYPASSRLS (G7)', async () => {
    const spec = specTables();
    const specTenant = [...spec].filter(([, scope]) => scope !== 'global').map(([name]) => name);
    const names = tables.map((t) => t.name);
    // discovery: every schema.json tenant table, the tenant root, and the manual stored_object (tenant_id column)
    expect(names).toEqual(expect.arrayContaining([...specTenant, 'tenant', 'stored_object']));
    expect(tables.find((t) => t.name === 'tenant')?.key).toBe('id');

    const rls = await db.adminQuery(
      `select x.name, c.relrowsecurity, c.relforcerowsecurity from unnest($1::text[]) x(name) join pg_class c on c.oid = x.name::regclass`,
      [tables.map((t) => t.sql)],
    );
    expect(rls.rows).toHaveLength(tables.length);
    for (const r of rls.rows) expect(r, String(r.name)).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    const role = await db.adminQuery(`select rolsuper, rolbypassrls from pg_roles where rolname = $1`, [APP_ROLE]);
    expect(role.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);

    // the whole rule set: tenant policy per granted command, no widening policy, no TRUNCATE, FK guards, views, roles
    expect(await rlsViolations(db.adminQuery)).toEqual([]);
  });

  it('the check fails a tenant table without RLS, FORCE or a tenant policy, a widening policy, TRUNCATE, an unguarded FK, a definer view or a matview, and a BYPASSRLS app role', async () => {
    const owner = new pg.Client(clientConfig(db.owned.url));
    await owner.connect();
    const q: Query = (text, values) => owner.query(text, values);
    const probeTable = async (): Promise<string[]> => (await rlsViolations(q)).filter((v) => v.startsWith('leak_probe'));
    const noPolicy = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map(
      (c) => `leak_probe: no permissive policy limits ${c} by ${APP_ROLE} to tenant_id = app.tenant_id`,
    );
    try {
      await q('begin');
      // a tenant table as a careless manual migration would add it: found by its tenant_id column
      await q(`create table leak_probe (tenant_id uuid not null, scenario_id uuid, note text)`);
      await q(`grant select, insert, update, delete on leak_probe to ${APP_ROLE}`);
      expect(await probeTable()).toEqual([
        'leak_probe: row level security is not enabled',
        'leak_probe: row level security is not forced (FORCE ROW LEVEL SECURITY)',
        ...noPolicy,
      ]);
      await q('alter table leak_probe enable row level security');
      await q('alter table leak_probe force row level security');
      // RLS on but no policy (deny all): still a violation, the table has no tenant policy
      expect(await probeTable()).toEqual(noPolicy);
      await q(`create policy wide on leak_probe for all to public using (true) with check (true)`);
      await q(`create policy tenant_isolation on leak_probe for all to public
                 using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
                 with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)`);
      expect(await probeTable()).toEqual([
        `leak_probe: permissive policy wide may let ${APP_ROLE} reach rows of other tenants (USING true, WITH CHECK true)`,
      ]);
      await q('drop policy wide on leak_probe');
      // a SELECT policy for the pre-tenant reads must switch off once a tenant is set
      await q(`create policy no_tenant on leak_probe for select to public using (nullif(current_setting('app.user_id', true), '')::uuid is not null)`);
      expect(await probeTable()).toHaveLength(1);
      await q('drop policy no_tenant on leak_probe');
      expect(await probeTable()).toEqual([]);

      await q(`grant truncate on leak_probe to ${APP_ROLE}`);
      expect(await probeTable()).toEqual([`leak_probe: ${APP_ROLE} has TRUNCATE (TRUNCATE ignores row level security)`]);
      await q(`revoke truncate on leak_probe from ${APP_ROLE}`);

      // scenario's primary key is (id): this FK would accept another tenant's scenario
      await q('alter table leak_probe add constraint leak_probe_scenario_id_fkey foreign key (scenario_id) references scenario (id)');
      const fk = 'leak_probe: foreign key leak_probe_scenario_id_fkey (scenario_id) -> scenario does not carry the tenant and has no restrictive same-tenant policy (FK checks bypass RLS)';
      expect(await probeTable()).toEqual([fk]);
      await q(`create policy leak_probe_scenario_id_same_tenant on leak_probe as restrictive for all to public using (true)
                 with check (leak_probe.scenario_id is null or exists (select 1 from scenario r where r.id = leak_probe.scenario_id and r.tenant_id = leak_probe.tenant_id))`);
      expect(await probeTable()).toEqual([]);

      // views the app can read over tenant tables: only security_invoker views keep RLS
      await q(`create view leak_probe_v as select * from leak_probe`);
      await q(`create view leak_probe_vv as select * from v_inputs_resolved`);
      await q(`create materialized view leak_probe_mv as select tenant_id from scenario with no data`);
      await q(`grant select on leak_probe_v, leak_probe_vv, leak_probe_mv to ${APP_ROLE}`);
      expect(await probeTable()).toEqual([
        `leak_probe_mv: materialized view over tenant tables readable by ${APP_ROLE} (no row level security on it)`,
        `leak_probe_v: view over tenant tables readable by ${APP_ROLE} without security_invoker (reads as its owner)`,
        `leak_probe_vv: view over tenant tables readable by ${APP_ROLE} without security_invoker (reads as its owner)`,
      ]);
      await q('alter view leak_probe_v set (security_invoker = true)');
      await q('alter view leak_probe_vv set (security_invoker = true)');
      await q('drop materialized view leak_probe_mv');
      expect(await probeTable()).toEqual([]);
      expect(await rlsViolations(q)).toEqual([]);
    } finally {
      await q('rollback');
      await owner.end();
    }

    // the role (superuser only; rolled back, so no other session ever sees it)
    await db.adminQuery('begin');
    try {
      await db.adminQuery(`alter role ${APP_ROLE} bypassrls`);
      expect(await rlsViolations(db.adminQuery)).toEqual([`${APP_ROLE}: has BYPASSRLS`]);
    } finally {
      await db.adminQuery('rollback');
    }
  });

  it('every tenant table (catalog), as glidepath_app in tenant A: no row of tenant B is read, changed or deleted, and every row written with tenant B\'s id is refused; without a tenant nothing is visible', async () => {
    // the seed is not vacuous: both tenants have rows in every tenant table
    for (const t of tables) {
      const n = await db.adminQuery(
        `select count(*) filter (where ${quoteIdent(t.key)} = $1::uuid)::int as a, count(*) filter (where ${quoteIdent(t.key)} = $2::uuid)::int as b from ${t.sql}`,
        [TENANT_A, TENANT_B],
      );
      const { a, b } = n.rows[0] as { a: number; b: number };
      expect(a > 0 && b > 0, `${t.name}: the leak seed (test/leak/seed.ts) needs rows of both tenants (A ${a}, B ${b})`).toBe(true);
    }
    const privileges = new Map<string, Record<string, boolean>>();
    for (const t of tables) {
      const p = await db.adminQuery(
        `select has_table_privilege($2, $1, 'INSERT') as "INSERT", has_table_privilege($2, $1, 'UPDATE') as "UPDATE", has_table_privilege($2, $1, 'DELETE') as "DELETE"`,
        [t.sql, APP_ROLE],
      );
      privileges.set(t.name, p.rows[0] as Record<string, boolean>);
    }
    const fks = await crossTenantForeignKeys(db.adminQuery, tables);
    expect(fks.map((f) => `${f.table.name}.${f.columns.join(',')}`)).toEqual(expect.arrayContaining(['change.changeset_id', 'line_item.source_id']));

    const client = await db.app.pool.connect();
    const q: Query = (text, values) => client.query(text, values);
    try {
      await q('begin');
      await q(`select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`, [TENANT_A, ANA]);
      expect((await q('select current_user as u')).rows[0]?.u).toBe(APP_ROLE);
      for (const t of tables) {
        const k = quoteIdent(t.key);
        const can = privileges.get(t.name)!;
        const refused = (outcome: Awaited<ReturnType<typeof probe>>, privilege: string, what: string) => {
          expect('error' in outcome, `${t.name}: ${what} was not refused`).toBe(true);
          const err = (outcome as { error: string }).error;
          expect(err, `${t.name}: ${what}`).toMatch(can[privilege] ? /new row violates row-level security policy/ : /permission denied/);
        };
        const untouched = (outcome: Awaited<ReturnType<typeof probe>>, privilege: string, what: string) => {
          if (can[privilege]) expect(outcome, `${t.name}: ${what}`).toMatchObject({ rowCount: 0 });
          else expect(outcome, `${t.name}: ${what}`).toMatchObject({ error: expect.stringMatching(/permission denied/) });
        };
        const own = await probe(q, `select count(*)::int as n from ${t.sql} where ${k} = $1::uuid`, [TENANT_A]);
        expect('rows' in own && Number(own.rows[0]?.n) > 0, `${t.name}: tenant A sees its own rows`).toBe(true);
        expect(await probe(q, `select count(*)::int as n from ${t.sql} where ${k} = $1::uuid`, [TENANT_B]), t.name).toMatchObject({ rows: [{ n: 0 }] });
        expect(await probe(q, `select count(*)::int as n from ${t.sql} where ${k} <> $1::uuid`, [TENANT_A]), t.name).toMatchObject({ rows: [{ n: 0 }] });
        untouched(await probe(q, `update ${t.sql} set ${k} = ${k} where ${k} = $1::uuid`, [TENANT_B]), 'UPDATE', 'update of tenant B rows');
        untouched(await probe(q, `delete from ${t.sql} where ${k} = $1::uuid`, [TENANT_B]), 'DELETE', 'delete of tenant B rows');
        // Postgres checks the RLS WITH CHECK before NOT NULL and other constraints: the bare key is enough
        refused(await probe(q, `insert into ${t.sql} (${k}) values ($1::uuid)`, [TENANT_B]), 'INSERT', 'insert with tenant B\'s id');
        refused(await probe(q, `update ${t.sql} set ${k} = $1::uuid where ${k} = $2::uuid`, [TENANT_B, TENANT_A]), 'UPDATE', 'moving a row of A to tenant B');
      }
      // a row of A that points at a row of B through a foreign key (FK checks bypass RLS) is refused too
      for (const fk of fks) {
        const target = await db.adminQuery(
          `select ${fk.refColumns.map(quoteIdent).join(', ')} from ${fk.ref.sql} where ${quoteIdent(fk.ref.key)} = $1::uuid limit 1`,
          [TENANT_B],
        );
        const values = fk.refColumns.map((c) => target.rows[0]![c]);
        const cols = [fk.table.key, ...fk.columns].map(quoteIdent).join(', ');
        const params = [TENANT_A, ...values];
        const outcome = await probe(q, `insert into ${fk.table.sql} (${cols}) values (${params.map((_, i) => `$${i + 1}`).join(', ')})`, params);
        expect(outcome, `${fk.table.name}.${fk.columns.join(',')} -> tenant B's ${fk.ref.name}`).toMatchObject({
          error: expect.stringMatching(/new row violates row-level security policy/),
        });
      }
      await q('rollback');

      // no tenant and no user set: every tenant table is empty to the app role
      await q('begin');
      await q(`select set_config('app.tenant_id', '', true), set_config('app.user_id', '', true)`);
      for (const t of tables) {
        expect(await probe(q, `select count(*)::int as n from ${t.sql}`), t.name).toMatchObject({ rows: [{ n: 0 }] });
      }
      await q('rollback');
    } finally {
      client.release();
    }
  });
});
