import {
  applyChangeset,
  ChangesetConflictError,
  ChangesetRejectedError,
  resolveInputs,
  reverse,
  summaryOf,
  type Changeset,
  type ChangesetDraft,
  type ChangesetTx,
  type ScenarioTx,
} from '@glidepath/domain';
import type { ModelBundle } from '@glidepath/spec';
import { getTestDatabaseUrl } from '@glidepath/pg-local';
import { and, eq, ne, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db';
import type { DbHandle } from '../db';
import { migrate } from '../migrate';
import { TenantScopeError } from '../scope';
import {
  addr_tag,
  audit_log,
  calc_run,
  change,
  changeset,
  dimension_member,
  line_item,
  line_item_lever,
  node_override,
  scenario,
  scenario_value,
  tenant,
  tenant_membership,
  variable_value,
} from '../schema';
import { withTenant } from '../tenant';
import type { TenantTx } from '../tenant';
import { createAppRoleDb, recordQueries } from '../testing/app-db';
import type { RecordedQuery } from '../testing/app-db';
import { ANA, BOB, CAROL, CS, MV1, RUN, SCN, TENANT_A, TENANT_B, fixture, seedMinimal, twinB } from '../testing/minimal-seed';
import { createOwnedDatabase } from '../testing/owner-db';
import type { OwnedDatabase } from '../testing/owner-db';
import {
  ScenarioVersionError,
  changesetTx,
  createChangesetStore,
  createTenantChangesetStore,
} from './changeset-store';

/**
 * DATA-06 on pg-local: the ChangesetStore port over Postgres, as glidepath_app (RLS applies), on the
 * two-tenant seed of DATA-05 plus a third tenant (C) for the end-to-end applyChangeset runs.
 * Most tests run in a transaction that is rolled back, so each starts from the seed.
 */

let owned: OwnedDatabase;
let owner: DbHandle;
let app: DbHandle;
let log: RecordedQuery[];

const TENANT_C = '00000000-0000-4000-8000-0000000000c0';
const PRESET_C = '00000000-0000-4000-8000-0000000000c1';
/** The changeset that wrote tenant C's defaults (values name a changeset of their tenant: DATA-12 composite FK). */
const SEED_CS_C = '00000000-0000-4000-8000-0000000000ce';
const DAVE = '00000000-0000-4000-8000-0000000000e4';
const at = (s: string): Date => new Date(s);

beforeAll(async () => {
  const adminUrl = await getTestDatabaseUrl();
  owned = await createOwnedDatabase(adminUrl);
  await migrate(owned.url);
  owner = createDb(owned.url);
  await seedMinimal(owner.db);
  await seedTenantC();
  app = createAppRoleDb(adminUrl, owned.database);
  log = recordQueries(app.pool);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await owned?.drop();
});

/** Tenant C: one locked preset with a tenant default, no lines or members (no rule has anything to say). */
async function seedTenantC(): Promise<void> {
  await withTenant(owner.db, TENANT_C, DAVE, async (tx) => {
    await tx.insert(tenant).values({
      id: TENANT_C, slug: 'tc', name: 'Tenant C', currency: 'USD', base_year: 2026, target_year: 2027,
      fiscal_calendar: 'calendar', ticker: null, model_version_id: MV1, status: 'active', created_at: at('2026-09-12T00:00:00Z'),
    });
    await tx.insert(tenant_membership).values({ tenant_id: TENANT_C, user_id: ANA, role: 'owner' });
    await tx.insert(scenario).values({
      tenant_id: TENANT_C, id: PRESET_C, key: 'rates', label: 'Rates', kind: 'preset', parent_id: null,
      model_version_id: MV1, version: 0, locked: true, created_by: ANA, created_at: at('2026-10-01T00:00:00Z'),
    });
    await tx.insert(changeset).values({
      tenant_id: TENANT_C, id: SEED_CS_C, origin: 'seed', scenario_id: null, base_scenario_version: 0, status: 'applied',
      summary: {}, created_by: ANA, created_at: at('2026-10-01T00:00:00Z'), reverts_id: null,
    });
    await tx.insert(variable_value).values([
      { tenant_id: TENANT_C, var_key: 'g.target_net', member_key: '', value: '100', source_id: null, confidence: 'H', note: 'filing', changeset_id: SEED_CS_C, updated_at: at('2026-10-01T00:00:00Z') },
      { tenant_id: TENANT_C, var_key: 'g.head_start', member_key: '', value: '1', source_id: null, confidence: 'L', note: '', changeset_id: SEED_CS_C, updated_at: at('2026-10-01T00:00:00Z') },
    ]);
  });
}

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super('rollback');
  }
}

/** Runs `fn` in a withTenant transaction on the port's view and rolls it back; returns what `fn` returned. */
async function scratch<T>(
  tenantId: string,
  userId: string,
  fn: (s: ScenarioTx, tx: TenantTx) => Promise<T>,
): Promise<T> {
  try {
    await withTenant(app.db, tenantId, userId, async (tx) => {
      throw new Rollback(await fn(changesetTx(tx), tx));
    });
  } catch (e) {
    if (e instanceof Rollback) return e.value as T;
    throw e;
  }
  throw new Error('unreachable');
}
const asA = <T>(fn: (s: ScenarioTx, tx: TenantTx) => Promise<T>) => scratch(TENANT_A, ANA, fn);

const GC = SCN.grandchild!;
const GC_B = twinB(GC);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const message = (e: unknown): string => {
  const x = e as { message?: string; cause?: { message?: string } };
  return `${x.message ?? ''} ${x.cause?.message ?? ''}`;
};

function newChangeset(over: Partial<Changeset> = {}): Changeset {
  const id = over.id ?? uuid(0x501);
  return {
    id,
    origin: 'ui',
    scenario_id: GC,
    base_scenario_version: 4,
    status: 'applied',
    summary: { changes: 3, edits: 3, edits_count: 3, client_request_id: 'rq-1', forked_from: null },
    created_by: ANA,
    created_at: '2026-11-20T10:00:00.000Z',
    reverts_id: null,
    changes: [
      {
        changeset_id: id, seq: 0, target: 'scenario_value', key: 'g.target_net', member_key: '', op: 'update',
        old_value: 120, new_value: 130, export_value: null, status: 'clean', messages: { note: 'why not' },
      },
      {
        changeset_id: id, seq: 1, target: 'node_override', key: 'res.net', member_key: '', op: 'insert',
        old_value: null, new_value: 99.5, export_value: 98, status: 'accepted', messages: {},
      },
      {
        changeset_id: id, seq: 2, target: 'dimension_member', key: 'vp', member_key: 'vp_new', op: 'insert',
        old_value: null, new_value: { label: 'New', attrs: { a: [1, 2] }, sort: 9, active: true }, export_value: null,
        status: 'clean', messages: { warnings: [{ rule: 'VR04', severity: 'warning', cells: ['g.target_net[]'], message: 'm' }] },
      },
    ],
    ...over,
  };
}

