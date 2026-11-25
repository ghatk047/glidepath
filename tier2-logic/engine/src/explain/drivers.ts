/**
 * Local sensitivity of one cell to everything that feeds it (03 §1 Modes, Explain: "top drivers by
 * local sensitivity"). Each candidate driver takes one forward-difference step and the target is
 * recomputed by rerun over the reverse CSR (ENG-04's graph, nothing else): only cells downstream of the
 * driver *and* upstream of the target run, in topological order, with early stop when a recomputed value
 * is unchanged (`Object.is`, as 03 §1 Incremental mode). The result equals `Model.rerun` bitwise
 * (`test/fixtures/dump_explain.py`).
 */
import type { Adjacency } from '../compile/csr';
import type { Program } from '../compile/program';
import { EngineError } from '../errors';
import { runCells } from '../eval/run';
import type { CellKey, Evaluation } from '../types';

/**
 * Forward-difference step, relative to `max(|x|, 1)`: 2^-26 = √ε of float64, the step that balances
 * truncation and rounding error. A numerical constant, not a business number.
 */
export const FD_STEP = 1.4901161193847656e-8;

/** What the drivers need of a compiled model. */
export interface SensitivityModel {
  readonly program: Program;
  readonly graph: Adjacency;
  /** Expression of each node cell (topological order), for error positions. */
  readonly sources: readonly string[];
}

/** One candidate driver of a target cell. */
export interface LocalSensitivity {
  readonly cell: CellKey;
  /** The driver's value `x` in the evaluation. */
  readonly value: number;
  /**
   * `(y(x + h) - y(x)) / h`; NaN when `x` is not finite or the perturbed rerun raised (e.g. a '/' by
   * zero that the step makes reachable).
   */
  readonly derivative: number;
}

/**
 * Every candidate driver of node cell `target` in `at`, in breadth-first upstream order (nearest
 * first), with its derivative. Candidates are the provided inputs and the pinned node cells that the
 * target reads, directly or not; a pinned cell's own expression is not evaluated, so the walk does not
 * go past it. A pinned target has no candidates. `at` is read, never changed.
 */
export function localSensitivities(
  model: SensitivityModel,
  target: CellKey,
  at: Evaluation,
): LocalSensitivity[] {
  const p = model.program;
  const g = model.graph;
  const nCells = p.nCells;
  const t = g.index.get(target);
  if (t === undefined || t >= nCells) {
    throw new EngineError('UNKNOWN_CELL', `${target} is not a node cell`, target);
  }

  const pinned = new Uint8Array(nCells);
  for (const key of at.overrides.keys()) {
    const id = g.index.get(key);
    if (id !== undefined && id < nCells) pinned[id] = 1;
  }
  if (pinned[t] === 1) return [];

  // Slots as the evaluation left them: constants, provided inputs, node cells.
  const work = new Float64Array(p.nSlots);
  work.set(p.consts, p.constBase);
  const present = new Uint8Array(p.nInputs);
  for (let i = 0; i < p.nInputs; i++) {
    const v = at.values.get(p.inputKeys[i]!);
    if (v !== undefined) {
      work[p.inputBase + i] = v;
      present[i] = 1;
    }
  }
  const isInput = (k: number) => k >= nCells && k < nCells + p.nInputs;
  const slotOf = (k: number) => (k < nCells ? k : p.inputBase + (k - nCells));

  // The target's upstream cone over the dependency CSR, breadth first, stopping at pins.
  const inCone = new Uint8Array(g.keys.length);
  inCone[t] = 1;
  const queue = [t];
  const candidates: number[] = [];
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi]!;
    if (k < nCells) work[k] = at.get(g.keys[k]!);
    if (k !== t && ((k < nCells && pinned[k] === 1) || (isInput(k) && present[k - nCells] === 1))) {
      candidates.push(k);
    }
    if (k >= nCells || pinned[k] === 1) continue;
    for (let o = g.depOff[k]!; o < g.depOff[k + 1]!; o++) {
      const d = g.depIds[o]!;
      if (inCone[d] === 0) {
        inCone[d] = 1;
        queue.push(d);
      }
    }
  }

  const base = work.slice();
  const y0 = base[t]!;
  const dirty = new Uint8Array(nCells);
  const changed: number[] = [];
  /** Marks the users of `k` that rerun must recompute: in the cone, not pinned. Returns the lowest. */
  const markUsers = (k: number, lowest: number) => {
    for (let o = g.userOff[k]!; o < g.userOff[k + 1]!; o++) {
      const u = g.userIds[o]!;
      if (inCone[u] === 1 && pinned[u] === 0) {
        dirty[u] = 1;
        if (u < lowest) lowest = u;
      }
    }
    return lowest;
  };

  return candidates.map((k) => {
    const s = slotOf(k);
    const x = base[s]!;
    const cell = g.keys[k]!;
    if (!Number.isFinite(x)) return { cell, value: x, derivative: Number.NaN };
    const xh = x + Math.max(Math.abs(x), 1) * FD_STEP;
    const h = xh - x;
    work[s] = xh;
    const from = markUsers(k, t + 1);
    let derivative: number;
    try {
      for (let c = from; c <= t; c++) {
        if (dirty[c] === 0) continue;
        dirty[c] = 0;
        runCells(p, work, present, null, null, model.sources, c, c + 1);
        if (!Object.is(work[c], base[c])) {
          changed.push(c);
          markUsers(c, t + 1);
        }
      }
      derivative = (work[t]! - y0) / h;
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      dirty.fill(0, from, t + 1);
      derivative = Number.NaN;
    }
    work[s] = x;
    for (const c of changed) work[c] = base[c]!;
    changed.length = 0;
    return { cell, value: x, derivative };
  });
}
