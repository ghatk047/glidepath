/**
 * Full evaluation: `Model.run` (engine.py L317-328). Inputs fill their slots, node overrides pin their
 * cells (S15), and the program runs every cell in topological order.
 */
import type { Program } from '../compile/program';
import { EngineError } from '../errors';
import type { CellKey, Evaluation } from '../types';
import { runCells } from './run';

/** What an evaluation noticed that is not an error. */
export interface EvaluationDiagnostics {
  /** Override keys that are not node cells: ignored, as in Python (S15). */
  readonly ignoredOverrides: readonly CellKey[];
}

/** What `evaluate` needs of a compiled model. */
export interface EvaluableModel {
  readonly program: Program;
  /** Key → id: node cells `[0, nCells)` in topological order (= slots), then inputs, then dangling keys. */
  readonly index: ReadonlyMap<CellKey, number>;
  /** Expression of each node cell (topological order), for error positions. */
  readonly sources: readonly string[];
}

/** An evaluation over the program's slots. Node cells read their slot; inputs read `values`. */
export class SlotEvaluation implements Evaluation {
  constructor(
    /** The compiled model this evaluation belongs to (`rerun` carries values over only within it). */
    readonly model: EvaluableModel,
    /** Every slot after the run: node cells `[0, nCells)`, then inputs, constants, temporaries. */
    readonly slots: Float64Array,
    readonly values: ReadonlyMap<CellKey, number>,
    /** The pins applied (node cells only; the others are in `diagnostics.ignoredOverrides`). */
    readonly overrides: ReadonlyMap<CellKey, number>,
    readonly diagnostics: EvaluationDiagnostics,
  ) {}

  get(cell: CellKey): number {
    const id = this.model.index.get(cell);
    if (id !== undefined && id < this.model.program.nCells) return this.slots[id]!;
    const v = this.values.get(cell);
    if (v === undefined) throw new EngineError('UNKNOWN_CELL', `unknown cell ${cell}`, cell);
    return v;
  }

  has(cell: CellKey): boolean {
    const id = this.model.index.get(cell);
    return (id !== undefined && id < this.model.program.nCells) || this.values.has(cell);
  }
}

/**
 * `evaluate(values, overrides?)`. `values` are resolved inputs by cell key (keys the model does not
 * read are kept for `get`); `overrides` pin node cells, other keys are ignored and reported.
 */
export function evaluate(
  model: EvaluableModel,
  values: ReadonlyMap<CellKey, number>,
  overrides: ReadonlyMap<CellKey, number> = new Map(),
): SlotEvaluation {
  const p = model.program;
  const slots = new Float64Array(p.nSlots);
  slots.set(p.consts, p.constBase);
  const present = new Uint8Array(p.nInputs);
  for (let i = 0; i < p.nInputs; i++) {
    const v = values.get(p.inputKeys[i]!);
    if (v !== undefined) {
      slots[p.inputBase + i] = v;
      present[i] = 1;
    }
  }
  let pinned: Uint8Array | null = null;
  let pins: Float64Array | null = null;
  const applied = new Map<CellKey, number>();
  const ignored: CellKey[] = [];
  for (const [key, v] of overrides) {
    const id = model.index.get(key);
    if (id === undefined || id >= p.nCells) {
      ignored.push(key);
      continue;
    }
    pinned ??= new Uint8Array(p.nCells);
    pins ??= new Float64Array(p.nCells);
    pinned[id] = 1;
    pins[id] = v;
    applied.set(key, v);
  }
  runCells(p, slots, present, pinned, pins, model.sources);
  return new SlotEvaluation(model, slots, new Map(values), applied, {
    ignoredOverrides: ignored,
  });
}
