import { start, stop } from '@glidepath/pg-local';
import type { PgLocalInstance } from '@glidepath/pg-local';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './db';
import { migrate } from './migrate';
import { app_user } from './schema';
import { createOwnedDatabase } from './testing/owner-db';
import type { OwnedDatabase } from './testing/owner-db';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Always TLS: a pg-local cluster started with --ssl (self-signed cert), URL ends ?sslmode=require. */
let inst: PgLocalInstance;
let owned: OwnedDatabase;

beforeAll(async () => {
  inst = await start({ ssl: true, stateFile: join(tmpdir(), `gp-data-access-db-${process.pid}.json`) });
  owned = await createOwnedDatabase(inst.url);
  await migrate(owned.url);
}, 120_000);

afterAll(async () => {
  stop({ instance: inst, stateFile: join(tmpdir(), `gp-data-access-db-${process.pid}.json`) });
});

describe('createDb on pg-local --ssl', () => {
  it('pg-local --ssl URL asks for sslmode=require', () => {
    expect(inst.url).toContain('sslmode=require');
  });

  it('TLS comes from the URL: sslmode=require connects over TLS to a self-signed server', async () => {
    const h = createDb(owned.url);
    try {
      const r = await h.db.execute<{ ssl: boolean }>(sql`select ssl from pg_stat_ssl where pid = pg_backend_pid()`);
      expect(r.rows[0]?.ssl).toBe(true);
    } finally {
      await h.close();
    }
  });

  it('without sslmode in the URL the connection is plain', async () => {
    const u = new URL(owned.url);
    u.searchParams.delete('sslmode');
    const h = createDb(u.toString());
    try {
      const r = await h.db.execute<{ ssl: boolean }>(sql`select ssl from pg_stat_ssl where pid = pg_backend_pid()`);
      expect(r.rows[0]?.ssl).toBe(false);
    } finally {
      await h.close();
    }
  });

  it('runs typed Drizzle queries against the migrated schema', async () => {
    const h = createDb(owned.url);
    try {
      const id = '00000000-0000-4000-8000-000000000001';
      await h.db.insert(app_user).values({ id, email: 'Pilot@Example.com', name: 'P' });
      const rows = await h.db.select().from(app_user);
      expect(rows).toEqual([{ id, email: 'Pilot@Example.com', name: 'P' }]);
      // citext: case-insensitive lookup
      const hit = await h.db.select().from(app_user).where(sql`${app_user.email} = 'pilot@example.com'`);
      expect(hit).toHaveLength(1);
    } finally {
      await h.close();
    }
  });

  it('pooler safe: prepared statements off by default (names dropped), on when asked', async () => {
    const count = sql`select count(*)::int as n from pg_prepared_statements`;
    const off = createDb(owned.url, { poolMax: 1 });
    try {
      const q = off.db.select().from(app_user).prepare('gp_named_stmt');
      await q.execute();
      await q.execute();
      const r = await off.db.execute<{ n: number }>(count);
      expect(r.rows[0]?.n).toBe(0);
    } finally {
      await off.close();
    }
    const on = createDb(owned.url, { poolMax: 1, preparedStatements: true });
    try {
      const q = on.db.select().from(app_user).prepare('gp_named_stmt');
      await q.execute();
      const r = await on.db.execute<{ n: number }>(count);
      expect(r.rows[0]?.n).toBeGreaterThan(0);
    } finally {
      await on.close();
    }
  });

  it('pooler safe: tenant context via SET LOCAL does not outlive its transaction on a reused connection', async () => {
    const h = createDb(owned.url, { poolMax: 1 });
    try {
      const inTx = await h.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', 'tenant-a', true)`);
        const r = await tx.execute<{ v: string }>(sql`select current_setting('app.tenant_id', true) as v`);
        return r.rows[0]?.v;
      });
      expect(inTx).toBe('tenant-a');
      const after = await h.db.execute<{ v: string | null }>(sql`select current_setting('app.tenant_id', true) as v`);
      expect(after.rows[0]?.v ?? '').toBe('');
    } finally {
      await h.close();
    }
  });

  it('pool size bounds concurrent connections', async () => {
    const h = createDb(owned.url, { poolMax: 2 });
    try {
      await Promise.all(Array.from({ length: 6 }, () => h.db.execute(sql`select pg_sleep(0.05)`)));
      expect(h.pool.totalCount).toBeLessThanOrEqual(2);
    } finally {
      await h.close();
    }
  });
});
