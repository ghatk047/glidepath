import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, stop } from '@glidepath/pg-local';
import type { PgLocalInstance } from '@glidepath/pg-local';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './db';
import type { DbHandle } from './db';
import { withTenant } from './tenant';

const stateFile = join(tmpdir(), `gp-data-access-tenant-${process.pid}.json`);
let inst: PgLocalInstance;
let h: DbHandle;

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'user-ana';

type Row = { t: string | null; u: string | null };
const settings = sql`select current_setting('app.tenant_id', true) as t, current_setting('app.user_id', true) as u`;

beforeAll(async () => {
  inst = await start({ stateFile });
  // One connection, so every call below reuses the same backend (what a pooler does).
  h = createDb(inst.url, { poolMax: 1 });
  await h.pool.query('create table scratch (v text)');
}, 120_000);

afterAll(async () => {
  await h?.close();
  if (inst) stop({ instance: inst, stateFile });
});

describe('withTenant (pg-local)', () => {
  it('sets app.tenant_id and app.user_id inside the transaction and returns the callback result', async () => {
    const r = await withTenant(
      h.db,
      TENANT,
      USER,
      async (tx) => (await tx.execute<Row>(settings)).rows[0],
    );
    expect(r).toEqual({ t: TENANT, u: USER });
  });

  it('SET LOCAL: nothing survives on the reused connection afterwards', async () => {
    await withTenant(h.db, TENANT, USER, async () => undefined);
    const after = await h.db.execute<Row>(settings);
    expect(after.rows[0]?.t ?? '').toBe('');
    expect(after.rows[0]?.u ?? '').toBe('');
  });

  it('runs in a single transaction: commits on success, rolls back and rethrows on failure', async () => {
    await withTenant(h.db, TENANT, USER, (tx) =>
      tx.execute(sql`insert into scratch (v) values ('ok')`),
    );
    await expect(
      withTenant(h.db, TENANT, USER, async (tx) => {
        await tx.execute(sql`insert into scratch (v) values ('fail')`);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rows = await h.pool.query<{ v: string }>('select v from scratch order by v');
    expect(rows.rows.map((r) => r.v)).toEqual(['ok']);
  });

  it('values are bound, not interpolated', async () => {
    const odd = "o'brien'; drop table scratch; --";
    const r = await withTenant(
      h.db,
      TENANT,
      odd,
      async (tx) => (await tx.execute<Row>(settings)).rows[0],
    );
    expect(r?.u).toBe(odd);
    await h.pool.query('select 1 from scratch');
  });

  it('consecutive calls on one connection do not leak context into each other', async () => {
    await withTenant(h.db, 'tenant-a', 'user-a', async () => undefined);
    const r = await withTenant(
      h.db,
      'tenant-b',
      'user-b',
      async (tx) => (await tx.execute<Row>(settings)).rows[0],
    );
    expect(r).toEqual({ t: 'tenant-b', u: 'user-b' });
  });
});
