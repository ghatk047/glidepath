/**
 * The topological half of `Model._expand` (engine.py L276-293): Kahn's algorithm with a FIFO queue.
 * PORTING.md S22. Deterministic (no hash order), so the order equals `Model.order` exactly.
 */
import { EngineError } from '../errors';
import type { CellKey } from '../types';

/** What the sort needs of a cell: its key and its distinct deps. */
export interface SortableCell {
  readonly key: CellKey;
  readonly deps: readonly CellKey[];
}

/** Cells named by a CYCLE error, at most. */
export const CYCLE_REPORT_LIMIT = 10;

/**
 * Positions (into `cells`, which are in expansion order) in topological order. Start with every cell
 * without node-cell deps, in expansion order; when a cell is done, visit its users in expansion order.
 * In-degree counts distinct deps that are node cells (inputs and dangling keys do not count). A cycle
 * is a CYCLE error naming up to 10 cells that still have in-degree > 0, in expansion order.
 */
export function topoSort(cells: readonly SortableCell[]): Int32Array {
  const n = cells.length;
  const index = new Map<CellKey, number>();
  cells.forEach((c, i) => index.set(c.key, i));

  const indeg = new Int32Array(n);
  const userCount = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    for (const d of cells[i]!.deps) {
      const j = index.get(d);
      if (j !== undefined) {
        indeg[i]!++;
        userCount[j]!++;
      }
    }
  }
  // Users of each node cell, in expansion order (Python appends `k` while iterating cells in order).
  const userOff = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) userOff[i + 1] = userOff[i]! + userCount[i]!;
  const users = new Int32Array(userOff[n]!);
  const fill = userOff.slice(0, n);
  for (let i = 0; i < n; i++) {
    for (const d of cells[i]!.deps) {
      const j = index.get(d);
      if (j !== undefined) users[fill[j]!++] = i;
    }
  }

  const order = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) if (indeg[i] === 0) order[tail++] = i;
  while (head < tail) {
    const k = order[head++]!;
    for (let u = userOff[k]!; u < userOff[k + 1]!; u++) {
      const v = users[u]!;
      if (--indeg[v]! === 0) order[tail++] = v;
    }
  }
  if (tail !== n) {
    const bad: CellKey[] = [];
    for (let i = 0; i < n && bad.length < CYCLE_REPORT_LIMIT; i++) {
      if (indeg[i]! > 0) bad.push(cells[i]!.key);
    }
    throw new EngineError('CYCLE', `cycle in formula graph near ${JSON.stringify(bad)}`, bad[0]);
  }
  return order;
}
