/**
 * Tornado sensitivity (04 §5; `solvers.json` `problems.sensitivity.methods.tornado`): move each input
 * alone to its registry min and max (or ± a fraction of its current value), read the output, sort by
 * swing. Optional elasticities `∂output/∂input × input/output` at the current point by central finite
 * differences. Every point is one lane of a single `evaluateBatch` from the start point (ENG-08).
 *
 * Each item carries a category (`policy`, `timing`, `lever`) derived from the registry so the UI can
 * colour policy and timing inputs apart from savings levers (docs/ux/01_moodboard.md).
 */
import { FD_STEP, type BatchInput, type CellKey, type VariableDef } from '@glidepath/engine';
import { DECISION_SET_IDS } from './decision-sets';
import { SolverError } from './errors';
import type { SolverModel } from './model';
import type { SensitivityParams } from './types';

/** Colour class of a tornado item. */
export type TornadoCategory = 'policy' | 'timing' | 'lever';
export const TORNADO_CATEGORIES: readonly TornadoCategory[] = ['policy', 'timing', 'lever'];

/** Registry group of target and governance inputs (`variables.json` `group`). */
const GOVERNANCE_GROUP = 'Target & governance';
/** Registry layer of the target itself inside that group (`variables.json` `layer`). */
const TARGET_LAYER = 'target';
const TIMING_IDS: ReadonlySet<string> = new Set(DECISION_SET_IDS.lever_timing);

/**
 * Category from the registry group: the `lever_timing` decision set (`lev.start`, `lev.ramp`) is timing;
 * in the target-and-governance group, the target layer (target, funding share, …) is policy and the rest
 * (head start, one-time phasing) timing; every other group is a lever or a baseline driver of one.
 */
export function defaultTornadoCategory(v: VariableDef): TornadoCategory {
  if (TIMING_IDS.has(v.id)) return 'timing';
  if (v.group === GOVERNANCE_GROUP) return v.layer === TARGET_LAYER ? 'policy' : 'timing';
  return 'lever';
}

export interface TornadoOptions {
  /** Input cells to vary (`g.head_start`, `lev.start[L03]`); absent = every scalar, ranged, non-enum driver that feeds `output`. */
  readonly inputs?: readonly CellKey[];
  /** Registry min/max (default) or ± `fraction` of the current value. */
  readonly range?: SensitivityParams['range'];
  /** Also compute each input's elasticity at the current point. */
  readonly elasticity?: boolean;
  /** Category rule; defaults to `defaultTornadoCategory`. */
  readonly category?: (v: VariableDef) => TornadoCategory;
  /** Keep only the first `top` items after sorting. */
  readonly top?: number;
}

export interface TornadoPoint {
  readonly input: number;
  readonly output: number;
}

export interface TornadoItem {
  readonly cell: CellKey;
  /** Registry variable id of the cell. */
  readonly id: string;
  readonly category: TornadoCategory;
  /** Input value at the start point. */
  readonly value: number;
  /** Output with the input at its low / high point; null if that evaluation failed. */
  readonly low: TornadoPoint | null;
  readonly high: TornadoPoint | null;
  /** |high.output − low.output| (or the one side's distance from the base output). */
  readonly swing: number;
  /** ∂output/∂input × input/output; null unless asked for, or where output = 0 or a lane failed. */
  readonly elasticity: number | null;
}

export interface Tornado {
  readonly output: CellKey;
  /** Output at the start point. */
  readonly base: number;
  /** Sorted by swing, descending; ties keep input order. */
  readonly items: readonly TornadoItem[];
}

export type TornadoModel = Pick<SolverModel, 'compiled' | 'base' | 'bundle'>;

const varIdOf = (cell: CellKey): string => {
  const i = cell.indexOf('[');
  return i < 0 ? cell : cell.slice(0, i);
};

/** Lane offsets of one input's points: low, high, and for elasticity x − h, x + h. */
const LANE = { low: 0, high: 1, minus: 2, plus: 3 } as const;
const LANES_TORNADO = LANE.high + 1;
const LANES_WITH_ELASTICITY = LANE.plus + 1;

const ranged = (v: VariableDef): boolean => v.min !== null && v.max !== null;

