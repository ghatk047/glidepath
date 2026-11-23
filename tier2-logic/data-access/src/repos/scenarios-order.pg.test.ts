import { readFileSync } from 'node:fs';
import { getTestDatabaseUrl } from '@glidepath/pg-local';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db';
import type { DbHandle } from '../db';
import { migrate } from '../migrate';
import { scenario } from '../schema';
import { withTenant } from '../tenant';
import type { TenantTx } from '../tenant';
import { createAppRoleDb } from '../testing/app-db';
import { ANA, MV1, TENANT_A, seedMinimal } from '../testing/minimal-seed';
import { createOwnedDatabase } from '../testing/owner-db';
import type { OwnedDatabase } from '../testing/owner-db';
import { listScenarios } from './index';

/**
 * DATA-14: scenario.sort_order. listScenarios returns presets in seed order (docs/spec/seed/aa/scenarios.json:
 * rates, A, B, C, D), then the other scenarios by created_at, key. The migration backfills existing AA databases.
 */

const seedOrder = (JSON.parse(
  readFileSync(new URL('../../../../docs/spec/seed/aa/scenarios.json', import.meta.url), 'utf8'),
) as { scenarios: { id: string }[] }).scenarios.map((s) => s.id);
const migrationSql = readFileSync(
  new URL('../../../../tier3-data/migrations/manual/0005_scenario_sort_order.sql', import.meta.url),
  'utf8',
);

let owned: OwnedDatabase;
let owner: DbHandle;
let app: DbHandle;

beforeAll(async () => {
  const adminUrl = await getTestDatabaseUrl();
  owned = await createOwnedDatabase(adminUrl);
  await migrate(owned.url);
  owner = createDb(owned.url);
  await seedMinimal(owner.db);
  app = createAppRoleDb(adminUrl, owned.database);
  // the AA presets as an older database holds them: all created at one instant, no sort_order
  await withTenant(owner.db, TENANT_A, ANA, async (tx) => {
    await tx.execute(sql`update tenant set slug = 'aa' where id = ${TENANT_A}`);
    await tx.insert(scenario).values(
      [...seedOrder, 'mine'].map((key, i) => ({
        tenant_id: TENANT_A, id: `00000000-0000-4000-8000-0000000000${10 + i}`, key, label: key,
        kind: key === 'mine' ? ('user' as const) : ('preset' as const), parent_id: null, model_version_id: MV1,
        version: 0, locked: key !== 'mine', created_by: ANA,
        created_at: new Date(key === 'mine' ? '2026-11-02T00:00:00Z' : '2026-11-01T00:00:00Z'),
      })),
    );
  });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await owned?.drop();
});

const asA = <T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> => withTenant(app.db, TENANT_A, ANA, fn);
const keys = async (): Promise<string[]> => (await asA(listScenarios)).map((s) => s.key);

describe('scenario.sort_order (DATA-14)', () => {
  it('the seed order starts with rates (the order the cockpit renders)', () => {
    expect(seedOrder[0]).toBe('rates');
  });

  it('migration 0005 adds a nullable integer sort_order; RLS on scenario is unchanged (forced)', async () => {
    const col = await owner.pool.query(
      `select is_nullable, data_type from information_schema.columns where table_name = 'scenario' and column_name = 'sort_order'`,
    );
    expect(col.rows).toEqual([{ is_nullable: 'YES', data_type: 'integer' }]);
    const r = await owner.pool.query(`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'scenario'`);
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('without sort_order the key collation puts rates last (what DATA-14 fixes)', async () => {
    const k = (await keys()).filter((x) => seedOrder.includes(x));
    expect(k[k.length - 1]).toBe('rates');
  });

  it('migration 0005 backfills sort_order of the preset keys of the aa tenant from the seed order; other scenarios stay null', async () => {
    const stmt = migrationSql.slice(migrationSql.indexOf('UPDATE scenario'));
    await withTenant(owner.db, TENANT_A, ANA, (tx) => tx.execute(sql.raw(stmt)));
    const rows = await withTenant(owner.db, TENANT_A, ANA, (tx) => tx.select().from(scenario));
    const by = Object.fromEntries(rows.map((r) => [r.key, r.sort_order]));
    seedOrder.forEach((k, i) => expect(by[k], k).toBe(i));
    expect(by.mine).toBeNull();
    expect(by.root).toBeNull();
  });

  it('listScenarios returns rates, A, B, C, D, then the other scenarios by created_at', async () => {
    const k = await keys();
    expect(k.slice(0, 5)).toEqual(seedOrder);
    expect(k.slice(5)).toEqual(['root', 'child', 'sibling', 'grandchild', 'mine']);
  });
});
