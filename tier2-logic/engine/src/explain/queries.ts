/**
 * Dependency queries (03 §1 `upstream`, `downstream`): read-only views over the CSR adjacency built by
 * `compile` (ENG-04, `src/compile/csr.ts`). No second graph is built: every walk reads `graph.depIds`
 * and `graph.userIds` in place.
 */
import { downstreamOf, upstreamOf, type Adjacency } from '../compile/csr';
import type { CellKey } from '../types';
import { catalogOf, type CatalogSource } from './catalog';

/** What the queries need of a compiled model. */
export interface QueryModel extends CatalogSource {
  readonly graph: Adjacency;
}

/**
 * True for a well-formed cell of an input variable that no formula reads: it has no key id in the CSR,
 * no deps and no users. Any other key the CSR does not know is UNKNOWN_CELL.
 */
export function isUnreadInputCell(model: QueryModel, cell: CellKey): boolean {
  return !model.graph.index.has(cell) && catalogOf(model).isVariableCell(cell);
}

/**
 * What feeds `cell`: its deps, their deps, … up to `depth` levels (all when omitted), breadth first,
 * each key once, in first-reference order within a level (inputs and dangling keys included; they have
 * no deps). UNKNOWN_CELL for a key that is no cell, input or dangling key of the model.
 */
export function upstream(model: QueryModel, cell: CellKey, depth?: number): CellKey[] {
  return isUnreadInputCell(model, cell) ? [] : upstreamOf(model.graph, cell, depth);
}

/** What `cell` moves: every node cell that reads it, directly or not, in topological order. */
export function downstream(model: QueryModel, cell: CellKey): CellKey[] {
  return isUnreadInputCell(model, cell) ? [] : downstreamOf(model.graph, cell);
}
