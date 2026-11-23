/**
 * Scenario resolution: the semantics of the view `v_inputs_resolved(tenant, scenario)`
 * (docs/spec/01_data_model.md section 4). Shared fixture with DATA-03: fixtures/scenario-chain-3.json.
 */
import type { NodeId, VarId } from '@glidepath/spec';
import type { ScenarioId } from './changeset';
import type { MemberKey } from './member-key';

/** One stored input cell: a variable_value row (tenant default) or a scenario_value row. */
export interface InputValueRow {
  readonly var_key: VarId;
  readonly member_key: MemberKey;
  readonly value: number;
}

/** One scenario's own scenario_value rows. */
export interface ScenarioLevel {
  readonly scenario_id: ScenarioId;
  readonly values: readonly InputValueRow[];
}

/** One node_override row of a scenario (without scenario_id). */
export interface NodeOverrideRow {
  readonly node_key: NodeId;
  readonly member_key: MemberKey;
  readonly value: number;
  readonly reason: string;
}

/** A resolved input cell, with the level that supplied its value. */
export interface ResolvedInput extends InputValueRow {
  /** The scenario whose row won; null = the tenant default. */
  readonly scenario_id: ScenarioId | null;
}

export interface ResolvedInputs {
  /** One entry per (var_key, member_key), ordered by var_key then member_key (code-point order). */
  readonly values: readonly ResolvedInput[];
  /** The scenario's node overrides, same order by node_key then member_key. */
  readonly overrides: readonly NodeOverrideRow[];
}

export interface ResolveOptions {
  /**
   * Variable ids of the tenant's pinned model version (variable_def). When given, cells of other
   * variables (stale rows from an older model) are left out, as the view does.
   */
  readonly variables?: Iterable<VarId>;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Resolve a scenario's inputs: per (var_key, member_key) cell, variable definition -> tenant default
 * -> each scenario of `scenarioChain` (ordered from the root ancestor to the scenario itself), the
 * last level with a row wins; plus `overrides`, the scenario's own node overrides (they are not
 * inherited). A cell set only by a scenario, with no tenant default, is included. An empty chain
 * resolves the tenant defaults. Two rows for one cell on one level throw.
 */
export function resolveInputs(
  defaults: readonly InputValueRow[],
  scenarioChain: readonly ScenarioLevel[],
  overrides: readonly NodeOverrideRow[],
  options: ResolveOptions = {},
): ResolvedInputs {
  const defined = options.variables === undefined ? null : new Set(options.variables);
  const cells = new Map<VarId, Map<MemberKey, ResolvedInput>>();

  const overlay = (rows: readonly InputValueRow[], scenarioId: ScenarioId | null): void => {
    const seen = new Map<VarId, Set<MemberKey>>();
    for (const r of rows) {
      const level = seen.get(r.var_key) ?? new Set<MemberKey>();
      if (level.has(r.member_key)) {
        const where = scenarioId === null ? 'tenant default' : `scenario ${scenarioId}`;
        throw new Error(`resolveInputs: duplicate cell ${r.var_key}[${r.member_key}] in ${where}`);
      }
      seen.set(r.var_key, level.add(r.member_key));
      if (defined !== null && !defined.has(r.var_key)) continue;
      const byMember = cells.get(r.var_key) ?? new Map<MemberKey, ResolvedInput>();
      cells.set(r.var_key, byMember);
      byMember.set(r.member_key, {
        var_key: r.var_key,
        member_key: r.member_key,
        value: r.value,
        scenario_id: scenarioId,
      });
    }
  };

  overlay(defaults, null);
  for (const level of scenarioChain) overlay(level.values, level.scenario_id);

  const values: ResolvedInput[] = [];
  for (const varKey of [...cells.keys()].sort(compare)) {
    const byMember = cells.get(varKey)!;
    for (const mk of [...byMember.keys()].sort(compare)) values.push(byMember.get(mk)!);
  }

  const ownOverrides = [...overrides]
    .map((o) => ({
      node_key: o.node_key,
      member_key: o.member_key,
      value: o.value,
      reason: o.reason,
    }))
    .sort((a, b) => compare(a.node_key, b.node_key) || compare(a.member_key, b.member_key));
  ownOverrides.forEach((o, i) => {
    const prev = ownOverrides[i - 1];
    if (prev && prev.node_key === o.node_key && prev.member_key === o.member_key) {
      throw new Error(`resolveInputs: duplicate node override ${o.node_key}[${o.member_key}]`);
    }
  });

  return { values, overrides: ownOverrides };
}

/** A scenario row's identity and parent link (schema.json tables.scenario). */
export interface ScenarioLink {
  readonly id: ScenarioId;
  readonly parent_id: ScenarioId | null;
}

/**
 * The chain of `scenarioId`: scenario ids from the root ancestor down to the scenario itself, the
 * order `resolveInputs` takes. Throws on an unknown scenario or parent and on a cycle.
 */
export function resolveScenarioChain(
  scenarios: readonly ScenarioLink[],
  scenarioId: ScenarioId,
): ScenarioId[] {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const chain: ScenarioId[] = [];
  const seen = new Set<ScenarioId>();
  let id: ScenarioId | null = scenarioId;
  while (id !== null) {
    const s = byId.get(id);
    if (!s) {
      const child = chain[chain.length - 1];
      throw new Error(
        `resolveScenarioChain: unknown scenario ${id}${child ? ` (parent of ${child})` : ''}`,
      );
    }
    if (seen.has(id))
      throw new Error(`resolveScenarioChain: cycle through ${id} in the chain of ${scenarioId}`);
    seen.add(id);
    chain.push(id);
    id = s.parent_id;
  }
  return chain.reverse();
}
