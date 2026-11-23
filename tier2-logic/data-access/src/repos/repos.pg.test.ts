import { resolveInputs, resolveScenarioChain } from '@glidepath/domain';
import { getTestDatabaseUrl } from '@glidepath/pg-local';
import { membersHash } from '@glidepath/spec';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db';
import type { DbHandle } from '../db';
import { migrate } from '../migrate';
import { TenantScopeError } from '../scope';
import { withTenant, withUser } from '../tenant';
import type { TenantTx } from '../tenant';
import { createAppRoleDb, recordQueries } from '../testing/app-db';
import type { RecordedQuery } from '../testing/app-db';
import {
  ANA, B_OFFSET, BOB, CAROL, CS, GHOST, MV1, MV2, RUN, SCN, SLUG_A, SLUG_B, TENANT_A, TENANT_B, fixture, seedMinimal,
  twinB,
} from '../testing/minimal-seed';
import { createOwnedDatabase } from '../testing/owner-db';
import type { OwnedDatabase } from '../testing/owner-db';
import * as repos from './index';
import { InvalidCursorError } from './changesets';
import {
  findMyMembership, getChangeset, getCurrentUser, getLatestCalcRun, getScenario, getTenant, listChangesetHistory,
  listMyMemberships, listScenarios, listTenantMembers, loadMembers, loadModelDefs, loadResolvedInputs,
} from './index';

/**
 * DATA-05 on pg-local: migrated as a non-superuser owner, seeded with two tenants (testing/minimal-seed),
 * read as glidepath_app (RLS applies, only the grants of 0002_rls.sql).
 */

let owned: OwnedDatabase;
let owner: DbHandle;
let app: DbHandle;
let log: RecordedQuery[];

beforeAll(async () => {
  const adminUrl = await getTestDatabaseUrl();
  owned = await createOwnedDatabase(adminUrl);
  await migrate(owned.url);
  owner = createDb(owned.url);
  await seedMinimal(owner.db);
  app = createAppRoleDb(adminUrl, owned.database);
  log = recordQueries(app.pool);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await owned?.drop();
});

