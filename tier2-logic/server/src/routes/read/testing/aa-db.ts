import { createDb, findMyMembership, sql, withTenant, withUser } from '@glidepath/data-access';
import type { Db, DbHandle } from '@glidepath/data-access';
import { schema } from '@glidepath/data-access';
import { TenantId, TenantSlug } from '@glidepath/api-contract';
import { aaSeed, specBundle, withTestDatabase } from '@glidepath/testkit';
import type { TestDatabase } from '@glidepath/testkit';
import type { MembershipResolver } from '../../../app/tenant';

/**
 * Test support: a migrated pg-local database holding the model version of `docs/spec`, the AA tenant seed
 * (dimension members, 415 baseline lines, tenant defaults, the five presets) plus a user scenario with a
 * changeset history, and a second tenant `zz` pinning the same model version. Seeded as the owner role;
 * the app under test connects as `glidepath_app` (RLS applies, nothing bypassed).
 */

const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const MV = id(0xa1);
export const AA_ID = id(0x10);
export const ZZ_ID = id(0x20);
/** Owner of aa and member of nothing else. */
export const ANA = id(0xe1);
/** Editor of zz only: a stranger to aa. */
export const BOB = id(0xe2);
/** Member of nothing. */
export const CAROL = id(0xe3);

/** The user scenario of aa, a child of preset C, with a history of five changesets. */
export const MINE = id(0x51);
/** zz's only scenario. */
export const ZZ_SCENARIO = id(0x52);
export const presetId = (key: string): string => id(0x100 + 'rates ABCD'.indexOf(key));

export const CS = { seed: id(0xc0), c1: id(0xc1), c2: id(0xc2), c3: id(0xc3), c4: id(0xc4), c5: id(0xc5) };

export const asUser = (u: string): { headers: Record<string, string> } => ({ headers: { 'x-test-user': u } });

const at = (s: string): Date => new Date(s);
/** A jsonb value; JSON null needs SQL `'null'::jsonb` (a JS null would be SQL NULL). */
const json = (v: unknown) => (v === null ? sql`'null'::jsonb` : v);

export interface AaDatabase {
  database: TestDatabase;
  /** The app's connection: role `glidepath_app`. */
  app: DbHandle;
  /** Real membership lookup (withUser + findMyMembership), as the auth layer will wire it. */
  membership: MembershipResolver;
  close(): Promise<void>;
}

export async function startAaDatabase(): Promise<AaDatabase> {
  const database = await withTestDatabase({ seed: seedAa });
  const u = new URL(database.adminUrl);
  u.pathname = `/${database.database}`;
  u.searchParams.set('options', '-c role=glidepath_app');
  const app = createDb(u.toString());
  const membership: MembershipResolver = async (userId, slug) => {
    const m = await withUser(app.db, userId, (tx) => findMyMembership(tx, slug));
    return m ? { tenantId: TenantId.parse(m.tenant.id), slug: TenantSlug.parse(m.tenant.slug), role: m.role } : null;
  };
  return {
    database,
    app,
    membership,
    async close() {
      await app.close();
      await database.close();
    },
  };
}

async function seedAa(testDb: TestDatabase): Promise<void> {
  const owner = createDb(testDb.url);
  try {
    await seedGlobal(owner.db);
    await seedAaTenant(owner.db);
    await seedZz(owner.db);
  } finally {
    await owner.close();
  }
}

async function seedGlobal(db: Db): Promise<void> {
  const bundle = await specBundle();
  const seed = await aaSeed();
  await db.insert(schema.model_version).values({
    id: MV, semver: bundle.specVersion, status: 'published', notes: 'docs/spec', created_at: at('2026-09-01T00:00:00Z'),
  });
  await db.insert(schema.dimension_def).values(
    bundle.dimensions.map((d) => ({
      model_version_id: MV, dim_key: d.id, scope: d.scope as 'global', attributes: [...d.attributes],
    })),
  );
  await db.insert(schema.variable_def).values(
    bundle.variables.map((v) => ({
      model_version_id: MV, var_key: v.id, dims: [...v.dims], label: v.label, unit: v.unit, type: v.type,
      min: v.min === null ? null : String(v.min), max: v.max === null ? null : String(v.max),
      step: v.step === null ? null : String(v.step), group: v.group ?? '', layer: v.layer, role: v.role,
      ui: v.ui, dist: null, validation: null, legacy: v.legacy ?? [],
    })),
  );
  await db.insert(schema.node_def).values(
    bundle.nodes.map((n) => ({
      model_version_id: MV, node_key: n.id, dims: [...n.dims], expr: n.expr ?? null, cases: n.cases ?? null,
      members: n.members ?? null, unit: n.unit, label: n.label, layer: n.layer, output: n.output, overridable: true,
    })),
  );
  await db.insert(schema.canonical_pool).values(
    (seed.dimensionMembers.pool ?? []).map((p, i) => ({
      id: p.id, label: String(p.label), third_party: Boolean(p.third_party), sort: Number(p.order ?? i + 1),
    })),
  );
  await db.insert(schema.addr_tag).values((seed.dimensionMembers.addr_tag ?? []).map((a) => ({ id: a.id, label: String(a.label) })));
  await db.insert(schema.app_user).values([
    { id: ANA, email: 'ana@example.test', name: 'Ana' },
    { id: BOB, email: 'bob@example.test', name: 'Bob' },
    { id: CAROL, email: 'carol@example.test', name: 'Carol' },
  ]);
}

