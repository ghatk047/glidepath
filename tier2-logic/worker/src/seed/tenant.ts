import {
  createChangesetStore,
  schema,
  sql,
  withTenant,
  type Db,
} from '@glidepath/data-access';
import {
  SOURCING_DIMENSIONS,
  applyChangeset,
  recomputeHook,
  type ChangesetDraft,
  type ChangesetStore,
  type ModelCache,
  type ScenarioRow,
} from '@glidepath/domain';
import type { CompiledModel } from '@glidepath/engine';
import type { ModelBundle, TenantSeed } from '@glidepath/spec';
import {
  allSourceCodes,
  cellId,
  leverMappings,
  missingDefaults,
  missingMembers,
  presetChanges,
  tenantDimensions,
} from './drafts';
import { SEED_ACTOR_EMAIL, SEED_ACTOR_NAME, seedIds } from './ids';
import { missingSourcingMembers, type SourcingSeed } from './sourcing';

export interface TenantSeedOptions {
  readonly slug: string;
  readonly seed: TenantSeed;
  /** The tenant's sourcing.json (SRC-01): contract, benchmark and sourcing_param members; none when absent. */
  readonly sourcing?: SourcingSeed | null;
  readonly bundle: ModelBundle;
  readonly modelVersionId: string;
  /** DEMO_USER_EMAIL: a fictitious user created with an owner membership; none when empty. */
  readonly demoUserEmail?: string;
  /** DEMO_USER_NAME; defaults to "Demo user". */
  readonly demoUserName?: string;
  readonly now?: () => Date;
}

export interface TenantSeedReport {
  readonly tenantId: string;
  /** Rows or changesets written by this run, by name; empty on a rerun. */
  readonly written: Readonly<Record<string, number>>;
  readonly total: number;
  /** Scenario key -> id of the presets (all locked). */
  readonly presets: Readonly<Record<string, string>>;
  readonly defaultScenario: string;
  readonly demoUserId: string | null;
}

const CHUNK = 500;
const chunks = <T>(rows: readonly T[]): T[][] =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

const text = (v: unknown, field: string): string => {
  if (typeof v !== 'string') throw new Error(`seed: tenant.json ${field} must be a string`);
  return v;
};
const int = (v: unknown, field: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`seed: tenant.json ${field} must be an integer`);
  return v;
};

/** Normalised demo email, or null when unset; anything without an `@` is an error. */
export function parseDemoEmail(raw: string | undefined): string | null {
  const email = raw?.trim().toLowerCase() ?? '';
  if (email === '') return null;
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('seed: DEMO_USER_EMAIL must be an email address');
  return email;
}

/** One compiled model per (tenant, model version, members hash) for the preset recomputes of one run. */
function seedModelCache(): ModelCache<CompiledModel> {
  const models = new Map<string, CompiledModel>();
  return {
    getOrCompile(key, compile) {
      const id = `${key.tenant_id}|${key.model_version_id}|${key.members_hash}`;
      let model = models.get(id);
      if (!model) models.set(id, (model = compile()));
      return model;
    },
  };
}

/**
 * Loads one tenant seed in a single tenant-scoped transaction (all or nothing), as the owner role:
 *
 * 1. the tenant row, the seed-loader user, the demo user + owner membership, `source` rows;
 * 2. the five presets as locked scenario rows (DOM-04 owns scenario ops, so rows go in through the
 *    store port's createScenario, like the DOM-03 seed test);
 * 3. through `applyChangeset` with origin `seed`: the tenant's members and lines, its sourcing members
 *    (SRC-02: contract, benchmark, sourcing_param; data the engine never reads) and its variable
 *    defaults (one changeset), then each preset's values (one changeset per preset), each recomputed
 *    so the preset has its `calc_run` (04 §2 step 6, ADR-007; `GET /scenarios/:id/calc`);
 * 4. `line_item_lever` rows (the port has no write for them).
 *
 * Idempotent: only what is missing is written. Tenant members and defaults are never overwritten
 * (users edit them); preset cells that differ from the seed are repaired, since presets are locked.
 */
