import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { clientConfig, start, stop, type PgLocalInstance } from '@glidepath/pg-local';
import { migrationsDir, repoRoot } from '../spec';

/**
 * Test database per ADR-016.
 *
 * - TEST_DATABASE_URL set (CI: a shared Postgres 16 service, superuser URL): a
 *   fresh database per test file on that server, bootstrapped by running
 *   tier3-data/postgres/init in it (as `pg:local start --init` does), dropped at stop.
 * - Otherwise a throwaway cluster: `pnpm pg:local start --init tier3-data/postgres/init --db <name>`.
 *
 * Roles are cluster-wide and other test files may run concurrently on a shared
 * server, so tests must never rename, drop or re-privilege glidepath_app /
 * glidepath_owner: use throwaway roles for negative cases.
 */

/** Local role bootstrap (DATA-02): creates glidepath_owner and glidepath_app. */
export const initDir = resolve(repoRoot, 'tier3-data/postgres/init');

/** Login password the tests give the bootstrap roles (pg-local and CI trust; other servers may not). */
export const TEST_ROLE_PASSWORD = 'gp-test-role';

export interface Session {
  /** Rows as `psql -At` prints them: columns joined by '|', rows by '\n', NULL as ''. */
  q(sql: string, params?: unknown[]): Promise<string>;
  query(sql: string, params?: unknown[]): Promise<pg.QueryResult>;
  /** Notices and warnings received on this connection. */
  notices: string[];
}

export interface TestCluster {
  /** The bootstrapped database (random suffix). */
  database: string;
  url(database: string, role?: string): string;
  /** One connection as `role` (default: the admin of the server) to `database` (default: the bootstrapped one). */
  withSession<T>(
    opts: { role?: string; database?: string },
    fn: (s: Session) => Promise<T>,
  ): Promise<T>;
  /** One-shot query, trimmed text. */
  q(sql: string, opts?: { role?: string; database?: string; params?: unknown[] }): Promise<string>;
  /** Applies migration files from tier3-data/migrations (simple query: one implicit transaction per file). */
  migrate(files: string[], opts?: { role?: string; database?: string }): Promise<void>;
  /** Runs `fn` holding the cluster-wide role lock (for anything that changes glidepath_* roles). */
  withRoleLock<T>(fn: () => Promise<T> | T): Promise<T>;
  stop(): Promise<void>;
}

// Every value as its text form, like psql.
const asText = { getTypeParser: () => (v: string) => v };

function rowsAsText(r: pg.QueryResult): string {
  return r.rows
    .map((row: Record<string, unknown>) =>
      Object.values(row)
        .map((v) => (v === null ? '' : String(v)))
        .join('|'),
    )
    .join('\n');
}

function urlFor(base: string, database: string, role?: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  if (role) {
    u.username = role;
    u.password = TEST_ROLE_PASSWORD;
  }
  return u.toString();
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client(clientConfig(url));
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/**
 * Runs `fn` while holding the role lock. Concurrent writes to the same role fail
 * ("tuple concurrently updated"), and advisory locks are per database, so every
 * test file takes it in the server's own database (`adminUrl`), not its fresh one.
 */
export async function withRoleLock<T>(
  adminUrl: string,
  fn: (c: pg.Client) => Promise<T>,
): Promise<T> {
  return withClient(adminUrl, async (c) => {
    await c.query('BEGIN');
    try {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('glidepath.test.roles'))`);
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
  });
}

/** Cluster-wide roles (01_roles.sql only touches roles), plus a login password where none is set. */
async function bootstrapRoles(adminUrl: string): Promise<void> {
  await withRoleLock(adminUrl, async (c) => {
    await c.query(readFileSync(join(initDir, '01_roles.sql'), 'utf8'));
    for (const role of ['glidepath_owner', 'glidepath_app']) {
      const r = await c.query(
        `SELECT rolpassword IS NULL AS missing FROM pg_authid WHERE rolname = $1`,
        [role],
      );
      if (r.rows[0]?.missing) await c.query(`ALTER ROLE ${role} PASSWORD '${TEST_ROLE_PASSWORD}'`);
    }
  });
}

/** The rest of the init folder, in the test database (hands it to glidepath_owner). */
async function initDatabase(url: string): Promise<void> {
  await withClient(url, async (c) => {
    for (const f of readdirSync(initDir)
      .filter((x) => x.endsWith('.sql') && x !== '01_roles.sql')
      .sort()) {
      await c.query(readFileSync(join(initDir, f), 'utf8'));
    }
  });
}

export async function startTestCluster(prefix: string): Promise<TestCluster> {
  const database = `${prefix}_${randomBytes(4).toString('hex')}`;
  const external = process.env.TEST_DATABASE_URL;
  let base: string;
  let cleanup: () => Promise<void>;
  if (external) {
    base = external;
    // As `pg:local start --init` would: roles first (cluster-wide, serialised), then this database.
    await bootstrapRoles(external);
    await withClient(external, (c) => c.query(`CREATE DATABASE ${database}`));
    await initDatabase(urlFor(base, database));
    cleanup = () =>
      withClient(external, (c) => c.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)).then(
        () => undefined,
      );
  } else {
    const stateDir = mkdtempSync(join(tmpdir(), 'gp-gen-schema-'));
    const stateFile = join(stateDir, 'state.json');
    // == pnpm pg:local start --init tier3-data/postgres/init --db <database>
    const inst: PgLocalInstance = await start({ init: initDir, database, stateFile });
    base = inst.url;
    await bootstrapRoles(urlFor(base, 'postgres')); // roles exist already; sets the test passwords
    cleanup = async () => {
      stop({ instance: inst, stateFile });
      rmSync(stateDir, { recursive: true, force: true });
    };
  }

  const adminUrl = external ?? urlFor(base, 'postgres');
  const adminRole = decodeURIComponent(new URL(base).username);
  const url = (db: string, role?: string) =>
    urlFor(base, db, role && role !== adminRole ? role : undefined);
  const withSession: TestCluster['withSession'] = async ({ role, database: db = database }, fn) => {
    const c = new pg.Client({ ...clientConfig(url(db, role)), types: asText });
    const notices: string[] = [];
    c.on('notice', (n) => notices.push(`${n.severity ?? ''}: ${n.message}`));
    await c.connect();
    try {
      return await fn({
        q: async (sql, params) => rowsAsText(await c.query(sql, params)),
        query: (sql, params) => c.query(sql, params),
        notices,
      });
    } finally {
      await c.end();
    }
  };
  return {
    database,
    url,
    withSession,
    q: (sql, opts = {}) => withSession(opts, (s) => s.q(sql, opts.params)).then((x) => x.trim()),
    migrate: (files, opts = {}) =>
      withSession(opts, async (s) => {
        for (const f of files) await s.query(readFileSync(resolve(migrationsDir, f), 'utf8'));
      }),
    withRoleLock: (fn) => withRoleLock(adminUrl, async () => fn()),
    stop: cleanup,
  };
}

/** Awaits `p` and returns the Postgres error it fails with (throws if it succeeds). */
export async function sqlError(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { code: err.code ?? '', message: err.message ?? String(e) };
  }
  throw new Error('expected the statement to fail, but it succeeded');
}
