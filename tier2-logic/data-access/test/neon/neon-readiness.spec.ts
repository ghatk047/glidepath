import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientConfig, start, stop } from '@glidepath/pg-local';
import type { PgLocalInstance } from '@glidepath/pg-local';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db';
import type { DbHandle } from '../../src/db';
import {
  createExportJob,
  createTenantChangesetStore,
  findMyMembership,
  getCurrentUser,
  getExportJob,
  getLatestCalcRun,
  getScenario,
  getTenant,
  listChangesetHistory,
  listMyMemberships,
  listScenarios,
  listTenantMembers,
  loadEditsCounts,
  loadMembers,
  loadModelDefs,
  loadResolvedInputs,
  PostgresObjectStore,
  sql,
  withTenant,
  withUser,
} from '../../src/index';
import { recordQueries } from '../../src/testing/app-db';
import type { RecordedQuery } from '../../src/testing/app-db';

/**
 * DATA-09 (ADR-015): everything Neon needs, proved on pg-local --ssl. The cluster is bootstrapped like a
 * fresh Neon project: two plain roles (glidepath_owner, glidepath_app: no SUPERUSER, CREATEROLE,
 * BYPASSRLS), a database owned by glidepath_owner, TLS on. Tests share the database and run in order:
 * first the migrate entry (migrations + AA seed) as the owner over sslmode=require, then the runtime as
 * the app role, over a direct connection, with prepared statements off, and through pgbouncer in
 * transaction mode when the binary exists.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const tier3Data = join(repoRoot, 'tier3-data');
const srcDir = resolve(here, '../../src');

let instance: PgLocalInstance;
let stateFile: string;
let ownerUrl: string;
let appUrl: string;
let tenantId = '';
let userId = '';
let scenarioId = '';

const asRole = (url: string, role: string): string => {
  const u = new URL(url);
  u.username = role;
  return u.toString();
};

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
 * The migrate entry of the compose `migrate` service (`runMigrate`: migrations, model definitions, AA seed
 * through applyChangeset), run in its own process with only the environment Neon gives: DATABASE_URL_MIGRATE.
 * Not imported (worker depends on data-access). The pg-boss queue install that follows it in `migrate.js`
 * is a separate step with its own driver; see docs/ops/neon.md.
 */
const SEED_SCRIPT = `
const { runMigrate } = await import(process.env.GP_RUN_MODULE);
const report = await runMigrate({
  databaseUrl: process.env.DATABASE_URL_MIGRATE, seed: 'aa', tier3Data: process.env.TIER3_DATA_DIR,
  demoUserEmail: 'demo@example.com', log: (m) => console.log(m),
});
console.log('migrate: done, ' + report.changes + ' changes');
`;

function runMigrateEntry(databaseUrlMigrate: string): { status: number | null; out: string } {
  const tsx = join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'gp-neon-seed-'));
  const script = join(dir, 'seed.mjs');
  writeFileSync(script, SEED_SCRIPT);
  const r = spawnSync(process.execPath, [tsx, script], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 240_000,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      DATABASE_URL_MIGRATE: databaseUrlMigrate,
      TIER3_DATA_DIR: tier3Data,
      GP_RUN_MODULE: join(repoRoot, 'tier2-logic/worker/src/seed/run.ts'),
    },
  });
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

beforeAll(async () => {
  stateFile = join(tmpdir(), `gp-neon-ready-${process.pid}.json`);
  instance = await start({ ssl: true, stateFile, init: join(tier3Data, 'postgres/init') });
  ownerUrl = asRole(instance.url, 'glidepath_owner');
  appUrl = asRole(instance.url, 'glidepath_app');
}, 120_000);

afterAll(() => {
  if (instance) stop({ instance, stateFile });
});

