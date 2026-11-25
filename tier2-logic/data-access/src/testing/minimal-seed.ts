import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import type { Db } from '../db';
import {
  addr_tag, app_user, calc_run, canonical_pool, change, changeset, dimension_def, dimension_member, line_item,
  line_item_lever, lever_template, model_version, node_def, node_override, scenario, scenario_value, tenant,
  tenant_membership, variable_def, variable_value,
} from '../schema';
import { withTenant } from '../tenant';

/**
 * Minimal two-tenant seed for the read repository tests (DATA-05), written as the owner role.
 * Tenant A holds the scenario chain of tier2-logic/domain/fixtures/scenario-chain-3.json (shared with
 * DOM-01 and DATA-03); tenant B holds the same cells under other scenario ids, other values and other
 * labels, and pins another model version, so any cross-tenant leak changes an answer.
 * Values are synthetic; ids are spec ids verbatim.
 */

interface Fixture {
  tenant_id: string;
  variable_def: { var_key: string; dims: string[] }[];
  variable_value: { var_key: string; member_key: string; value: number }[];
  scenario: { id: string; key: string; parent_id: string | null }[];
  scenario_value: { scenario_id: string; var_key: string; member_key: string; value: number }[];
  node_override: { scenario_id: string; node_key: string; member_key: string; value: number; reason: string }[];
  expected: Record<string, {
    chain: string[];
    values: { var_key: string; member_key: string; value: number; scenario_id: string | null }[];
    overrides: { node_key: string; member_key: string; value: number; reason: string }[];
  }>;
}

export const fixture: Fixture = JSON.parse(
  readFileSync(new URL('../../../domain/fixtures/scenario-chain-3.json', import.meta.url), 'utf8'),
);

const id = (suffix: string): string => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

export const MV1 = id('a001');
export const MV2 = id('a002');
export const TENANT_A = fixture.tenant_id;
export const TENANT_B = id('2');
export const SLUG_A = 'ta';
export const SLUG_B = 'tb';
/** Owner of A, viewer of B. */
export const ANA = id('e1');
/** Editor of B only. */
export const BOB = id('e2');
/** Member of nothing. */
export const CAROL = id('e3');
/** Author with no app_user row. */
export const GHOST = id('e9');

/** Scenario ids of A by fixture key. */
export const SCN = Object.fromEntries(fixture.scenario.map((s) => [s.key, s.id])) as Record<string, string>;
/** B's twin of an A id (scenario, changeset, ...): same key, other id. */
export const twinB = (aId: string): string => `${aId.slice(0, -12)}b${aId.slice(-11)}`;
/** B's values are A's plus this, so a B value in an A answer is visible. */
export const B_OFFSET = 1000;

export const CS = { c1: id('c1'), c2: id('c2'), c3: id('c3'), c4: id('c4'), c5: id('c5') };
/** Microseconds matter: c3 and c5 share created_at, beyond JS Date precision. */
export const CS_AT = {
  c1: '2026-11-01 10:00:00.000001+00',
  c2: '2026-11-02 10:00:00+00',
  c3: '2026-11-03 10:00:00.123456+00',
  c4: '2026-10-01 09:00:00+00',
  c5: '2026-11-03 10:00:00.123456+00',
};
export const RUN = { r1: id('d1'), r2: id('d2') };

const at = (s: string): Date => new Date(s);

const dimsMv1 = [
  { dim_key: 'pool', scope: 'global' as const, attributes: ['label', 'third_party', 'order'] },
  { dim_key: 'line', scope: 'tenant' as const, attributes: ['pool', 'domain', 'addr', 'drv', 'lever_ids', 'in_scope'] },
  { dim_key: 'vp', scope: 'tenant' as const, attributes: ['label'] },
  { dim_key: 'lgroup', scope: 'tenant' as const, attributes: ['label'] },
  { dim_key: 'lever', scope: 'global+tenant' as const, attributes: ['label', 'order', 'alloc_key'] },
  { dim_key: 'iyear', scope: 'system' as const, attributes: ['label'] },
  { dim_key: 'addr_tag', scope: 'global' as const, attributes: ['label'] },
];

