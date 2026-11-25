// OPS-07: ops/backup.sh and ops/restore.sh against a real throwaway Postgres 16 (pg-local, TLS on,
// so every URL is sslmode=require). The schema is migrated as glidepath_owner exactly like the
// compose `migrate` service does; the owner is given BYPASSRLS to stand for the managed-Postgres
// owner role (pg_dump cannot read FORCE-RLS tenant tables otherwise, see the exit-3 test).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start, stop, type PgLocalInstance } from '@glidepath/pg-local';
import { REPO_ROOT } from '../src/index';

const PG_BIN = process.env.PG_BIN ?? '/usr/lib/postgresql/16/bin';
const HAVE_PG = existsSync(join(PG_BIN, 'initdb')) && existsSync(join(PG_BIN, 'pg_dump'));
const BACKUP = join(REPO_ROOT, 'ops/backup.sh');
const RESTORE = join(REPO_ROOT, 'ops/restore.sh');

const TENANT = '00000000-0000-0000-0000-0000000000b1';
const MODEL = '00000000-0000-0000-0000-0000000000a1';
/** calc_run.scenario_id names a scenario of its tenant (DATA-12 composite FK). */
const SCENARIO = '00000000-0000-0000-0000-0000000000c1';
const OWNER_PW = 'ownerpw';
const APP_PW = 'apppw';

let inst: PgLocalInstance;
let stateFile: string;
let workDir: string;
let ownerUrl: string;
let appUrl: string;
let rtUrl: string; // empty second database: "clean volumes"

function withUser(url: string, user: string, pw: string, db?: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = pw;
  if (db) u.pathname = `/${db}`;
  return u.toString();
}

function sh(cmd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    env: { ...process.env, PG_BIN, DATABASE_URL_MIGRATE: '', DATABASE_URL_BACKUP: '', ...env },
    cwd: workDir,
  });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

