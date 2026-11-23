/**
 * Public types of the engine: the interfaces of docs/architecture/03_engine_and_solvers.md §1.
 * Types that 03 §1 names but does not spell out (CellKey, Evaluation, Change, BatchInput, BatchResult,
 * Explanation) are defined here as the narrowest shape the spec implies; PORTING.md §4 records each choice.
 */
import type { ModelBundle, TenantMembers } from '@glidepath/spec';
import type { EngineError } from './errors';

/**
 * A cell: `node_id` or `var_id` for a scalar, `id[m1,m2]` for a dimensioned one (comma, no spaces;
 * `Model.key` in engine.py). The bracket content is `variable_value.member_key`, e.g. `'pilots,fy27'`.
 */
export type CellKey = string;

/** A tenant's data for one scenario (03 §1): members from the database, inputs from `v_inputs_resolved`. */
export interface TenantData {
  /**
   * Members per dimension, with attributes (`line.pool`, `line.domain`, …). Array order is evaluation
   * order: `SUM` adds members in this order (PORTING.md S06), so it is part of the model's identity.
   */
  members: TenantMembers;
  /** Resolved inputs, CellKey = `${var}[${memberKey}]` (or `${var}` for a scalar). */
  values: Map<CellKey, number>;
  /** `node_override` pins: node cell → value that replaces it. */
  overrides: Map<CellKey, number>;
}

/** Result of `evaluate` or `rerun`: every input and node cell's value. */
export interface Evaluation {
  /** Value of an input or node cell; throws `EngineError` UNKNOWN_CELL for any other key. */
  get(cell: CellKey): number;
  /** True for every input and node cell of the model. */
  has(cell: CellKey): boolean;
  /** The resolved inputs this evaluation was computed from. */
  readonly values: ReadonlyMap<CellKey, number>;
  /** The override pins this evaluation was computed from (node cells only). */
  readonly overrides: ReadonlyMap<CellKey, number>;
}

/**
 * One incremental change for `rerun`. The engine cannot import `domain`'s changeset `Change`
 * (02 §1: domain → engine), so domain maps its changes onto this.
 */
export type Change =
  /** Set an input cell. */
  | { readonly target: 'variable'; readonly cell: CellKey; readonly value: number }
  /** Pin a node cell (`value` a number) or remove its pin (`value` null). */
  | { readonly target: 'override'; readonly cell: CellKey; readonly value: number | null };

/**
 * N input vectors in structure-of-arrays form (03 §1 Modes, Batch). Lane `i` is the base evaluation's
 * inputs and pins with input `key` set to `values.get(key)[i]` for every listed key.
 */
export interface BatchInput {
  /** Number of lanes N. */
  readonly size: number;
  /**
   * Varied input cells, each with N lane values (a node cell is BAD_INPUT: pin it in the base; a key
   * the model does not read moves nothing). Unlisted inputs keep the base evaluation's value.
   */
  readonly values: ReadonlyMap<CellKey, Float64Array>;
}

/**
 * Batch output: only the downstream closure of the varied inputs is computed. Lane `i` equals
 * `evaluate` of lane `i`'s inputs and pins, bitwise, or raises what that evaluate raises.
 */
export interface BatchResult {
  readonly size: number;
  /**
   * Node cells in the downstream closure (pinned cells and what only they feed excluded), in
   * topological order → N lane values. Every other cell equals the base evaluation in every lane.
   */
  readonly values: ReadonlyMap<CellKey, Float64Array>;
  /** 1 for a lane that raised (e.g. '/' by zero in a taken branch); that lane's values are NaN. */
  readonly failed: Uint8Array;
  /** Failed lane → the error a scalar `evaluate` of that lane throws (same code, cell, message, pos). */
  readonly errors: ReadonlyMap<number, EngineError>;
}

/** A cell an explanation names: what it is (spec id, label, unit) and, with an evaluation, its value. */
export interface ExplainRef {
  readonly cell: CellKey;
  /** Node or variable id of the cell (the key without its members). */
  readonly id: string;
  /** `node` for a node's key (a dangling key too), `input` for a variable's. */
  readonly kind: 'node' | 'input';
  /** Spec label of the node or variable; its id when the label is empty. */
  readonly label: string;
  readonly unit: string;
  /** The value, when an evaluation was given and holds the cell (a dangling key has none). */
  readonly value?: number;
}

