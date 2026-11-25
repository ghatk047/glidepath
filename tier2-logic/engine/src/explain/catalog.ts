/**
 * What explain reads from the spec and the tenant members: symbol dims, labels and units of nodes and
 * variables, dimension labels and member labels. Built once per compiled model, on first use.
 */
import type { DimId, MemberId, ModelBundle, TenantMembers } from '@glidepath/spec';
import { symbolOf } from '../compile/lower';
import { cellKey, symbolDims, type SymbolTable } from '../expand';
import type { CellKey } from '../types';

/** Label and unit of a node or variable. */
export interface SymbolLabel {
  readonly label: string;
  readonly unit: string;
  readonly kind: 'node' | 'input';
}

/** The parts of a compiled model the catalog reads. */
export interface CatalogSource {
  readonly bundle: ModelBundle;
  readonly members: TenantMembers;
}

export class Catalog {
  readonly symbols: SymbolTable;
  private readonly symbolLabels = new Map<string, SymbolLabel>();
  private readonly dimLabels = new Map<DimId, string>();
  /** Member id → member label, per dimension (`label` attribute when it is a non-empty string). */
  private readonly memberLabels = new Map<DimId, ReadonlyMap<MemberId, string | undefined>>();

  constructor(bundle: ModelBundle, members: TenantMembers) {
    this.symbols = symbolDims(bundle);
    const labelOf = (id: string, label: string | undefined) => (label ? label : id);
    // Nodes win over a variable of the same id, as in `symbolDims` (Model.dims_of).
    for (const v of bundle.variables) {
      this.symbolLabels.set(v.id, { label: labelOf(v.id, v.label), unit: v.unit, kind: 'input' });
    }
    for (const n of bundle.nodes) {
      this.symbolLabels.set(n.id, { label: labelOf(n.id, n.label), unit: n.unit, kind: 'node' });
    }
    for (const d of bundle.dimensions) this.dimLabels.set(d.id, labelOf(d.id, d.label));
    for (const [dim, list] of Object.entries(members)) {
      this.memberLabels.set(
        dim,
        new Map(
          list.map((m) => [m.id, typeof m.label === 'string' && m.label ? m.label : undefined]),
        ),
      );
    }
  }

  /** Label, unit and kind of the symbol of `key` (`id` or `id[m1,m2]`); the id itself when unknown. */
  symbol(key: CellKey): SymbolLabel & { readonly id: string } {
    const id = symbolOf(key);
    const known = this.symbolLabels.get(id);
    return { id, ...(known ?? { label: id, unit: '', kind: 'node' }) };
  }

  /** Label of a dimension; its id when the spec gives none. */
  dim(dim: DimId): string {
    return this.dimLabels.get(dim) ?? dim;
  }

  /** True for a dimension of the spec or of the tenant members. */
  hasDim(dim: DimId): boolean {
    return this.dimLabels.has(dim) || this.memberLabels.has(dim);
  }

  /** Label of a tenant member; undefined when the member is unknown or has no label. */
  member(dim: DimId | undefined, member: MemberId): string | undefined {
    return dim === undefined ? undefined : this.memberLabels.get(dim)?.get(member);
  }

  /**
   * True for a well-formed cell of an input variable: `id` for a scalar, `id[m1,…]` with one tenant
   * member per dim. Such a cell may be one no formula reads (then it has no key id in the CSR).
   */
  isVariableCell(key: CellKey): boolean {
    const id = symbolOf(key);
    const info = this.symbols.get(id);
    if (info?.kind !== 'var') return false;
    if (info.dims.length === 0) return key === id;
    const members = key.slice(id.length + 1, -1).split(',');
    return (
      members.length === info.dims.length &&
      cellKey(id, members) === key &&
      members.every((m, i) => this.memberLabels.get(info.dims[i]!)?.has(m) === true)
    );
  }
}

const catalogs = new WeakMap<CatalogSource, Catalog>();

/** The catalog of a compiled model, built on first use and kept while the model lives. */
export function catalogOf(model: CatalogSource): Catalog {
  let c = catalogs.get(model);
  if (!c) {
    c = new Catalog(model.bundle, model.members);
    catalogs.set(model, c);
  }
  return c;
}
