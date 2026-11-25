/**
 * `Model.dims_of` (engine.py L128): every variable and node id with its dims. Nodes win over a variable
 * of the same id, as in the Python dict merge (the spec loader rejects such a clash anyway).
 */
import type { DimId, ModelBundle } from '@glidepath/spec';

export interface SymbolInfo {
  /** `var` for an input variable (its cells are inputs), `node` for a formula node. */
  readonly kind: 'var' | 'node';
  readonly dims: readonly DimId[];
}

export type SymbolTable = ReadonlyMap<string, SymbolInfo>;

export function symbolDims(bundle: Pick<ModelBundle, 'variables' | 'nodes'>): SymbolTable {
  const out = new Map<string, SymbolInfo>();
  for (const v of bundle.variables) out.set(v.id, { kind: 'var', dims: v.dims ?? [] });
  for (const n of bundle.nodes) out.set(n.id, { kind: 'node', dims: n.dims ?? [] });
  return out;
}