describe('migrations and tenant seed over sslmode=require', () => {
  it('the URLs ask for TLS and the roles are plain (Neon: no superuser anywhere)', async () => {
    expect(ownerUrl).toContain('sslmode=require');
    expect(appUrl).toContain('sslmode=require');
    await withClient(instance.url, async (c) => {
      const r = await c.query<{ rolname: string; rolsuper: boolean; rolcreaterole: boolean; rolbypassrls: boolean }>(
        `select rolname, rolsuper, rolcreaterole, rolbypassrls from pg_roles where rolname in ('glidepath_owner','glidepath_app')`,
      );
      expect(r.rows).toHaveLength(2);
      for (const role of r.rows) {
        expect(role.rolsuper, role.rolname).toBe(false);
        expect(role.rolcreaterole, role.rolname).toBe(false);
        expect(role.rolbypassrls, role.rolname).toBe(false);
      }
    });
  });

  it('migrate entry as glidepath_owner (DATABASE_URL_MIGRATE) applies migrations and the tenant seed, twice', async () => {
    const first = runMigrateEntry(ownerUrl);
    expect(first.status, first.out).toBe(0);
    expect(first.out).toContain('migrate: done');
    expect(first.out).toMatch(/migrate: tenant aa:/);

    await withClient(ownerUrl, async (c) => {
      const ssl = await c.query<{ ssl: boolean }>('select ssl from pg_stat_ssl where pid = pg_backend_pid()');
      expect(ssl.rows[0]?.ssl).toBe(true);
      const mig = await c.query<{ n: number }>('select count(*)::int as n from schema_migration');
      expect(mig.rows[0]!.n).toBeGreaterThan(0);
      const t = await c.query<{ n: number }>('select count(*)::int as n from model_version');
      expect(t.rows[0]!.n).toBe(1);
    });

    const again = runMigrateEntry(ownerUrl);
    expect(again.status, again.out).toBe(0);
    expect(again.out).toContain('migrate: done, 0 changes');
  }, 300_000);
});

