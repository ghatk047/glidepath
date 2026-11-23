/**
 * The stack of the route-level leak test (QA-03, G7): a migrated pg-local database holding three tenants,
 * and the real server composition (`startServer`) on a loopback port with real cookie sign-in.
 *
 * - `aa`: the reference tenant seed (`tier3-data/seed/aa`), tenant A, the caller of every route under test.
 * - `zz`: the synthetic second tenant of QA-02 (`@glidepath/testkit` `zzSeed`), other members and values.
 * - `aa-copy`: a copy of the reference seed under another slug: the same keys, labels and numbers as tenant A,
 *   only its row ids differ, so a leak of it can only be told by ids (and by the edits its owner makes).
 *
 * All three are loaded the way the compose `migrate` step loads a tenant (worker `seedTenant`: presets through
 * `applyChangeset`, each recomputed into its `calc_run`), as the owner role. The server connects as
 * `glidepath_app` (RLS applies, nothing bypassed). Excel jobs run in-process through a stand-in for the pg-boss
 * queue (the worker's own `runExport` / `runImport` / `runApply`); solver jobs are only recorded (the relay polls
 * `solver_run`, not the queue). `admin` is a superuser connection on the same database: it sees every tenant's
 * rows, for the oracle (what is really stored) and nothing else.
 */
import { randomUUID } from 'node:crypto';
import { PostgresObjectStore, createDb, schema, withTenant } from '@glidepath/data-access';
import type { Db, DbHandle } from '@glidepath/data-access';
import { aaSeed, withTestDatabase, zzSeed } from '@glidepath/testkit';
import type { TestDatabase } from '@glidepath/testkit';
// Test wiring only (as src/routes/excel/testing/worker-jobs.ts): the worker's seed loader and Excel jobs, in-process.
import { runApply } from '../../../worker/src/jobs/excel/apply';
import { defaultExcelDeps } from '../../../worker/src/jobs/excel/deps';
import type { ExcelJobDeps } from '../../../worker/src/jobs/excel/deps';
import { runExport } from '../../../worker/src/jobs/excel/export';
import { runImport } from '../../../worker/src/jobs/excel/import';
import type { ApplyPayload, ExcelJobContext, ExportPayload } from '../../../worker/src/jobs/excel/types';
import { findTier3Data, readSeedInputs } from '../../../worker/src/seed/files';
import { seedIds } from '../../../worker/src/seed/ids';
import { loadModelDefs } from '../../../worker/src/seed/model-defs';
import { seedTenant } from '../../../worker/src/seed/tenant';
import { startServer } from '../../src/app/start';
import type { RunningServer } from '../../src/app/start';
import { AUTH_SECRET } from '../../src/app/testing/fixtures';
import type { Mailer } from '../../src/auth/mailer';
import type { JobQueue, QueuePayload } from '../../src/compose/queue';
import { ORIGIN, PUBLIC_BASE_URL } from '../../src/session/testing/harness';

export { ORIGIN };

/** Tenant slugs: A is the caller; B and C are the other tenants. */
export const SLUG = { A: 'aa', B: 'zz', C: 'aa-copy' } as const;
export type TenantName = keyof typeof SLUG;
export const TENANT_ID = { A: seedIds.tenant(SLUG.A), B: seedIds.tenant(SLUG.B), C: seedIds.tenant(SLUG.C) } as const;
/** The copy's name: its only tenant-level string that differs from tenant A's. */
export const COPY_NAME = 'Copy of tenant aa (leak test)';

const uid = (n: number): string => `00000000-0000-4000-8000-${(0xa000 + n).toString(16).padStart(12, '0')}`;

export interface LeakUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  /** Memberships: tenant -> role. */
  readonly roles: Partial<Record<TenantName, 'owner' | 'editor' | 'viewer'>>;
}

/** Fictitious users (example.test). MAX belongs to tenant A and to the copy: a user scope is not a tenant scope. */
export const USERS = {
  ana: { id: uid(1), email: 'ana@example.test', name: 'Ana Leaktest', roles: { A: 'owner' } },
  bob: { id: uid(2), email: 'bob@example.test', name: 'Bob Leaktest', roles: { B: 'owner' } },
  cleo: { id: uid(3), email: 'cleo@example.test', name: 'Cleo Leaktest', roles: { C: 'owner' } },
  max: { id: uid(4), email: 'max@example.test', name: 'Max Leaktest', roles: { A: 'editor', C: 'editor' } },
} as const satisfies Record<string, LeakUser>;
export type UserName = keyof typeof USERS;

/** Preset scenario ids per tenant (the seed's deterministic ids), by preset key. */
export const presetOf = (t: TenantName, key: string): string => seedIds.scenario(SLUG[t], key);

