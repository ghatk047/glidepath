// Test support only (never exported by the package): the AA tenant seed (docs/spec/seed/aa) as
// changeset drafts of origin `seed`, the way a seed loader passes it through applyChangeset, plus the
// in-memory stores the applyChangeset tests start from.
import type { ModelBundle, Member, TenantMembers, TenantSeed } from '@glidepath/spec';
import type {
  ChangesetDraft,
  JsonObject,
  ScenarioId,
  StructuralChange,
  ValueChange,
} from '../changeset';
import { LINE_ITEM_DIM } from '../changeset';
import type { ScenarioRow } from '../ports';
import { MemoryChangesetStore } from './memory-store';
import { rowsOf } from './seed-state';

export const ACTOR = '00000000-0000-4000-8000-0000000000e1';
export const OTHER_USER = '00000000-0000-4000-8000-0000000000e2';
export const MODEL_VERSION = '00000000-0000-4000-8000-0000000000f1';
export const T0 = '2026-11-23T10:00:00.000Z';

/** Scenario id of a seed preset (`rates`, `A` ... `D`). */
export const presetId = (preset: string): ScenarioId => `sc-preset-${preset.toLowerCase()}`;

/** Whether a dimension holds tenant rows (scope `tenant` or `global+tenant`). */
const isTenantDim = (bundle: Pick<ModelBundle, 'dimensions'>, dim: string): boolean =>
  bundle.dimensions
    .find((d) => d.id === dim)
    ?.scope.split('+')
    .includes('tenant') ?? false;

/** The seed's members of global and system dims: in the database they come from global tables. */
export function seedGlobalMembers(seed: TenantSeed, bundle: ModelBundle): TenantMembers {
  return Object.fromEntries(
    Object.entries(seed.dimensionMembers).filter(([dim]) => !isTenantDim(bundle, dim)),
  );
}

const json = (v: unknown): JsonObject[string] =>
  v === undefined ? null : (v as JsonObject[string]);

/** A seed member of a tenant dim as a dimension_member row. */
export function dimensionMemberRow(m: Member, sort: number): JsonObject {
  const attrs: Record<string, unknown> = { ...m };
  delete attrs.id;
  delete attrs.label;
  return { label: json(m.label), attrs: attrs as JsonObject, sort, active: true };
}

/** A seed line as a line_item row (the seed's `vendor` is free text: vendor_text, no vendor_key). */
export function lineItemRow(m: Member): JsonObject {
  return {
    legacy_id: json(m.legacy_id),
    pool_id: json(m.pool),
    tenant_l1_label: json(m.l1_label),
    l2: json(m.l2),
    name: json(m.name),
    vendor_key: null,
    vendor_text: json(m.vendor),
    nature: json(m.nature),
    accounting: json(m.accounting),
    driver_text: json(m.driver_text),
    qty: json(m.qty),
    unit: json(m.unit),
    addr_tag: json(m.addr),
    domain_key: json(m.domain),
    scale_driver: json(m.drv),
    in_scope: m.in_scope === 1,
    memo: m.memo === 1,
    confidence: json(m.confidence),
    source_id: null,
    lever_hook_text: json(m.lever_hook),
    notes: json(m.notes),
    active: true,
  };
}

/** One draft for the tenant defaults: every tenant member and line, then every variable's default. */
export function seedDefaultsDraft(seed: TenantSeed, bundle: ModelBundle): ChangesetDraft {
  const structural: StructuralChange[] = Object.entries(seed.dimensionMembers)
    .filter(([dim]) => isTenantDim(bundle, dim))
    .flatMap(([dim, members]) =>
      members.map((m, i) => ({
        target: 'structural' as const,
        key: dim,
        member_key: m.id,
        op: 'insert' as const,
        new_value: dim === LINE_ITEM_DIM ? lineItemRow(m) : dimensionMemberRow(m, i + 1),
      })),
    );
  const values: ValueChange[] = rowsOf(seed.variableValues).map((r) => ({
    target: 'variable',
    key: r.var_key,
    member_key: r.member_key,
    op: 'set',
    new_value: r.value,
  }));
  return {
    origin: 'seed',
    scenario_id: null,
    base_scenario_version: 0,
    changes: [...structural, ...values],
  };
}

/** One draft per preset: its scenario values. */
export function seedPresetDraft(seed: TenantSeed, preset: string, version = 0): ChangesetDraft {
  const s = seed.scenarios.scenarios.find((x) => x.id === preset);
  if (!s) throw new Error(`no preset ${preset}`);
  return {
    origin: 'seed',
    scenario_id: presetId(preset),
    base_scenario_version: version,
    changes: rowsOf(s.values).map((r) => ({
      target: 'variable',
      key: r.var_key,
      member_key: r.member_key,
      op: 'set',
      new_value: r.value,
    })),
  };
}

/** The locked preset rows of the seed, at `version`. */
export function presetRows(seed: TenantSeed, version: number): ScenarioRow[] {
  return seed.scenarios.scenarios.map((s) => ({
    id: presetId(s.id),
    key: s.id,
    label: s.label,
    kind: 'preset',
    parent_id: null,
    model_version_id: MODEL_VERSION,
    version,
    locked: true,
    created_by: ACTOR,
    created_at: T0,
  }));
}

/** A user scenario, child of preset C. */
export const CUSTOM: ScenarioRow = {
  id: 'sc-mine',
  key: 'mine',
  label: 'Mine',
  kind: 'user',
  parent_id: presetId('C'),
  model_version_id: MODEL_VERSION,
  version: 0,
  locked: false,
  created_by: ACTOR,
  created_at: T0,
};

/**
 * The AA tenant already loaded: members (all served as global members), tenant defaults, the five
 * locked presets at version 1 with their values, and `CUSTOM` (version 0, no rows of its own).
 */
export function aaStore(
  seed: TenantSeed,
  init: { readonly pins?: boolean } = {},
): MemoryChangesetStore {
  return new MemoryChangesetStore({
    globalMembers: seed.dimensionMembers,
    defaults: rowsOf(seed.variableValues),
    scenarios: [...presetRows(seed, 1), CUSTOM],
    scenarioValues: Object.fromEntries(
      seed.scenarios.scenarios.map((s) => [presetId(s.id), rowsOf(s.values)]),
    ),
    ...(init.pins
      ? {
          nodeOverrides: {
            [presetId('C')]: [
              { node_key: 'res.net', member_key: '', value: 118, reason: 'finance view' },
            ],
          },
        }
      : {}),
  });
}

/** Sequential ids `id-1`, `id-2`, ... for deterministic rows. */
export function sequentialIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