/** Tenant-owned dimensions that live in dimension_member (the view serves the others itself). */
const MEMBER_DIMS = ['domain', 'vp', 'lever', 'vendor', 'lgroup'] as const;

async function seedAaTenant(owner: Db): Promise<void> {
  const seed = await aaSeed();
  const bundle = await specBundle();
  const t = seed.tenant;
  await withTenant(owner, AA_ID, ANA, async (tx) => {
    await tx.insert(schema.tenant).values({
      id: AA_ID, slug: String(t.id), name: t.name, currency: t.currency, base_year: Number(t.base_year),
      target_year: Number(t.target_year), fiscal_calendar: String(t.fiscal_calendar), ticker: t.ticker == null ? null : String(t.ticker),
      model_version_id: MV, status: 'active', created_at: at('2026-09-10T00:00:00Z'),
    });
    await tx.insert(schema.tenant_membership).values({ tenant_id: AA_ID, user_id: ANA, role: 'owner' });

    for (const dim of MEMBER_DIMS) {
      const members = seed.dimensionMembers[dim] ?? [];
      await tx.insert(schema.dimension_member).values(
        members.map((m, i) => {
          const { id: key, label, ...attrs } = m as Record<string, unknown> & { id: string };
          return { tenant_id: AA_ID, dim_key: dim, member_key: key, label: String(label ?? key), attrs, sort: i + 1, active: true };
        }),
      );
    }
    const lines = seed.dimensionMembers.line ?? [];
    await tx.insert(schema.line_item).values(
      lines.map((l) => {
        const r = l as Record<string, unknown> & { id: string };
        return {
          tenant_id: AA_ID, member_key: r.id, legacy_id: String(r.legacy_id), pool_id: String(r.pool),
          tenant_l1_label: String(r.l1_label), l2: String(r.l2), name: String(r.name), vendor_key: null,
          vendor_text: String(r.vendor ?? ''), nature: String(r.nature), accounting: String(r.accounting),
          driver_text: String(r.driver_text ?? ''), qty: String(r.qty), unit: String(r.unit), addr_tag: String(r.addr),
          domain_key: String(r.domain), scale_driver: String(r.drv) as 'us', in_scope: Number(r.in_scope) === 1,
          memo: Number(r.memo) === 1, confidence: String(r.confidence), source_id: null,
          lever_hook_text: String(r.lever_hook ?? ''), notes: String(r.notes ?? ''), active: true,
        };
      }),
    );
    await tx.insert(schema.line_item_lever).values(
      lines.flatMap((l) => {
        const r = l as Record<string, unknown> & { id: string; lever_ids?: string[] };
        return (r.lever_ids ?? []).map((code) => ({ tenant_id: AA_ID, line_key: r.id, lever_code: code, mapping_source: 'rule' as const }));
      }),
    );

    // History first (values point at it). `seed` wrote the defaults and the presets; the rest is the user scenario.
    const cs = (key: keyof typeof CS, over: Partial<typeof schema.changeset.$inferInsert>) => ({
      tenant_id: AA_ID, id: CS[key], origin: 'ui' as const, scenario_id: MINE, base_scenario_version: 0,
      status: 'applied' as const, summary: { edits: 1 }, created_by: ANA, created_at: at('2026-11-01T10:00:00Z'), reverts_id: null,
      ...over,
    });
    await tx.insert(schema.changeset).values([
      cs('seed', { origin: 'seed', scenario_id: null, created_by: CAROL, created_at: at('2026-09-10T00:00:00Z'), summary: 'Seeded from the tenant files' }),
    ]);

    const varDefs = new Set(bundle.variables.map((v) => v.id));
    await tx.insert(schema.variable_value).values(
      Object.entries(seed.variableValues).flatMap(([key, v]) => {
        if (!varDefs.has(key)) return [];
        const row = (member: string, value: number) => ({
          tenant_id: AA_ID, var_key: key, member_key: member, value: String(value), source_id: null,
          confidence: bundle.variables.find((x) => x.id === key)?.confidence ?? 'M', note: key === 'g.target_net' ? 'from the filing' : '',
          changeset_id: CS.seed, updated_at: at('2026-09-10T00:00:00Z'),
        });
        return typeof v === 'number' ? [row('', v)] : Object.entries(v).map(([m, x]) => row(m, x));
      }),
    );

    const presets = seed.scenarios.scenarios;
    await tx.insert(schema.scenario).values([
      ...presets.map((s, i) => ({
        tenant_id: AA_ID, id: presetId(s.id), key: s.id, label: s.label, kind: 'preset' as const, parent_id: null,
        model_version_id: MV, version: 0, locked: true, created_by: ANA, created_at: at('2026-09-11T00:00:00Z'), archived: false,
        sort_order: i, // as the seeder sets it (DATA-14); one created_at, as a real seed run has, so only sort_order orders
        is_default: s.id === seed.scenarios.default_scenario, // as the seeder sets it (WEB-12)
      })),
      {
        tenant_id: AA_ID, id: MINE, key: 'custom-c', label: 'Custom (from C)', kind: 'user' as const, parent_id: presetId('C'),
        model_version_id: MV, version: 4, locked: false, created_by: ANA, created_at: at('2026-11-01T09:00:00Z'), archived: false,
      },
    ]);
    await tx.insert(schema.scenario_value).values(
      presets.flatMap((s) =>
        Object.entries(s.values).flatMap(([key, v]) => {
          if (!varDefs.has(key)) return [];
          const row = (member: string, value: number) => ({
            tenant_id: AA_ID, scenario_id: presetId(s.id), var_key: key, member_key: member, value: String(value), changeset_id: CS.seed,
          });
          return typeof v === 'number' ? [row('', v)] : Object.entries(v).map(([m, x]) => row(m, x));
        }),
      ),
    );
    // The user scenario's own values and one pinned node cell.
    const pinned = bundle.nodes.find((n) => n.dims.length === 0 && n.output);
    await tx.insert(schema.scenario_value).values([
      { tenant_id: AA_ID, scenario_id: MINE, var_key: 'g.target_net', member_key: '', value: '120', changeset_id: CS.c1 },
    ]);
    if (pinned) {
      await tx.insert(schema.node_override).values({
        tenant_id: AA_ID, scenario_id: MINE, node_key: pinned.id, member_key: '', value: '99.5', reason: 'CFO pin',
      });
    }

    // History of MINE, newest last by time: c1 (2 changes), c2 (1, later reverted), c3 (undoes c2), c4 (1), c5 (rejected).
    await tx.insert(schema.changeset).values([
      cs('c1', { created_at: at('2026-11-01T10:00:00Z'), summary: { changes: 2, edits: 2, edits_count: 2 } }),
      cs('c2', { created_at: at('2026-11-02T10:00:00Z'), status: 'reverted', base_scenario_version: 1, origin: 'excel_import', summary: { changes: 1, edits: 1, edits_count: 3 } }),
      cs('c3', { created_at: at('2026-11-03T10:00:00Z'), reverts_id: CS.c2, base_scenario_version: 2, created_by: CAROL, summary: 'Undo: import' }),
      cs('c4', { created_at: at('2026-11-04T10:00:00Z'), base_scenario_version: 3, summary: { changes: 1, edits: 1, edits_count: 3 } }),
      cs('c5', { created_at: at('2026-11-05T10:00:00Z'), status: 'rejected', base_scenario_version: 4, summary: { changes: 1, edits: 1, edits_count: 99 } }),
    ]);
    const ch = (cset: string, seq: number, target: 'scenario_value' | 'node_override' | 'dimension_member', key: string, member: string, oldV: unknown, newV: unknown) => ({
      tenant_id: AA_ID, changeset_id: cset, seq, target, key, member_key: member, op: 'update' as const,
      old_value: json(oldV), new_value: json(newV), export_value: null, status: 'clean' as const, messages: [],
    });
    await tx.insert(schema.change).values([
      ch(CS.c1, 1, 'node_override', pinned?.id ?? 'res.net', '', null, 99.5),
      ch(CS.c1, 0, 'scenario_value', 'g.target_net', '', 100, 120),
      ch(CS.c2, 0, 'scenario_value', 'g.head_start', '', 1, 0),
      ch(CS.c3, 0, 'scenario_value', 'g.head_start', '', 0, 1),
      ch(CS.c4, 0, 'dimension_member', 'vp', 'vp_commercial', { label: 'Commercial Technology' }, { label: 'Commercial Tech' }),
      ch(CS.c5, 0, 'scenario_value', 'g.target_net', '', 120, 9999),
    ]);
  });
}