describe('ChangesetStore over Postgres (DATA-06): locks, reads, writes, bumpVersion, calc_run, audit_log, inside the caller withTenant transaction (pg-local)', () => {
  it('loadScenarioForUpdate: SELECT … FOR UPDATE; a second locker waits for the first transaction to end', async () => {
    const row = await asA((s) => s.loadScenarioForUpdate(GC));
    expect(row).toEqual({
      id: GC, key: 'grandchild', label: 'grandchild', kind: 'user', parent_id: SCN.child, model_version_id: MV1,
      version: 4, locked: false, created_by: ANA, created_at: '2026-10-03T00:00:00.000Z',
    });
    expect(log.some((q) => /for update/i.test(q.text) && q.text.includes('"scenario"'))).toBe(true);

    // another tenant's scenario, an unknown id and a non-uuid are all absent
    expect(await asA((s) => s.loadScenarioForUpdate(GC_B))).toBeNull();
    expect(await asA((s) => s.loadScenarioForUpdate(uuid(0xdead)))).toBeNull();
    expect(await asA((s) => s.loadScenarioForUpdate('not-a-uuid'))).toBeNull();

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const holding = new Promise<void>((r) => (locked = r));
    const first = withTenant(app.db, TENANT_A, ANA, async (tx) => {
      await changesetTx(tx).loadScenarioForUpdate(GC);
      locked();
      await held;
    });
    await holding;
    let secondDone = false;
    const second = withTenant(app.db, TENANT_A, ANA, async (tx) => {
      await changesetTx(tx).loadScenarioForUpdate(GC);
      secondDone = true;
    });
    await sleep(300);
    expect(secondDone).toBe(false); // blocked by the row lock
    release();
    await first;
    await second;
    expect(secondDone).toBe(true);
  });

  it('lockTenantDefaults: a transaction-scoped lock per tenant; another tenant is not blocked', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const holding = new Promise<void>((r) => (locked = r));
    const first = withTenant(app.db, TENANT_A, ANA, async (tx) => {
      await changesetTx(tx).lockTenantDefaults();
      locked();
      await held;
    });
    await holding;
    let secondDone = false;
    const second = withTenant(app.db, TENANT_A, ANA, async (tx) => {
      await changesetTx(tx).lockTenantDefaults();
      secondDone = true;
    });
    // tenant B takes its own lock at once
    await withTenant(app.db, TENANT_B, BOB, (tx) => changesetTx(tx).lockTenantDefaults());
    await sleep(300);
    expect(secondDone).toBe(false);
    release();
    await first;
    await second;
    expect(secondDone).toBe(true);
    // the lock went with the transaction: taking it again is immediate
    await withTenant(app.db, TENANT_A, ANA, (tx) => changesetTx(tx).lockTenantDefaults());
  });

  it('loadScenarios: every scenario of the tenant as domain rows, oldest first', async () => {
    const a = await asA((s) => s.loadScenarios());
    expect(a.map((r) => r.key)).toEqual(['root', 'child', 'sibling', 'grandchild']);
    expect(a.every((r) => !('archived' in r) && !('tenant_id' in r))).toBe(true);
    const b = await scratch(TENANT_B, BOB, (s) => s.loadScenarios());
    expect(b.map((r) => r.id)).toEqual(expect.arrayContaining([twinB(GC)]));
    expect(b.some((r) => r.id === GC)).toBe(false);
  });

  it('loadInputs: the arguments of resolveInputs; the chain ends with the scenario itself, even with no rows', async () => {
    await asA(async (s) => {
      for (const [key, expected] of Object.entries(fixture.expected)) {
        const got = await s.loadInputs(SCN[key]!);
        expect(got.chain.map((l) => l.scenario_id)).toEqual(expected.chain);
        const resolved = resolveInputs(got.defaults, got.chain, got.overrides, {
          variables: fixture.variable_def.map((v) => v.var_key),
        });
        expect(resolved.values).toEqual(expected.values);
        expect(resolved.overrides).toEqual(expected.overrides);
      }
      // tenant defaults: no chain, no overrides, stored rows only (also a variable the model dropped)
      const defaults = await s.loadInputs(null);
      expect(defaults.chain).toEqual([]);
      expect(defaults.overrides).toEqual([]);
      const byCell = (x: { var_key: string; member_key: string }, y: { var_key: string; member_key: string }) =>
        x.var_key < y.var_key ? -1 : x.var_key > y.var_key ? 1 : x.member_key < y.member_key ? -1 : x.member_key > y.member_key ? 1 : 0;
      expect(defaults.defaults).toEqual([...fixture.variable_value].sort(byCell));

      // a new scenario with no rows of its own: its level is last in the chain, and empty
      await s.createScenario({
        id: uuid(0x601), key: 'fresh', label: 'Fresh', kind: 'user', parent_id: GC, model_version_id: MV1,
        version: 0, locked: false, created_by: ANA, created_at: '2026-11-21T00:00:00.000Z',
      });
      const fresh = await s.loadInputs(uuid(0x601));
      expect(fresh.chain.map((l) => l.scenario_id)).toEqual([...fixture.expected.grandchild!.chain, uuid(0x601)]);
      expect(fresh.chain.at(-1)?.values).toEqual([]);
      expect(fresh.overrides).toEqual([]);
      await expect(s.loadInputs(uuid(0xdead))).rejects.toThrow();
    });
  });

  it('loadMembers: active members only (v_dimension_members), in the spec member order', async () => {
    const m = await asA((s) => s.loadMembers());
    expect(m.vp?.map((x) => x.id)).toEqual(['vp_operations', 'vp_commercial']); // vp_infra is inactive
    expect(m.lever?.map((x) => x.id)).toEqual(['L05', 'L09']);
    expect(m.line?.map((x) => x.id)).toEqual(['it_001', 'it_002']); // it_003 is inactive
    expect(m.vendor).toBeUndefined(); // a dimension the pinned model does not define
    expect(m.pool?.map((x) => x.id)).toEqual(['internal_labour', 'captive_labour', 'software']);
  });

  it('loadMemberRows: line_item and dimension_member rows as the content of MemberWrite.row; absent members are left out', async () => {
    await asA(async (s) => {
      const lines = await s.loadMemberRows('line', ['it_001', 'it_404']);
      expect([...lines.keys()]).toEqual(['it_001']);
      expect(lines.get('it_001')).toEqual({
        legacy_id: 'IT_001', pool_id: 'internal_labour', tenant_l1_label: 'L1', l2: 'L2', name: 'line it_001', vendor_key: null,
        vendor_text: '', nature: 'run', accounting: 'opex', driver_text: '', qty: 1, unit: 'fte', addr_tag: 'locked',
        domain_key: 'd1', scale_driver: 'us', in_scope: true, memo: false, confidence: 'H', source_id: null,
        lever_hook_text: '', notes: '', active: true,
      });
      const vps = await s.loadMemberRows('vp', ['vp_infra', 'vp_operations', 'vp_b']);
      expect([...vps.keys()].sort()).toEqual(['vp_infra', 'vp_operations']); // vp_b is tenant B's
      expect(vps.get('vp_infra')).toEqual({ label: 'Infra', attrs: {}, sort: 3, active: false });
      expect((await s.loadMemberRows('lever', ['L09'])).get('L09')).toEqual({
        label: 'Lever 9', attrs: { alloc_key: 'apps', order: 9 }, sort: 9, active: true,
      });
      expect((await s.loadMemberRows('vp', [])).size).toBe(0);
    });
  });

  it('insertChangeset + change rows round-trip through loadChangeset (note in messages, summary JSON, JSON null old_value, SQL NULL export_value)', async () => {
    const cs = newChangeset();
    const back = await asA(async (s) => {
      await s.insertChangeset(cs);
      return s.loadChangeset(cs.id);
    });
    expect(back).toEqual(cs);
    expect(summaryOf(back!)).toMatchObject({ edits_count: 3, client_request_id: 'rq-1' });
    // change rows come back in seq order whatever the insert order was
    const reversed = newChangeset({ id: uuid(0x502), changes: [...cs.changes].reverse().map((c) => ({ ...c, changeset_id: uuid(0x502) })) });
    const again = await asA(async (s) => {
      await s.insertChangeset(reversed);
      return s.loadChangeset(reversed.id);
    });
    expect(again?.changes.map((c) => c.seq)).toEqual([0, 1, 2]);
    // a changeset with no change rows, and unknown ids
    const empty = newChangeset({ id: uuid(0x503), changes: [] });
    expect(await asA(async (s) => (await s.insertChangeset(empty), s.loadChangeset(empty.id)))).toEqual(empty);
    expect(await asA((s) => s.loadChangeset(uuid(0xdead)))).toBeNull();
    expect(await asA((s) => s.loadChangeset('nope'))).toBeNull();
    // a seeded changeset of the tenant, and another tenant's
    expect((await asA((s) => s.loadChangeset(CS.c1)))?.changes.map((c) => c.key)).toEqual(['g.target_net', 'lev.L09.n']);
    expect(await scratch(TENANT_B, BOB, (s) => s.loadChangeset(CS.c3))).toBeNull();
  });

  it('insertChangeset: a duplicate id is refused; setChangesetStatus changes the status, and refuses an unknown or foreign id', async () => {
    await expect(asA(async (s) => s.insertChangeset(newChangeset({ id: CS.c1, changes: [] })))).rejects.toThrow();
    const status = await asA(async (s) => {
      await s.setChangesetStatus(CS.c1, 'reverted');
      return (await s.loadChangeset(CS.c1))?.status;
    });
    expect(status).toBe('reverted');
    await expect(asA((s) => s.setChangesetStatus(uuid(0xdead), 'reverted'))).rejects.toThrow(/no changeset/);
    await expect(asA((s) => s.setChangesetStatus(twinB(CS.c1), 'reverted'))).rejects.toThrow(/no changeset/);
  });

  it('findChangesetByClientRequest: the changeset the author applied under that key (summary.client_request_id)', async () => {
    await asA(async (s) => {
      const cs = newChangeset();
      await s.insertChangeset(cs);
      expect((await s.findChangesetByClientRequest(ANA, 'rq-1'))?.id).toBe(cs.id);
      expect(await s.findChangesetByClientRequest(ANA, 'rq-2')).toBeNull();
      expect(await s.findChangesetByClientRequest(CAROL, 'rq-1')).toBeNull(); // another author
      expect(await s.findChangesetByClientRequest('nope', 'rq-1')).toBeNull();
      // the key is a bound value, not SQL text
      expect(await s.findChangesetByClientRequest(ANA, "rq-1' or '1'='1")).toBeNull();
    });
    // another tenant's changesets are not visible
    await asA(async (s) => s.insertChangeset(newChangeset()));
    expect(await scratch(TENANT_B, BOB, (s) => s.findChangesetByClientRequest(ANA, 'rq-1'))).toBeNull();
  });

  it('changesSince: status applied or reverted, base_scenario_version >= from, oldest first, with change rows; null = tenant defaults', async () => {
    await asA(async (s) => {
      expect((await s.changesSince(GC, 0)).map((c) => c.id)).toEqual([CS.c1, CS.c2, CS.c3, CS.c5]);
      expect((await s.changesSince(GC, 2)).map((c) => c.id)).toEqual([CS.c3, CS.c5]);
      expect((await s.changesSince(GC, 4)).map((c) => c.id)).toEqual([]);
      expect((await s.changesSince(GC, 0))[0]?.changes).toHaveLength(2);
      expect((await s.changesSince(null, 0)).map((c) => c.id)).toEqual([CS.c4]);
      // pending and rejected changesets are not changes since
      await s.insertChangeset(newChangeset({ id: uuid(0x511), status: 'pending', base_scenario_version: 5, changes: [] }));
      await s.insertChangeset(newChangeset({ id: uuid(0x512), status: 'rejected', base_scenario_version: 5, changes: [] }));
      await s.insertChangeset(newChangeset({ id: uuid(0x513), status: 'reverted', base_scenario_version: 5, changes: [] }));
      expect((await s.changesSince(GC, 4)).map((c) => c.id)).toEqual([uuid(0x513)]);
      expect(await s.changesSince('nope', 0)).toEqual([]);
    });
    expect(await scratch(TENANT_B, BOB, (s) => s.changesSince(GC, 0))).toEqual([]);
  });

  it('writeValue variable_value: upsert (insert, update keeps confidence and source), note, changeset_id, delete', async () => {
    await asA(async (s, tx) => {
      const row = async (key: string, member = '') =>
        (await tx.select().from(variable_value).where(and(eq(variable_value.tenant_id, TENANT_A), eq(variable_value.var_key, key), eq(variable_value.member_key, member))))[0];
      // update of a stored row
      expect((await row('g.target_net'))).toMatchObject({ value: '100', confidence: 'M', note: 'from the filing' });
      await s.writeValue({ target: 'variable_value', key: 'g.target_net', member_key: '', value: 111.25, note: 'user edit', changeset_id: CS.c5 });
      expect(await row('g.target_net')).toMatchObject({ value: '111.25', confidence: 'M', note: 'user edit', changeset_id: CS.c5 });
      // no note: the stale one goes (as the reference store does)
      await s.writeValue({ target: 'variable_value', key: 'g.target_net', member_key: '', value: 112, changeset_id: CS.c5 });
      expect(await row('g.target_net')).toMatchObject({ value: '112', note: '' });
      // insert: confidence defaults, no source
      await s.writeValue({ target: 'variable_value', key: 'lev.start', member_key: 'L99', value: 7, changeset_id: CS.c5 });
      expect(await row('lev.start', 'L99')).toMatchObject({ value: '7', confidence: 'M', source_id: null, note: '' });
      expect((await s.loadInputs(null)).defaults).toContainEqual({ var_key: 'lev.start', member_key: 'L99', value: 7 });
      // delete, also of a row that is not there
      await s.writeValue({ target: 'variable_value', key: 'lev.start', member_key: 'L99', value: null, changeset_id: CS.c5 });
      await s.writeValue({ target: 'variable_value', key: 'lev.start', member_key: 'L99', value: null, changeset_id: CS.c5 });
      expect(await row('lev.start', 'L99')).toBeUndefined();
      await expect(s.writeValue({ target: 'variable_value', key: 'g.x', member_key: '', value: Number.NaN, changeset_id: CS.c5 })).rejects.toThrow(/finite/);
    });
  });

  it('writeValue scenario_value and node_override: upsert, delete, reason; the scenario must be the tenant\'s', async () => {
    await asA(async (s) => {
      await s.writeValue({ target: 'scenario_value', scenario_id: GC, key: 'g.target_net', member_key: '', value: 150, changeset_id: CS.c5 });
      await s.writeValue({ target: 'scenario_value', scenario_id: GC, key: 'g.target_net', member_key: '', value: 155.5, changeset_id: CS.c5 });
      await s.writeValue({ target: 'scenario_value', scenario_id: GC, key: 'new.var', member_key: 'a,b', value: 0.1, changeset_id: CS.c5 });
      await s.writeValue({ target: 'node_override', scenario_id: GC, key: 'res.net', member_key: '', value: 90, reason: 'finance says 90' });
      await s.writeValue({ target: 'node_override', scenario_id: GC, key: 'res.net', member_key: '', value: 91 });
      await s.writeValue({ target: 'node_override', scenario_id: GC, key: 'vp.target', member_key: 'vp_commercial', value: 3, reason: 'r' });
      const got = await s.loadInputs(GC);
      expect(got.chain.at(-1)?.values).toContainEqual({ var_key: 'g.target_net', member_key: '', value: 155.5 });
      expect(got.chain.at(-1)?.values).toContainEqual({ var_key: 'new.var', member_key: 'a,b', value: 0.1 });
      expect(got.overrides).toContainEqual({ node_key: 'res.net', member_key: '', value: 91, reason: '' });
      expect(got.overrides).toContainEqual({ node_key: 'vp.target', member_key: 'vp_commercial', value: 3, reason: 'r' });
      await s.writeValue({ target: 'scenario_value', scenario_id: GC, key: 'new.var', member_key: 'a,b', value: null, changeset_id: CS.c5 });
      await s.writeValue({ target: 'node_override', scenario_id: GC, key: 'res.net', member_key: '', value: null });
      const after = await s.loadInputs(GC);
      expect(after.chain.at(-1)?.values.some((v) => v.var_key === 'new.var')).toBe(false);
      expect(after.overrides.some((o) => o.node_key === 'res.net')).toBe(false);

      // a scenario of another tenant, or none at all: nothing is written
      for (const scenario_id of [GC_B, uuid(0xdead), 'nope']) {
        await expect(s.writeValue({ target: 'scenario_value', scenario_id, key: 'g.target_net', member_key: '', value: 1, changeset_id: CS.c5 })).rejects.toThrow(/no scenario/);
        await expect(s.writeValue({ target: 'node_override', scenario_id, key: 'res.net', member_key: '', value: 1 })).rejects.toThrow(/no scenario/);
      }
    });
  });

  it('writeMember line_item: insert, replace, partial replace, delete (with its lever mappings); loadMembers sees the change', async () => {
    await asA(async (s, tx) => {
      const base = (await s.loadMemberRows('line', ['it_001'])).get('it_001')!;
      await s.writeMember({ target: 'line_item', dim_key: 'line', member_key: 'it_010', row: { ...base, name: 'ten', qty: 2.5 } });
      expect((await s.loadMemberRows('line', ['it_010'])).get('it_010')).toMatchObject({ name: 'ten', qty: 2.5, pool_id: 'internal_labour' });
      expect((await s.loadMembers()).line?.find((m) => m.id === 'it_010')).toMatchObject({ label: 'ten', pool: 'internal_labour', in_scope: 1 });
      // replace of the full row, then a partial row only changes what it names
      await s.writeMember({ target: 'line_item', dim_key: 'line', member_key: 'it_010', row: { ...base, name: 'ten again' } });
      await s.writeMember({ target: 'line_item', dim_key: 'line', member_key: 'it_010', row: { in_scope: false } });
      expect((await s.loadMemberRows('line', ['it_010'])).get('it_010')).toMatchObject({ name: 'ten again', in_scope: false, qty: 1 });
      // soft delete by the active flag is not a member any more
      await s.writeMember({ target: 'line_item', dim_key: 'line', member_key: 'it_010', row: { active: false } });
      expect((await s.loadMembers()).line?.some((m) => m.id === 'it_010')).toBe(false);
      // it_001 has lever mappings: deleting the line removes them too
      expect((await tx.select().from(line_item_lever).where(eq(line_item_lever.tenant_id, TENANT_A))).length).toBe(2);
      await s.writeMember({ target: 'line_item', dim_key: 'line', member_key: 'it_001', row: null });
      expect((await s.loadMemberRows('line', ['it_001'])).size).toBe(0);
      expect((await tx.select().from(line_item_lever).where(eq(line_item_lever.tenant_id, TENANT_A))).length).toBe(0);
      await s.writeMember({ target: 'line_item', dim_key: 'line', member_key: 'it_001', row: null }); // already gone
      // a column the table does not have; a target that does not hold the dimension
      await expect(s.writeMember({ target: 'line_item', dim_key: 'line', member_key: 'it_011', row: { lever_ids: [] } })).rejects.toThrow(/no column lever_ids/);
      await expect(s.writeMember({ target: 'line_item', dim_key: 'vp', member_key: 'x', row: {} })).rejects.toThrow(/does not hold/);
      await expect(s.writeMember({ target: 'dimension_member', dim_key: 'line', member_key: 'x', row: {} })).rejects.toThrow(/does not hold/);
    });
  });

  it('writeMember dimension_member: insert (attrs and active default), replace, delete; loadMembers and loadMemberRows see it', async () => {
    await asA(async (s) => {
      await s.writeMember({ target: 'dimension_member', dim_key: 'vp', member_key: 'vp_new', row: { label: 'New VP', sort: 4 } });
      expect((await s.loadMemberRows('vp', ['vp_new'])).get('vp_new')).toEqual({ label: 'New VP', attrs: {}, sort: 4, active: true });
      expect((await s.loadMembers()).vp?.map((m) => m.id)).toEqual(['vp_operations', 'vp_commercial', 'vp_new']);
      await s.writeMember({ target: 'dimension_member', dim_key: 'lever', member_key: 'L09', row: { label: 'Nine', attrs: { alloc_key: 'si_contingent', order: 9 }, sort: 9, active: true } });
      expect((await s.loadMembers()).lever?.find((m) => m.id === 'L09')).toMatchObject({ label: 'Nine', alloc_key: 'si_contingent', order: 9 });
      // inactive: kept as a row, not a member
      await s.writeMember({ target: 'dimension_member', dim_key: 'vp', member_key: 'vp_new', row: { active: false } });
      expect((await s.loadMembers()).vp?.some((m) => m.id === 'vp_new')).toBe(false);
      expect((await s.loadMemberRows('vp', ['vp_new'])).size).toBe(1);
      await s.writeMember({ target: 'dimension_member', dim_key: 'vp', member_key: 'vp_new', row: null });
      expect((await s.loadMemberRows('vp', ['vp_new'])).size).toBe(0);
      await expect(s.writeMember({ target: 'dimension_member', dim_key: 'vp', member_key: 'x', row: { bogus: 1 } })).rejects.toThrow(/no column bogus/);
    });
  });

  it('createScenario: inserts the row (unique key per tenant); bumpVersion: fromVersion + 1 only if the scenario is still there', async () => {
    await asA(async (s) => {
      const row = {
        id: uuid(0x701), key: 'custom-x', label: 'Custom (from x)', kind: 'user' as const, parent_id: SCN.root!, model_version_id: MV1,
        version: 0, locked: false, created_by: CAROL, created_at: '2026-11-22T08:30:00.000Z',
      };
      await s.createScenario(row);
      expect((await s.loadScenarios()).find((r) => r.id === row.id)).toEqual(row);
      expect(await s.bumpVersion(row.id, 0)).toBe(1);
      expect((await s.loadScenarioForUpdate(row.id))?.version).toBe(1);
      expect(await s.bumpVersion(row.id, 1)).toBe(2);
      await expect(s.bumpVersion(row.id, 1)).rejects.toThrow(ScenarioVersionError);
      await expect(s.bumpVersion(row.id, 5)).rejects.toThrow(/no longer at version 5/);
      await expect(s.bumpVersion(GC_B, 4)).rejects.toThrow(ScenarioVersionError); // tenant B's
      await expect(s.bumpVersion('nope', 0)).rejects.toThrow(ScenarioVersionError);
    });
    await expect(asA(async (s) => s.createScenario({
      id: uuid(0x702), key: 'root', label: 'dup', kind: 'user', parent_id: null, model_version_id: MV1, version: 0, locked: false,
      created_by: ANA, created_at: '2026-11-22T08:30:00.000Z',
    }))).rejects.toThrow();
  });

  it('upsertCalcRun + findCalcRun: keyed (scenario_id, input_hash); a second upsert replaces the run', async () => {
    await asA(async (s, tx) => {
      const run = {
        id: uuid(0x801), scenario_id: GC, scenario_version: 5, model_version_id: MV1, input_hash: 'hash-new', ms: 17,
        outputs: { 'res.net[]': 131.5, nested: { a: [1, null] } }, created_at: '2026-11-22T09:00:00.000Z',
      };
      expect(await s.findCalcRun(GC, 'hash-new')).toBeNull();
      await s.upsertCalcRun(run);
      expect(await s.findCalcRun(GC, 'hash-new')).toEqual(run);
      const replaced = { ...run, id: uuid(0x802), scenario_version: 6, ms: 18.4, outputs: { 'res.net[]': 1 } };
      await s.upsertCalcRun(replaced);
      expect(await s.findCalcRun(GC, 'hash-new')).toEqual({ ...replaced, ms: 18 }); // integer column
      expect((await tx.select().from(calc_run).where(and(eq(calc_run.tenant_id, TENANT_A), eq(calc_run.input_hash, 'hash-new')))).length).toBe(1);
      // other hashes and scenarios are other runs; the seeded one is untouched
      expect((await s.findCalcRun(GC, 'h1'))?.id).toBe(RUN.r1);
      expect(await s.findCalcRun(SCN.child!, 'h1')).toBeNull();
      expect(await s.findCalcRun('nope', 'h1')).toBeNull();
    });
    expect(await scratch(TENANT_B, BOB, (s) => s.findCalcRun(GC_B, 'h1'))).toBeNull(); // B's hash is h1-b
  });

  it('appendAudit: audit_log rows of the tenant, append only', async () => {
    await asA(async (s, tx) => {
      await s.appendAudit({ actor: ANA, action: 'changeset.apply', entity: 'changeset', entity_key: CS.c1, before: null, after: { version: 5 }, at: '2026-11-22T10:00:00.000Z' });
      await s.appendAudit({ actor: CAROL, action: 'scenario.fork', entity: 'scenario', entity_key: GC, before: { a: 1 }, after: [1, 2], at: '2026-11-22T10:00:01.000Z' });
      const rows = await tx.select().from(audit_log).where(eq(audit_log.tenant_id, TENANT_A)).orderBy(audit_log.id);
      expect(rows.map((r) => [r.actor, r.action, r.entity, r.entity_key, r.before, r.after, r.at.toISOString()])).toEqual([
        [ANA, 'changeset.apply', 'changeset', CS.c1, null, { version: 5 }, '2026-11-22T10:00:00.000Z'],
        [CAROL, 'scenario.fork', 'scenario', GC, { a: 1 }, [1, 2], '2026-11-22T10:00:01.000Z'],
      ]);
      // the app role cannot edit or remove its audit trail
      await expect(tx.delete(audit_log)).rejects.toThrow();
    });
  });

  it('updateScenario (ScenarioTx, DATA-13): sets the label, locked and archived it names, never the version; another tenant\'s scenario is not found', async () => {
    await asA(async (s, tx) => {
      const before = (await tx.select().from(scenario).where(eq(scenario.id, GC)))[0]!;
      await s.loadScenarioForUpdate(GC);
      await s.updateScenario(GC, { label: 'Renamed' });
      let row = (await tx.select().from(scenario).where(eq(scenario.id, GC)))[0]!;
      expect(row).toEqual({ ...before, label: 'Renamed' });
      await s.updateScenario(GC, { locked: true, archived: true });
      await s.updateScenario(GC, {}); // nothing named, nothing written
      row = (await tx.select().from(scenario).where(eq(scenario.id, GC)))[0]!;
      expect(row).toEqual({ ...before, label: 'Renamed', locked: true, archived: true });
      await expect(s.updateScenario(GC_B, { label: 'hijacked' })).rejects.toThrow(/no scenario/);
      await expect(s.updateScenario('not-a-uuid', { label: 'x' })).rejects.toThrow(/no scenario/);
    });
    expect((await scratch(TENANT_B, BOB, (_s, tx) => tx.select().from(scenario).where(eq(scenario.id, GC_B))))[0]?.label).toBe('B grandchild');
  });
});

