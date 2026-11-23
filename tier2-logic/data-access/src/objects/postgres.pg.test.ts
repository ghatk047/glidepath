import { randomUUID } from 'node:crypto';
import { getTestDatabaseUrl } from '@glidepath/pg-local';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db';
import type { DbHandle } from '../db';
import { migrate } from '../migrate';
import { createOwnedDatabase } from '../testing/owner-db';
import type { OwnedDatabase } from '../testing/owner-db';
import { withTenant } from '../tenant';
import { objectStoreContract } from './contract';
import { PostgresObjectStore } from './postgres';

let owned: OwnedDatabase;
let h: DbHandle;
const TENANT = { A: randomUUID(), B: randomUUID() };
const USER = 'user-test';
const clock = { now: new Date('2026-12-01T00:00:00Z') };

beforeAll(async () => {
  owned = await createOwnedDatabase(await getTestDatabaseUrl());
  await migrate(owned.url);
  h = createDb(owned.url);
  const mv = randomUUID();
  await h.db.execute(sql`insert into model_version (id, semver, status, notes, created_at)
    values (${mv}::uuid, '1.0.0', (select min(e.enumlabel) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'model_version_status')::model_version_status, '', now())`);
  for (const [slug, id] of Object.entries(TENANT)) {
    await withTenant(h.db, id, USER, (tx) =>
      tx.execute(sql`insert into tenant (id, slug, name, currency, base_year, target_year, fiscal_calendar, model_version_id, status, created_at)
        values (${id}::uuid, ${'t' + slug}, ${slug}, 'USD', 2025, 2027, 'calendar', ${mv}::uuid,
          (select min(e.enumlabel) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'tenant_status')::tenant_status, now())`),
    );
  }
}, 120_000);

afterAll(async () => {
  await h?.close();
  await owned?.drop();
});

objectStoreContract('postgres', async () => {
  for (const id of Object.values(TENANT)) {
    await withTenant(h.db, id, USER, (tx) => tx.execute(sql`delete from stored_object`));
  }
  clock.now = new Date('2026-12-01T00:00:00Z');
  const now = (): Date => clock.now;
  return {
    store: (t) => new PostgresObjectStore(h.db, TENANT[t], USER, now),
    clock,
    corrupt: async (bucket, key) => {
      await withTenant(h.db, TENANT.A, USER, async (tx) => {
        // Flip a byte, keeping the length so the size check still holds.
        await tx.execute(sql`update stored_object set bytes = set_byte(bytes, 0, (get_byte(bytes, 0) + 1) % 256)
          where bucket = ${bucket} and key = ${key}`);
      });
    },
  };
});

describe('stored_object table (pg-local)', () => {
  it('FORCE RLS: no rows without tenant context, and a wrong-tenant insert is refused', async () => {
    await new PostgresObjectStore(h.db, TENANT.A, USER).put('ai', 'rls', new Uint8Array([1]));
    const none = await h.db.execute(sql`select 1 from stored_object`);
    expect(none.rows).toHaveLength(0);
    await expect(
      withTenant(h.db, TENANT.B, USER, (tx) =>
        tx.execute(sql`insert into stored_object (tenant_id, bucket, key, content_type, bytes, sha256, size)
          values (${TENANT.A}::uuid, 'ai', 'x', 'a/b', '\\x01', repeat('0', 64), 1)`),
      ),
    ).rejects.toThrow();
  });

  it('only the four buckets exist', async () => {
    await expect(
      withTenant(h.db, TENANT.A, USER, (tx) =>
        tx.execute(sql`insert into stored_object (tenant_id, bucket, key, content_type, bytes, sha256, size)
          values (${TENANT.A}::uuid, 'other', 'x', 'a/b', '\\x01', repeat('0', 64), 1)`),
      ),
    ).rejects.toThrow();
  });
});
