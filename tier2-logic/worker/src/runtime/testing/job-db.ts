import { createDb, schema, withTenant } from '@glidepath/data-access';
import type { Db, DbHandle } from '@glidepath/data-access';
import { withTestDatabase } from '@glidepath/testkit';
import type { TestDatabase } from '@glidepath/testkit';
import { installQueueSchema } from '../install';

/** Test support: a migrated pg-local database with two tenants, one scenario each, and the pg-boss schema installed. */

const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const MV = id(0xa1);
export const TENANT_A = id(0x10);
export const TENANT_B = id(0x20);
export const USER_A = id(0xe1);
export const USER_B = id(0xe2);
export const SCENARIO_A = id(0x51);
export const SCENARIO_B = id(0x52);

export interface JobDatabase {
  database: TestDatabase;
  /** URL of the app role (`glidepath_app`, RLS applies): what the worker gets as DATABASE_URL. */
  appUrl: string;
  /** Own app-role connection for assertions. */
  app: DbHandle;
  close(): Promise<void>;
}

export const QUEUES = ['solver.test', 'solver.other', 'excel.test', 'ai.test'] as const;

const at = (s: string): Date => new Date(s);

async function seed(db: Db): Promise<void> {
  await db.insert(schema.model_version).values({ id: MV, semver: '0.0.1', status: 'published', notes: 'job tests', created_at: at('2026-09-01T00:00:00Z') });
  await db.insert(schema.app_user).values([
    { id: USER_A, email: 'a@example.test', name: 'A' },
    { id: USER_B, email: 'b@example.test', name: 'B' },
  ]);
  for (const [tenant, user, scenario, slug] of [
    [TENANT_A, USER_A, SCENARIO_A, 'ta'],
    [TENANT_B, USER_B, SCENARIO_B, 'tb'],
  ] as const) {
    await withTenant(db, tenant, user, async (tx) => {
      await tx.insert(schema.tenant).values({
        id: tenant, slug, name: `Tenant ${slug}`, currency: 'USD', base_year: 2025, target_year: 2027, fiscal_calendar: 'calendar',
        ticker: null, model_version_id: MV, status: 'active', created_at: at('2026-09-10T00:00:00Z'),
      });
      await tx.insert(schema.tenant_membership).values({ tenant_id: tenant, user_id: user, role: 'owner' });
      await tx.insert(schema.scenario).values({
        tenant_id: tenant, id: scenario, key: 'base', label: 'Base', kind: 'user', parent_id: null, model_version_id: MV, version: 0,
        locked: false, created_by: user, created_at: at('2026-09-11T00:00:00Z'), archived: false,
      });
    });
  }
}

export async function startJobDatabase(): Promise<JobDatabase> {
  const database = await withTestDatabase({
    seed: async (testDb) => {
      const owner = createDb(testDb.url);
      try {
        await seed(owner.db);
      } finally {
        await owner.close();
      }
    },
  });
  await installQueueSchema({ ownerUrl: database.url, queues: QUEUES });
  const u = new URL(database.adminUrl);
  u.pathname = `/${database.database}`;
  u.searchParams.set('options', '-c role=glidepath_app');
  const appUrl = u.toString();
  const app = createDb(appUrl);
  return {
    database,
    appUrl,
    app,
    async close() {
      await app.close();
      await database.close();
    },
  };
}

export async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 20_000, everyMs = 50): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`waitFor timed out after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

export class Gate {
  private release!: () => void;
  readonly opened = new Promise<void>((r) => (this.release = r));
  open(): void {
    this.release();
  }
}
