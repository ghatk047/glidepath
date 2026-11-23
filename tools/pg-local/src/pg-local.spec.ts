import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { clientConfig, getTestDatabaseUrl, start, stop } from './index';

async function query(url: string, sql: string) {
  const c = new pg.Client(clientConfig(url));
  await c.connect();
  try {
    return await c.query(sql);
  } finally {
    await c.end();
  }
}

function tmpState(): string {
  return join(mkdtempSync(join(tmpdir(), 'pgl-state-')), 'state.json');
}

describe('pg-local', () => {
  it('starts a cluster, runs SELECT 1, and stop removes it', async () => {
    const stateFile = tmpState();
    const inst = await start({ stateFile });
    try {
      const r = await query(inst.url, 'SELECT 1 AS one');
      expect(r.rows[0].one).toBe(1);
    } finally {
      expect(stop({ stateFile })).toBe(true);
    }
    expect(existsSync(inst.dir)).toBe(false);
  }, 60_000);

  it('--init runs SQL files as the bootstrap superuser', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pgl-init-'));
    writeFileSync(join(dir, '01_roles.sql'), `CREATE ROLE app_role LOGIN PASSWORD 'x' NOSUPERUSER;`);
    writeFileSync(join(dir, '02_tbl.sql'), `CREATE TABLE t (a int); GRANT SELECT ON t TO app_role;`);
    const stateFile = tmpState();
    const inst = await start({ stateFile, init: dir });
    try {
      const r = await query(inst.url, `SELECT rolname FROM pg_roles WHERE rolname='app_role'`);
      expect(r.rows).toHaveLength(1);
    } finally {
      stop({ stateFile });
    }
  }, 60_000);

  it('--ssl accepts sslmode=require connections', async () => {
    const stateFile = tmpState();
    const inst = await start({ stateFile, ssl: true });
    try {
      expect(inst.url).toContain('sslmode=require');
      const r = await query(inst.url, 'SHOW ssl');
      expect(r.rows[0].ssl).toBe('on');
      const s = await query(inst.url, 'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
      expect(s.rows[0].ssl).toBe(true);
    } finally {
      stop({ stateFile });
    }
  }, 60_000);

  it('works in this environment (root drops to a postgres-owned data dir)', async () => {
    const stateFile = tmpState();
    const inst = await start({ stateFile });
    try {
      const uid = process.getuid?.();
      if (uid === 0) {
        expect(inst.owner).toBe('postgres');
        const owner = execFileSync('stat', ['-c', '%U', join(inst.dir, 'data')], { encoding: 'utf8' }).trim();
        expect(owner).toBe('postgres');
      } else {
        expect(inst.owner).toBeNull();
      }
      expect((await query(inst.url, 'SELECT 1 AS one')).rows[0].one).toBe(1);
    } finally {
      stop({ stateFile });
    }
  }, 60_000);
});

describe('getTestDatabaseUrl env matrix', () => {
  const local = async () => 'local://';
  const container = async () => 'container://';
  const mk = (env: NodeJS.ProcessEnv, docker: boolean) =>
    getTestDatabaseUrl({ env, dockerAvailable: () => docker, startLocal: local, startContainer: container });

  it('TEST_DATABASE_URL wins', async () => {
    expect(await mk({ TEST_DATABASE_URL: 'postgres://x', TESTCONTAINERS: '1' }, true)).toBe('postgres://x');
  });
  it('defaults to pg-local', async () => {
    expect(await mk({}, true)).toBe('local://');
  });
  it('TESTCONTAINERS=1 with a daemon uses the container', async () => {
    expect(await mk({ TESTCONTAINERS: '1' }, true)).toBe('container://');
  });
  it('TESTCONTAINERS=1 without a daemon falls back to pg-local', async () => {
    expect(await mk({ TESTCONTAINERS: '1' }, false)).toBe('local://');
  });
  it('daemon present but TESTCONTAINERS unset uses pg-local', async () => {
    expect(await mk({}, true)).toBe('local://');
  });
  it('real default path starts pg-local and returns a usable url', async () => {
    const url = await getTestDatabaseUrl({ env: {} });
    expect(url).toMatch(/^postgres:\/\//);
    expect((await query(url, 'SELECT 1 AS one')).rows[0].one).toBe(1);
  }, 60_000);
});
