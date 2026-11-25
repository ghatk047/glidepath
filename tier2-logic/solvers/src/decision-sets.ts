/**
 * Decision variable sets (`solvers.json` `decision_variable_sets`; 04 §1 "Decision variables vs
 * estimates"): which input cells an optimiser may move, and within which bounds. Estimates are facts or
 * assumptions a solver must hold; no set ever contains one.
 */
import { cellKey, type CellKey, type VariableDef } from '@glidepath/engine';
import type { DecisionBounds, VariableKind } from '@glidepath/spec';
import { SolverError } from './errors';
import type { SolverModel } from './model';
import type { DecisionSetId } from './types';

/** One movable input cell with its bounds. */
export interface DecisionVariable {
  readonly set: DecisionSetId;
  readonly cell: CellKey;
  /** Variable id (`lev.L03.pct`, `lev.start`). */
  readonly id: string;
  /** Members of the variable's dims for this cell, in dim order; empty for a scalar. */
  readonly members: readonly string[];
  readonly kind: VariableKind;
  readonly type: VariableDef['type'];
  /** Registry step; null when the registry has none. */
  readonly step: number | null;
  /** Registry range. */
  readonly min: number | null;
  readonly max: number | null;
  /** Solver bounds `[lo, hi]`. */
  readonly lo: number;
  readonly hi: number;
  /** Value at the start point (the base evaluation). It may lie outside `[lo, hi]`. */
  readonly value: number;
}

/** Kinds no solver may move (04 §1). */
const HELD_KINDS: ReadonlySet<VariableKind> = new Set<VariableKind>(['estimate', 'simulation']);

interface SetRule {
  /** Which registry variables belong to the set. */
  readonly select: (v: VariableDef) => boolean;
  /** `stretch`: `[min, min(max, stretch cap)]`; `registry`: `[min, max]`. */
  readonly bounds: 'stretch' | 'registry';
}

/** Variable ids the spec names for a set (`solvers.json` `decision_variable_sets`, verbatim). */
export const DECISION_SET_IDS = {
  lever_timing: ['lev.start', 'lev.ramp'],
  lever_switch: ['lev.on'],
  funding: ['g.ot_out_share'],
} as const satisfies Partial<Record<DecisionSetId, readonly string[]>>;

/** Lever-intensity inputs: `lev.Lxx.*` (`solvers.json`). */
const LEVER_PREFIX = 'lev.L';

const named = (ids: readonly string[]) => (v: VariableDef) => ids.includes(v.id);

const RULES: Readonly<Record<DecisionSetId, SetRule>> = {
  // "scalar lever inputs that vary by scenario (lev.Lxx.*)", kind = decision.
  lever_intensity: {
    select: (v) => v.id.startsWith(LEVER_PREFIX) && v.scenario_varies && v.dims.length === 0 && v.kind === 'decision',
    bounds: 'stretch',
  },
  // "lev.start[lever] integer 1-12, lev.ramp[lever]"; registry bounds (no earliest-feasible data yet).
  lever_timing: { select: (v) => named(DECISION_SET_IDS.lever_timing)(v) && v.kind === 'decision', bounds: 'registry' },
  // "lev.on[lever] binary".
  lever_switch: { select: (v) => named(DECISION_SET_IDS.lever_switch)(v) && v.kind === 'decision', bounds: 'registry' },
  // "g.ot_out_share (policy, usually fixed)": named by the spec, so taken whatever its kind (not an estimate).
  funding: { select: named(DECISION_SET_IDS.funding), bounds: 'registry' },
};

/** Every set id, in `solvers.json` order. */
export const DECISION_SETS: readonly DecisionSetId[] = ['lever_intensity', 'lever_timing', 'lever_switch', 'funding'];

/** Cartesian product of the members of `dims`, first dim outermost (the engine's expansion order). */
function combos(model: SolverModel, v: VariableDef): string[][] {
  let out: string[][] = [[]];
  for (const dim of v.dims) {
    const members = model.members[dim];
    if (members === undefined) throw new SolverError('BAD_MODEL', `variable ${v.id}: no members for dimension ${dim}`);
    out = out.flatMap((prefix) => members.map((m) => [...prefix, m.id]));
  }
  return out;
}