const asA = <T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> => withTenant(app.db, TENANT_A, ANA, fn);
const asB = <T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> => withTenant(app.db, TENANT_B, BOB, fn);
const asUser = <T>(user: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> => withUser(app.db, user, fn);
const codePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

describe('read repos: model bundle defs (global tables), members via v_dimension_members (+ members_hash), scenarios, resolved inputs via v_inputs_resolved, changeset history, latest calc_run, memberships (pg-local + minimal seed)', () => {
  it('reads as glidepath_app, under row-level security', async () => {
    const who = await asA(async (tx) => (await tx.execute<{ u: string }>(sql`select current_user as u`)).rows[0]?.u);
    expect(who).toBe('glidepath_app');
    // without tenant context the app role sees no tenant rows at all
    const none = await app.db.execute(sql`select 1 from scenario`);
    expect(none.rows).toHaveLength(0);
  });

  it('loadModelDefs: model_version, dimension_def, variable_def, node_def, lever_template of the pinned model version', async () => {
    const a = await asA(loadModelDefs);
    expect(a?.modelVersion).toEqual({
      id: MV1, semver: '1.0.0', status: 'published', notes: 'pinned by A', created_at: '2026-09-01T00:00:00.000Z',
    });
    expect(a?.dimensions.map((d) => d.dim_key)).toEqual(['addr_tag', 'iyear', 'lever', 'lgroup', 'line', 'pool', 'vp']);
    expect(a?.dimensions.find((d) => d.dim_key === 'lever')).toEqual({
      dim_key: 'lever', scope: 'global+tenant', attributes: ['label', 'order', 'alloc_key'],
    });
    expect(a?.variables.map((v) => v.var_key)).toEqual(fixture.variable_def.map((v) => v.var_key).sort(codePoint));
    expect(a?.variables.find((v) => v.var_key === 'g.target_net')).toEqual({
      var_key: 'g.target_net', dims: [], label: 'g.target_net label', unit: 'USD m', type: 'number',
      min: 0, max: 250.5, step: 0.5, group: 'goal', layer: 'inputs', role: 'driver',
      ui: { control: 'slider', hero: true }, dist: null, validation: null, legacy: [],
    });
    expect(a?.variables.find((v) => v.var_key === 'corp.lab_hc_g')).toMatchObject({ dims: ['lgroup', 'iyear'], min: null, max: null, step: null });
    expect(a?.nodes.map((n) => n.node_key)).toEqual(['base.pool_outlay', 'res.net', 'vp.target']);
    expect(a?.nodes.find((n) => n.node_key === 'vp.target')).toMatchObject({
      dims: ['vp'], expr: null, cases: [{ when: null, expr: '1' }], members: null, output: false, overridable: false,
    });
    expect(a?.nodes.find((n) => n.node_key === 'res.net')).toMatchObject({ expr: 'g.target_net', output: true, overridable: true });
    expect(a?.nodes.find((n) => n.node_key === 'base.pool_outlay')?.members).toEqual({ pool: ['software'] });
    expect(a?.leverTemplates.map((l) => l.code)).toEqual(['L05', 'L09']);
    expect(a?.leverTemplates[0]).toEqual({
      code: 'L05', label: 'Lever L05', category: 'labour', default_alloc_key: 'apps',
      node_keys: ['lev.L05.save'], var_keys: ['lev.L05.n'], library: { hypothesis: 'h L05' },
    });

    // B pins MV2: its own definitions, none of A's model
    const b = await asB(loadModelDefs);
    expect(b?.modelVersion.id).toBe(MV2);
    expect(b?.variables.map((v) => v.var_key)).toContain('g.mv2_only');
    expect(b?.dimensions.map((d) => d.dim_key)).toContain('vendor');
    expect(b?.nodes.map((n) => n.node_key)).toContain('res.mv2_only');
    expect(a?.variables.map((v) => v.var_key)).not.toContain('g.mv2_only');
  });

  it('loadMembers: v_dimension_members in member order (sort, never key alone), active members as TenantMembers, membersHash', async () => {
    const a = await asA(loadMembers);
    // only the dimensions of the pinned model: no vendor (not in MV1), no akey/year (system, not defined in MV1)
    expect([...new Set(a.rows.map((r) => r.dim_key))]).toEqual(['addr_tag', 'iyear', 'lever', 'lgroup', 'line', 'pool', 'vp']);
    const ids = (dim: string) => a.members[dim]?.map((m) => m.id);
    expect(ids('pool')).toEqual(['internal_labour', 'captive_labour', 'software']); // canonical_pool.sort
    expect(ids('vp')).toEqual(['vp_operations', 'vp_commercial']); // sort; vp_infra is inactive
    expect(ids('lgroup')).toEqual(['pilots', 'flight_attendants']);
    expect(ids('lever')).toEqual(['L05', 'L09']);
    expect(ids('iyear')).toEqual(['fy25', 'fy26', 'fy27']); // the model's order (system dimension)
    expect(ids('line')).toEqual(['it_001', 'it_002']); // no sort column: member_key; it_003 inactive
    expect(ids('addr_tag')).toEqual(['addressable', 'locked', 'partly']); // no sort column: member_key
    expect(a.rows.filter((r) => r.dim_key === 'vp').map((r) => [r.member_key, r.active, r.origin])).toEqual([
      ['vp_operations', true, 'tenant'], ['vp_commercial', true, 'tenant'], ['vp_infra', false, 'tenant'],
    ]);
    expect(a.members.pool?.[0]).toEqual({ id: 'internal_labour', label: 'US labour', third_party: 0, order: 1 });
    expect(a.members.lever?.[0]).toEqual({ id: 'L05', label: 'Lever 5', alloc_key: 'si_contingent', order: 5 });
    expect(a.members.line?.[0]).toMatchObject({
      id: 'it_001', label: 'line it_001', pool: 'internal_labour', addr: 'locked', domain: 'd1', drv: 'us',
      lever_ids: ['L05', 'L09'], in_scope: 1, memo: 0, legacy_id: 'IT_001',
    });
    expect(a.rows.find((r) => r.member_key === 'it_003')).toMatchObject({ dim_key: 'line', active: false, origin: 'line_item' });
    expect(a.membersHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.membersHash).toBe(membersHash(a.members));

    const b = await asB(loadMembers);
    expect(b.members.vp?.map((m) => m.id)).toEqual(['vp_b']);
    expect(b.members.vendor?.map((m) => m.id)).toEqual(['vendor_b']); // MV2 defines vendor
    expect(b.members.line).toEqual([expect.objectContaining({ id: 'it_001', label: 'Tenant B line', pool: 'captive_labour', lever_ids: [] })]);
    expect(b.membersHash).not.toBe(a.membersHash);
  });

  it('listScenarios / getScenario: the tenant scenarios with kind, parent, version, locked, archived', async () => {
    const list = await asA(listScenarios);
    expect(list.map((s) => s.key)).toEqual(['root', 'child', 'sibling', 'grandchild']);
    expect(list[0]).toEqual({
      id: SCN.root, key: 'root', label: 'root', kind: 'preset', parent_id: null, model_version_id: MV1, version: 3,
      locked: true, created_by: ANA, created_at: '2026-10-01T00:00:00.000Z', archived: false,
    });
    expect(list.find((s) => s.key === 'sibling')).toMatchObject({ parent_id: SCN.root, archived: true, kind: 'user', locked: false });
    expect(await asA((tx) => getScenario(tx, SCN.grandchild!))).toMatchObject({ key: 'grandchild', parent_id: SCN.child, version: 4 });
    expect(await asA((tx) => getScenario(tx, twinB(SCN.grandchild!)))).toBeNull(); // B's scenario
    expect(await asA((tx) => getScenario(tx, 'not-a-uuid'))).toBeNull();
    expect((await asB(listScenarios)).map((s) => s.id)).toEqual([SCN.root, SCN.child, SCN.sibling, SCN.grandchild].map((x) => twinB(x!)));
  });

  it('loadResolvedInputs: v_inputs_resolved per scenario equals the fixture and the domain resolveInputs', async () => {
    const scenarios = fixture.scenario;
    const variables = fixture.variable_def.map((v) => v.var_key);
    for (const [key, expected] of Object.entries(fixture.expected)) {
      const id = SCN[key]!;
      const got = await asA((tx) => loadResolvedInputs(tx, id));
      expect(got?.scenario_id).toBe(id);
      expect(got?.values.map(({ var_key, member_key, value, scenario_id }) => ({ var_key, member_key, value, scenario_id }))).toEqual(expected.values);
      expect(got?.overrides).toEqual(expected.overrides);
      for (const v of got?.values ?? []) {
        expect(v.resolved_from).toBe(v.scenario_id === null ? 'tenant' : v.scenario_id === id ? 'scenario' : 'parent');
      }
      // the same answer as the domain's pure resolution of the stored rows
      const chain = resolveScenarioChain(scenarios, id);
      const domain = resolveInputs(
        fixture.variable_value,
        chain.map((sid) => ({ scenario_id: sid, values: fixture.scenario_value.filter((r) => r.scenario_id === sid) })),
        fixture.node_override.filter((o) => o.scenario_id === id),
        { variables },
      );
      expect(got?.values.map(({ var_key, member_key, value, scenario_id }) => ({ var_key, member_key, value, scenario_id }))).toEqual(domain.values);
    }
    // tenant defaults: scenario null; provenance columns of the default row
    const defaults = await asA((tx) => loadResolvedInputs(tx, null));
    expect(defaults?.values).toEqual(resolveInputs(fixture.variable_value, [], [], { variables }).values.map((v) => ({
      ...v, resolved_from: 'tenant', confidence: v.var_key === 'g.target_net' ? 'M' : 'H', note: v.var_key === 'g.target_net' ? 'from the filing' : '',
    })));
    expect(defaults?.overrides).toEqual([]);
    // B's values carry the offset; A never sees them, and B's scenario is unknown to A
    const b = await asB((tx) => loadResolvedInputs(tx, twinB(SCN.grandchild!)));
    expect(b?.values.find((v) => v.var_key === 'g.target_net')?.value).toBe(130 + B_OFFSET);
    expect(await asA((tx) => loadResolvedInputs(tx, twinB(SCN.grandchild!)))).toBeNull();
    expect(await asA((tx) => loadResolvedInputs(tx, 'nope'))).toBeNull();
  });

  it('listChangesetHistory / getChangeset: newest first with change rows and author, keyset pages', async () => {
    const all = await asA((tx) => listChangesetHistory(tx, SCN.grandchild!));
    // c3 and c5 share created_at to the microsecond: id breaks the tie
    expect(all.changesets.map((c) => c.id)).toEqual([CS.c5, CS.c3, CS.c2, CS.c1]);
    expect(all.nextCursor).toBeNull();
    const c1 = all.changesets[3]!;
    expect(c1).toMatchObject({
      origin: 'ui', scenario_id: SCN.grandchild, base_scenario_version: 0, status: 'applied', summary: { edits: 2 },
      created_by: ANA, created_by_name: 'Ana', created_at: '2026-11-01T10:00:00.000Z', reverts_id: null,
    });
    expect(c1.changes.map((c) => [c.seq, c.key, c.old_value, c.new_value])).toEqual([[0, 'g.target_net', 120, 130], [1, 'lev.L09.n', 10, 40]]);
    expect(c1.changes[0]).toEqual({
      changeset_id: CS.c1, seq: 0, target: 'scenario_value', key: 'g.target_net', member_key: '', op: 'update',
      old_value: 120, new_value: 130, export_value: null, status: 'clean', messages: [],
    });
    expect(all.changesets[1]).toMatchObject({ created_by: CAROL, created_by_name: 'Carol', reverts_id: CS.c2, changes: [] });
    expect(all.changesets[2]).toMatchObject({ origin: 'excel_import', status: 'reverted' });

    // pages of one: every changeset exactly once, in order (microsecond keyset, no skip at the tie)
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listChangesetHistory>> = await asA((tx) => listChangesetHistory(tx, SCN.grandchild!, { limit: 1, cursor }));
      seen.push(...page.changesets.map((c) => c.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([CS.c5, CS.c3, CS.c2, CS.c1]);
    const two = await asA((tx) => listChangesetHistory(tx, SCN.grandchild!, { limit: 2 }));
    expect(two.changesets.map((c) => c.id)).toEqual([CS.c5, CS.c3]);
    expect(two.nextCursor).not.toBeNull();

    // tenant defaults, unknown author
    const defaults = await asA((tx) => listChangesetHistory(tx, null));
    expect(defaults.changesets.map((c) => [c.id, c.origin, c.created_by, c.created_by_name])).toEqual([[CS.c4, 'seed', GHOST, null]]);
    // bad input
    await expect(asA((tx) => listChangesetHistory(tx, SCN.grandchild!, { cursor: 'garbage' }))).rejects.toThrow(InvalidCursorError);
    await expect(asA((tx) => listChangesetHistory(tx, SCN.grandchild!, { limit: 0 }))).rejects.toThrow(RangeError);
    expect((await asA((tx) => listChangesetHistory(tx, 'not-a-uuid'))).changesets).toEqual([]);

    expect(await asA((tx) => getChangeset(tx, CS.c1))).toEqual(c1);
    expect(await asA((tx) => getChangeset(tx, twinB(CS.c1)))).toBeNull(); // B's changeset
    const b = await asB((tx) => listChangesetHistory(tx, twinB(SCN.grandchild!)));
    expect(b.changesets.map((c) => [c.id, c.created_by_name, c.changes.length])).toEqual([[twinB(CS.c1), 'Bob', 2]]);
  });

  it('getLatestCalcRun: the newest calc_run of the scenario', async () => {
    expect(await asA((tx) => getLatestCalcRun(tx, SCN.grandchild!))).toEqual({
      id: RUN.r2, scenario_id: SCN.grandchild, scenario_version: 4, model_version_id: MV1, input_hash: 'h2', ms: 12,
      outputs: { 'res.net[]': 134 }, created_at: '2026-11-03T12:00:00.000Z',
    });
    expect(await asA((tx) => getLatestCalcRun(tx, SCN.root!))).toBeNull();
    expect(await asA((tx) => getLatestCalcRun(tx, twinB(SCN.grandchild!)))).toBeNull();
    expect((await asB((tx) => getLatestCalcRun(tx, twinB(SCN.grandchild!))))?.input_hash).toBe('h9-b');
  });

  it('memberships: the user\'s tenants and roles before a tenant is chosen; the tenant, its members and the user inside it', async () => {
    const ana = await asUser(ANA, listMyMemberships);
    expect(ana.map((m) => [m.tenant.slug, m.role])).toEqual([[SLUG_A, 'owner'], [SLUG_B, 'viewer']]);
    expect(ana[1]?.tenant).toEqual({
      id: TENANT_B, slug: SLUG_B, name: 'Tenant B', currency: 'EUR', base_year: 2025, target_year: 2026,
      fiscal_calendar: 'fiscal', ticker: 'TB', model_version_id: MV2, status: 'setup', created_at: '2026-09-11T00:00:00.000Z',
    });
    expect((await asUser(BOB, listMyMemberships)).map((m) => [m.tenant.slug, m.role])).toEqual([[SLUG_B, 'editor']]);
    expect(await asUser(CAROL, listMyMemberships)).toEqual([]);

    expect(await asUser(ANA, (tx) => findMyMembership(tx, SLUG_B))).toMatchObject({ tenant: { id: TENANT_B }, role: 'viewer' });
    expect(await asUser(BOB, (tx) => findMyMembership(tx, SLUG_A))).toBeNull();
    expect(await asUser(ANA, (tx) => findMyMembership(tx, 'zz'))).toBeNull();
    expect(await asUser(ANA, (tx) => findMyMembership(tx, `${SLUG_A}' or '1'='1`))).toBeNull();

    expect(await asA(getTenant)).toMatchObject({ id: TENANT_A, slug: SLUG_A, model_version_id: MV1, status: 'active' });
    expect(await asA(listTenantMembers)).toEqual([{ user_id: ANA, email: 'ana@example.test', name: 'Ana', role: 'owner' }]);
    expect((await asB(listTenantMembers)).map((m) => [m.name, m.role])).toEqual([['Ana', 'viewer'], ['Bob', 'editor']]);
    expect(await asA(getCurrentUser)).toEqual({ id: ANA, email: 'ana@example.test', name: 'Ana' });
    expect(await asUser(CAROL, getCurrentUser)).toEqual({ id: CAROL, email: 'carol@example.test', name: 'Carol' });
    expect(await withTenant(app.db, TENANT_A, 'user-not-a-uuid', getCurrentUser)).toBeNull();
  });

  it('G7: run as tenant A, no repository returns a row of tenant B', async () => {
    const out = await asA(async (tx) => {
      const inputs = [];
      for (const id of [null, ...Object.values(SCN)]) inputs.push(await loadResolvedInputs(tx, id));
      const runs = [];
      for (const id of Object.values(SCN)) runs.push(await getLatestCalcRun(tx, id));
      return {
        defs: await loadModelDefs(tx),
        members: await loadMembers(tx),
        scenarios: await listScenarios(tx),
        inputs,
        history: [await listChangesetHistory(tx, SCN.grandchild!), await listChangesetHistory(tx, null)],
        runs,
        tenant: await getTenant(tx),
        users: await listTenantMembers(tx),
      };
    });
    const text = JSON.stringify(out);
    const bMarkers = [
      TENANT_B, MV2, 'Tenant B', 'vendor_b', 'vp_b', 'g.mv2_only', 'h9-b', '"tenant":"B"',
      ...Object.values(SCN).map(twinB), ...Object.values(CS).map(twinB), twinB(RUN.r2),
    ];
    for (const m of bMarkers) expect(text, m).not.toContain(m);
    const values = out.inputs.flatMap((r) => r?.values.map((v) => v.value) ?? []);
    expect(values.every((v) => v < B_OFFSET)).toBe(true);
  });

  it('a savepoint opened inside withTenant keeps the tenant scope', async () => {
    const keys = await asA((tx) => tx.transaction(async (sp) => (await listScenarios(sp)).map((s) => s.key)));
    expect(keys).toEqual(['root', 'child', 'sibling', 'grandchild']);
  });
});

/** Arguments for repositories that need more than the transaction. */
const ARGS: Record<string, unknown[]> = {
  getScenario: [SCN.root],
  loadResolvedInputs: [SCN.root],
  listChangesetHistory: [SCN.grandchild],
  getChangeset: [CS.c1],
  getLatestCalcRun: [SCN.grandchild],
  findMyMembership: [SLUG_A],
};
/** Repositories for the pre-tenant reads (withUser), and the one that works in either scope. */
const USER_REPOS = new Set(['listMyMemberships', 'findMyMembership']);
const EITHER_REPOS = new Set(['getCurrentUser']);

type Repo = (tx: unknown, ...args: unknown[]) => Promise<unknown>;
const allRepos: [string, Repo][] = Object.entries(repos as Record<string, unknown>)
  .filter(([, fn]) => typeof fn === 'function')
  .map(([name, fn]) => [name, fn as Repo]);
const call = ([name, fn]: [string, Repo], tx: unknown): Promise<unknown> => fn(tx, ...(ARGS[name] ?? []));

describe('a repo call outside withTenant throws', () => {
  it('every read repository rejects the plain Db, a bare transaction and an ended withTenant, before any SQL', async () => {
    expect(allRepos.map(([n]) => n).sort()).toEqual([
      'findMyMembership', 'getChangeset', 'getCurrentUser', 'getLatestCalcRun', 'getScenario', 'getTenant',
      'listChangesetHistory', 'listMyMemberships', 'listScenarios', 'listTenantMembers', 'loadMembers', 'loadModelDefs',
      'loadResolvedInputs',
    ]);
    const kept = await asA(async (tx) => tx); // the transaction outlives its withTenant
    const keptUser = await asUser(ANA, async (tx) => tx);
    for (const repo of allRepos) {
      const before = log.length;
      await expect(call(repo, app.db), repo[0]).rejects.toThrow(TenantScopeError);
      await expect(call(repo, undefined), repo[0]).rejects.toThrow(TenantScopeError);
      await expect(call(repo, kept), repo[0]).rejects.toThrow(TenantScopeError);
      await expect(call(repo, keptUser), repo[0]).rejects.toThrow(TenantScopeError);
      expect(log.length, `${repo[0]} sent SQL`).toBe(before);
      // a transaction opened directly, without the tenant settings
      await app.db.transaction(async (tx) => {
        const inTx = log.length;
        await expect(call(repo, tx), repo[0]).rejects.toThrow(TenantScopeError);
        expect(log.length, `${repo[0]} sent SQL`).toBe(inTx);
      });
    }
  });

  it('tenant repositories need withTenant and pre-tenant ones withUser', async () => {
    for (const repo of allRepos) {
      const [name] = repo;
      // a resolved call is the pass; a rejection fails the test
      if (EITHER_REPOS.has(name)) {
        await asA((tx) => call(repo, tx));
        await asUser(ANA, (tx) => call(repo, tx));
      } else if (USER_REPOS.has(name)) {
        await expect(asA((tx) => call(repo, tx)), name).rejects.toThrow(TenantScopeError);
        await asUser(ANA, (tx) => call(repo, tx));
      } else {
        await expect(asUser(ANA, (tx) => call(repo, tx)), name).rejects.toThrow(TenantScopeError);
        await asA((tx) => call(repo, tx));
      }
    }
  });

  it('a savepoint of an ended withTenant is refused', async () => {
    const kept = await asA(async (tx) => tx);
    await expect(kept.transaction(async () => 1)).rejects.toThrow(TenantScopeError);
  });
});

describe('all queries parameterised; no string-built SQL (runtime)', () => {
  it('ids, slugs and cursors travel as bind parameters: none appears in any SQL text', async () => {
    const hostileSlug = `${SLUG_B}' or ''='`;
    log.length = 0;
    const cursor = await asA(async (tx) => {
      await loadModelDefs(tx);
      await loadMembers(tx);
      await listScenarios(tx);
      await getScenario(tx, SCN.child!);
      await loadResolvedInputs(tx, SCN.sibling!);
      await loadResolvedInputs(tx, null);
      const page = await listChangesetHistory(tx, SCN.grandchild!, { limit: 1 });
      await listChangesetHistory(tx, SCN.grandchild!, { limit: 1, cursor: page.nextCursor });
      await getChangeset(tx, CS.c3);
      await getLatestCalcRun(tx, SCN.grandchild!);
      await getTenant(tx);
      await listTenantMembers(tx);
      await getCurrentUser(tx);
      return page.nextCursor;
    });
    const found = await asUser(ANA, async (tx) => [
      await listMyMemberships(tx),
      await findMyMembership(tx, hostileSlug),
      await findMyMembership(tx, SLUG_B),
    ]);
    expect(found[1]).toBeNull();
    expect(cursor).not.toBeNull();

    const [cursorAt, cursorId] = JSON.parse(Buffer.from(cursor!, 'base64url').toString('utf8')) as [string, string];
    const bound = [TENANT_A, ANA, SCN.child!, SCN.sibling!, SCN.grandchild!, CS.c3, hostileSlug, SLUG_B, cursorAt, cursorId];
    for (const v of bound) {
      expect(log.filter((q) => q.text.includes(v)).map((q) => q.text), v).toEqual([]);
      expect(log.some((q) => q.values.includes(v)), `${v} bound`).toBe(true);
    }
    // and no statement carries a quoted literal beyond the fixed ones of the repository SQL
    const literals = new Set(log.flatMap((q) => q.text.match(/'[^']*'/g) ?? []));
    expect([...literals].sort()).toEqual(["'UTC'", "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'", "'app.tenant_id'", "'app.user_id'"]);
  });
});