function varDef(mv: string, v: { var_key: string; dims: string[] }) {
  const ranged = v.var_key === 'g.target_net';
  return {
    model_version_id: mv,
    var_key: v.var_key,
    dims: v.dims,
    label: `${v.var_key} label`,
    unit: 'USD m',
    type: 'number' as const,
    min: ranged ? '0' : null,
    max: ranged ? '250.5' : null,
    step: ranged ? '0.5' : null,
    group: 'goal',
    layer: 'inputs',
    role: 'driver' as const,
    ui: { control: 'slider', hero: ranged },
    dist: null,
    validation: null,
    legacy: [],
  };
}

function nodeDefs(mv: string, extra: boolean) {
  const base = { model_version_id: mv, unit: 'USD m', layer: 'result' };
  return [
    { ...base, node_key: 'res.net', dims: [], expr: 'g.target_net', label: 'Net', output: true },
    { ...base, node_key: 'vp.target', dims: ['vp'], expr: null, cases: [{ when: null, expr: '1' }], label: 'VP target', output: false, overridable: false },
    { ...base, node_key: 'base.pool_outlay', dims: ['pool'], expr: '0', members: { pool: ['software'] }, label: 'Pool outlay', output: false },
    ...(extra ? [{ ...base, node_key: 'res.mv2_only', dims: [], expr: '1', label: 'MV2 only', output: true }] : []),
  ];
}

function lineRow(tenantId: string, key: string, over: Partial<typeof line_item.$inferInsert>) {
  return {
    tenant_id: tenantId, member_key: key, legacy_id: key.toUpperCase(), pool_id: 'internal_labour',
    tenant_l1_label: 'L1', l2: 'L2', name: `line ${key}`, vendor_key: null, vendor_text: '', nature: 'run',
    accounting: 'opex', driver_text: '', qty: '1', unit: 'fte', addr_tag: 'locked', domain_key: 'd1',
    scale_driver: 'us' as const, in_scope: true, memo: false, confidence: 'H', source_id: null,
    lever_hook_text: '', notes: '', active: true, ...over,
  };
}

