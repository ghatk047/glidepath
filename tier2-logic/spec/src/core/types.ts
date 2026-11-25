/**
 * ModelBundle and friends: the validated, immutable shape of one `model_version`
 * (variables.json + formula_graph.json). See docs/architecture/03_engine_and_solvers.md §1.
 * Spec ids are used verbatim; nothing here is renamed or reinterpreted.
 */

/** A dimension id from the spec, e.g. `'pool'`, `'line'`, `'lever'`, `'year'`. */
export type DimId = string;
/** A node id from formula_graph.json, e.g. `'lev.rr'`. */
export type NodeId = string;
/** A variable id from variables.json, e.g. `'g.target_net'`. */
export type VarId = string;
/** A member id within a dimension, e.g. `'internal_labour'`, `'fy27b'`. */
export type MemberId = string;

export type VariableKind = 'fact_or_estimate' | 'decision' | 'estimate' | 'simulation';
export type VariableType = 'number' | 'int' | 'bool' | 'enum';
export type VariableRole = 'driver' | 'calibration' | 'simulation';

/** One input variable (variables.json). Extra fields in the JSON are preserved on the object. */
export interface VariableDef {
  readonly id: VarId;
  readonly kind: VariableKind;
  readonly label: string;
  readonly unit: string;
  readonly type: VariableType;
  readonly dims: readonly DimId[];
  readonly min: number | null;
  readonly max: number | null;
  readonly step: number | null;
  readonly group?: string;
  readonly layer: string;
  readonly role: VariableRole;
  readonly ui: { readonly control: string; readonly hero: boolean };
  readonly source?: string;
  readonly confidence?: string;
  readonly note?: string;
  readonly scenario_varies: boolean;
  readonly legacy?: readonly string[] | null;
  /** AA default: scalar, or `{ memberKey: value }` for dimensioned variables. Tenant data, not model logic. */
  readonly aa_default?: string | number | Readonly<Record<string, number>>;
}

/** One dimension (formula_graph.json → dimensions). `attributes` are the member attributes expressions may read. */
export interface DimensionDef {
  readonly id: DimId;
  readonly label: string;
  readonly scope: string;
  readonly attributes: readonly string[];
}

/** `when` of a case: `null` matches always; otherwise every listed dim must be bound to one of the listed members. */
export type CaseWhen = Readonly<Record<DimId, readonly MemberId[]>> | null;

export interface NodeCase {
  readonly when: CaseWhen;
  readonly expr: string;
}

/** One calculated node (formula_graph.json → nodes). Has `expr`, `cases`, or both (cases first, `expr` as fallback). */
export interface NodeDef {
  readonly id: NodeId;
  readonly dims: readonly DimId[];
  readonly unit: string;
  readonly label: string;
  readonly layer: string;
  readonly output: boolean;
  readonly expr?: string;
  readonly cases?: readonly NodeCase[];
  /** Expand only over these members of the listed dims (subset of the node's dims). */
  readonly members?: Readonly<Record<DimId, readonly MemberId[]>>;
}

/** One model_version: everything the engine needs except tenant members and values. */
export interface ModelBundle {
  readonly variables: readonly VariableDef[];
  readonly nodes: readonly NodeDef[];
  readonly dimensions: readonly DimensionDef[];
  /** Additive metadata from the spec files. */
  readonly specVersion: string;
  readonly modelId: string;
  readonly units: string;
  readonly expressionLanguage: string;
  /** Layer ids in evaluation/display order (formula_graph.json → layers). */
  readonly layers: readonly string[];
}

/** Raw JSON documents `loadModelBundle` accepts (already `JSON.parse`d). */
export interface ModelBundleJson {
  /** Contents of `variables.json`. */
  readonly variables: unknown;
  /** Contents of `formula_graph.json`. */
  readonly formulaGraph: unknown;
}

/** A member attribute value. Attributes are plain JSON. */
export type AttrValue = string | number | boolean | null | readonly AttrValue[];

/** A dimension member with its attributes, e.g. `{ id: 'it_001', pool: 'internal_labour', qty: 660, … }`. */
export interface Member {
  readonly id: MemberId;
  readonly [attr: string]: AttrValue | undefined;
}

/** Tenant dimension members, as passed to `compile()` and `membersHash()`. */
export type TenantMembers = Readonly<Record<DimId, readonly Member[]>>;