/**
 * A driver of an explained cell `y`: a provided input, or a pinned node cell, that `y` reads (directly
 * or not; reads under a pin do not count). Local sensitivity at the evaluation (03 §1 Modes, Explain):
 * the driver `x` moves by a forward-difference step and `y` is recomputed incrementally, cells
 * downstream of `x` only (rerun).
 */
export interface ExplainDriver extends ExplainRef {
  /** The driver's value `x` in the evaluation. */
  readonly value: number;
  /** ∂y/∂x: `(y(x + h) - y(x)) / h`, `h = max(|x|, 1) * 2^-26` (made exact as `(x + h) - x`). */
  readonly derivative: number;
  /**
   * `derivative * x`: y's linearised change, in y's unit, for a 100% change of `x`. Drivers are ranked
   * by its absolute value, which ranks them as the elasticity of 04 §5 does, and stays defined at y = 0.
   */
  readonly sensitivity: number;
  /** Elasticity `∂y/∂x * x / y` (04 §5): `sensitivity / y`; null when y is 0 or not finite. */
  readonly elasticity: number | null;
}

/** "What is this number": the trace drawer and ⌘K (03 §1 Modes, Explain). */
export interface Explanation {
  readonly cell: CellKey;
  /** Node or variable id of the cell. */
  readonly id: string;
  readonly kind: 'node' | 'input';
  /** Spec label of the node or variable; its id when the label is empty. */
  readonly label: string;
  readonly unit: string;
  /** The expression chosen for this cell (its case, else `expr`); null for an input. */
  readonly expression: string | null;
  /** The cell's value, when an evaluation was given (an input the evaluation lacks has none). */
  readonly value?: number;
  /** True when the evaluation pins this node cell (override): its expression was not evaluated. */
  readonly pinned: boolean;
  /**
   * Cells this cell reads (resolved keys, both IF branches, aggregate members that pass `where`), in
   * first-reference order, with values when an evaluation was given. Empty for an input.
   */
  readonly inputs: readonly ExplainRef[];
  /** The formula in words, from spec labels (`Input: <label>` for an input). */
  readonly words: string;
  /**
   * Every driver with a non-zero sensitivity, by |sensitivity| descending (ties: nearest first); the
   * caller shows the top ones. Empty without an evaluation, for an input and for a pinned cell.
   */
  readonly drivers: readonly ExplainDriver[];
}

/** A model compiled for one (model_version, tenant members). Pure and shareable across sessions. */
export interface CompiledModel {
  /** Full evaluation in topological order (`Model.run`); < 50 ms on AA. */
  evaluate(
    values: ReadonlyMap<CellKey, number>,
    overrides?: ReadonlyMap<CellKey, number>,
  ): Evaluation;
  /** Incremental: recompute only cells downstream of the changes (`Model.rerun`); < 10 ms. */
  rerun(prev: Evaluation, changes: readonly Change[]): Evaluation;
  /** N vectors at once, structure of arrays. */
  evaluateBatch(base: Evaluation, vectors: BatchInput): BatchResult;
  /** What feeds this number, up to `depth` levels (all when omitted). */
  upstream(cell: CellKey, depth?: number): CellKey[];
  /** What this input moves. */
  downstream(cell: CellKey): CellKey[];
  /**
   * Expression, inputs, values, words. 03 §1 lists `explain(cell)`; values need an evaluation and a
   * compiled model is shared across sessions, so the evaluation is an optional second argument.
   */
  explain(cell: CellKey, at?: Evaluation): Explanation;
  /** SHA-256 of the sorted cells + model version (calc_run cache key). */
  inputHash(values: ReadonlyMap<CellKey, number>, overrides: ReadonlyMap<CellKey, number>): string;
}

/** `compile(bundle, members)` of 03 §1. */
export type Compile = (bundle: ModelBundle, members: TenantData['members']) => CompiledModel;
