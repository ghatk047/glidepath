/**
 * Incremental rerun: `Model.rerun` (engine.py L330-344) as PORTING.md S23 and D3 define it.
 *
 * `rerun(prev, changes)` gives the evaluation `evaluate(values', overrides')` would give, where
 * `values'` is `prev.values` with the `variable` changes applied and `overrides'` is `prev.overrides`
 * with the `override` changes applied (a number pins, null unpins), in order. Bitwise equal, error for
 * error, but only the dirty cells run:
 *
 * - an input whose value changes bitwise (or that was missing) dirties its users;
 * - a node cell named by an override change is dirty, whether the pin is added, moved or removed;
 * - dirty cells run in topological order (ascending id); a cell whose new value has the same float64
 *   bits as before dirties nothing (early stop, so 0 → −0 is a change and NaN → NaN is not); a cell
 *   whose value changed dirties its users from the reverse CSR.
 *
 * Every cell that is not dirty computes from the same bits as in `prev`, so its value, and the fact
 * that it did not raise, carry over. When `prev` is not an evaluation of this compiled model there is
 * nothing to carry over and every cell runs.
 */
import type { Adjacency } from '../compile/csr';
import { EngineError } from '../errors';
import type { CellKey, Change, Evaluation } from '../types';
import {
  evaluate,
  SlotEvaluation,
  type EvaluableModel,
  type EvaluationDiagnostics,
} from './evaluate';
import { runCells } from './run';

/** What `rerun` needs of a compiled model: the program and the reverse adjacency. */
export interface IncrementalModel extends EvaluableModel {
  readonly graph: Pick<Adjacency, 'userOff' | 'userIds'>;
}

/** What a rerun did, beside `ignoredOverrides` (override changes that name no node cell). */
export interface RerunDiagnostics extends EvaluationDiagnostics {
  /** Node cells that ran (or had their pin re-applied), in topological order. */
  readonly recomputed: readonly CellKey[];
  /** The node cells whose value differs bitwise from `prev`, in topological order. */
  readonly changed: readonly CellKey[];
  /** True when `prev` was not an evaluation of this model, so every cell ran. */
  readonly full: boolean;
}

/** The evaluation `rerun` returns. */
export type RerunEvaluation = SlotEvaluation & { readonly diagnostics: RerunDiagnostics };

/** `prev`'s inputs and pins with `changes` applied, and the ids the changes touch. */
interface Applied {
  readonly values: Map<CellKey, number>;
  readonly overrides: Map<CellKey, number>;
  readonly ignored: CellKey[];
  /** Input ids set by a `variable` change (the slot, too). */
  readonly inputs: number[];
  /** Node cell ids named by an `override` change. */
  readonly pinned: number[];
}

function apply(model: IncrementalModel, prev: Evaluation, changes: readonly Change[]): Applied {
  const p = model.program;
  const inputEnd = p.inputBase + p.nInputs;
  const out: Applied = {
    values: new Map(prev.values),
    overrides: new Map(prev.overrides),
    ignored: [],
    inputs: [],
    pinned: [],
  };
  for (const change of changes) {
    const id = model.index.get(change.cell);
    const isNode = id !== undefined && id < p.nCells;
    if (change.target === 'variable') {
      if (isNode) {
        throw new EngineError(
          'BAD_INPUT',
          `${change.cell} is a node cell: pin it with an 'override' change`,
          change.cell,
        );
      }
      out.values.set(change.cell, change.value);
      // Keys the model does not read (not inputs, or dangling) are kept for `get`, as evaluate does.
      if (id !== undefined && id < inputEnd) out.inputs.push(id);
    } else if (!isNode) {
      out.ignored.push(change.cell);
    } else {
      if (change.value === null) out.overrides.delete(change.cell);
      else out.overrides.set(change.cell, change.value);
      out.pinned.push(id);
    }
  }
  return out;
}

/**
 * `rerun(prev, changes)` (03 §1 Modes, Incremental). `prev` is not modified. Throws what `evaluate`
 * would throw on the new inputs and pins; a `variable` change naming a node cell is BAD_INPUT (D3).
 */