export async function seedTenant(db: Db, o: TenantSeedOptions): Promise<TenantSeedReport> {
  const { slug, seed, bundle } = o;
  const now = o.now ?? (() => new Date());
  const tenantId = seedIds.tenant(slug);
  const actor = seedIds.seedActor();
  const demoEmail = parseDemoEmail(o.demoUserEmail);
  const presetKeys = seed.scenarios.scenarios.map((s) => s.id);
  if (!presetKeys.includes(seed.scenarios.default_scenario)) {
    throw new Error(`seed: default_scenario ${seed.scenarios.default_scenario} is not one of the presets`);
  }
  const written: Record<string, number> = {};
  const add = (name: string, n: number): void => {
    if (n > 0) written[name] = (written[name] ?? 0) + n;
  };
  let demoUserId: string | null = null;
  const presets: Record<string, string> = {};

  await withTenant(db, tenantId, actor, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`glidepath:seed:tenant:${slug}`}, 0))`);

    // ---- 1. tenant, users, sources
    const info = seed.tenant;
    add(
      'tenant',
      (
        await tx
          .insert(schema.tenant)
          .values({
            id: tenantId,
            slug,
            name: text(info.name, 'name'),
            currency: text(info.currency, 'currency'),
            base_year: int(info.base_year, 'base_year'),
            target_year: int(info.target_year, 'target_year'),
            fiscal_calendar: text(info.fiscal_calendar, 'fiscal_calendar'),
            ticker: typeof info.ticker === 'string' ? info.ticker : null,
            model_version_id: o.modelVersionId,
            status: 'active',
            created_at: now(),
          })
          .onConflictDoNothing()
          .returning({ id: schema.tenant.id })
      ).length,
    );
    add(
      'app_user (seed loader)',
      (
        await tx
          .insert(schema.app_user)
          .values({ id: actor, email: SEED_ACTOR_EMAIL, name: SEED_ACTOR_NAME })
          .onConflictDoNothing()
          .returning({ id: schema.app_user.id })
      ).length,
    );
    if (demoEmail !== null) {
      const found = await tx
        .select({ id: schema.app_user.id })
        .from(schema.app_user)
        .where(sql`${schema.app_user.email} = ${demoEmail}`);
      demoUserId = found[0]?.id ?? seedIds.user(demoEmail);
      add(
        'app_user (demo)',
        (
          await tx
            .insert(schema.app_user)
            .values({ id: demoUserId, email: demoEmail, name: o.demoUserName?.trim() || 'Demo user' })
            .onConflictDoNothing()
            .returning({ id: schema.app_user.id })
        ).length,
      );
      add(
        'tenant_membership',
        (
          await tx
            .insert(schema.tenant_membership)
            .values({ tenant_id: tenantId, user_id: demoUserId, role: 'owner' })
            .onConflictDoNothing()
            .returning({ id: schema.tenant_membership.user_id })
        ).length,
      );
    }
    const codes = allSourceCodes(seed);
    if (codes.length > 0) {
      add(
        'source',
        (
          await tx
            .insert(schema.source)
            .values(
              codes.map((code) => ({
                tenant_id: tenantId,
                id: seedIds.source(slug, code),
                code,
                kind: 'spec' as const,
                title: `Seed source ${code}`,
                url: null,
                as_of: null,
              })),
            )
            .onConflictDoNothing()
            .returning({ id: schema.source.id })
        ).length,
      );
    }

    // ---- 2. presets (locked scenario rows)
    const store: ChangesetStore = createChangesetStore(tx);
    const stored = await store.transaction((t) => t.loadScenarios());
    const byKey = new Map(stored.map((s) => [s.key, s]));
    const newRows: ScenarioRow[] = seed.scenarios.scenarios
      .filter((s) => !byKey.has(s.id))
      .map((s) => ({
        id: seedIds.scenario(slug, s.id),
        key: s.id,
        label: s.label,
        kind: 'preset',
        parent_id: null,
        model_version_id: o.modelVersionId,
        version: 0,
        locked: true,
        created_by: actor,
        created_at: now().toISOString(),
      }));
    if (newRows.length > 0) {
      await store.transaction(async (t) => {
        for (const row of newRows) await t.createScenario(row);
      });
      add('scenario', newRows.length);
    }
    for (const s of seed.scenarios.scenarios) {
      presets[s.id] = byKey.get(s.id)?.id ?? seedIds.scenario(slug, s.id);
    }
    // DATA-14: the position in scenarios.json is the list order (new and already seeded rows alike);
    // WEB-12: `default_scenario` marks the preset `/` opens
    for (const [pos, s] of seed.scenarios.scenarios.entries()) {
      await tx
        .update(schema.scenario)
        .set({ sort_order: pos, is_default: s.id === seed.scenarios.default_scenario })
        .where(sql`${schema.scenario.tenant_id} = ${tenantId} and ${schema.scenario.key} = ${s.id} and ${schema.scenario.kind} = 'preset'`);
    }

    // ---- 3a. tenant members, lines and defaults: one changeset
    const state = await store.transaction(async (t) => {
      const existing = new Map<string, Set<string>>();
      for (const dim of tenantDimensions(bundle)) {
        const keys = (seed.dimensionMembers[dim] ?? []).map((m) => m.id);
        const rows = keys.length === 0 ? new Map() : await t.loadMemberRows(dim, keys);
        existing.set(dim, new Set(rows.keys()));
      }
      for (const dim of SOURCING_DIMENSIONS) {
        const keys = (o.sourcing?.dimensions[dim] ?? []).map((m) => m.id);
        const rows = keys.length === 0 ? new Map() : await t.loadMemberRows(dim, keys);
        existing.set(dim, new Set(rows.keys()));
      }
      const defaults = (await t.loadInputs(null)).defaults;
      const version = (await t.changesSince(null, 0)).length;
      return { existing, defaults, version };
    });
    const sourcingChanges = o.sourcing ? missingSourcingMembers(o.sourcing, state.existing) : [];
    const defaultChanges = [
      ...missingMembers(seed, bundle, state.existing, (code) => seedIds.source(slug, code)),
      ...sourcingChanges,
      ...missingDefaults(seed, new Set(state.defaults.map((r) => cellId(r.var_key, r.member_key)))),
    ];
    if (defaultChanges.length > 0) {
      const draft: ChangesetDraft = {
        origin: 'seed',
        scenario_id: null,
        base_scenario_version: state.version,
        changes: defaultChanges,
      };
      await applyChangeset(store, draft, { actor, bundle, now: () => now().toISOString() });
      add('changeset (tenant defaults)', 1);
      add('changes (tenant defaults)', defaultChanges.length);
      add('sourcing members', sourcingChanges.length);
    }

    // ---- 3b. each preset's values: one changeset per preset that differs, recomputed (calc_run)
    const recompute = recomputeHook({
      tenantId,
      modelVersionId: o.modelVersionId,
      bundle,
      cache: seedModelCache(),
      now: () => now().toISOString(),
    });
    for (const s of seed.scenarios.scenarios) {
      const id = presets[s.id]!;
      const own = await store.transaction(async (t) => {
        const row = await t.loadScenarioForUpdate(id);
        const input = await t.loadInputs(id);
        return { version: row?.version ?? 0, input };
      });
      const level = own.input.chain.at(-1);
      const values = new Map((level?.values ?? []).map((r) => [cellId(r.var_key, r.member_key), r.value]));
      const overrides = new Map(own.input.overrides.map((r) => [cellId(r.node_key, r.member_key), r.value]));
      const changes = presetChanges(s, values, overrides);
      if (changes.length === 0) continue;
      await applyChangeset(
        store,
        { origin: 'seed', scenario_id: id, base_scenario_version: own.version, changes },
        { actor, bundle, recompute, now: () => now().toISOString() },
      );
      add('changeset (preset)', 1);
      add('changes (preset)', changes.length);
    }

    // ---- 4. line_item_lever (no port write)
    const levers = leverMappings(seed);
    let inserted = 0;
    for (const part of chunks(levers)) {
      inserted += (
        await tx
          .insert(schema.line_item_lever)
          .values(part.map((p) => ({ tenant_id: tenantId, ...p, mapping_source: 'rule' as const })))
          .onConflictDoNothing()
          .returning({ k: schema.line_item_lever.line_key })
      ).length;
    }
    add('line_item_lever', inserted);
  });

  return {
    tenantId,
    written,
    total: Object.values(written).reduce((a, b) => a + b, 0),
    presets,
    defaultScenario: seed.scenarios.default_scenario,
    demoUserId,
  };
}