/** Default inputs: scalar drivers with a registry range, not enums, that feed `output`. */
function defaultInputs(model: TornadoModel, output: CellKey): CellKey[] {
  const feeds = new Set(model.compiled.upstream(output));
  return model.bundle.variables
    .filter((v) => v.dims.length === 0 && v.role === 'driver' && v.type !== 'enum' && ranged(v) && feeds.has(v.id))
    .map((v) => v.id);
}

/** `tornado(output, options)` on `model`: one batch, items sorted by swing. Pure. */
export function tornado(model: TornadoModel, output: CellKey, options: TornadoOptions = {}): Tornado {
  if (!model.base.has(output)) throw new SolverError('BAD_PARAMS', `unknown output cell ${output}`);
  const range = options.range ?? { mode: 'registry' };
  if (range.mode === 'relative' && !(range.fraction > 0)) {
    throw new SolverError('BAD_PARAMS', `relative range fraction must be > 0, got ${range.fraction}`);
  }
  const categoryOf = options.category ?? defaultTornadoCategory;
  const vars = new Map(model.bundle.variables.map((v) => [v.id, v] as const));
  const cells = options.inputs ?? defaultInputs(model, output);

  const withElasticity = options.elasticity === true;
  const per = withElasticity ? LANES_WITH_ELASTICITY : LANES_TORNADO;
  const specs = cells.map((cell) => {
    const v = vars.get(varIdOf(cell));
    if (v === undefined || !model.base.has(cell)) throw new SolverError('BAD_PARAMS', `unknown input cell ${cell}`);
    const x = model.base.get(cell);
    let lo: number;
    let hi: number;
    if (range.mode === 'registry') {
      if (!ranged(v)) throw new SolverError('BAD_PARAMS', `${cell} has no registry min/max`);
      lo = v.min!;
      hi = v.max!;
    } else {
      const a = x * (1 - range.fraction);
      const b = x * (1 + range.fraction);
      lo = Math.min(a, b);
      hi = Math.max(a, b);
      if (v.type === 'int') {
        lo = Math.round(lo);
        hi = Math.round(hi);
      }
    }
    const h = Math.max(Math.abs(x), 1) * FD_STEP;
    return { cell, v, x, lo, hi, h };
  });

  const size = specs.length * per;
  const lanes = new Map<CellKey, Float64Array>();
  specs.forEach((s, i) => {
    let a = lanes.get(s.cell);
    if (a === undefined) {
      a = new Float64Array(size).fill(s.x);
      lanes.set(s.cell, a);
    }
    const k = i * per;
    a[k + LANE.low] = s.lo;
    a[k + LANE.high] = s.hi;
    if (withElasticity) {
      a[k + LANE.minus] = s.x - s.h;
      a[k + LANE.plus] = s.x + s.h;
    }
  });

  const y0 = model.base.get(output);
  const input: BatchInput = { size, values: lanes };
  const result = size === 0 ? undefined : model.compiled.evaluateBatch(model.base, input);
  const ys = result?.values.get(output) ?? lanes.get(output);
  const at = (lane: number): number | null => {
    if (result?.errors.has(lane) === true) return null;
    const y = ys === undefined ? y0 : ys[lane]!;
    return Number.isFinite(y) ? y : null;
  };

  const items: TornadoItem[] = specs.map((s, i) => {
    const k = i * per;
    const yl = at(k + LANE.low);
    const yh = at(k + LANE.high);
    const low = yl === null ? null : { input: s.lo, output: yl };
    const high = yh === null ? null : { input: s.hi, output: yh };
    const swing =
      yl !== null && yh !== null ? Math.abs(yh - yl) : yl !== null ? Math.abs(yl - y0) : yh !== null ? Math.abs(yh - y0) : 0;
    let elasticity: number | null = null;
    if (withElasticity) {
      const ym = at(k + LANE.minus);
      const yp = at(k + LANE.plus);
      if (ym !== null && yp !== null && y0 !== 0) {
        // Central difference over x ± h.
        const e = ((yp - ym) / (s.x + s.h - (s.x - s.h))) * (s.x / y0);
        elasticity = Number.isFinite(e) ? e : null;
      }
    }
    return { cell: s.cell, id: s.v.id, category: categoryOf(s.v), value: s.x, low, high, swing, elasticity };
  });

  // Array.prototype.sort is stable: equal swings keep input order.
  items.sort((a, b) => b.swing - a.swing);
  const top = options.top;
  return { output, base: y0, items: top === undefined ? items : items.slice(0, Math.max(0, top)) };
}