export function rerun(
  model: IncrementalModel,
  prev: Evaluation,
  changes: readonly Change[],
): RerunEvaluation {
  const a = apply(model, prev, changes);
  if (!(prev instanceof SlotEvaluation) || prev.model !== model) return rerunFull(model, prev, a);

  const p = model.program;
  const { userOff, userIds } = model.graph;
  const slots = prev.slots.slice();
  // Two int32 words per float64 slot: slot s is words 2s and 2s + 1 (`s << 1`, `(s << 1) | 1`).
  const words = new Int32Array(slots.buffer);
  const dirty = new Uint8Array(p.nCells);
  let lo = p.nCells;
  let hi = -1;
  const markUsers = (k: number): void => {
    const end = userOff[k + 1]!;
    for (let o = userOff[k]!; o < end; o++) dirty[userIds[o]!] = 1;
    if (end > userOff[k]!) {
      lo = Math.min(lo, userIds[userOff[k]!]!);
      hi = Math.max(hi, userIds[end - 1]!);
    }
  };

  for (const s of a.inputs) {
    const key = p.inputKeys[s - p.inputBase]!;
    const w0 = words[s << 1];
    const w1 = words[(s << 1) | 1];
    slots[s] = a.values.get(key)!;
    if (!prev.values.has(key) || words[s << 1] !== w0 || words[(s << 1) | 1] !== w1) markUsers(s);
  }
  for (const c of a.pinned) {
    dirty[c] = 1;
    lo = Math.min(lo, c);
    hi = Math.max(hi, c);
  }

  const present = new Uint8Array(p.nInputs);
  for (let i = 0; i < p.nInputs; i++) present[i] = a.values.has(p.inputKeys[i]!) ? 1 : 0;
  let pinned: Uint8Array | null = null;
  let pins: Float64Array | null = null;
  if (a.overrides.size > 0) {
    pinned = new Uint8Array(p.nCells);
    pins = new Float64Array(p.nCells);
    for (const [key, v] of a.overrides) {
      const id = model.index.get(key)!;
      pinned[id] = 1;
      pins[id] = v;
    }
  }

  const recomputed: CellKey[] = [];
  const changed: CellKey[] = [];
  for (let t = lo; t <= hi; t++) {
    if (dirty[t] === 0) continue;
    const w0 = words[t << 1];
    const w1 = words[(t << 1) | 1];
    runCells(p, slots, present, pinned, pins, model.sources, t, t + 1);
    recomputed.push(p.cellKeys[t]!);
    if (words[t << 1] === w0 && words[(t << 1) | 1] === w1) continue;
    changed.push(p.cellKeys[t]!);
    markUsers(t);
  }

  const diagnostics: RerunDiagnostics = {
    ignoredOverrides: a.ignored,
    recomputed,
    changed,
    full: false,
  };
  return new SlotEvaluation(model, slots, a.values, a.overrides, diagnostics) as RerunEvaluation;
}

/** `prev` belongs to another model: evaluate in full, and compare with `prev` through its `get`. */
function rerunFull(model: IncrementalModel, prev: Evaluation, a: Applied): RerunEvaluation {
  const p = model.program;
  const ev = evaluate(model, a.values, a.overrides);
  const changed = p.cellKeys.filter((k, c) => !prev.has(k) || !sameBits(prev.get(k), ev.slots[c]!));
  const diagnostics: RerunDiagnostics = {
    ignoredOverrides: [...a.ignored, ...ev.diagnostics.ignoredOverrides],
    recomputed: p.cellKeys,
    changed,
    full: true,
  };
  return new SlotEvaluation(
    model,
    ev.slots,
    ev.values,
    ev.overrides,
    diagnostics,
  ) as RerunEvaluation;
}

/** Scratch for `sameBits`: x in slot 0, y in slot 1. */
const PAIR = 2;
const pair = new Float64Array(PAIR);
const pairWords = new Int32Array(pair.buffer);

/** Same float64 bit pattern (unlike `===`, tells −0 from 0; unlike `Object.is`, compares NaN payloads). */
function sameBits(x: number, y: number): boolean {
  pair[0] = x;
  pair[1] = y;
  return pairWords[0] === pairWords[2] && pairWords[1] === pairWords[3];
}
