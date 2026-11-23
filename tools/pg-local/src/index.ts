import { execFileSync, spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

export interface StartOptions {
  /** Directory of *.sql files run (sorted) as the bootstrap superuser. */
  init?: string;
  /** Generate a self-signed certificate; the URL gets sslmode=require. */
  ssl?: boolean;
  /** Database to create and put in the URL. */
  database?: string;
  /** Postgres bin directory; defaults to PG_BIN or /usr/lib/postgresql/16/bin. */
  pgBin?: string;
  /** Where the state file lives; defaults to <tmp>/glidepath-pg-local.json. */
  stateFile?: string;
  /**
   * Stop the cluster and delete its directory when this process exits (normally, or on SIGINT, SIGTERM
   * or SIGHUP); a cluster whose process died without that (SIGKILL) is swept by the next `start`.
   * Default true; the CLI passes false, since its cluster outlives `pg:local start`.
   */
  stopOnExit?: boolean;
}

export interface PgLocalInstance {
  url: string;
  port: number;
  dir: string;
  ssl: boolean;
  /** OS user owning the data dir (set when started as root). */
  owner: string | null;
  pgBin: string;
}

export const DEFAULT_PG_BIN = '/usr/lib/postgresql/16/bin';
export const SUPERUSER = 'postgres';
/** Unprivileged OS user used when running as root (initdb refuses root). */
export const ROOT_DROP_USER = 'postgres';

function pgBinDir(opts?: { pgBin?: string }): string {
  return opts?.pgBin ?? process.env.PG_BIN ?? DEFAULT_PG_BIN;
}

function stateFilePath(opts?: { stateFile?: string }): string {
  return opts?.stateFile ?? process.env.PG_LOCAL_STATE ?? join(tmpdir(), 'glidepath-pg-local.json');
}

function isRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

function lookupIds(user: string): { uid: number; gid: number } {
  const uid = Number(execFileSync('id', ['-u', user], { encoding: 'utf8' }).trim());
  const gid = Number(execFileSync('id', ['-g', user], { encoding: 'utf8' }).trim());
  return { uid, gid };
}

/** Run a postgres binary; when root, as the unprivileged `postgres` user. */
function runPg(bin: string, args: string[], drop: { uid: number; gid: number } | null): SpawnSyncReturns<string> {
  const res = spawnSync(bin, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: tmpdir(),
    ...(drop ? { uid: drop.uid, gid: drop.gid, env: { ...process.env, HOME: tmpdir() } } : {}),
  });
  if (res.status !== 0) {
    throw new Error(`${bin} ${args.join(' ')} failed: ${res.stderr || res.stdout || res.error}`);
  }
  return res;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function chownTree(path: string, ids: { uid: number; gid: number }): void {
  chownSync(path, ids.uid, ids.gid);
}

function generateCert(dataDir: string, drop: { uid: number; gid: number } | null): void {
  const key = join(dataDir, 'server.key');
  const crt = join(dataDir, 'server.crt');
  execFileSync(
    'openssl',
    ['req', '-new', '-x509', '-days', '2', '-nodes', '-subj', '/CN=localhost', '-keyout', key, '-out', crt],
    { stdio: 'ignore' },
  );
  chmodSync(key, 0o600);
  if (drop) {
    chownTree(key, drop);
    chownTree(crt, drop);
  }
}

/**
 * node-postgres treats sslmode=require in a URL as verify-full, which rejects
 * the self-signed cert; this keeps TLS on but skips verification.
 */
export function clientConfig(url: string): pg.ClientConfig {
  if (!url.includes('sslmode=require')) return { connectionString: url };
  const u = new URL(url);
  u.searchParams.delete('sslmode');
  return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } };
}

export async function runSqlDir(url: string, dir: string): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const client = new pg.Client(clientConfig(url));
  await client.connect();
  try {
    for (const f of files) {
      await client.query(readFileSync(join(dir, f), 'utf8'));
    }
  } finally {
    await client.end();
  }
  return files;
}

// ---------------------------------------------------------------------------------- cleanup on exit

/** Prefix of every cluster directory under the OS temp dir. */
const DIR_PREFIX = 'glidepath-pg-';
/** In a cluster directory: the pid of the process that stops it on exit (absent for the CLI's). */
const OWNER_FILE = 'owner.json';
const EXIT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/** Clusters this process started with `stopOnExit`, by directory, with their state files. */
const owned = new Map<string, { instance: PgLocalInstance; stateFile: string }>();
let exitHooked = false;

