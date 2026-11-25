import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientConfig, getTestDatabaseUrl } from '@glidepath/pg-local';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fictitiousUsers, insertFictitiousUsers, withTestDatabase } from './index';
import type { TestDatabase } from './index';

let serverUrl: string;

async function databaseExists(name: string): Promise<boolean> {
  const u = new URL(serverUrl);
  u.pathname = '/postgres';
  const c = new pg.Client(clientConfig(u.toString()));
  await c.connect();
  try {
    const r = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    return r.rowCount === 1;
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  serverUrl = await getTestDatabaseUrl();
}, 120_000);

describe('withTestDatabase: server selection (TEST_DATABASE_URL, else pg-local, else Testcontainers)', () => {
  it('TEST_DATABASE_URL wins', async () => {
    let started = 0;
    const db = await withTestDatabase({
      migrate: false,
      source: {
        env: { TEST_DATABASE_URL: serverUrl, TESTCONTAINERS: '1' },
        dockerAvailable: () => true,
        startContainer: async () => (started++, 'postgres://unused'),
        startLocal: async () => (started++, 'postgres://unused'),
      },
    });
    try {
      expect(db.adminUrl).toBe(serverUrl);
      expect(started).toBe(0);
    } finally {
      await db.close();
    }
  });

  it('without TEST_DATABASE_URL it starts the pg-local cluster', async () => {
    let local = 0;
    const db = await withTestDatabase({
      migrate: false,
      source: {
        env: {},
        dockerAvailable: () => true,
        startContainer: async () => 'postgres://unused',
        startLocal: async () => (local++, serverUrl),
      },
    });
    try {
      expect(local).toBe(1);
      expect(db.adminUrl).toBe(serverUrl);
    } finally {
      await db.close();
    }
  });

  it('TESTCONTAINERS=1 with a Docker daemon uses Testcontainers; without a daemon it falls back to pg-local', async () => {
    let container = 0;
    let local = 0;
    const deps = (docker: boolean) => ({
      env: { TESTCONTAINERS: '1' } as NodeJS.ProcessEnv,
      dockerAvailable: () => docker,
      startContainer: async () => (container++, serverUrl),
      startLocal: async () => (local++, serverUrl),
    });
    await withTestDatabase({ migrate: false, source: deps(true) }, async () => undefined);
    expect([container, local]).toEqual([1, 0]);
    await withTestDatabase({ migrate: false, source: deps(false) }, async () => undefined);
    expect([container, local]).toEqual([1, 1]);
  });
});

describe('withTestDatabase: migrations, seed, isolation', () => {
  let a: TestDatabase;
  let b: TestDatabase;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'testkit-seed-'));
    writeFileSync(join(dir, '01_marker.sql'), `CREATE TABLE testkit_marker (n int); INSERT INTO testkit_marker VALUES (1);`);
    writeFileSync(join(dir, '02_marker.sql'), `INSERT INTO testkit_marker VALUES (2);`);
    a = await withTestDatabase({
      seed: [dir, async (db) => void (await db.query('INSERT INTO testkit_marker VALUES (3)'))],
    });
    b = await withTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await a?.close();
    await b?.close();
  });

  it('applies the migrations (schema_migration rows, tenant and app_user tables)', async () => {
    const r = await b.query<{ n: string }>(`SELECT count(*)::text AS n FROM schema_migration`);
    expect(Number(r.rows[0]?.n)).toBeGreaterThan(0);
    await b.query('SELECT 1 FROM tenant LIMIT 1');
    await b.query('SELECT 1 FROM app_user LIMIT 1');
  });

  it('runs the optional seed: SQL directory in order, then a function', async () => {
    const r = await a.query<{ n: number }>('SELECT n FROM testkit_marker ORDER BY n');
    expect(r.rows.map((x) => x.n)).toEqual([1, 2, 3]);
  });

  it('isolates per call: separate databases, nothing leaks between them', async () => {
    expect(a.database).not.toBe(b.database);
    await expect(b.query('SELECT 1 FROM testkit_marker')).rejects.toThrow(/testkit_marker/);
  });

  it('connects as a non-superuser owner role', async () => {
    expect(b.role).not.toBeNull();
    const r = await b.query<{ su: boolean; u: string }>(
      `SELECT rolsuper AS su, current_user AS u FROM pg_roles WHERE rolname = current_user`,
    );
    expect(r.rows[0]).toEqual({ su: false, u: b.role });
  });

  it('inserts fictitious users only (reserved .test addresses)', async () => {
    await insertFictitiousUsers(b.url);
    await insertFictitiousUsers(b.url); // idempotent
    const r = await b.query<{ email: string }>('SELECT email FROM app_user ORDER BY email');
    expect(r.rows).toHaveLength(fictitiousUsers.length);
    for (const row of r.rows) expect(row.email).toMatch(/@example\.test$/);
  });

  it('migrate:false leaves the database empty', async () => {
    await withTestDatabase({ migrate: false }, async (db) => {
      await expect(db.query('SELECT 1 FROM tenant')).rejects.toThrow(/tenant/);
    });
  });

  it('close() drops the database and role; the callback form always closes; a failing seed cleans up', async () => {
    const tmp = await withTestDatabase({ migrate: false });
    expect(await databaseExists(tmp.database)).toBe(true);
    await tmp.close();
    await tmp.close();
    expect(await databaseExists(tmp.database)).toBe(false);

    let name = '';
    await withTestDatabase({ migrate: false }, async (db) => {
      name = db.database;
    });
    expect(await databaseExists(name)).toBe(false);

    let failing = '';
    await expect(
      withTestDatabase({
        migrate: false,
        seed: async (db) => {
          failing = db.database;
          throw new Error('seed boom');
        },
      }),
    ).rejects.toThrow('seed boom');
    expect(await databaseExists(failing)).toBe(false);
  });
});
