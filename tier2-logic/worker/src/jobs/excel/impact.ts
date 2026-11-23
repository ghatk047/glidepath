import { engineOverrides, engineValues, nodeMemberKeys, resolveInputs } from '@glidepath/domain';
import type { ChangesetDraft, InputState, InputValueRow, NodeOverrideRow, ScenarioLevel } from '@glidepath/domain';
import type { Change, CompiledModel } from '@glidepath/engine';
import type { DeltaImpact } from '@glidepath/excel';
import type { ModelBundle, TenantMembers } from '@glidepath/spec';

const cellOf = (id: string, memberKey: string): string => (memberKey === '' ? id : `${id}[${memberKey}]`);
const rowKey = (id: string, memberKey: string): string => `${id}\u0000${memberKey}`;

/** The stored rows of one scenario with the proposed drafts applied in memory (nothing is written). */
export function applyDraftsToState(
  state: InputState,
  scenarioId: string,
  drafts: readonly ChangesetDraft[],
): { state: InputState; skippedStructural: number } {
  const defaults = new Map<string, InputValueRow>(state.defaults.map((r) => [rowKey(r.var_key, r.member_key), r]));
  const levels = state.chain.map((l) => ({
    scenario_id: l.scenario_id,
    rows: new Map<string, InputValueRow>(l.values.map((r) => [rowKey(r.var_key, r.member_key), r])),
  }));
  const pins = new Map<string, NodeOverrideRow>(state.overrides.map((r) => [rowKey(r.node_key, r.member_key), r]));
  let skippedStructural = 0;

  for (const draft of drafts) {
    for (const change of draft.changes) {
      if (change.target === 'structural') {
        skippedStructural += 1;
        continue;
      }
      const k = rowKey(change.key, change.member_key);
      if (change.target === 'variable') {
        const rows =
          draft.scenario_id === null ? defaults : levels.find((l) => l.scenario_id === draft.scenario_id)?.rows;
        if (rows === undefined) continue;
        if (change.op === 'unset' || change.new_value === null) rows.delete(k);
        else rows.set(k, { var_key: change.key, member_key: change.member_key, value: change.new_value });
      } else if (draft.scenario_id === scenarioId) {
        if (change.op === 'unset' || change.new_value === null) pins.delete(k);
        else
          pins.set(k, {
            node_key: change.key,
            member_key: change.member_key,
            value: change.new_value,
            reason: change.note ?? pins.get(k)?.reason ?? '',
          });
      }
    }
  }
  const chain: ScenarioLevel[] = levels.map((l) => ({ scenario_id: l.scenario_id, values: [...l.rows.values()] }));
  return {
    state: { defaults: [...defaults.values()], chain, overrides: [...pins.values()] },
    skippedStructural,
  };
}

/** The impact cells: every cell of each listed node that the model has, as `node[member]`. */
export function impactCells(
  nodes: readonly string[],
  bundle: ModelBundle,
  members: TenantMembers,
  has: (cell: string) => boolean,
): string[] {
  const byId = new Map(bundle.nodes.map((n) => [n.id, n]));
  return nodes.flatMap((id) => {
    const node = byId.get(id);
    if (node === undefined) return [];
    return nodeMemberKeys(node, members)
      .map((k) => cellOf(id, k))
      .filter(has);
  });
}

export interface ImpactInput {
  readonly model: CompiledModel;
  readonly bundle: ModelBundle;
  readonly members: TenantMembers;
  /** Stored rows of the scenario now. */
  readonly state: InputState;
  readonly scenarioId: string;
  /** Report key of the scenario (`C`). */
  readonly scenarioKey: string;
  readonly drafts: readonly ChangesetDraft[];
  readonly nodes: readonly string[];
}

export interface ImpactResult {
  readonly impact: DeltaImpact;
  readonly skippedStructural: number;
}

/**
 * Impact preview of one scenario (05 step 5): evaluate the scenario as stored, put the proposed
 * drafts on top in memory, and `rerun` the engine over the cells whose resolved value changed. Gives
 * `[before, after]` for each hero cell. Structural changes (a new or deleted line) change the members
 * and are not previewed; they are counted.
 */
export function previewImpact(input: ImpactInput): ImpactResult {
  const { model, bundle } = input;
  const variables = bundle.variables.map((v) => v.id);
  const resolve = (s: InputState) => resolveInputs(s.defaults, s.chain, s.overrides, { variables });

  const before = resolve(input.state);
  const beforeValues = engineValues(before.values);
  const beforePins = engineOverrides(before.overrides);
  const prev = model.evaluate(beforeValues, beforePins);

  const proposed = applyDraftsToState(input.state, input.scenarioId, input.drafts);
  const after = resolve(proposed.state);
  const afterValues = engineValues(after.values);
  const afterPins = engineOverrides(after.overrides);

  const changes: Change[] = [];
  for (const [cell, value] of afterValues) {
    if (beforeValues.get(cell) !== value && prev.has(cell)) changes.push({ target: 'variable', cell, value });
  }
  for (const [cell, value] of afterPins) {
    if (beforePins.get(cell) !== value && prev.has(cell)) changes.push({ target: 'override', cell, value });
  }
  for (const cell of beforePins.keys()) {
    if (!afterPins.has(cell)) changes.push({ target: 'override', cell, value: null });
  }
  const next = changes.length === 0 ? prev : model.rerun(prev, changes);

  const impact: Record<string, string | readonly [number, number]> = { scenario: input.scenarioKey };
  for (const cell of impactCells(input.nodes, bundle, input.members, (c) => prev.has(c) && next.has(c))) {
    impact[cell] = [prev.get(cell), next.get(cell)] as const;
  }
  return { impact: impact as DeltaImpact, skippedStructural: proposed.skippedStructural };
}