function psql(url: string, sql: string): string {
  const r = spawnSync(join(PG_BIN, 'psql'), ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', url, '-c', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim();
}

function psqlFile(url: string, file: string): void {
  const r = spawnSync(join(PG_BIN, 'psql'), ['-X', '-q', '-v', 'ON_ERROR_STOP=1', url, '-f', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`psql ${file} failed: ${r.stderr}`);
}

function backupDirs(root: string): string[] {
  return existsSync(root) ? readdirSync(root).sort() : [];
}

function manifest(dir: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of readFileSync(join(dir, 'manifest.txt'), 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) m.set(line.slice(0, i), line.slice(i + 1));
  }
  return m;
}

describe.skipIf(!HAVE_PG)('ops/backup.sh and ops/restore.sh (OPS-07)', () => {
  let backupRoot: string;
  let firstBackup: string;
  let preCalc: string;
  let preObjects: string;

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'glidepath-ops07-'));
    stateFile = join(workDir, 'pg.json');
    inst = await start({ ssl: true, init: join(REPO_ROOT, 'tier3-data/postgres/init'), stateFile });
    psql(inst.url, `alter role glidepath_owner password '${OWNER_PW}' bypassrls`);
    psql(inst.url, `alter role glidepath_app password '${APP_PW}'`);
    ownerUrl = withUser(inst.url, 'glidepath_owner', OWNER_PW);
    appUrl = withUser(inst.url, 'glidepath_app', APP_PW);
    psql(inst.url.replace('/glidepath_test', '/postgres'), 'create database rt owner glidepath_owner');
    rtUrl = withUser(inst.url, 'glidepath_owner', OWNER_PW, 'rt');
    expect(inst.url).toContain('sslmode=require');

    const mig = join(REPO_ROOT, 'tier3-data/migrations');
    const files = [
      ...readdirSync(mig).filter((f) => f.endsWith('.sql')).sort().map((f) => join(mig, f)),
      ...readdirSync(join(mig, 'manual')).filter((f) => f.endsWith('.sql')).sort().map((f) => join(mig, 'manual', f)),
    ];
    for (const f of files) psqlFile(ownerUrl, f);

    // seed: one tenant, one scenario, one calc_run with outputs C, two stored objects (a workbook and an AI file)
    const seed = join(workDir, 'seed.sql');
    writeFileSync(
      seed,
      `insert into model_version values ('${MODEL}','1.0.0','published','n',now());
       insert into tenant values ('${TENANT}','t1','Tenant One','USD',2025,2027,'cal',null,'${MODEL}','active',now());
       select set_config('app.tenant_id','${TENANT}',false);
       insert into scenario (tenant_id,id,key,label,kind,parent_id,model_version_id,version,locked,created_by,created_at)
         values ('${TENANT}','${SCENARIO}','s1','S1','user',null,'${MODEL}',1,false,gen_random_uuid(),now());
       insert into calc_run values ('${TENANT}',gen_random_uuid(),'${SCENARIO}',1,'${MODEL}','h',5,'{"C":123456.789}',now());
       insert into stored_object(tenant_id,bucket,key,content_type,bytes,sha256,size) values
         ('${TENANT}','exports','wb1.xlsx','application/octet-stream','\\x504b0304',repeat('a',64),4),
         ('${TENANT}','ai','ctx1.json','application/json','\\x7b7d',repeat('b',64),2);`,
    );
    psqlFile(ownerUrl, seed);
    preCalc = psql(ownerUrl, `select outputs->>'C' from calc_run`);
    preObjects = psql(ownerUrl, `select count(*) from stored_object`);
    expect(preObjects).toBe('2');
  }, 120_000);

  afterAll(() => {
    if (inst) stop({ stateFile });
  });

  // acceptance 1: pg_dump custom format via DATABASE_URL_MIGRATE into ./backups/<timestamp>/; the dump covers stored objects
  it('backup writes a custom-format pg_dump to ./backups/<timestamp>/ that includes stored_object rows', () => {
    const r = sh(BACKUP, [], { DATABASE_URL_MIGRATE: ownerUrl });
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    backupRoot = join(workDir, 'backups'); // relative to cwd
    const dirs = backupDirs(backupRoot);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toMatch(/^\d{8}T\d{6}Z$/);
    firstBackup = join(backupRoot, dirs[0] as string);
    expect(r.out).toContain(`backup: OK: ./backups/${dirs[0]}`);
    expect(r.out).not.toContain(OWNER_PW); // the password is never printed

    const dump = join(firstBackup, 'glidepath.dump');
    expect(readFileSync(dump).subarray(0, 5).toString()).toBe('PGDMP'); // custom format
    const toc = spawnSync(join(PG_BIN, 'pg_restore'), ['--list', dump], { encoding: 'utf8' });
    expect(toc.stdout).toMatch(/TABLE DATA public stored_object/);
    expect(toc.stdout).toMatch(/TABLE DATA public calc_run/);
    const data = spawnSync(join(PG_BIN, 'pg_restore'), ['--data-only', '-t', 'stored_object', '-f', '-', dump], { encoding: 'utf8' });
    expect(data.stdout).toContain('wb1.xlsx');
    expect(data.stdout).toContain('ctx1.json');

    const m = manifest(firstBackup);
    expect(m.get('stored_object_count')).toBe('2');
    expect(m.get('calc_run_count')).toBe('1');
    expect(m.get('tenant_count')).toBe('1');
    expect(m.get('format')).toBe('pg_dump-custom');
  }, 60_000);

  it('picks the database from DATABASE_URL_MIGRATE in .env when the environment has none', () => {
    const envFile = join(workDir, 'dotenv');
    writeFileSync(envFile, `OWNER_DB_PASSWORD=${OWNER_PW}\nDATABASE_URL_MIGRATE=${ownerUrl.replace(`:${OWNER_PW}@`, ':${OWNER_DB_PASSWORD}@')}\n`);
    const out = join(workDir, 'bk-env');
    const r = sh(BACKUP, ['--env-file', envFile, '--dir', out]);
    expect(r.code).toBe(0);
    expect(backupDirs(out)).toHaveLength(1);
  }, 60_000);

  // acceptance 2: restore into a clean database; C and object counts equal the pre-backup values
  it('restore into an empty database gives back C and the stored-object count', () => {
    expect(psql(rtUrl, `select count(*) from pg_tables where schemaname='public'`)).toBe('0');
    const r = sh(RESTORE, [firstBackup], { DATABASE_URL_MIGRATE: rtUrl });
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('restore: OK');
    expect(psql(rtUrl, `select outputs->>'C' from calc_run`)).toBe(preCalc);
    expect(psql(rtUrl, `select count(*) from stored_object`)).toBe(preObjects);
    expect(psql(rtUrl, `select encode(bytes,'hex') from stored_object where key='wb1.xlsx'`)).toBe('504b0304');
    // RLS survived: still forced, and the app role reads through its grants (re-applied from grants.sql)
    expect(psql(rtUrl, `select relforcerowsecurity from pg_class where relname='stored_object'`)).toBe('t');
    expect(psql(rtUrl, `select has_table_privilege('glidepath_app','calc_run','select'), has_table_privilege('glidepath_app','audit_log','update')`)).toBe('t|f');
    expect(psql(rtUrl, `select count(*) from pg_policies where tablename='stored_object'`)).toBe('1');
  }, 120_000);

  it('restore refuses a non-empty database without --yes, and `latest` with --yes replaces it', () => {
    const refused = sh(RESTORE, ['--dir', backupRoot, 'latest'], { DATABASE_URL_MIGRATE: rtUrl });
    expect(refused.code).toBe(4);
    expect(refused.err).toContain('--yes');
    const ok = sh(RESTORE, ['--yes', '--dir', backupRoot, 'latest'], { DATABASE_URL_MIGRATE: rtUrl });
    expect(ok.code).toBe(0);
  }, 120_000);

  it('restore stops on a dump that does not match its manifest', () => {
    const bad = join(workDir, 'bad');
    spawnSync('cp', ['-R', firstBackup, bad]);
    writeFileSync(join(bad, 'glidepath.dump'), 'tampered');
    const r = sh(RESTORE, [bad], { DATABASE_URL_MIGRATE: rtUrl });
    expect(r.code).toBe(1);
    expect(r.err).toContain('sha256');
  });

  // acceptance 3: --no-owner --no-privileges, non-superuser URL, sslmode=require
  it('works as a non-superuser over sslmode=require, with --no-owner --no-privileges', () => {
    expect(ownerUrl).toContain('sslmode=require');
    expect(psql(ownerUrl, `select rolsuper from pg_roles where rolname=current_user`)).toBe('f');
    // pg_dump -x leaves ACLs out of the archive; -O applies at restore time (archive formats), which
    // the scripts pass to pg_restore: no ALTER ... OWNER TO is ever executed
    expect(readFileSync(BACKUP, 'utf8')).toContain('--no-owner');
    expect(readFileSync(join(REPO_ROOT, 'ops/pg-common.sh'), 'utf8')).toMatch(/pg_restore --no-owner --no-privileges/);
    const schema = spawnSync(join(PG_BIN, 'pg_restore'), ['--schema-only', '--no-owner', '-f', '-', join(firstBackup, 'glidepath.dump')], { encoding: 'utf8' });
    expect(schema.stdout).not.toMatch(/OWNER TO/);
    expect(schema.stdout).not.toMatch(/^GRANT /m);
    expect(schema.stdout).not.toMatch(/^REVOKE /m);
    // privileges travel separately and are re-applied by restore
    expect(readFileSync(join(firstBackup, 'grants.sql'), 'utf8')).toMatch(/GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public\.stored_object TO glidepath_app/);
  });

  it('stops (exit 3) rather than write a dump with missing tenant rows when the role cannot bypass RLS', () => {
    const out = join(workDir, 'bk-app');
    const r = sh(BACKUP, ['--dir', out], { DATABASE_URL_MIGRATE: appUrl });
    expect(r.code).toBe(3);
    expect(r.err).toContain('row-level security');
    expect(backupDirs(out)).toHaveLength(0);
  });

  it('is bash 3.2 safe and shellcheck-clean', () => {
    for (const f of ['backup.sh', 'restore.sh', 'pg-common.sh']) {
      const text = readFileSync(join(REPO_ROOT, 'ops', f), 'utf8');
      expect(text, f).not.toMatch(/declare -A|mapfile|readarray|\$\{[A-Za-z_]+(,,|\^\^)\}|&>>|\s\|&\s/);
      const bash = spawnSync('bash', ['-n', join(REPO_ROOT, 'ops', f)], { encoding: 'utf8' });
      expect(bash.status, `${f}: ${bash.stderr}`).toBe(0);
    }
    const sc = spawnSync('shellcheck', ['-x', '--source-path=SCRIPTDIR', BACKUP, RESTORE, join(REPO_ROOT, 'ops/pg-common.sh')], { encoding: 'utf8' });
    if (sc.error === undefined) expect(sc.stdout).toBe('');
  });
});