/** Highest value of `cell` across the stretch presets; undefined when none sets it. */
function stretchCap(model: SolverModel, cell: CellKey): number | undefined {
  let cap: number | undefined;
  for (const preset of model.stretch ?? []) {
    const v = preset.get(cell);
    if (v !== undefined && (cap === undefined || v > cap)) cap = v;
  }
  return cap;
}

/**
 * The decision variables of one set, in registry order (members in tenant order), restricted to cells
 * the model reads. Bounds:
 * - `lever_intensity`: `[registry min, min(registry max, max over model.stretch)]` (04 §1 stretch cap);
 * - other sets: `[registry min, registry max]`;
 * - `model.caps` replaces the upper bound of a listed cell (the user widened it);
 * - a missing registry bound falls back to the start value (that side cannot move).
 */
export function decisionSet(model: SolverModel, set: DecisionSetId): DecisionVariable[] {
  const rule = RULES[set];
  if (rule === undefined) throw new SolverError('BAD_PARAMS', `unknown decision set ${String(set)}`);
  const out: DecisionVariable[] = [];
  for (const v of model.bundle.variables) {
    if (HELD_KINDS.has(v.kind) || !rule.select(v)) continue;
    for (const members of combos(model, v)) {
      const cell = cellKey(v.id, members);
      if (!model.base.has(cell)) continue;
      const value = model.base.get(cell);
      const lo = v.min ?? value;
      let hi = v.max ?? value;
      if (rule.bounds === 'stretch') {
        const cap = stretchCap(model, cell);
        if (cap !== undefined) hi = Math.min(hi, cap);
      }
      const widened = model.caps?.get(cell);
      if (widened !== undefined) hi = widened;
      out.push({
        set,
        cell,
        id: v.id,
        members,
        kind: v.kind,
        type: v.type,
        step: v.step,
        min: v.min,
        max: v.max,
        lo,
        hi: Math.max(lo, hi),
        value,
      });
    }
  }
  return out;
}

/** The union of several sets, first occurrence of a cell kept. */
export function decisionSets(model: SolverModel, sets: readonly DecisionSetId[]): DecisionVariable[] {
  const seen = new Set<CellKey>();
  const out: DecisionVariable[] = [];
  for (const set of sets) {
    for (const d of decisionSet(model, set)) {
      if (seen.has(d.cell)) continue;
      seen.add(d.cell);
      out.push(d);
    }
  }
  return out;
}

/**
 * The model with the reference decision bounds (SOL-12; `@glidepath/spec` `decisionBoundsFor`, generated from
 * docs/spec/reference/solvers_demo.py) as `caps`: every `lever_intensity` cell the bounds name gets their upper
 * bound, so the set's bounds are the reference's (`lo` is the registry min on both sides). The reference caps at
 * the stretch presets alone, above the registry max for a few inputs; SOL-01's default bound stays for cells the
 * bounds do not name. A cap already on the model (the user widened it) wins. `null` returns the model unchanged.
 */
export function withDecisionBounds(model: SolverModel, bounds: Pick<DecisionBounds, 'hi'> | null): SolverModel {
  if (bounds === null) return model;
  const caps = new Map<CellKey, number>();
  for (const d of decisionSet(model, 'lever_intensity')) {
    const hi = Object.hasOwn(bounds.hi, d.cell) ? bounds.hi[d.cell] : undefined;
    if (hi !== undefined) caps.set(d.cell, hi);
  }
  for (const [cell, hi] of model.caps ?? []) caps.set(cell, hi);
  return { ...model, caps };
}

/** Clamps `x` to the variable's bounds. */
export function clampToBounds(d: Pick<DecisionVariable, 'lo' | 'hi'>, x: number): number {
  return Math.min(d.hi, Math.max(d.lo, x));
}

/** True for a registry variable a solver must hold fixed (an estimate or a simulation input). */
export function isHeld(v: Pick<VariableDef, 'kind'>): boolean {
  return HELD_KINDS.has(v.kind);
}