/** Stops every cluster this process still owns (synchronous: it runs in the 'exit' handler). */
export function stopOwned(): number {
  let n = 0;
  for (const { instance, stateFile } of [...owned.values()]) {
    stop({ instance, stateFile });
    n += 1;
  }
  return n;
}

function onSignal(signal: NodeJS.Signals): void {
  stopOwned();
  // Only listener: do what the signal would have done without us (exit by that signal).
  if (process.listenerCount(signal) === 1) {
    for (const s of EXIT_SIGNALS) process.removeListener(s, onSignal);
    process.kill(process.pid, signal);
  }
}

function hookExit(): void {
  if (exitHooked) return;
  exitHooked = true;
  process.on('exit', () => {
    stopOwned();
  });
  for (const s of EXIT_SIGNALS) process.on(s, onSignal);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Stops and deletes the clusters whose owning process is gone (it died by SIGKILL or a crash before its
 * exit handler ran). Clusters without an owner file (the CLI's) and those of live processes stay.
 * Returns the directories removed. `start` runs it first.
 */
export function sweepOrphans(opts: { pgBin?: string } = {}): string[] {
  const removed: string[] = [];
  const base = tmpdir();
  let names: string[];
  try {
    names = readdirSync(base).filter((n) => n.startsWith(DIR_PREFIX));
  } catch {
    return removed;
  }
  for (const name of names) {
    const dir = join(base, name);
    let owner: { pid: number; instance: PgLocalInstance; stateFile: string };
    try {
      owner = JSON.parse(readFileSync(join(dir, OWNER_FILE), 'utf8')) as typeof owner;
    } catch {
      continue; // no owner file: not ours to stop
    }
    if (owner.pid === process.pid || alive(owner.pid)) continue;
    stop({ instance: { ...owner.instance, pgBin: opts.pgBin ?? owner.instance.pgBin }, stateFile: owner.stateFile });
    removed.push(dir);
  }
  return removed;
}

export async function start(opts: StartOptions = {}): Promise<PgLocalInstance> {
  const stateFile = stateFilePath(opts);
  if (existsSync(stateFile)) {
    throw new Error(`pg-local already started (state file ${stateFile}); run stop first`);
  }
  const bin = pgBinDir(opts);
  const stopOnExit = opts.stopOnExit !== false;
  if (stopOnExit) sweepOrphans();
  const drop = isRoot() ? lookupIds(ROOT_DROP_USER) : null;
  const dir = mkdtempSync(join(tmpdir(), DIR_PREFIX));
  if (stopOnExit) {
    // Owned from the start: an exit during initdb or pg_ctl start still stops and deletes it.
    const pending: PgLocalInstance = { url: '', port: 0, dir, ssl: false, owner: drop ? ROOT_DROP_USER : null, pgBin: bin };
    owned.set(dir, { instance: pending, stateFile });
    writeFileSync(join(dir, OWNER_FILE), JSON.stringify({ pid: process.pid, instance: pending, stateFile }));
    hookExit();
  }
  const dataDir = join(dir, 'data');
  const sockDir = join(dir, 'sock');
  mkdirSync(dataDir, { mode: 0o700 });
  mkdirSync(sockDir, { mode: 0o700 });
  chmodSync(dir, 0o755);
  if (drop) {
    chownTree(dir, drop);
    chownTree(dataDir, drop);
    chownTree(sockDir, drop);
  }
  const database = opts.database ?? 'glidepath_test';
  const ssl = opts.ssl === true;
  try {
    runPg(join(bin, 'initdb'), ['-D', dataDir, '-U', SUPERUSER, '--auth=trust', '-E', 'UTF8', '--no-sync'], drop);
    if (ssl) generateCert(dataDir, drop);
    const port = await freePort();
    const serverOpts = [
      `-p ${port}`,
      `-c listen_addresses=127.0.0.1`,
      `-c unix_socket_directories=${sockDir}`,
      `-c fsync=off`,
      `-c synchronous_commit=off`,
      `-c full_page_writes=off`,
      ...(ssl ? ['-c ssl=on'] : []),
    ].join(' ');
    runPg(join(bin, 'pg_ctl'), ['-D', dataDir, '-w', '-l', join(dir, 'server.log'), '-o', serverOpts, 'start'], drop);
    const sslParam = ssl ? '?sslmode=require' : '';
    const base = `postgres://${SUPERUSER}@127.0.0.1:${port}`;
    const admin = new pg.Client(clientConfig(`${base}/postgres${sslParam}`));
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    } finally {
      await admin.end();
    }
    const url = `${base}/${database}${sslParam}`;
    if (opts.init) await runSqlDir(url, opts.init);
    const inst: PgLocalInstance = { url, port, dir, ssl, owner: drop ? ROOT_DROP_USER : null, pgBin: bin };
    writeFileSync(stateFile, JSON.stringify(inst));
    if (stopOnExit) {
      owned.set(dir, { instance: inst, stateFile });
      writeFileSync(join(dir, OWNER_FILE), JSON.stringify({ pid: process.pid, instance: inst, stateFile }));
    }
    return inst;
  } catch (err) {
    owned.delete(dir);
    try {
      runPg(join(bin, 'pg_ctl'), ['-D', dataDir, '-m', 'immediate', 'stop'], drop);
    } catch {
      /* not running */
    }
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

/** Stops the cluster recorded in the state file (or `inst`) and deletes its directory. */
export function stop(opts: { stateFile?: string; instance?: PgLocalInstance } = {}): boolean {
  const stateFile = stateFilePath(opts);
  let inst = opts.instance;
  if (!inst) {
    if (!existsSync(stateFile)) return false;
    inst = JSON.parse(readFileSync(stateFile, 'utf8')) as PgLocalInstance;
  }
  const drop = inst.owner ? lookupIds(inst.owner) : null;
  try {
    runPg(join(inst.pgBin, 'pg_ctl'), ['-D', join(inst.dir, 'data'), '-m', 'fast', '-w', 'stop'], drop);
  } catch {
    /* already stopped */
  }
  rmSync(inst.dir, { recursive: true, force: true });
  rmSync(stateFile, { force: true });
  owned.delete(inst.dir);
  return true;
}

export interface TestDatabaseDeps {
  env?: NodeJS.ProcessEnv;
  dockerAvailable?: () => boolean | Promise<boolean>;
  startContainer?: () => Promise<string>;
  startLocal?: () => Promise<string>;
}

export function dockerDaemonAnswers(): boolean {
  const r = spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 10_000 });
  return r.status === 0;
}

async function startTestcontainer(): Promise<string> {
  const moduleName = 'testcontainers';
  const tc = (await import(/* @vite-ignore */ moduleName)) as {
    GenericContainer: new (image: string) => {
      withEnvironment(e: Record<string, string>): unknown;
      withExposedPorts(p: number): unknown;
      start(): Promise<{ getHost(): string; getMappedPort(p: number): number }>;
    };
  };
  const c = new tc.GenericContainer('postgres:16') as unknown as {
    withEnvironment(e: Record<string, string>): typeof c;
    withExposedPorts(p: number): typeof c;
    start(): Promise<{ getHost(): string; getMappedPort(p: number): number }>;
  };
  const started = await c
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'glidepath_test' })
    .withExposedPorts(5432)
    .start();
  return `postgres://postgres:test@${started.getHost()}:${started.getMappedPort(5432)}/glidepath_test`;
}

let cached: Promise<string> | undefined;

async function startLocalForTests(): Promise<string> {
  const stateFile = join(tmpdir(), `glidepath-pg-local-test-${process.pid}.json`);
  // stopOnExit (the default): stopped and deleted when this process exits.
  const inst = await start({ stateFile });
  return inst.url;
}

/**
 * TEST_DATABASE_URL when set; else Testcontainers when TESTCONTAINERS=1 and a
 * Docker daemon answers; else a throwaway pg-local cluster (stopped on exit).
 */
export async function getTestDatabaseUrl(deps: TestDatabaseDeps = {}): Promise<string> {
  const env = deps.env ?? process.env;
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
  const custom = deps.env !== undefined || deps.startLocal !== undefined || deps.startContainer !== undefined;
  if (!custom && cached) return cached;
  const run = async (): Promise<string> => {
    if (env.TESTCONTAINERS === '1' && (await (deps.dockerAvailable ?? dockerDaemonAnswers)())) {
      return (deps.startContainer ?? startTestcontainer)();
    }
    return (deps.startLocal ?? startLocalForTests)();
  };
  const p = run();
  if (!custom) cached = p;
  return p;
}
