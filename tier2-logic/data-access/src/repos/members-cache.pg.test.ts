import { applyChangeset, modelCacheKey, type ChangesetDraft, type RecomputeInput } from '@glidepath/domain';
import type { ModelBundle } from '@glidepath/spec';
import * as spec from '@glidepath/spec';
import { getTestDatabaseUrl } from '@glidepath/pg-local';
import { TransactionRollbackError, and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../db';
import type { DbHandle } from '../db';
import { migrate } from '../migrate';
import { changeset, dimension_member, scenario, tenant, tenant_membership, variable_value } from '../schema';
import { withTenant } from '../tenant';
import { createAppRoleDb, recordQueries } from '../testing/app-db';
import type { RecordedQuery } from '../testing/app-db';
import { ANA, MV1, seedMinimal } from '../testing/minimal-seed';
import { createOwnedDatabase } from '../testing/owner-db';
import type { OwnedDatabase } from '../testing/owner-db';
import { createTenantChangesetStore } from '../write/changeset-store';
import { clearMembersCache, loadMembers, membersCacheStats } from './members';

// Count every members hash, wherever it is taken (data-access's snapshot, the domain's ModelCache key).
vi.mock('@glidepath/spec', async (importOriginal) => {
  const real = await importOriginal<typeof import('@glidepath/spec')>();
  return { ...real, membersHash: vi.fn(real.membersHash) };
});
const hashes = (): number => vi.mocked(spec.membersHash).mock.calls.length;

/**
 * DATA-13: the members snapshot and members_hash are cached per (tenant, members version). Commits run
 * through the real applyChangeset on Postgres (as glidepath_app, each its own committed withTenant) with a
 * Recompute hook that takes the ModelCache key as the server's does (`modelCacheKey`).
 */

let owned: OwnedDatabase;
let owner: DbHandle;
let app: DbHandle;
let log: RecordedQuery[];

const TENANT_C = '00000000-0000-4000-8000-0000000000c0';
const PRESET_C = '00000000-0000-4000-8000-0000000000c1';
const USER_C = '00000000-0000-4000-8000-0000000000c2';
const SEED_CS = '00000000-0000-4000-8000-00000000c5ed';
const at = (s: string): Date => new Date(s);

const bundle = {
  variables: [
    { id: 'g.target_net', kind: 'decision', label: 'Net', unit: 'USD m', type: 'number', dims: [], min: 0, max: 250.5, step: 0.5, layer: 'inputs', role: 'driver', ui: { control: 'slider', hero: true }, scenario_varies: true },
  ],
  nodes: [{ id: 'res.net', dims: [], unit: 'USD m', label: 'Net', layer: 'result', output: true, expr: 'g.target_net' }],
  dimensions: [{ id: 'vp', label: 'VP', scope: 'tenant', attributes: ['label'] }],
} as unknown as ModelBundle;

beforeAll(async () => {
  const adminUrl = await getTestDatabaseUrl();
  owned = await createOwnedDatabase(adminUrl);
  await migrate(owned.url);
  owner = createDb(owned.url);
  await seedMinimal(owner.db);
  await withTenant(owner.db, TENANT_C, ANA, async (tx) => {
    await tx.insert(tenant).values({
      id: TENANT_C, slug: 'tc', name: 'Tenant C', currency: 'USD', base_year: 2026, target_year: 2027,
      fiscal_calendar: 'calendar', ticker: null, model_version_id: MV1, status: 'active', created_at: at('2026-09-12T00:00:00Z'),
    });
    await tx.insert(tenant_membership).values({ tenant_id: TENANT_C, user_id: ANA, role: 'owner' });
    await tx.insert(scenario).values([
      { tenant_id: TENANT_C, id: PRESET_C, key: 'rates', label: 'Rates', kind: 'preset', parent_id: null, model_version_id: MV1, version: 0, locked: true, created_by: ANA, created_at: at('2026-10-01T00:00:00Z') },
      { tenant_id: TENANT_C, id: USER_C, key: 'mine', label: 'Mine', kind: 'user', parent_id: PRESET_C, model_version_id: MV1, version: 0, locked: false, created_by: ANA, created_at: at('2026-10-02T00:00:00Z') },
    ]);
    await tx.insert(changeset).values({ tenant_id: TENANT_C, id: SEED_CS, origin: 'seed', scenario_id: PRESET_C, base_scenario_version: 0, status: 'applied', summary: {}, created_by: ANA, created_at: at('2026-10-01T00:00:00Z'), reverts_id: null });
    await tx.insert(variable_value).values({ tenant_id: TENANT_C, var_key: 'g.target_net', member_key: '', value: '100', source_id: null, confidence: 'H', note: '', changeset_id: SEED_CS, updated_at: at('2026-10-01T00:00:00Z') });
    await tx.insert(dimension_member).values({ tenant_id: TENANT_C, dim_key: 'vp', member_key: 'vp_ops', label: 'Operations', attrs: {}, sort: 1, active: true });
  });
  app = createAppRoleDb(adminUrl, owned.database);
  log = recordQueries(app.pool);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await owned?.drop();
});

beforeEach(() => {
  clearMembersCache();
});

let version = 0;
/** Members and key each commit's Recompute saw. */
const seen: { members: spec.TenantMembers; hash: string }[] = [];
const recompute = async ({ state }: RecomputeInput) => {
  seen.push({ members: state.members, hash: modelCacheKey(TENANT_C, MV1, state.members).members_hash });
};
const store = () => createTenantChangesetStore(app.db, TENANT_C, ANA);

async function commit(changes: ChangesetDraft['changes']): Promise<void> {
  const r = await applyChangeset(store(), { origin: 'ui', scenario_id: USER_C, base_scenario_version: version, changes }, { actor: ANA, bundle, recompute });
  version = r.version;
}
const setNet = (v: number): ChangesetDraft['changes'] => [{ target: 'variable', key: 'g.target_net', member_key: '', op: 'set', new_value: v }];
const viewReads = (from: number): number => log.slice(from).filter((q) => q.text.includes('v_dimension_members')).length;
const vpIds = (m: spec.TenantMembers): string[] => (m.vp ?? []).map((x) => x.id);

describe('members cache per (tenant, members version) (DATA-13)', () => {
  it('a commit with no structural change does not reload members or rehash', async () => {
    await commit(setNet(110)); // warms the cache: one read of the view, one hash
    expect(membersCacheStats()).toMatchObject({ loads: 1, hits: 0 });
    const [hashesBefore, logBefore] = [hashes(), log.length];

    for (const v of [111, 112, 113]) await commit(setNet(v));

    expect(membersCacheStats()).toMatchObject({ loads: 1, hits: 3 });
    expect(viewReads(logBefore), 'v_dimension_members read again').toBe(0);
    expect(hashes() - hashesBefore, 'members hashed again').toBe(0);
    // the same frozen snapshot every time, so the same ModelCache key
    const last = seen.slice(-4);
    expect(new Set(last.map((s) => s.members)).size).toBe(1);
    expect(new Set(last.map((s) => s.hash)).size).toBe(1);
    expect(Object.isFrozen(last[0]!.members) && Object.isFrozen(last[0]!.members.vp)).toBe(true);
  });

  it('a structural changeset invalidates: its own recompute and the next commit see the new members, read and hashed once', async () => {
    await commit(setNet(120));
    const before = seen.at(-1)!;
    const loads = membersCacheStats().loads;

    await commit([{ target: 'structural', key: 'vp', member_key: 'vp_new', op: 'insert', new_value: { label: 'New VP', sort: 2 } }]);
    const structural = seen.at(-1)!;
    expect(vpIds(structural.members)).toEqual(['vp_ops', 'vp_new']);
    expect(structural.hash).not.toBe(before.hash);

    const [hashesBefore, logBefore] = [hashes(), log.length];
    await commit(setNet(121));
    expect(membersCacheStats().loads).toBe(loads + 1);
    expect(viewReads(logBefore)).toBe(1);
    expect(hashes() - hashesBefore).toBe(1);
    expect(vpIds(seen.at(-1)!.members)).toEqual(['vp_ops', 'vp_new']);
    expect(seen.at(-1)!.hash).toBe(structural.hash);

    // and from then on it is cached again
    await commit(setNet(122));
    expect(membersCacheStats().loads).toBe(loads + 1);
  });

  it('a member changed outside any changeset (seed, migration) changes the members version: the next read sees it', async () => {
    await commit(setNet(130));
    const loads = membersCacheStats().loads;
    // the owner role, as the seed writes (RLS is FORCEd, so inside the tenant's context)
    await withTenant(owner.db, TENANT_C, ANA, (tx) =>
      tx.update(dimension_member).set({ label: 'Ops renamed' }).where(and(eq(dimension_member.tenant_id, TENANT_C), eq(dimension_member.member_key, 'vp_ops'))),
    );
    await commit(setNet(131));
    expect(membersCacheStats().loads).toBe(loads + 1);
    expect(seen.at(-1)!.members.vp?.[0]?.label).toBe('Ops renamed');
  });

  it('loadMembers inside a transaction that wrote a member sees that write; other transactions keep the committed snapshot', async () => {
    const committed = await withTenant(app.db, TENANT_C, ANA, (tx) => loadMembers(tx));
    let inside: string[] = [];
    await withTenant(app.db, TENANT_C, ANA, async (tx) => {
      await tx.insert(dimension_member).values({ tenant_id: TENANT_C, dim_key: 'vp', member_key: 'vp_tmp', label: 'Tmp', attrs: {}, sort: 9, active: true });
      inside = vpIds((await loadMembers(tx)).members);
      tx.rollback();
    }).catch((e: unknown) => {
      if (!(e instanceof TransactionRollbackError)) throw e;
    });
    expect(inside).toContain('vp_tmp');
    const after = await withTenant(app.db, TENANT_C, ANA, (tx) => loadMembers(tx));
    expect(vpIds(after.members)).not.toContain('vp_tmp');
    expect(after).toBe(committed);
  });
});