/** Seeds the global rows and both tenants. `owner` connects as the database owner (FORCE RLS applies). */
export async function seedMinimal(owner: Db): Promise<void> {
  // ---- global
  await owner.insert(model_version).values([
    { id: MV1, semver: '1.0.0', status: 'published', notes: 'pinned by A', created_at: at('2026-09-01T00:00:00Z') },
    { id: MV2, semver: '2.0.0', status: 'draft', notes: 'pinned by B', created_at: at('2026-09-02T00:00:00Z') },
  ]);
  await owner.insert(dimension_def).values([
    ...dimsMv1.map((d) => ({ ...d, model_version_id: MV1 })),
    ...[...dimsMv1, { dim_key: 'vendor', scope: 'tenant' as const, attributes: ['label'] }].map((d) => ({ ...d, model_version_id: MV2 })),
  ]);
  await owner.insert(variable_def).values([
    ...fixture.variable_def.map((v) => varDef(MV1, v)),
    ...[...fixture.variable_def, { var_key: 'g.mv2_only', dims: [] }].map((v) => varDef(MV2, v)),
  ]);
  await owner.insert(node_def).values([...nodeDefs(MV1, false), ...nodeDefs(MV2, true)]);
  const lever = (mv: string, code: string) => ({
    model_version_id: mv, code, label: `Lever ${code}`, category: 'labour', default_alloc_key: 'apps',
    node_keys: [`lev.${code}.save`], var_keys: [`lev.${code}.n`], library: { hypothesis: `h ${code}` },
  });
  await owner.insert(lever_template).values([lever(MV1, 'L09'), lever(MV1, 'L05'), lever(MV2, 'L05')]);
  // Inserted out of order: member order is canonical_pool.sort, not insertion or key order.
  await owner.insert(canonical_pool).values([
    { id: 'software', label: 'Software', third_party: true, sort: 5 },
    { id: 'internal_labour', label: 'US labour', third_party: false, sort: 1 },
    { id: 'captive_labour', label: 'India GCC', third_party: false, sort: 2 },
  ]);
  await owner.insert(addr_tag).values([
    { id: 'locked', label: 'Locked' },
    { id: 'partly', label: 'Partly' },
    { id: 'addressable', label: 'Addressable' },
  ]);
  await owner.insert(app_user).values([
    { id: ANA, email: 'ana@example.test', name: 'Ana' },
    { id: BOB, email: 'bob@example.test', name: 'Bob' },
    { id: CAROL, email: 'carol@example.test', name: 'Carol' },
  ]);

  // ---- tenant A
  await withTenant(owner, TENANT_A, ANA, async (tx) => {
    await tx.insert(tenant).values({
      id: TENANT_A, slug: SLUG_A, name: 'Tenant A', currency: 'USD', base_year: 2026, target_year: 2027,
      fiscal_calendar: 'calendar', ticker: null, model_version_id: MV1, status: 'active', created_at: at('2026-09-10T00:00:00Z'),
    });
    await tx.insert(tenant_membership).values({ tenant_id: TENANT_A, user_id: ANA, role: 'owner' });
    await tx.insert(dimension_member).values([
      // sort decides member order (the seed's), not member_key
      { tenant_id: TENANT_A, dim_key: 'vp', member_key: 'vp_operations', label: 'Operations', attrs: {}, sort: 1, active: true },
      { tenant_id: TENANT_A, dim_key: 'vp', member_key: 'vp_commercial', label: 'Commercial', attrs: {}, sort: 2, active: true },
      { tenant_id: TENANT_A, dim_key: 'vp', member_key: 'vp_infra', label: 'Infra', attrs: {}, sort: 3, active: false },
      { tenant_id: TENANT_A, dim_key: 'lgroup', member_key: 'pilots', label: 'Pilots', attrs: {}, sort: 1, active: true },
      { tenant_id: TENANT_A, dim_key: 'lgroup', member_key: 'flight_attendants', label: 'Flight attendants', attrs: {}, sort: 2, active: true },
      { tenant_id: TENANT_A, dim_key: 'lever', member_key: 'L09', label: 'Lever 9', attrs: { alloc_key: 'apps', order: 9 }, sort: 9, active: true },
      { tenant_id: TENANT_A, dim_key: 'lever', member_key: 'L05', label: 'Lever 5', attrs: { alloc_key: 'si_contingent', order: 5 }, sort: 5, active: true },
      // a dimension the pinned model (MV1) does not define
      { tenant_id: TENANT_A, dim_key: 'vendor', member_key: 'vendor_x', label: 'Vendor X', attrs: {}, sort: 1, active: true },
    ]);
    await tx.insert(line_item).values([
      lineRow(TENANT_A, 'it_002', { pool_id: 'software', addr_tag: 'partly', scale_driver: 'none' }),
      lineRow(TENANT_A, 'it_001', {}),
      lineRow(TENANT_A, 'it_003', { active: false }),
    ]);
    await tx.insert(line_item_lever).values([
      { tenant_id: TENANT_A, line_key: 'it_001', lever_code: 'L09', mapping_source: 'user' },
      { tenant_id: TENANT_A, line_key: 'it_001', lever_code: 'L05', mapping_source: 'rule' },
    ]);
  });

  // ---- tenant B (pins MV2)
  await withTenant(owner, TENANT_B, BOB, async (tx) => {
    await tx.insert(tenant).values({
      id: TENANT_B, slug: SLUG_B, name: 'Tenant B', currency: 'EUR', base_year: 2025, target_year: 2026,
      fiscal_calendar: 'fiscal', ticker: 'TB', model_version_id: MV2, status: 'setup', created_at: at('2026-09-11T00:00:00Z'),
    });
    await tx.insert(tenant_membership).values([
      { tenant_id: TENANT_B, user_id: BOB, role: 'editor' },
      { tenant_id: TENANT_B, user_id: ANA, role: 'viewer' },
    ]);
    await tx.insert(dimension_member).values([
      { tenant_id: TENANT_B, dim_key: 'vp', member_key: 'vp_b', label: 'Tenant B VP', attrs: {}, sort: 1, active: true },
      { tenant_id: TENANT_B, dim_key: 'vendor', member_key: 'vendor_b', label: 'Tenant B vendor', attrs: {}, sort: 1, active: true },
    ]);
    await tx.insert(line_item).values([lineRow(TENANT_B, 'it_001', { name: 'Tenant B line', pool_id: 'captive_labour' })]);
  });

  // ---- values, scenarios, history and calc runs: A from the fixture, B its twin
  for (const [tenantId, user, sid, offset] of [
    [TENANT_A, ANA, (s: string) => s, 0],
    [TENANT_B, BOB, twinB, B_OFFSET],
  ] as const) {
    const mv = tenantId === TENANT_A ? MV1 : MV2;
    await withTenant(owner, tenantId, user, async (tx) => {
      await tx.insert(variable_value).values(
        fixture.variable_value.map((v) => ({
          tenant_id: tenantId, var_key: v.var_key, member_key: v.member_key, value: String(v.value + offset),
          source_id: null, confidence: v.var_key === 'g.target_net' ? 'M' : 'H',
          note: v.var_key === 'g.target_net' ? 'from the filing' : '',
          // B's history is its c1 only: a value names a changeset of its own tenant (DATA-12 composite FK)
          changeset_id: tenantId === TENANT_A ? CS.c4 : sid(CS.c1), updated_at: at('2026-10-01T09:00:00Z'),
        })),
      );
      const created: Record<string, string> = {
        root: '2026-10-01T00:00:00Z', child: '2026-10-02T00:00:00Z', sibling: '2026-10-02T00:00:00Z', grandchild: '2026-10-03T00:00:00Z',
      };
      const version: Record<string, number> = { root: 3, child: 2, sibling: 1, grandchild: 4 };
      await tx.insert(scenario).values(
        fixture.scenario.map((s) => ({
          tenant_id: tenantId, id: sid(s.id), key: s.key, label: offset ? `B ${s.key}` : s.key,
          kind: s.key === 'root' ? ('preset' as const) : ('user' as const), parent_id: s.parent_id && sid(s.parent_id),
          model_version_id: mv, version: version[s.key]!, locked: s.key === 'root', created_by: user,
          created_at: at(created[s.key]!), archived: s.key === 'sibling',
        })),
      );
      await tx.insert(scenario_value).values(
        fixture.scenario_value.map((v) => ({
          tenant_id: tenantId, scenario_id: sid(v.scenario_id), var_key: v.var_key, member_key: v.member_key,
          value: String(v.value + offset), changeset_id: sid(CS.c1),
        })),
      );
      await tx.insert(node_override).values(
        fixture.node_override.map((o) => ({
          tenant_id: tenantId, scenario_id: sid(o.scenario_id), node_key: o.node_key, member_key: o.member_key,
          value: String(o.value + offset), reason: o.reason,
        })),
      );

      const gc = sid(SCN.grandchild!);
      const cs = (key: keyof typeof CS, over: Partial<typeof changeset.$inferInsert>) => ({
        tenant_id: tenantId, id: sid(CS[key]), origin: 'ui' as const, scenario_id: gc, base_scenario_version: 0,
        // microseconds: through SQL, not a JS Date
        status: 'applied' as const, summary: { edits: 1 }, created_by: user, created_at: sql`${CS_AT[key]}::timestamptz`, reverts_id: null,
        ...over,
      });
      const rows = tenantId === TENANT_A
        ? [
            cs('c1', { base_scenario_version: 0, summary: { edits: 2 } }),
            cs('c2', { origin: 'excel_import', status: 'reverted', base_scenario_version: 1 }),
            cs('c3', { created_by: CAROL, reverts_id: CS.c2, base_scenario_version: 2 }),
            cs('c4', { origin: 'seed', scenario_id: null, created_by: GHOST }),
            cs('c5', { base_scenario_version: 3 }),
          ]
        : [cs('c1', { summary: { edits: 1, tenant: 'B' } })];
      await tx.insert(changeset).values(rows);
      const ch = (seq: number, key: string, oldV: unknown, newV: unknown) => ({
        tenant_id: tenantId, changeset_id: sid(CS.c1), seq, target: 'scenario_value' as const, key, member_key: '',
        op: 'update' as const, old_value: oldV, new_value: newV, export_value: null, status: 'clean' as const, messages: [],
      });
      // inserted out of seq order
      await tx.insert(change).values([ch(1, 'lev.L09.n', 10 + offset, 40 + offset), ch(0, 'g.target_net', 120 + offset, 130 + offset)]);

      const run = (rid: string, v: number, hash: string, when: string) => ({
        tenant_id: tenantId, id: sid(rid), scenario_id: gc, scenario_version: v, model_version_id: mv,
        input_hash: `${hash}${offset ? '-b' : ''}`, ms: 12, outputs: { 'res.net[]': 130 + offset + v }, created_at: at(when),
      });
      await tx.insert(calc_run).values(
        tenantId === TENANT_A
          ? [run(RUN.r2, 4, 'h2', '2026-11-03T12:00:00Z'), run(RUN.r1, 3, 'h1', '2026-11-01T12:00:00Z')]
          : [run(RUN.r2, 4, 'h9', '2026-11-09T12:00:00Z')],
      );
    });
  }
}
