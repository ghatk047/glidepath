/**
 * The two-tenant database of the leak tests (DATA-10): migrated as a non-superuser owner, seeded with
 * the DATA-05 minimal seed (tenants A and B) plus rows of both tenants in every tenant table the
 * minimal seed leaves empty, so each table, and each repository that reads it, has a tenant-B row
 * that must never reach tenant A. Values are synthetic; B's strings say "tenant-b" so a leak is legible.
 */
import { clientConfig, getTestDatabaseUrl } from '@glidepath/pg-local';
import pg from 'pg';
import { createDb } from '../../src/db';
import type { Db, DbHandle } from '../../src/db';
import { createAiReconfigJob, createExportJob, createImportJob, createSolverRun } from '../../src/jobs';
import { migrate } from '../../src/migrate';
import { sha256Hex } from '../../src/objects/port';
import { app_user, audit_log, changeset, line_item_lever, market_snapshot, source, stored_object, tenant_membership } from '../../src/schema';
import { withTenant } from '../../src/tenant';
import { createAppRoleDb } from '../../src/testing/app-db';
import { ANA, BOB, SCN, TENANT_A, TENANT_B, seedMinimal, twinB } from '../../src/testing/minimal-seed';
import { createOwnedDatabase } from '../../src/testing/owner-db';
import type { OwnedDatabase } from '../../src/testing/owner-db';
import type { Query } from './catalog';

const lid = (n: number): string => `00000000-0000-4000-8000-${(0xf000 + n).toString(16).padStart(12, '0')}`;

/** Editor of tenant A only: the user of the pre-tenant (withUser) reads, who must not see tenant B. */
export const DORA = lid(0xe5);
/** A changeset idempotency key used by both tenants. */
export const CLIENT_REQUEST = 'rq-leak';
export const GC_A = SCN.grandchild!;
export const GC_B = twinB(GC_A);

/** Ids of the rows this seed adds, per tenant. */
export const IDS = {
  A: {
    source: lid(0x01), market: lid(0x02), exportJob: lid(0x03), importJob: lid(0x04), solverRun: lid(0x05),
    aiJob: lid(0x06), changeset: lid(0x07),
  },
  B: {
    source: lid(0x81), market: lid(0x82), exportJob: lid(0x83), importJob: lid(0x84), solverRun: lid(0x85),
    aiJob: lid(0x86), changeset: lid(0x87),
  },
} as const;

/** stored_object rows per tenant: one live, one expired (purgeExpired). */
export const OBJECTS = {
  A: { live: { bucket: 'exports', key: 'a/report.xlsx' }, expired: { bucket: 'ai', key: 'a/old.json' } },
  B: { live: { bucket: 'exports', key: 'tenant-b-only/report.xlsx' }, expired: { bucket: 'ai', key: 'tenant-b-only/old.json' } },
} as const;

async function seedTenant(owner: Db, t: 'A' | 'B'): Promise<void> {
  const b = t === 'B';
  const tenantId = b ? TENANT_B : TENANT_A;
  const user = b ? BOB : ANA;
  const ids = IDS[t];
  const gc = b ? GC_B : GC_A;
  const tag = (s: string): string => (b ? `tenant-b ${s}` : `a ${s}`);
  await withTenant(owner, tenantId, user, async (tx) => {
    if (b) await tx.insert(line_item_lever).values({ tenant_id: TENANT_B, line_key: 'it_001', lever_code: 'L05', mapping_source: 'user' });
    else await tx.insert(tenant_membership).values({ tenant_id: TENANT_A, user_id: DORA, role: 'editor' });
    await tx.insert(source).values({ tenant_id: tenantId, id: ids.source, code: tag('source code'), kind: b ? 'filing' : 'user', title: tag('source'), url: null, as_of: null });
    await tx.insert(market_snapshot).values({
      tenant_id: tenantId, id: ids.market, as_of: b ? '2026-10-15' : '2026-10-14', payload: { feed: tag('feed') }, source_id: ids.source, applied_changeset_id: null,
    });
    await tx.insert(changeset).values({
      tenant_id: tenantId, id: ids.changeset, origin: 'api', scenario_id: null, base_scenario_version: 0, status: 'applied',
      summary: { client_request_id: CLIENT_REQUEST, by: tag('request') }, created_by: user, created_at: new Date(b ? '2026-11-05T08:00:00Z' : '2026-11-04T08:00:00Z'), reverts_id: null,
    });
    await createExportJob(tx, {
      id: ids.exportJob, template_version: tag('template'), scenario_ids: [gc], snapshot: { cells: tag('snapshot') },
      file_uri: tag('export.xlsx'), checksum: tag('checksum'), created_by: user,
    });
    await createImportJob(tx, { id: ids.importJob, export_job_id: ids.exportJob, file_uri: tag('import.xlsx'), report: { delta: tag('report') } });
    await createSolverRun(tx, { id: ids.solverRun, kind: 'goal_seek', scenario_id: gc, spec: { goal: tag('goal') } });
    await createAiReconfigJob(tx, { id: ids.aiJob, prompt: tag('prompt'), plan: { members: tag('plan') }, status: tag('status') });
    await tx.insert(audit_log).values({
      tenant_id: tenantId, actor: user, action: tag('action'), entity: 'scenario', entity_key: gc, before: { label: tag('before') }, after: { label: tag('after') },
      at: new Date('2026-11-06T09:00:00Z'),
    });
    const objects = OBJECTS[t];
    for (const [o, expires] of [[objects.live, null], [objects.expired, new Date('2026-01-01T00:00:00Z')]] as const) {
      const bytes = Buffer.from(tag(`bytes of ${o.key}`));
      await tx.insert(stored_object).values({
        tenant_id: tenantId, bucket: o.bucket, key: o.key, content_type: 'text/plain', bytes, sha256: sha256Hex(bytes), size: bytes.byteLength, expires_at: expires,
      });
    }
  });
}

/** Rows of A and B in the tenant tables the minimal seed leaves empty for either tenant, and DORA. */
export async function seedLeak(owner: Db): Promise<void> {
  await owner.insert(app_user).values({ id: DORA, email: 'dora@example.test', name: 'Dora' });
  await seedTenant(owner, 'A');
  await seedTenant(owner, 'B');
}

export interface LeakDb {
  owned: OwnedDatabase;
  /** The owner role (migrations, seed). */
  owner: DbHandle;
  /** glidepath_app, the runtime role: RLS applies. */
  app: DbHandle;
  /** Superuser on the test database: bypasses RLS, for snapshots of what is really stored. */
  admin: pg.Client;
  adminQuery: Query;
  close(): Promise<void>;
}

export async function openLeakDb(): Promise<LeakDb> {
  const adminUrl = await getTestDatabaseUrl();
  const owned = await createOwnedDatabase(adminUrl);
  const handles: { close(): Promise<void> }[] = [];
  const close = async (): Promise<void> => {
    for (const h of handles.reverse()) await h.close();
    await owned.drop();
  };
  try {
    await migrate(owned.url);
    const owner = createDb(owned.url);
    handles.push(owner);
    await seedMinimal(owner.db);
    await seedLeak(owner.db);
    const app = createAppRoleDb(adminUrl, owned.database);
    handles.push(app);
    const u = new URL(adminUrl);
    u.pathname = `/${owned.database}`;
    const admin = new pg.Client(clientConfig(u.toString()));
    await admin.connect();
    handles.push({ close: () => admin.end() });
    const adminQuery: Query = (text, values) => admin.query(text, values);
    return { owned, owner, app, admin, adminQuery, close };
  } catch (e) {
    await close();
    throw e;
  }
}
