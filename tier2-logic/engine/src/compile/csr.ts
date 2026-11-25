/**
 * Dependency index (docs/architecture/03 §1 step 5): forward (deps) and reverse (users) adjacency in
 * CSR form over key ids, for rerun, upstream and downstream.
 *
 * Key ids: node cells `[0, nCells)` in topological order (= their slots), inputs
 * `[nCells, nCells + nInputs)` (= their slots), then dangling keys. Deps are Python's static deps
 * (both IF branches), so the graph is the one `Model.users` describes.
 */
import { EngineError } from '../errors';
import type { CellKey } from '../types';

export interface Adjacency {
  /** Every key: node cells, inputs, dangling keys, by id. */
  readonly keys: readonly CellKey[];
  readonly index: ReadonlyMap<CellKey, number>;
  readonly nCells: number;
  /** Deps of node cell `c`: `depIds[depOff[c] .. depOff[c + 1])`, in first-reference order. */
  readonly depOff: Int32Array;
  readonly depIds: Int32Array;
  /** Users of key `k` (node cells only): `userIds[userOff[k] .. userOff[k + 1])`, ascending (topological). */
  readonly userOff: Int32Array;
  readonly userIds: Int32Array;
}

/**
 * Builds both directions. `deps[c]` lists node cell `c`'s distinct deps; `keys` must list every key a
 * dep names, node cells first in topological order.
 */
export function buildAdjacency(
  keys: readonly CellKey[],
  nCells: number,
  deps: readonly (readonly CellKey[])[],
): Adjacency {
  const index = new Map<CellKey, number>();
  keys.forEach((k, i) => index.set(k, i));

  const depOff = new Int32Array(nCells + 1);
  for (let c = 0; c < nCells; c++) depOff[c + 1] = depOff[c]! + deps[c]!.length;
  const depIds = new Int32Array(depOff[nCells]!);
  const userCount = new Int32Array(keys.length);
  for (let c = 0; c < nCells; c++) {
    let o = depOff[c]!;
    for (const d of deps[c]!) {
      const id = index.get(d);
      if (id === undefined)
        throw new EngineError('UNKNOWN_CELL', `dep ${d} of ${keys[c]} has no id`);
      depIds[o++] = id;
      userCount[id]!++;
    }
  }
  const userOff = new Int32Array(keys.length + 1);
  for (let k = 0; k < keys.length; k++) userOff[k + 1] = userOff[k]! + userCount[k]!;
  const userIds = new Int32Array(userOff[keys.length]!);
  const fill = userOff.slice(0, keys.length);
  // Cells in ascending (topological) order, so each user list comes out ascending.
  for (let c = 0; c < nCells; c++) {
    for (let o = depOff[c]!; o < depOff[c + 1]!; o++) userIds[fill[depIds[o]!]!++] = c;
  }
  return { keys, index, nCells, depOff, depIds, userOff, userIds };
}

function idOf(g: Adjacency, cell: CellKey): number {
  const id = g.index.get(cell);
  if (id === undefined) throw new EngineError('UNKNOWN_CELL', `unknown cell ${cell}`, cell);
  return id;
}

/**
 * What feeds `cell`: its deps, their deps, … up to `depth` levels (all when omitted), breadth first,
 * each key once, in first-reference order within a level. Inputs and dangling keys have no deps.
 */
export function upstreamOf(g: Adjacency, cell: CellKey, depth = Infinity): CellKey[] {
  const start = idOf(g, cell);
  const seen = new Uint8Array(g.keys.length);
  seen[start] = 1;
  const out: CellKey[] = [];
  let frontier = [start];
  for (let level = 0; level < depth && frontier.length > 0; level++) {
    const next: number[] = [];
    for (const k of frontier) {
      if (k >= g.nCells) continue;
      for (let o = g.depOff[k]!; o < g.depOff[k + 1]!; o++) {
        const d = g.depIds[o]!;
        if (seen[d]) continue;
        seen[d] = 1;
        out.push(g.keys[d]!);
        next.push(d);
      }
    }
    frontier = next;
  }
  return out;
}

/** Ids of every node cell downstream of the ids in `from` (not including them), ascending. */
export function downstreamIds(g: Adjacency, from: Iterable<number>): Int32Array {
  const seen = new Uint8Array(g.keys.length);
  const stack: number[] = [];
  for (const k of from) stack.push(k);
  let count = 0;
  while (stack.length > 0) {
    const k = stack.pop()!;
    for (let o = g.userOff[k]!; o < g.userOff[k + 1]!; o++) {
      const u = g.userIds[o]!;
      if (seen[u]) continue;
      seen[u] = 1;
      count++;
      stack.push(u);
    }
  }
  const out = new Int32Array(count);
  let i = 0;
  for (let c = 0; c < g.nCells && i < count; c++) if (seen[c]) out[i++] = c;
  return out;
}

/** What `cell` moves: every node cell that depends on it, directly or not, in topological order. */
export function downstreamOf(g: Adjacency, cell: CellKey): CellKey[] {
  return Array.from(downstreamIds(g, [idOf(g, cell)]), (c) => g.keys[c]!);
}