async function seedZz(owner: Db): Promise<void> {
  await withTenant(owner, ZZ_ID, BOB, async (tx) => {
    await tx.insert(schema.tenant).values({
      id: ZZ_ID, slug: 'zz', name: 'Example Air', currency: 'EUR', base_year: 2026, target_year: 2027,
      fiscal_calendar: 'calendar', ticker: null, model_version_id: MV, status: 'active', created_at: at('2026-09-12T00:00:00Z'),
    });
    await tx.insert(schema.tenant_membership).values({ tenant_id: ZZ_ID, user_id: BOB, role: 'editor' });
    await tx.insert(schema.dimension_member).values({
      tenant_id: ZZ_ID, dim_key: 'vp', member_key: 'vp_zz', label: 'ZZ VP', attrs: {}, sort: 1, active: true,
    });
    await tx.insert(schema.changeset).values({
      tenant_id: ZZ_ID, id: id(0xc9), origin: 'seed', scenario_id: null, base_scenario_version: 0, status: 'applied',
      summary: {}, created_by: BOB, created_at: at('2026-09-12T00:00:00Z'), reverts_id: null,
    });
    await tx.insert(schema.variable_value).values({
      tenant_id: ZZ_ID, var_key: 'g.target_net', member_key: '', value: '777', source_id: null, confidence: 'L', note: 'zz only',
      changeset_id: id(0xc9), updated_at: at('2026-09-12T00:00:00Z'),
    });
    await tx.insert(schema.scenario).values({
      tenant_id: ZZ_ID, id: ZZ_SCENARIO, key: 'zz-own', label: 'ZZ own', kind: 'user', parent_id: null, model_version_id: MV,
      version: 7, locked: false, created_by: BOB, created_at: at('2026-09-13T00:00:00Z'), archived: false,
    });
  });
}

