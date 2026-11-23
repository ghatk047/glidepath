import { execFileSync } from 'node:child_process';
import { chownSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Test database per ADR-016: TEST_DATABASE_URL if set, else a throwaway
 * cluster started with initdb/pg_ctl from /usr/lib/postgresql/16/bin.
 * (tools/pg-local does not exist yet; this is the minimal local equivalent.)
 */

const BIN = process.env.PG_BIN_DIR ?? '/usr/lib/postgresql/16/bin';

export interface PgLocal {
  /** Run SQL (or a file) against a database as the given role; returns stdout (tuples only, unaligned). */
  psql(opts: { db?: string; user?: string; sql?: string; file?: string; singleTransaction?: boolean }): string;
  /** Create a NOSUPERUSER owner role and a database it owns; returns the database name. */
  createOwnedDatabase(db: string, owner: string): void;
  stop(): void;
}

function runAsPostgresIfRoot(cmd: string, args: string[]): string {
  if (process.getuid && process.getuid() === 0) {
    const user = process.env.PG_LOCAL_USER ?? 'postgres';
    return execFileSync('runuser', ['-u', user, '--', cmd, ...args], { encoding: 'utf8' });
  }
  return execFileSync(cmd, args, { encoding: 'utf8' });
}

export function startPgLocal(): PgLocal {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    const u = new URL(external);
    const mk = (db: string, user?: string) => {
      const x = new URL(external);
      x.pathname = `/${db}`;
      if (user) {
        x.username = user;
        x.password = 'gp-test-owner';
      }
      return x.toString();
    };
    return makeClient(mk, u.pathname.slice(1) || 'postgres', () => {});
  }

  const dir = mkdtempSync(join(tmpdir(), 'gp-pg-'));
  if (process.getuid && process.getuid() === 0) {
    const ids = execFileSync('id', ['-u', process.env.PG_LOCAL_USER ?? 'postgres'], { encoding: 'utf8' }).trim();
    const gid = execFileSync('id', ['-g', process.env.PG_LOCAL_USER ?? 'postgres'], { encoding: 'utf8' }).trim();
    chownSync(dir, Number(ids), Number(gid));
  }
  const data = join(dir, 'data');
  const port = 20000 + Math.floor(Math.random() * 20000);
  runAsPostgresIfRoot(join(BIN, 'initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
  runAsPostgresIfRoot(join(BIN, 'pg_ctl'), [
    '-D',
    data,
    '-w',
    '-l',
    join(dir, 'log'),
    '-o',
    `-p ${port} -k ${dir} -c listen_addresses=''`,
    'start',
  ]);
  const cleanup = () => {
    try {
      runAsPostgresIfRoot(join(BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const mk = (db: string, user = 'postgres') => `postgresql://${user}@/${db}?host=${encodeURIComponent(dir)}&port=${port}`;
  return makeClient(mk, 'postgres', cleanup);
}

function makeClient(mk: (db: string, user?: string) => string, adminDb: string, stop: () => void): PgLocal {
  const psql: PgLocal['psql'] = ({ db = adminDb, user, sql, file, singleTransaction }) => {
    const args = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-d', mk(db, user)];
    if (singleTransaction) args.push('-1');
    if (file) args.push('-f', file);
    if (sql) args.push('-c', sql);
    return execFileSync(join(BIN, 'psql'), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  };
  return {
    psql,
    createOwnedDatabase(db, owner) {
      psql({ sql: `CREATE ROLE ${owner} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS PASSWORD 'gp-test-owner'` });
      psql({ sql: `CREATE DATABASE ${db} OWNER ${owner}` });
    },
    stop,
  };
}