describe('runtime as glidepath_app (login role, no SET ROLE)', () => {
  let app: DbHandle;
  let log: RecordedQuery[];

  beforeAll(async () => {
    // the demo user comes from a global table; everything below goes through RLS
    await withClient(ownerUrl, async (c) => {
      const u = await c.query<{ id: string }>(`select id from app_user where email = 'demo@example.com'`);
      userId = u.rows[0]!.id;
    });
    app = createDb(appUrl, { poolMax: 3 });
    log = recordQueries(app.pool);
    const m = await withUser(app.db, userId, (tx) => findMyMembership(tx, 'aa'));
    expect(m).not.toBeNull();
    tenantId = m!.tenant.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('the connection is the app role, over TLS, without SUPERUSER, CREATEROLE or BYPASSRLS', async () => {
    const r = await app.db.execute<{
      u: string;
      ssl: boolean;
      super: boolean;
      createrole: boolean;
      bypass: boolean;
    }>(sql`
      select current_user as u, (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as ssl,
             r.rolsuper as super, r.rolcreaterole as createrole, r.rolbypassrls as bypass
      from pg_roles r where r.rolname = current_user`);
    expect(r.rows[0]).toEqual({ u: 'glidepath_app', ssl: true, super: false, createrole: false, bypass: false });
    const m = await app.db.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_auth_members am join pg_roles g on g.oid = am.roleid
      where am.member = (select oid from pg_roles where rolname = current_user)
        and (g.rolsuper or g.rolcreaterole or g.rolbypassrls)`);
    expect(m.rows[0]!.n).toBe(0);
  });

  it('full repository suite passes as that role', async () => {
    const mine = await withUser(app.db, userId, (tx) => listMyMemberships(tx));
    expect(mine.map((x) => x.tenant.slug)).toContain('aa');

    const read = await withTenant(app.db, tenantId, userId, async (tx) => {
      const defs = await loadModelDefs(tx);
      const members = await loadMembers(tx);
      const scenarios = await listScenarios(tx);
      expect(scenarios.length).toBeGreaterThan(0);
      const sid = scenarios[0]!.id;
      return {
        tenant: await getTenant(tx),
        users: await listTenantMembers(tx),
        me: await getCurrentUser(tx),
        defs,
        members,
        scenarios,
        one: await getScenario(tx, sid),
        edits: await loadEditsCounts(tx, scenarios.map((s) => s.id)),
        resolved: await loadResolvedInputs(tx, sid),
        base: await loadResolvedInputs(tx, null),
        history: await listChangesetHistory(tx, sid, { limit: 5 }),
        calc: await getLatestCalcRun(tx, sid),
        sid,
      };
    });
    scenarioId = read.sid;
    expect(read.tenant?.slug).toBe('aa');
    expect(read.users.length).toBeGreaterThan(0);
    expect(read.me?.id).toBe(userId);
    expect(read.defs).toBeTruthy();
    expect(read.members.rows.length).toBeGreaterThan(0);
    expect(read.one?.id).toBe(scenarioId);
    expect(read.edits.size).toBe(read.scenarios.length);
    expect(read.resolved).toBeTruthy();
    expect(read.base).toBeTruthy();
    expect(read.history).toBeTruthy();

    // writes: a scenario through the ChangesetStore port, a job row, an object
    const store = createTenantChangesetStore(app.db, tenantId, userId);
    const newId = '00000000-0000-4000-8000-0000000d0a09';
    const parent = read.one!;
    await store.transaction(async (tx) => {
      await tx.createScenario({
        ...parent,
        id: newId,
        key: 'neon-ready',
        label: 'Neon readiness',
        kind: 'user',
        parent_id: parent.id,
        version: 0,
        locked: false,
        created_by: userId,
        created_at: new Date().toISOString(),
      } as never);
    });
    const after = await withTenant(app.db, tenantId, userId, (tx) => getScenario(tx, newId));
    expect(after?.key).toBe('neon-ready');

    const job = await withTenant(app.db, tenantId, userId, async (tx) => {
      const made = await createExportJob(tx, {
        template_version: 'neon',
        scenario_ids: [newId],
        snapshot: {},
        file_uri: 'exports/neon.xlsx',
        checksum: 'x',
        created_by: userId,
      });
      return getExportJob(tx, made.id);
    });
    expect(job?.template_version).toBe('neon');

    const objects = new PostgresObjectStore(app.db, tenantId, userId);
    await objects.put('exports', 'neon.bin', new Uint8Array([1, 2, 3]));
    const got = await objects.get('exports', 'neon.bin');
    expect(got).toBeTruthy();
  }, 60_000);

  it('without a tenant set the app role sees nothing', async () => {
    const seen = await app.db.transaction(async (tx) => {
      const r = await tx.execute<{ n: number }>(sql`select count(*)::int as n from scenario`);
      return r.rows[0]!.n;
    });
    expect(seen).toBe(0);
  });

  it('pooler compatibility: tenant context by SET LOCAL only, no session state, no session locks, no LISTEN/NOTIFY', async () => {
    expect(log.length).toBeGreaterThan(20);
    const bad =
      /^\s*(set\s+(?!local\b)|reset\b|listen\b|unlisten\b|notify\b|prepare\b|deallocate\b|discard\b|declare\b)|pg_(try_)?advisory_lock\s*\(|pg_advisory_lock_shared|pg_advisory_unlock|pg_notify/i;
    const offenders = log.filter((q) => bad.test(q.text));
    expect(offenders.map((q) => q.text)).toEqual([]);
    // every set_config is transaction-local (third argument true)
    const setConfigs = log.filter((x) => /set_config\s*\(/i.test(x.text));
    expect(setConfigs.length).toBeGreaterThan(0);
    for (const q of setConfigs) expect(q.text).not.toMatch(/,\s*false\s*\)/i);
    // no tenant setting survives COMMIT: a fresh transaction on the pool starts empty
    const r = await app.db.transaction((tx) =>
      tx.execute<{ t: string | null }>(sql`select nullif(current_setting('app.tenant_id', true), '') as t`),
    );
    expect(r.rows[0]!.t).toBeNull();
  });

  it('pooler compatibility: runtime source has no session SET, session advisory lock or LISTEN/NOTIFY', () => {
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'testing') walk(p);
        } else if (/\.ts$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name) && e.name !== 'schema.ts') files.push(p);
      }
    };
    walk(srcDir);
    expect(files.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const f of files) {
      // comments are prose, not SQL
      const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const rules: [string, RegExp][] = [
        ['session SET', /['"`]\s*set\s+(?!local\b)(?:session\s+)?[a-z_.]+\s*(?:=|to\b)/i],
        ['set_config(..., false)', /set_config\([^)]*,\s*false\s*\)/i],
        ['session advisory lock', /pg_(?:try_)?advisory_lock\s*\(|pg_advisory_unlock/i],
        ['LISTEN/NOTIFY', /\bLISTEN\b|\bNOTIFY\b|pg_notify/],
        ['startup options', /options:\s*['"`]-c\b/],
      ];
      for (const [name, re] of rules) if (re.test(text)) hits.push(`${relative(srcDir, f)}: ${name}`);
    }
    expect(hits).toEqual([]);
  });

  it('works with prepared statements disabled (default) and nothing is left prepared server-side', async () => {
    const one = createDb(appUrl, { poolMax: 1 });
    try {
      for (let i = 0; i < 3; i++) {
        const s = await withTenant(one.db, tenantId, userId, (tx) => listScenarios(tx));
        expect(s.length).toBeGreaterThan(0);
      }
      const r = await one.db.execute<{ n: number }>(sql`select count(*)::int as n from pg_prepared_statements`);
      expect(r.rows[0]!.n).toBe(0);
    } finally {
      await one.close();
    }
  });
});