describe('transactions: the caller\'s withTenant transaction, savepoints, scope', () => {
  it('createChangesetStore(tx).transaction commits with the caller; a throw undoes only its own writes', async () => {
    const key = 'tx-test';
    await expect(
      withTenant(app.db, TENANT_A, ANA, async (tx) => {
        const store = createChangesetStore(tx);
        await store.transaction((s) => s.writeValue({ target: 'variable_value', key, member_key: 'kept', value: 1, changeset_id: CS.c5 }));
        await expect(
          store.transaction(async (s) => {
            await s.writeValue({ target: 'variable_value', key, member_key: 'undone', value: 2, changeset_id: CS.c5 });
            throw new Error('boom');
          }),
        ).rejects.toThrow('boom');
        // the caller's transaction is still usable and holds the first write only
        const rows = await tx.select().from(variable_value).where(and(eq(variable_value.tenant_id, TENANT_A), eq(variable_value.var_key, key)));
        expect(rows.map((r) => r.member_key)).toEqual(['kept']);
        // a failed statement inside undoes the savepoint, not the caller's transaction
        await expect(
          store.transaction(async (s) => {
            await s.writeValue({ target: 'variable_value', key, member_key: 'bad', value: 3, changeset_id: 'not-a-uuid' });
          }),
        ).rejects.toThrow();
        expect((await tx.select().from(variable_value).where(eq(variable_value.var_key, key))).length).toBe(1);
        throw new Rollback(undefined);
      }),
    ).rejects.toBeInstanceOf(Rollback);
    // nothing of it survived the caller's rollback
    const left = await withTenant(app.db, TENANT_A, ANA, (tx) => tx.select().from(variable_value).where(eq(variable_value.var_key, key)));
    expect(left).toEqual([]);
  });

  it('createTenantChangesetStore: each transaction is its own withTenant; commits on return, rolls back on a throw', async () => {
    const store = createTenantChangesetStore(app.db, TENANT_A, ANA);
    const key = 'tenant-store-test';
    await store.transaction((s) => s.writeValue({ target: 'variable_value', key, member_key: '', value: 5, changeset_id: CS.c5 }));
    await expect(
      store.transaction(async (s) => {
        await s.writeValue({ target: 'variable_value', key: `${key}-2`, member_key: '', value: 6, changeset_id: CS.c5 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rows = await withTenant(app.db, TENANT_A, ANA, (tx) => tx.select().from(variable_value).where(sql`${variable_value.var_key} like ${`${key}%`}`));
    expect(rows.map((r) => r.var_key)).toEqual([key]);
    // the same store under another tenant sees none of it
    const other = createTenantChangesetStore(app.db, TENANT_B, BOB);
    expect((await other.transaction((s) => s.loadInputs(null))).defaults.some((d) => d.var_key === key)).toBe(false);
    await withTenant(app.db, TENANT_A, ANA, (tx) => tx.delete(variable_value).where(eq(variable_value.var_key, key)));
  });

  it('refuses any transaction that is not the one of a live withTenant (TenantScopeError, before any SQL)', async () => {
    expect(() => createChangesetStore(app.db as unknown as TenantTx)).toThrow(TenantScopeError);
    await app.db.transaction(async (bare) => {
      expect(() => changesetTx(bare)).not.toThrow(); // the view is lazy; its first call checks the scope
      await expect(changesetTx(bare).loadScenarios()).rejects.toThrow(TenantScopeError);
      await expect(changesetTx(bare).lockTenantDefaults()).rejects.toThrow(TenantScopeError);
    });
    let kept!: ChangesetTx;
    await withTenant(app.db, TENANT_A, ANA, async (tx) => {
      kept = changesetTx(tx);
    });
    await expect(kept.loadScenarios()).rejects.toThrow(TenantScopeError);
    await expect(kept.appendAudit({ actor: ANA, action: 'a', entity: 'e', entity_key: 'k', before: null, after: null, at: '2026-11-22T10:00:00.000Z' })).rejects.toThrow(TenantScopeError);
  });
});

describe('row-level security on the write path: a row with another tenant_id fails the WITH CHECK (pg-local)', () => {
  const B = TENANT_B;
  const row = {
    scenario: () => ({ tenant_id: B, id: uuid(0x901), key: 'x', label: 'x', kind: 'user' as const, parent_id: null, model_version_id: MV1, version: 0, locked: false, created_by: ANA, created_at: new Date() }),
  };
  const writes: Record<string, (tx: TenantTx) => PromiseLike<unknown>> = {
    scenario: (tx) => tx.insert(scenario).values(row.scenario()),
    variable_value: (tx) => tx.insert(variable_value).values({ tenant_id: B, var_key: 'v', member_key: '', value: '1', source_id: null, confidence: 'M', note: '', changeset_id: CS.c1, updated_at: new Date() }),
    scenario_value: (tx) => tx.insert(scenario_value).values({ tenant_id: B, scenario_id: GC, var_key: 'v', member_key: '', value: '1', changeset_id: CS.c1 }),
    node_override: (tx) => tx.insert(node_override).values({ tenant_id: B, scenario_id: GC, node_key: 'n', member_key: '', value: '1', reason: '' }),
    dimension_member: (tx) => tx.insert(dimension_member).values({ tenant_id: B, dim_key: 'vp', member_key: 'm', label: 'm', attrs: {}, sort: 1, active: true }),
    line_item: (tx) => tx.insert(line_item).values({
      tenant_id: B, member_key: 'it_099', legacy_id: 'x', pool_id: 'software', tenant_l1_label: '', l2: '', name: 'n', vendor_key: null, vendor_text: '',
      nature: '', accounting: '', driver_text: '', qty: '1', unit: '', addr_tag: 'locked', domain_key: 'd', scale_driver: 'us', in_scope: true,
      memo: false, confidence: 'H', source_id: null, lever_hook_text: '', notes: '', active: true,
    }),
    changeset: (tx) => tx.insert(changeset).values({ tenant_id: B, id: uuid(0x902), origin: 'ui', scenario_id: null, base_scenario_version: 0, status: 'applied', summary: {}, created_by: ANA, created_at: new Date(), reverts_id: null }),
    change: (tx) => tx.insert(change).values({ tenant_id: B, changeset_id: CS.c1, seq: 9, target: 'scenario_value', key: 'k', member_key: '', op: 'insert', old_value: 1, new_value: 2, export_value: null, status: 'clean', messages: {} }),
    calc_run: (tx) => tx.insert(calc_run).values({ tenant_id: B, id: uuid(0x903), scenario_id: GC, scenario_version: 1, model_version_id: MV1, input_hash: 'h', ms: 1, outputs: {}, created_at: new Date() }),
    audit_log: (tx) => tx.insert(audit_log).values({ tenant_id: B, actor: ANA, action: 'a', entity: 'e', entity_key: 'k', before: null, after: null, at: new Date() }),
  };

  for (const [table, write] of Object.entries(writes)) {
    it(`${table}: insert with tenant_id of another tenant is refused`, async () => {
      const err = await withTenant(app.db, TENANT_A, ANA, async (tx) => write(tx).then(() => null, (e: unknown) => e));
      expect(err, `${table} accepted a row of another tenant`).not.toBeNull();
      expect(message(err)).toMatch(/row-level security/);
    });
  }

  it('the same insert with the caller\'s own tenant_id is accepted (the failures above are RLS, not the row)', async () => {
    await scratch(TENANT_A, ANA, async (_s, tx) => {
      await tx.insert(scenario).values({ ...row.scenario(), tenant_id: TENANT_A });
      await tx.insert(addr_tag).values({ id: 'x', label: 'x' }).catch((e: unknown) => expect(message(e)).toMatch(/permission denied/)); // global tables stay read-only
    });
  });

  it('through the store: another tenant\'s scenarios, changesets and values are neither read nor written', async () => {
    await asA(async (s, tx) => {
      expect(await s.loadScenarioForUpdate(GC_B)).toBeNull();
      await expect(s.writeValue({ target: 'scenario_value', scenario_id: GC_B, key: 'k', member_key: '', value: 1, changeset_id: CS.c1 })).rejects.toThrow(/no scenario/);
      await expect(s.setChangesetStatus(twinB(CS.c1), 'reverted')).rejects.toThrow(/no changeset/);
      await expect(s.bumpVersion(GC_B, 4)).rejects.toThrow(ScenarioVersionError);
      // an update aimed at B's row by id finds nothing under A's context
      const hit = await tx.update(scenario).set({ label: 'hijacked' }).where(eq(scenario.id, GC_B)).returning({ id: scenario.id });
      expect(hit).toEqual([]);
    });
    const b = await scratch(TENANT_B, BOB, (s) => s.loadScenarioForUpdate(GC_B));
    expect(b?.label).toBe('B grandchild');
  });
});

describe('applyChangeset (DOM-03) end to end on Postgres (tenant C)', () => {
  const bundle = {
    variables: [
      { id: 'g.target_net', kind: 'decision', label: 'Net', unit: 'USD m', type: 'number', dims: [], min: 0, max: 250.5, step: 0.5, layer: 'inputs', role: 'driver', ui: { control: 'slider', hero: true }, scenario_varies: true },
      { id: 'g.head_start', kind: 'decision', label: 'Head start', unit: 'x', type: 'number', dims: [], min: null, max: null, step: null, layer: 'inputs', role: 'driver', ui: { control: 'slider', hero: false }, scenario_varies: true },
    ],
    nodes: [{ id: 'res.net', dims: [], unit: 'USD m', label: 'Net', layer: 'result', output: true, expr: 'g.target_net' }],
    dimensions: [
      { id: 'vp', label: 'VP', scope: 'tenant', attributes: ['label'] },
      { id: 'line', label: 'Line', scope: 'tenant', attributes: [] },
    ],
  } as unknown as Pick<ModelBundle, 'variables' | 'nodes' | 'dimensions'>;
  const draft = (over: Partial<ChangesetDraft> = {}): ChangesetDraft => ({
    origin: 'ui', scenario_id: PRESET_C, base_scenario_version: 0,
    changes: [{ target: 'variable', key: 'g.target_net', member_key: '', op: 'set', new_value: 120, note: 'ask' }],
    ...over,
  });
  const apply = (store: ReturnType<typeof createChangesetStore>, d: ChangesetDraft, extra: Record<string, unknown> = {}) =>
    applyChangeset(store, d, { actor: ANA, bundle, ...extra });
  const inC = <T>(fn: (store: ReturnType<typeof createChangesetStore>, tx: TenantTx) => Promise<T>): Promise<T> =>
    scratch(TENANT_C, ANA, (_s, tx) => fn(createChangesetStore(tx), tx));

  it('a UI edit of a locked preset forks it: scenario, changeset and change rows, scenario_value, version, edits count, audit rows', async () => {
    await inC(async (store, tx) => {
      const r = await apply(store, draft(), { clientRequestId: 'rq-fork' });
      expect(r.forkedFrom).toBe(PRESET_C);
      expect(r.scenarioId).not.toBe(PRESET_C);
      expect(r).toMatchObject({ version: 1, editsCount: 1, replayed: false });
      const fork = (await tx.select().from(scenario).where(eq(scenario.id, r.scenarioId!)))[0]!;
      expect(fork).toMatchObject({ kind: 'user', parent_id: PRESET_C, version: 1, locked: false, created_by: ANA, label: 'Custom (from rates)' });
      const [cs] = await tx.select().from(changeset).where(eq(changeset.id, r.changesetId));
      expect(cs).toMatchObject({ scenario_id: fork.id, status: 'applied', created_by: ANA, origin: 'ui', base_scenario_version: 0 });
      expect(cs!.summary).toMatchObject({ changes: 1, edits: 1, edits_count: 1, client_request_id: 'rq-fork', forked_from: PRESET_C });
      const rows = await tx.select().from(change).where(eq(change.changeset_id, r.changesetId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ target: 'scenario_value', key: 'g.target_net', op: 'insert', old_value: 100, new_value: 120, messages: { note: 'ask' } });
      const [v] = await tx.select().from(scenario_value).where(eq(scenario_value.scenario_id, fork.id));
      expect(v).toMatchObject({ var_key: 'g.target_net', value: '120', changeset_id: r.changesetId });
      const audit = await tx.select().from(audit_log).where(eq(audit_log.tenant_id, TENANT_C)).orderBy(audit_log.id);
      expect(audit.map((a) => a.action)).toEqual(['scenario.fork', 'changeset.apply']);
      expect(audit.every((a) => a.actor === ANA)).toBe(true);
      // the preset itself is untouched
      expect((await tx.select().from(scenario).where(eq(scenario.id, PRESET_C)))[0]?.version).toBe(0);
      expect(await tx.select().from(scenario_value).where(eq(scenario_value.scenario_id, PRESET_C))).toEqual([]);

      // a replay under the same key writes nothing and answers with the first result
      const again = await apply(store, draft({ scenario_id: r.scenarioId, base_scenario_version: 99 }), { clientRequestId: 'rq-fork' });
      expect(again).toMatchObject({ replayed: true, changesetId: r.changesetId, version: 1, editsCount: 1 });
      expect((await tx.select().from(changeset).where(and(eq(changeset.tenant_id, TENANT_C), ne(changeset.id, SEED_CS_C)))).length).toBe(1);
    });
  });

  it('a second edit on the fork bumps the version; a stale base version is a conflict with the changes since', async () => {
    await inC(async (store) => {
      const first = await apply(store, draft());
      const fork = first.scenarioId!;
      const second = await apply(store, draft({ scenario_id: fork, base_scenario_version: 1, changes: [{ target: 'variable', key: 'g.target_net', member_key: '', op: 'set', new_value: 130 }] }));
      expect(second).toMatchObject({ version: 2, editsCount: 2, replayed: false });
      expect(second.changeset.changes[0]).toMatchObject({ op: 'update', old_value: 120, new_value: 130 });
      const err = await apply(store, draft({ scenario_id: fork, base_scenario_version: 1 })).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ChangesetConflictError);
      expect((err as ChangesetConflictError).serverVersion).toBe(2);
      expect((err as ChangesetConflictError).changesSince.map((c) => c.id)).toEqual([second.changesetId]);
    });
  });

  it('UI clamps a value past the registry bound; an API value past it is rejected and nothing is written', async () => {
    await inC(async (store, tx) => {
      const clamped = await apply(store, draft({ changes: [{ target: 'variable', key: 'g.target_net', member_key: '', op: 'set', new_value: 9999 }] }));
      expect(clamped.clamped).toEqual([expect.objectContaining({ requested: 9999, value: 250.5 })]);
      const [v] = await tx.select().from(scenario_value).where(eq(scenario_value.scenario_id, clamped.scenarioId!));
      expect(v?.value).toBe('250.5');
      const before = (await tx.select().from(changeset)).length;
      await expect(
        apply(store, draft({ origin: 'api', scenario_id: clamped.scenarioId, base_scenario_version: 1, changes: [{ target: 'variable', key: 'g.target_net', member_key: '', op: 'set', new_value: 9999 }] })),
      ).rejects.toBeInstanceOf(ChangesetRejectedError);
      expect((await tx.select().from(changeset)).length).toBe(before);
      expect((await tx.select().from(scenario).where(eq(scenario.id, clamped.scenarioId!)))[0]?.version).toBe(1);
    });
  });

  it('tenant defaults: the note is kept on the variable_value row and in change.messages; the version is the changeset count', async () => {
    await inC(async (store, tx) => {
      const d = (base: number, value: number): ChangesetDraft => ({
        origin: 'ui', scenario_id: null, base_scenario_version: base,
        changes: [{ target: 'variable', key: 'g.head_start', member_key: '', op: 'set', new_value: value, note: `now ${value}` }],
      });
      // the seed changeset (SEED_CS_C) wrote the defaults: they start at version 1
      const one = await apply(store, d(1, 2));
      expect(one).toMatchObject({ scenarioId: null, version: 2 });
      const [vv] = await tx.select().from(variable_value).where(and(eq(variable_value.tenant_id, TENANT_C), eq(variable_value.var_key, 'g.head_start')));
      expect(vv).toMatchObject({ value: '2', note: 'now 2', confidence: 'L', changeset_id: one.changesetId });
      expect(one.changeset.changes[0]).toMatchObject({ old_value: 1, new_value: 2, messages: { note: 'now 2' } });
      expect(await apply(store, d(2, 3))).toMatchObject({ version: 3 });
      await expect(apply(store, d(2, 4))).rejects.toBeInstanceOf(ChangesetConflictError);
    });
  });

  it('an override and a structural insert land in node_override (reason) and dimension_member; undo restores and marks the changeset reverted', async () => {
    await inC(async (store, tx) => {
      const r = await apply(
        store,
        draft({
          origin: 'seed', // writes a locked preset in place
          changes: [
            { target: 'override', key: 'res.net', member_key: '', op: 'set', new_value: 77, note: 'finance says 77' },
            { target: 'structural', key: 'vp', member_key: 'vp_x', op: 'insert', new_value: { label: 'VP X', attrs: {}, sort: 1, active: true } },
          ],
        }),
      );
      expect(r.scenarioId).toBe(PRESET_C);
      expect(await tx.select().from(node_override).where(eq(node_override.scenario_id, PRESET_C))).toEqual([
        expect.objectContaining({ tenant_id: TENANT_C, node_key: 'res.net', member_key: '', value: '77', reason: 'finance says 77' }),
      ]);
      expect((await tx.select().from(dimension_member).where(eq(dimension_member.tenant_id, TENANT_C))).map((m) => m.member_key)).toEqual(['vp_x']);
      expect((await store.transaction((s) => s.loadMembers())).vp?.map((m) => m.id)).toEqual(['vp_x']);

      const undo = await apply(store, reverse(r.changeset, r.version), { actor: ANA });
      expect(undo.changeset.reverts_id).toBe(r.changesetId);
      expect(await tx.select().from(node_override).where(eq(node_override.scenario_id, PRESET_C))).toEqual([]);
      expect(await tx.select().from(dimension_member).where(eq(dimension_member.tenant_id, TENANT_C))).toEqual([]);
      const [orig] = await tx.select().from(changeset).where(eq(changeset.id, r.changesetId));
      expect(orig?.status).toBe('reverted');
      expect(summaryOf((await store.transaction((s) => s.loadChangeset(undo.changesetId)))!).edits_count).toBe(0);
      const actions = (await tx.select().from(audit_log).where(eq(audit_log.tenant_id, TENANT_C)).orderBy(audit_log.id)).map((a) => a.action);
      expect(actions).toEqual(['changeset.apply', 'changeset.apply', 'changeset.revert']);
    });
  });

  it('a draft the rules reject leaves nothing behind in the committed store (createTenantChangesetStore)', async () => {
    const store = createTenantChangesetStore(app.db, TENANT_C, ANA);
    const count = () => withTenant(app.db, TENANT_C, ANA, async (tx) => (await tx.select().from(changeset).where(eq(changeset.tenant_id, TENANT_C))).length);
    const before = await count();
    await expect(
      applyChangeset(store, { origin: 'api', scenario_id: PRESET_C, base_scenario_version: 0, changes: [{ target: 'variable', key: 'g.target_net', member_key: '', op: 'set', new_value: -5 }] }, { actor: ANA, bundle }),
    ).rejects.toBeInstanceOf(ChangesetRejectedError);
    expect(await count()).toBe(before);
    // a committed apply on the same store, then a concurrent pair of identical bases: exactly one wins
    const a = await applyChangeset(store, { ...draft(), origin: 'seed' }, { actor: ANA, bundle });
    expect(a.version).toBe(1);
    const results = await Promise.allSettled([
      applyChangeset(store, { ...draft({ origin: 'seed', base_scenario_version: 1, changes: [{ target: 'variable', key: 'g.target_net', member_key: '', op: 'set', new_value: 101 }] }) }, { actor: ANA, bundle }),
      applyChangeset(store, { ...draft({ origin: 'seed', base_scenario_version: 1, changes: [{ target: 'variable', key: 'g.target_net', member_key: '', op: 'set', new_value: 102 }] }) }, { actor: ANA, bundle }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ChangesetConflictError);
    await withTenant(app.db, TENANT_C, ANA, async (tx) => {
      expect((await tx.select().from(scenario).where(eq(scenario.id, PRESET_C)))[0]?.version).toBe(2);
    });
  });
});
