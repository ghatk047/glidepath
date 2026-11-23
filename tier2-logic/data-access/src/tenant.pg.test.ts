import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, stop } from '@glidepath/pg-local';
import type { PgLocalInstance } from '@glidepath/pg-local';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './db';
import type { DbHandle } from './db';
import { withTenant, withUser } from './tenant';
import { recordQueries } from './testing/app-db';

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
  it('withTenant runs fn in one transaction that first executes SET LOCAL app.tenant_id and app.user_id: visible inside, gone after commit', async () => {
    // A fresh single-connection pool, so the recorder sees every statement on that connection.
    const one = createDb(inst.url, { poolMax: 1 });
    const log = recordQueries(one.pool);
    type TxRow = Row & { xid: string };
    const probe = sql`select current_setting('app.tenant_id', true) as t, current_setting('app.user_id', true) as u, txid_current()::text as xid`;
    try {
      const inside = await withTenant(one.db, TENANT, USER, async (tx) => {
        const first = await tx.execute<TxRow>(probe);
        const second = await tx.execute<TxRow>(probe);
        return [first.rows[0], second.rows[0]];
      });
      // visible inside, in one transaction (the same transaction id for every statement)
      expect(inside[0]).toEqual({ t: TENANT, u: USER, xid: inside[0]?.xid });
      expect(inside[1]).toEqual(inside[0]);
      // the first statement after BEGIN sets both, transaction-local (is_local = true), values bound
      const texts = log.map((q) => q.text.trim().toLowerCase());
      expect(texts[0]).toBe('begin');
      expect(texts[1]).toBe("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)");
      expect(log[1]?.values).toEqual([TENANT, USER]);
      expect(texts.slice(2).map((t) => (t.includes('current_setting') ? 'probe' : t))).toEqual(['probe', 'probe', 'commit']);
      // gone after commit, on the same (only) connection
      const after = await one.db.execute<TxRow>(probe);
      expect(after.rows[0]?.t ?? '').toBe('');
      expect(after.rows[0]?.u ?? '').toBe('');
      expect(after.rows[0]?.xid).not.toBe(inside[0]?.xid);
    } finally {
      await one.close();
    }
  });

  it('refuses an empty tenant or user id without opening a transaction', async () => {
    let ran = false;
    const fn = async () => {
      ran = true;
    };
    await expect(withTenant(h.db, '', USER, fn)).rejects.toThrow(TypeError);
    await expect(withTenant(h.db, TENANT, ' ', fn)).rejects.toThrow(TypeError);
    await expect(withUser(h.db, '', fn)).rejects.toThrow(TypeError);
    expect(ran).toBe(false);
  });

  it('withUser sets app.user_id and clears app.tenant_id for its transaction only', async () => {
    // A stale session-level tenant on the (only) connection must not show through.
    await h.db.execute(sql`select set_config('app.tenant_id', ${TENANT}, false)`);
    try {
      const r = await withUser(h.db, 'user-bob', async (tx) => (await tx.execute<Row>(settings)).rows[0]);
      expect(r).toEqual({ t: '', u: 'user-bob' });
      const after = await h.db.execute<Row>(settings);
      expect(after.rows[0]?.t).toBe(TENANT);
      expect(after.rows[0]?.u ?? '').toBe('');
    } finally {
      await h.db.execute(sql`select set_config('app.tenant_id', '', false)`);
    }
  });

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