/** One changeset as `applyChangeset` stores it (DOM-03): its change count, what it adds, the counter after it. */
export interface StoredStep {
  /** The scenario's version when it was applied (`base_scenario_version`); the version after it is `base + 1`. */
  base: number;
  /** Change rows written (and `summary.changes`). */
  changes: number;
  /** `summary.edits`: the changes of an edit, minus the undone changeset's `edits` for an undo. */
  edits: number;
  /** `summary.edits_count`: the scenario's counter after the changeset (`applyChangeset(...).editsCount`). */
  editsCount: number;
  /** Set for an undo or redo: the step number it reverts, which becomes `reverted`. */
  reverts?: number;
}

const stepId = (n: number): string => id(0x400 + n);

/** Creates an empty user scenario of aa (version 0) for {@link applyStoredStep}. */
export async function createUserScenario(database: TestDatabase, scenarioId: string, key: string): Promise<void> {
  const owner = createDb(database.url);
  try {
    await withTenant(owner.db, AA_ID, ANA, async (tx) => {
      await tx.insert(schema.scenario).values({
        tenant_id: AA_ID, id: scenarioId, key, label: key, kind: 'user', parent_id: null, model_version_id: MV, version: 0,
        locked: false, created_by: ANA, created_at: at('2026-11-10T00:00:00Z'), archived: false,
      });
    });
  } finally {
    await owner.close();
  }
}

/**
 * Writes step `n` of a scenario's history the way the write path does: the changeset with
 * `summary { changes, edits, edits_count }`, its change rows, the reverted changeset marked, the version bumped.
 */
export async function applyStoredStep(database: TestDatabase, scenarioId: string, n: number, step: StoredStep): Promise<void> {
  const owner = createDb(database.url);
  try {
    await withTenant(owner.db, AA_ID, ANA, async (tx) => {
      await tx.insert(schema.changeset).values({
        tenant_id: AA_ID, id: stepId(n), origin: 'ui', scenario_id: scenarioId, base_scenario_version: step.base, status: 'applied',
        summary: { changes: step.changes, edits: step.edits, edits_count: step.editsCount }, created_by: ANA,
        created_at: at(`2026-11-10T10:00:${String(n).padStart(2, '0')}Z`), reverts_id: step.reverts === undefined ? null : stepId(step.reverts),
      });
      await tx.insert(schema.change).values(
        Array.from({ length: step.changes }, (_, seq) => ({
          tenant_id: AA_ID, changeset_id: stepId(n), seq, target: 'scenario_value' as const, key: 'g.head_start', member_key: '',
          op: 'update' as const, old_value: json(seq), new_value: json(seq + 1), export_value: null, status: 'clean' as const, messages: [],
        })),
      );
      if (step.reverts !== undefined) {
        await tx.execute(sql`update changeset set status = 'reverted' where tenant_id = ${AA_ID}::uuid and id = ${stepId(step.reverts)}::uuid`);
      }
      await tx.execute(sql`update scenario set version = ${step.base + 1} where tenant_id = ${AA_ID}::uuid and id = ${scenarioId}::uuid`);
    });
  } finally {
    await owner.close();
  }
}