async function seedThreeTenants(test: TestDatabase): Promise<void> {
  const owner = createDb(test.url, { poolMax: 2 });
  try {
    const tier3Data = findTier3Data();
    const inputs = await readSeedInputs(tier3Data, SLUG.A);
    const defs = await loadModelDefs(owner.db, inputs.global, inputs.tenant);
    const aa = await aaSeed();
    const seeds = {
      A: inputs.tenant,
      B: await zzSeed(),
      C: { ...aa, tenant: { ...aa.tenant, id: SLUG.C, name: COPY_NAME } },
    } as const;
    for (const t of ['A', 'B', 'C'] as const) {
      await seedTenant(owner.db, { slug: SLUG[t], seed: seeds[t], bundle: inputs.global.bundle, modelVersionId: defs.modelVersionId });
    }
    await owner.db.insert(schema.app_user).values(Object.values(USERS).map((u) => ({ id: u.id, email: u.email, name: u.name })));
    for (const u of Object.values(USERS) as LeakUser[]) {
      for (const [t, role] of Object.entries(u.roles) as [TenantName, string][]) {
        await withTenant(owner.db, TENANT_ID[t], u.id, (tx) =>
          tx.insert(schema.tenant_membership).values({ tenant_id: TENANT_ID[t], user_id: u.id, role: role as 'owner' }),
        );
      }
    }
  } finally {
    await owner.close();
  }
}

/** The pg-boss stand-in: Excel jobs run in-process (the worker's handlers), solver jobs are recorded. */
function inProcessQueue(db: DbHandle): { queue: JobQueue; solverJobs: { queue: string; payload: QueuePayload }[]; settled(): Promise<void> } {
  const objects = (who: { tenantId: string; userId: string }): PostgresObjectStore => new PostgresObjectStore(db.db, who.tenantId, who.userId);
  const deps: ExcelJobDeps = { ...defaultExcelDeps(), objects };
  const ctxOf = (p: QueuePayload): ExcelJobContext => ({
    tenantId: p.tenantId,
    userId: p.userId,
    signal: new AbortController().signal,
    progress: () => undefined,
    withTenant: (fn) => withTenant(db.db, p.tenantId, p.userId, fn),
  });
  const running = new Set<Promise<unknown>>();
  const solverJobs: { queue: string; payload: QueuePayload }[] = [];
  const queue: JobQueue = {
    async enqueue(name, payload) {
      if (name === 'excel.import') {
        const p = runImport(ctxOf(payload), payload as never, deps).catch(() => undefined);
        running.add(p);
        void p.finally(() => running.delete(p));
      } else {
        solverJobs.push({ queue: name, payload });
      }
      return randomUUID();
    },
    async run(name, payload) {
      if (name === 'excel.export') return JSON.parse(JSON.stringify(await runExport(ctxOf(payload), payload as unknown as ExportPayload, deps)));
      if (name === 'excel.apply') return JSON.parse(JSON.stringify(await runApply(ctxOf(payload), payload as unknown as ApplyPayload, deps)));
      throw new Error(`the leak test's queue runs no ${name} job`);
    },
    close: async () => undefined,
  };
  return { queue, solverJobs, settled: async () => void (await Promise.all([...running])) };
}

export interface LeakStack {
  test: TestDatabase;
  /** Superuser on the test database (bypasses RLS): the oracle's view of what is stored. */
  admin: DbHandle;
  /** glidepath_app on the test database: the in-process Excel jobs' connection. */
  app: DbHandle;
  server: RunningServer;
  /** `http://127.0.0.1:<port>` */
  base: string;
  /** Sign-in links the server sent, oldest first. */
  links: string[];
  solverJobs: { queue: string; payload: QueuePayload }[];
  /** Resolves when every started import preview has ended. */
  settled(): Promise<void>;
  close(): Promise<void>;
}

const urlOf = (adminUrl: string, database: string, role?: string): string => {
  const u = new URL(adminUrl);
  u.pathname = `/${database}`;
  if (role) u.searchParams.set('options', `-c role=${role}`);
  return u.toString();
};

export async function openLeakStack(): Promise<LeakStack> {
  const test = await withTestDatabase({ seed: seedThreeTenants });
  const handles: { close(): Promise<void> }[] = [];
  const close = async (): Promise<void> => {
    for (const h of handles.reverse()) await h.close().catch(() => undefined);
    await test.close();
  };
  try {
    const appUrl = urlOf(test.adminUrl, test.database, 'glidepath_app');
    const admin = createDb(urlOf(test.adminUrl, test.database), { poolMax: 2 });
    handles.push(admin);
    const app = createDb(appUrl, { poolMax: 4 });
    handles.push(app);
    const jobs = inProcessQueue(app);
    handles.push({ close: () => jobs.settled() });
    const links: string[] = [];
    const mailer: Mailer = { sendMagicLink: async (m) => void links.push(m.link), close: () => undefined };
    const server = await startServer(
      // The server is silent; `LEAK_LOG_LEVEL=error` (or `debug`) prints its own log while a failure is looked into.
      { DATABASE_URL: appUrl, AUTH_SECRET, PUBLIC_BASE_URL, PORT: '0', LOG_LEVEL: process.env.LEAK_LOG_LEVEL ?? 'silent', JOB_RELAY_POLL_MS: '50' },
      { mailer, queue: jobs.queue },
    );
    handles.push(server);
    return {
      test,
      admin,
      app,
      server,
      base: `http://127.0.0.1:${server.port}`,
      links,
      solverJobs: jobs.solverJobs,
      settled: jobs.settled,
      close,
    };
  } catch (e) {
    await close();
    throw e;
  }
}

/** The tenant a stored row of `tenant_id` (or the tenant root's `id`) belongs to. */
export const tenantNameOf = (tenantId: string): TenantName | null =>
  (Object.entries(TENANT_ID).find(([, id]) => id === tenantId)?.[0] as TenantName | undefined) ?? null;

export type { Db };
