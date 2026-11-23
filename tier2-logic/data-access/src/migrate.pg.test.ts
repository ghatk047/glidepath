import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTestDatabaseUrl } from '@glidepath/pg-local';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TRACKING_TABLE, defaultMigrationsDir, listMigrations, migrate } from './migrate';
import { tables } from './schema';
import { createOwnedDatabase, withClient } from './testing/owner-db';
import type { OwnedDatabase } from './testing/owner-db';

let adminUrl: string;
const owned: OwnedDatabase[] = [];
const tmpDirs: string[] = [];

async function freshDb(): Promise<OwnedDatabase> {
  const o = await createOwnedDatabase(adminUrl);
  owned.push(o);
  return o;
}

function migrationDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'gp-migrations-'));
  tmpDirs.push(dir);
  for (const [name, sql] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, sql);
  }
  return dir;
}

const applied = (url: string) =>
  withClient(url, async (c) => (await c.query<{ id: string }>(`SELECT id FROM ${TRACKING_TABLE} ORDER BY applied_at, id`)).rows.map((r) => r.id));

beforeAll(async () => {
  adminUrl = await getTestDatabaseUrl();
}, 120_000);

afterAll(async () => {
  for (const o of owned) await o.drop().catch(() => undefined);
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe('migrate(DATABASE_URL_MIGRATE)', () => {
  it('applies tier3-data/migrations on pg-local as a non-superuser owner, then is idempotent', async () => {
    const db = await freshDb();
    const isSuper = await withClient(db.url, async (c) => (await c.query<{ is_superuser: string }>('SHOW is_superuser')).rows[0]?.is_superuser);
    expect(isSuper).toBe('off');

    const expected = listMigrations(defaultMigrationsDir).map((f) => f.id);
    expect(expected).toContain('0001_schema.sql');

    const first = await migrate(db.url);
    expect(first.applied).toEqual(expected);
    expect(first.skipped).toEqual([]);
    const n = await withClient(db.url, async (c) =>
      (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tenant'`)).rows[0]?.n,
    );
    expect(n).toBe(1);
    expect(await applied(db.url)).toEqual(expected);

    const second = await migrate(db.url);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(expected);
  }, 120_000);

  it('applies generated files in name order, then manual files in name order, recorded in a tracking table', async () => {
    const db = await freshDb();
    const dir = migrationDir({
      '0002_b.sql': 'CREATE TABLE t_b (id int PRIMARY KEY, a_id int REFERENCES t_a (id));',
      '0001_a.sql': 'CREATE TABLE t_a (id int PRIMARY KEY);',
      'manual/0001_m.sql': '-- ADR-023\nALTER TABLE t_b ADD COLUMN extra text;',
      'README.md': 'ignored',
    });
    const r = await migrate(db.url, { dir });
    expect(r.applied).toEqual(['0001_a.sql', '0002_b.sql', 'manual/0001_m.sql']);
    expect(await applied(db.url)).toEqual(['0001_a.sql', '0002_b.sql', 'manual/0001_m.sql']);
  }, 60_000);

  it('picks up only new files on a later run', async () => {
    const db = await freshDb();
    const dir = migrationDir({ '0001_a.sql': 'CREATE TABLE t_a (id int PRIMARY KEY);' });
    await migrate(db.url, { dir });
    writeFileSync(join(dir, '0002_b.sql'), 'CREATE TABLE t_b (id int PRIMARY KEY);');
    const r = await migrate(db.url, { dir });
    expect(r).toEqual({ applied: ['0002_b.sql'], skipped: ['0001_a.sql'] });
  }, 60_000);

  it('a failing file rolls back completely and later runs retry it', async () => {
    const db = await freshDb();
    const dir = migrationDir({
      '0001_a.sql': 'CREATE TABLE t_a (id int PRIMARY KEY);',
      '0002_bad.sql': 'CREATE TABLE t_half (id int); SELECT 1/0;',
    });
    await expect(migrate(db.url, { dir })).rejects.toThrow(/0002_bad\.sql failed/);
    expect(await applied(db.url)).toEqual(['0001_a.sql']);
    const half = await withClient(db.url, async (c) => (await c.query(`SELECT to_regclass('t_half') AS r`)).rows[0]?.r);
    expect(half).toBeNull();
    writeFileSync(join(dir, '0002_bad.sql'), 'CREATE TABLE t_half (id int);');
    // content changed but it never applied, so it simply applies now
    expect((await migrate(db.url, { dir })).applied).toEqual(['0002_bad.sql']);
  }, 60_000);

  it('refuses a changed file that was already applied', async () => {
    const db = await freshDb();
    const dir = migrationDir({ '0001_a.sql': 'CREATE TABLE t_a (id int PRIMARY KEY);' });
    await migrate(db.url, { dir });
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE t_a (id int PRIMARY KEY, x int);');
    await expect(migrate(db.url, { dir })).rejects.toThrow(/checksum mismatch/);
  }, 60_000);

  it('concurrent runs apply each file exactly once', async () => {
    const db = await freshDb();
    const dir = migrationDir({
      '0001_a.sql': 'CREATE TABLE t_a (id int PRIMARY KEY);',
      '0002_b.sql': 'CREATE TABLE t_b (id int PRIMARY KEY);',
    });
    const [x, y] = await Promise.all([migrate(db.url, { dir }), migrate(db.url, { dir })]);
    expect([...x.applied, ...y.applied].sort()).toEqual(['0001_a.sql', '0002_b.sql']);
  }, 60_000);

  it('rejects a missing URL and a missing directory', async () => {
    await expect(migrate('')).rejects.toThrow(/DATABASE_URL_MIGRATE is required/);
    await expect(migrate('postgres://x@127.0.0.1:1/y', { dir: '/nonexistent/migrations' })).rejects.toThrow(/not found/);
  });
});

describe('schema.ts matches the migrated database', () => {
  it('every generated table has the same columns, nullability, types and constraint names as tier3-data/migrations', async () => {
    const db = await freshDb();
    await migrate(db.url);
    await withClient(db.url, async (c) => {
      for (const [name, table] of Object.entries(tables)) {
        const cfg = getTableConfig(table as PgTable);
        expect(cfg.name).toBe(name);

        const cols = await c.query<{ column_name: string; not_null: boolean; type: string }>(
          `SELECT a.attname AS column_name, a.attnotnull AS not_null, format_type(a.atttypid, a.atttypmod) AS type
             FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
          [`public.${name}`],
        );
        expect(cfg.columns.map((x) => x.name)).toEqual(cols.rows.map((r) => r.column_name));
        for (const dbCol of cols.rows) {
          const dc = cfg.columns.find((x) => x.name === dbCol.column_name)!;
          expect(dc.notNull, `${name}.${dbCol.column_name} not null`).toBe(dbCol.not_null);
          const t = dc.getSQLType().replace('bigserial', 'bigint').replace(/^char\(/, 'character(');
          expect(t, `${name}.${dbCol.column_name} type`).toBe(dbCol.type);
        }

        const cons = await c.query<{ conname: string; contype: string }>(
          `SELECT conname, contype FROM pg_constraint WHERE conrelid = $1::regclass`,
          [`public.${name}`],
        );
        const fromDb = (t: string) => cons.rows.filter((r) => r.contype === t).map((r) => r.conname).sort();
        expect(cfg.primaryKeys.map((p) => p.getName()), `${name} pk`).toEqual(fromDb('p'));
        expect(cfg.uniqueConstraints.map((u) => u.name).sort(), `${name} unique`).toEqual(fromDb('u'));
        expect(cfg.foreignKeys.map((f) => f.getName()).sort(), `${name} fk`).toEqual(fromDb('f'));

        const idx = await c.query<{ indexname: string }>(
          `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1
             AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE conrelid = $2::regclass)`,
          [name, `public.${name}`],
        );
        expect(cfg.indexes.map((i) => i.config.name).sort(), `${name} indexes`).toEqual(idx.rows.map((r) => r.indexname).sort());
      }
    });
  }, 120_000);
});
