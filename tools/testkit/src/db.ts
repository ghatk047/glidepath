import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from '@glidepath/data-access';
import { clientConfig, getTestDatabaseUrl } from '@glidepath/pg-local';
import type { TestDatabaseDeps } from '@glidepath/pg-local';
import pg from 'pg';

/**
 * Per-test-file database harness (ADR-016).
 *
 * Server: `TEST_DATABASE_URL` if set, else Testcontainers when `TESTCONTAINERS=1`
 * and a Docker daemon answers, else a throwaway pg-local cluster (all three
 * decided by `getTestDatabaseUrl` of `@glidepath/pg-local`).
 *
 * Isolation: one fresh database per call, owned by a fresh NON-superuser role
 * (as `glidepath_owner` is on Neon), dropped on `close()`. When the server URL's
 * role may not create roles, the database is created owned by that role instead.
 */
/** A seed step: path of a `.sql` file or directory, or an async function. */
export type TestSeed = string | ((db: TestDatabase) => Promise<void>);

export interface TestDatabaseOptions {
  /** Apply `tier3-data/migrations` (default true). */
  migrate?: boolean;
  /** Migrations directory (default: the repository's `tier3-data/migrations`). */
  migrationsDir?: string;
  /**
   * Optional seed, run after migrations as the owner role: a `.sql` file, a directory of
   * `*.sql` files (sorted), a list of those, or an async function.
   */
  seed?: TestSeed | TestSeed[];
  /** Overrides how the server URL is chosen (tests inject fakes here). */
  source?: TestDatabaseDeps;
}

export interface TestDatabase {
  /** URL of the owner role on the fresh database (use as DATABASE_URL / DATABASE_URL_MIGRATE). */
  url: string;
  /** URL used to create the database (superuser or creator role of the server). */
  adminUrl: string;
  database: string;
  /** The owner role, or null when the server URL's own role owns the database. */
  role: string | null;
  /** Runs `fn` with a connected node-postgres client as the owner role. */
  withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T>;
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
  /** Drops the database and role. Idempotent. */
  close(): Promise<void>;
}

const quoteIdent = (s: string): string => `"${s.replace(/"/g, '""')}"`;

async function withAdmin<T>(adminUrl: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client(clientConfig(adminUrl));
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function runSeedPath(url: string, path: string): Promise<void> {
  const files = statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((f) => join(path, f))
    : [path];
  const c = new pg.Client(clientConfig(url));
  await c.connect();
  try {
    for (const f of files) await c.query(readFileSync(f, 'utf8'));
  } finally {
    await c.end();
  }
}

async function createDatabase(opts: TestDatabaseOptions): Promise<TestDatabase> {
  const adminUrl = await getTestDatabaseUrl(opts.source);
  const suffix = randomBytes(5).toString('hex');
  const database = `gp_test_${suffix}`;
  const wantedRole = `gp_owner_${suffix}`;
  const password = randomBytes(12).toString('hex');
  let role: string | null = null;
  await withAdmin(adminUrl, async (admin) => {
    // glidepath_owner / glidepath_app (cluster-wide, idempotent): tier3-data/migrations/0002_rls.sql grants to them (DATA-02).
    await admin.query(readFileSync(new URL('../../../tier3-data/postgres/init/01_roles.sql', import.meta.url), 'utf8'));
    try {
      await admin.query(
        `CREATE ROLE ${quoteIdent(wantedRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`,
      );
      role = wantedRole;
    } catch (err) {
      if ((err as { code?: string }).code !== '42501') throw err; // insufficient_privilege
    }
    const owner = role ? ` OWNER ${quoteIdent(role)}` : '';
    await admin.query(`CREATE DATABASE ${quoteIdent(database)}${owner}`);
  });
  const u = new URL(adminUrl);
  if (role) {
    u.username = role;
    u.password = password;
  }
  u.pathname = `/${database}`;
  const url = u.toString();
  /** Admin connection for drop: the maintenance database, not the one being dropped. */
  const adminOfNew = new URL(adminUrl);
  adminOfNew.pathname = '/postgres';

  let closed = false;
  const handle: TestDatabase = {
    url,
    adminUrl,
    database,
    role,
    async withClient(fn) {
      const c = new pg.Client(clientConfig(url));
      await c.connect();
      try {
        return await fn(c);
      } finally {
        await c.end();
      }
    },
    query(sql, params) {
      return handle.withClient((c) => c.query(sql, params as unknown[]));
    },
    async close() {
      if (closed) return;
      closed = true;
      await withAdmin(adminOfNew.toString(), async (admin) => {
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`);
        if (role) await admin.query(`DROP ROLE IF EXISTS ${quoteIdent(role)}`);
      });
    },
  };

  try {
    if (opts.migrate !== false) {
      await migrate(url, opts.migrationsDir ? { dir: opts.migrationsDir } : {});
    }
    const seeds: TestSeed[] = opts.seed === undefined ? [] : Array.isArray(opts.seed) ? opts.seed : [opts.seed];
    for (const s of seeds) {
      if (typeof s === 'function') await s(handle);
      else await runSeedPath(url, s);
    }
  } catch (err) {
    await handle.close().catch(() => undefined);
    throw err;
  }
  return handle;
}

/**
 * A fresh, migrated (and optionally seeded) database.
 *
 * - `withTestDatabase(opts?)` returns the handle; call `close()` in `afterAll`.
 * - `withTestDatabase(opts, fn)` runs `fn(db)` and always drops the database after.
 */
export function withTestDatabase(opts?: TestDatabaseOptions): Promise<TestDatabase>;
export function withTestDatabase<T>(opts: TestDatabaseOptions, fn: (db: TestDatabase) => Promise<T>): Promise<T>;
export async function withTestDatabase<T>(
  opts: TestDatabaseOptions = {},
  fn?: (db: TestDatabase) => Promise<T>,
): Promise<TestDatabase | T> {
  const db = await createDatabase(opts);
  if (!fn) return db;
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}
