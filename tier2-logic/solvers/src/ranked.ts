/**
 * The ranked move list of 03 §3 (`ranked: { cell, from, to, impact }[]`), shared by every solver. One
 * batch evaluation (ENG-08) prices all moves at once.
 */
import type { BatchInput, CellKey } from '@glidepath/engine';
import { SolverError } from './errors';
import type { SolverModel } from './model';
import type { Change, RankedMove } from './types';

export interface RankOptions {
  /**
   * `alone` (default): each move's impact is the output's change when that move alone is applied to the
   * start point. `path`: moves are applied cumulatively in the given order (an optimiser's path); each
   * impact is the output's change caused by that step, so the impacts add up to the total change.
   */
  readonly mode?: 'alone' | 'path';
  /**
   * `impact`: by |impact| descending, ties in given order (default for `alone`). `given`: the order of
   * `changes` (default for `path`, which keeps the optimiser's order).
   */
  readonly order?: 'impact' | 'given';
}

/**
 * Prices `changes` on `output` against `model.base` and returns `{ cell, from, to, impact }` rows.
 * `from` is the cell's value before the move (the start value, or for `path` the value an earlier move
 * set). A lane that fails to evaluate throws its engine error.
 */
export function rankMoves(
  model: Pick<SolverModel, 'compiled' | 'base'>,
  changes: readonly Change[],
  output: CellKey,
  options: RankOptions = {},
): RankedMove[] {
  const mode = options.mode ?? 'alone';
  const order = options.order ?? (mode === 'alone' ? 'impact' : 'given');
  const n = changes.length;
  if (n === 0) return [];
  if (!model.base.has(output)) throw new SolverError('BAD_PARAMS', `unknown output cell ${output}`);

  const lanes = new Map<CellKey, Float64Array>();
  const lane = (cell: CellKey): Float64Array => {
    let a = lanes.get(cell);
    if (a === undefined) {
      a = new Float64Array(n).fill(model.base.get(cell));
      lanes.set(cell, a);
    }
    return a;
  };
  const from: number[] = [];
  changes.forEach((c, i) => {
    const a = lane(c.cell);
    if (mode === 'alone') {
      from.push(model.base.get(c.cell));
      a[i] = c.value;
    } else {
      from.push(i === 0 ? model.base.get(c.cell) : a[i - 1]!);
      a.fill(c.value, i);
    }
  });

  const input: BatchInput = { size: n, values: lanes };
  const result = model.compiled.evaluateBatch(model.base, input);
  const y0 = model.base.get(output);
  const ys = result.values.get(output) ?? lanes.get(output);
  const at = (i: number): number => {
    const err = result.errors.get(i);
    if (err !== undefined) throw err;
    return ys === undefined ? y0 : ys[i]!;
  };

  const rows = changes.map((c, i) => {
    const prev = mode === 'alone' || i === 0 ? y0 : at(i - 1);
    return { cell: c.cell, from: from[i]!, to: c.value, impact: at(i) - prev };
  });
  if (order === 'impact') {
    // Array.prototype.sort is stable: ties keep the given order.
    rows.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  }
  return rows;
}
