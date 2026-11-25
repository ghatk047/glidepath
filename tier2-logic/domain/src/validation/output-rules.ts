/**
 * Output rules VR05 and VR08 of docs/spec/schema.json `validation_rules`: they read engine outputs, so
 * they run on an evaluation of the post-change state (docs/architecture/04_data_and_api.md section 2,
 * step 6), before the commit. Node and member ids are the spec's, verbatim; no business number lives
 * here.
 */
import type { MemberId, ModelBundle, NodeDef, NodeId, TenantMembers } from '@glidepath/spec';
import { ruleEntry, type ValidationEntry } from './catalog';
import { RULE_TOLERANCE, formatList, formatNumber, toCellKey } from './state';

/** The output rules, in rule order. */
export const OUTPUT_RULE_IDS = ['VR05', 'VR08'] as const;
export type OutputRuleId = (typeof OUTPUT_RULE_IDS)[number];

/**
 * What the output rules read of an evaluation, keyed by engine CellKey (`id` for a scalar,
 * `id[member_key]` otherwise). An engine `Evaluation` satisfies it.
 */
export interface OutputEvaluation {
  get(cell: string): number;
  has(cell: string): boolean;
  /** The node cells the evaluation pins (node_override), by engine CellKey. */
  readonly overrides?: ReadonlyMap<string, number>;
}

/** The state the output rules validate: one evaluation of a post-change state. */
export interface OutputState {
  /** The pinned model's nodes (dims, labels, the `output` flag). */
  readonly bundle: Pick<ModelBundle, 'nodes'>;
  /** The members the model was compiled with. */
  readonly members: TenantMembers;
  readonly evaluation: OutputEvaluation;
  /**
   * Every cell `cell` reads, transitively (`CompiledModel.upstream`). With it, a VR08 check that a
   * pinned cell feeds is skipped (see `vr08EngineSelfTest`). Without it every check is made.
   */
  readonly upstream?: (cell: string) => readonly string[];
}

/** The engine CellKey of a node cell: `id` for a scalar, `id[member_key]` otherwise. */
const engineKey = (id: string, memberKey: string): string =>
  memberKey === '' ? id : `${id}[${memberKey}]`;

/**
 * The member keys of a node: the cartesian product of its dims (first dim outermost), each over the
 * node's `members` subset when it lists one, else over the tenant's members. `['']` for a scalar.
 */
export function nodeMemberKeys(
  node: Pick<NodeDef, 'dims' | 'members'>,
  members: TenantMembers,
): string[] {
  let keys: MemberId[][] = [[]];
  for (const dim of node.dims) {
    const subset = node.members?.[dim];
    const ids = subset && subset.length > 0 ? subset : (members[dim] ?? []).map((m) => m.id);
    keys = keys.flatMap((k) => ids.map((id) => [...k, id]));
  }
  return keys.map((k) => k.join(','));
}

/** The node's cells the evaluation holds, as `[memberKey, value]`. */
function cellsOf(
  state: OutputState,
  id: NodeId,
): { node: NodeDef; cells: [string, number][] } | null {
  const node = state.bundle.nodes.find((n) => n.id === id);
  if (!node) return null;
  const cells = nodeMemberKeys(node, state.members)
    .filter((k) => state.evaluation.has(engineKey(id, k)))
    .map((k): [string, number] => [k, state.evaluation.get(engineKey(id, k))]);
  return { node, cells };
}

const labelOf = (node: NodeDef): string => (node.label.trim() !== '' ? node.label.trim() : node.id);

// ------------------------------------------------------------------------------------------ VR05

/** Managed / fixed-price SI services: the SI pool less contractor T&M cost. */
export const MANAGED_SERVICES_NODE: NodeId = 'lv.ms0';

/**
 * VR05: `lv.ms0 >= 0`. Contractor T&M cost cannot exceed the SI pool (spec 06_reconciliation R18:
 * large headcount or rate changes push managed services negative). One entry on `lv.ms0[]`.
 */
export function vr05ManagedServices(state: OutputState): ValidationEntry[] {
  const found = cellsOf(state, MANAGED_SERVICES_NODE);
  if (!found) return [];
  return found.cells
    .filter(([, v]) => !(v >= -RULE_TOLERANCE))
    .map(([k, v]) =>
      ruleEntry(
        'VR05',
        [toCellKey(MANAGED_SERVICES_NODE, k)],
        `${labelOf(found.node)} would be ${formatNumber(v)} ${found.node.unit}: contractor T&M cost exceeds the SI pool; lower contractor headcount or rates.`,
      ),
    );
}

// ------------------------------------------------------------------------------------------ VR08

/** The engine self-test cells of VR08: each must be 0. */
export const SELF_TEST_NODES: readonly NodeId[] = ['lev.rr_check', 'vp.check'];

/**
 * VR08: `lev.rr_check = 0` (pool effects sum to each lever's run-rate) and `vp.check = 0` (VP nets
 * sum to the total), within `RULE_TOLERANCE`. One entry per self-test node, listing its failing cells.
 *
 * A pin (node_override) replaces the engine's arithmetic for its cell, so a check a pinned cell feeds
 * no longer tests the engine: pinning `base.pool_outlay[si_contingent]` (spec 01 "the SI pool is
 * $118M") or `res.net` moves `vp.check` off 0 by design. A pinned check cell is skipped, and so is a
 * check a pin feeds when `state.upstream` is given; any other non-zero check is an error.
 */
export function vr08EngineSelfTest(state: OutputState): ValidationEntry[] {
  const pins = state.evaluation.overrides ?? new Map<string, number>();
  const pinned = (cell: string): boolean => {
    if (pins.has(cell)) return true;
    if (pins.size === 0 || state.upstream === undefined) return false;
    return state.upstream(cell).some((c) => pins.has(c));
  };
  return SELF_TEST_NODES.flatMap((id) => {
    const found = cellsOf(state, id);
    if (!found) return [];
    const failing = found.cells.filter(
      ([k, v]) => !(Math.abs(v) <= RULE_TOLERANCE) && !pinned(engineKey(id, k)),
    );
    if (failing.length === 0) return [];
    const worst = failing.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
    const where = found.node.dims.length > 0 ? ` for ${formatList(failing.map(([k]) => k))}` : '';
    return [
      ruleEntry(
        'VR08',
        failing.map(([k]) => toCellKey(id, k)),
        `Engine self-test failed: ${labelOf(found.node)} is ${formatNumber(worst[1])} ${found.node.unit}${where}; the calculation is inconsistent, report it.`,
      ),
    ];
  });
}

export type OutputRule = (state: OutputState) => ValidationEntry[];

/** One pure function per output rule. */
export const OUTPUT_RULES: Readonly<Record<OutputRuleId, OutputRule>> = {
  VR05: vr05ManagedServices,
  VR08: vr08EngineSelfTest,
};

/**
 * Every output rule's entries for one evaluation, in rule order (VR05, VR08). Empty when the
 * evaluation is valid; a changeset is rejected when any entry has severity `error`.
 */
export function validateOutputs(state: OutputState): ValidationEntry[] {
  return OUTPUT_RULE_IDS.flatMap((id) => OUTPUT_RULES[id](state));
}