describe('docs/ops/neon.md', () => {
  it('exists with the role, URL, migrate container and pg-boss headings', () => {
    const file = join(repoRoot, 'docs/ops/neon.md');
    expect(existsSync(file)).toBe(true);
    const headings = readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('## '));
    for (const h of [/create roles in neon/i, /DATABASE_URL \(pooled\) and DATABASE_URL_MIGRATE \(direct\)/, /run the migrate container/i, /pg-boss connection note/i]) {
      expect(headings.some((l) => h.test(l)), String(h)).toBe(true);
    }
  });
});

/** pgbouncer in transaction mode in front of the TLS cluster; skipped when no binary is installed. */
function findPgbouncer(): string | null {
  const dirs = (process.env.PATH ?? '').split(':').concat(['/usr/sbin', '/usr/local/bin', '/opt/homebrew/bin']);
  for (const d of dirs) {
    const p = join(d, 'pgbouncer');
    if (existsSync(p)) return p;
  }
  return null;
}
const pgbouncerBin = findPgbouncer();

describe.skipIf(pgbouncerBin === null)('through pgbouncer, pool_mode=transaction', () => {
  let dir = '';
  let proc: ReturnType<typeof spawn> | null = null;
  let bouncerUrl = '';
  let handle: DbHandle | null = null;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'gp-pgbouncer-'));
    const port = 20000 + Math.floor(Math.random() * 20000);
    const ini = [
      '[databases]',
      `glidepath_test = host=127.0.0.1 port=${instance.port} dbname=glidepath_test`,
      '[pgbouncer]',
      'listen_addr = 127.0.0.1',
      `listen_port = ${port}`,
      'auth_type = trust',
      'pool_mode = transaction',
      'default_pool_size = 1',
      'max_client_conn = 50',
      'server_tls_sslmode = require',
      `logfile = ${join(dir, 'pgbouncer.log')}`,
      `pidfile = ${join(dir, 'pgbouncer.pid')}`,
      'ignore_startup_parameters = extra_float_digits',
    ].join('\n');
    writeFileSync(join(dir, 'pgbouncer.ini'), ini);
    proc = spawn(pgbouncerBin!, [join(dir, 'pgbouncer.ini')], { stdio: 'ignore' });
    bouncerUrl = `postgres://glidepath_app@127.0.0.1:${port}/glidepath_test`;
    for (let i = 0; i < 50; i++) {
      try {
        await withClient(bouncerUrl, (c) => c.query('select 1'));
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error('pgbouncer did not start');
  }, 30_000);

  afterAll(async () => {
    await handle?.close();
    proc?.kill();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('tenant context never leaks between clients that share one server connection', async () => {
    handle = createDb(bouncerUrl, { poolMax: 6 });
    const { db } = handle;
    const work = Array.from({ length: 24 }, async (_, i) => {
      if (i % 2 === 0) {
        const s = await withTenant(db, tenantId, userId, (tx) => listScenarios(tx));
        expect(s.length).toBeGreaterThan(0);
      } else {
        const n = await db.transaction(async (tx) => {
          const r = await tx.execute<{ n: number }>(sql`select count(*)::int as n from scenario`);
          return r.rows[0]!.n;
        });
        expect(n).toBe(0);
      }
    });
    await Promise.all(work);
  }, 60_000);
});
