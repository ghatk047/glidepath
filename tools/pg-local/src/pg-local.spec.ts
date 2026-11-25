import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { clientConfig, getTestDatabaseUrl, start, stop, sweepOrphans } from './index';
import type { PgLocalInstance } from './index';

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

// ---------------------------------------------------------------------------------- no leaked clusters

const here = dirname(fileURLToPath(import.meta.url));
/** tsx's ESM loader, so the child is one node process (the `tsx` binary would wrap it in another). */
const TSX_LOADER = pathToFileURL(join(here, '../../../node_modules/tsx/dist/esm/index.mjs')).href;

/**
 * A child process that starts a cluster (`stopOnExit` unless `keep`), prints it, then exits by itself
 * (`exit`) or waits to be killed (`wait`). Resolves once the cluster is up.
 */
const childDirs: string[] = [];
afterAll(() => {
  for (const d of childDirs) rmSync(d, { recursive: true, force: true });
});

async function child(mode: 'exit' | 'wait', keep = false) {
  const dir = mkdtempSync(join(tmpdir(), 'pgl-child-'));
  childDirs.push(dir);
  const script = join(dir, 'child.mts');
  writeFileSync(
    script,
    [
      `import { start } from ${JSON.stringify(join(here, 'index.ts'))};`,
      `const inst = await start({ stateFile: ${JSON.stringify(join(dir, 'state.json'))}, stopOnExit: ${!keep} });`,
      `process.stdout.write(JSON.stringify(inst) + '\\n');`,
      mode === 'exit' ? 'process.exit(0);' : 'setInterval(() => {}, 1000);',
    ].join('\n'),
  );
  const proc = spawn(process.execPath, ['--import', TSX_LOADER, script], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    proc.once('exit', (code, signal) => resolve({ code, signal })),
  );
  let out = '';
  let err = '';
  proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
  const instance = await new Promise<PgLocalInstance>((resolve, reject) => {
    proc.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      const line = out.split('\n')[0];
      if (out.includes('\n') && line) resolve(JSON.parse(line) as PgLocalInstance);
    });
    void exited.then(() => reject(new Error(`child exited before its cluster was up: ${err}`)));
  });
  return { proc, exited, instance, stateFile: join(dir, 'state.json') };
}

/** Does a server still answer on the cluster's port? */
async function answers(inst: PgLocalInstance): Promise<boolean> {
  try {
    await query(inst.url, 'SELECT 1');
    return true;
  } catch {
    return false;
  }
}

describe('pg-local stops and removes its clusters on process exit (DATA-13: no leaked clusters after a test run)', () => {
  it('a process that exits normally stops its cluster and deletes the directory', async () => {
    const c = await child('exit');
    expect(await c.exited).toMatchObject({ code: 0 });
    expect(existsSync(c.instance.dir)).toBe(false);
    expect(existsSync(c.stateFile)).toBe(false);
    expect(await answers(c.instance)).toBe(false);
  }, 60_000);

  it('a process ended by SIGTERM (as a test runner ends its workers) stops its cluster, then dies by the signal', async () => {
    const c = await child('wait');
    expect(await answers(c.instance)).toBe(true);
    c.proc.kill('SIGTERM');
    expect(await c.exited).toMatchObject({ signal: 'SIGTERM' });
    expect(existsSync(c.instance.dir)).toBe(false);
    expect(await answers(c.instance)).toBe(false);
  }, 60_000);

  it('a cluster whose process was SIGKILLed is swept by the next start (sweepOrphans)', async () => {
    const c = await child('wait');
    c.proc.kill('SIGKILL');
    await c.exited;
    expect(existsSync(c.instance.dir)).toBe(true); // nothing could run in the killed process
    expect(sweepOrphans()).toContain(c.instance.dir);
    expect(existsSync(c.instance.dir)).toBe(false);
    expect(await answers(c.instance)).toBe(false);
  }, 60_000);

  it('the CLI\'s cluster (stopOnExit: false) outlives its process until stopped, and is no orphan', async () => {
    const c = await child('exit', true);
    await c.exited;
    try {
      expect(await answers(c.instance)).toBe(true);
      expect(sweepOrphans()).not.toContain(c.instance.dir);
      expect(existsSync(c.instance.dir)).toBe(true);
    } finally {
      expect(stop({ stateFile: c.stateFile })).toBe(true);
    }
    expect(existsSync(c.instance.dir)).toBe(false);
  }, 60_000);
});

