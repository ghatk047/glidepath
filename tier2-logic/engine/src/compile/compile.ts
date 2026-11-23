/**
 * `compile(bundle, members)` (docs/architecture/03 §1): parse → expand → toposort → lower → adjacency.
 * The result replaces engine.py's `Model` object: immutable, pure, shareable across sessions.
 */
import type { ModelBundle, TenantMembers } from '@glidepath/spec';
import { notImplemented } from '../errors';
import {
  evaluate,
  inputHash,
  modelDigest,
  rerun,
  type RerunEvaluation,
  type SlotEvaluation,
} from '../eval';
import { expand, symbolDims, type Cell } from '../expand';
import { downstream, explainCell, upstream } from '../explain';
import type { ParseCache } from '../parse';
import type {
  BatchInput,
  BatchResult,
  CellKey,
  Change,
  CompiledModel,
  Evaluation,
  Explanation,
} from '../types';
import { buildAdjacency, type Adjacency } from './csr';
import { lower } from './lower';
import type { Program } from './program';
import { topoSort } from './toposort';

/** Which backlog item builds each `CompiledModel` method that is not built yet. */
export const PENDING_METHODS = {
  evaluateBatch: 'ENG-08',
} as const satisfies Partial<Record<keyof CompiledModel, string>>;

/** What compile found that is not an error. */
export interface CompileDiagnostics {
  /** Node keys read without a cell (subset gap, bad literal): MISSING only when read (S20). */
  readonly dangling: readonly CellKey[];
}

/** The compiled model. `compile` returns it as a `CompiledModel`; tests and tools may inspect more. */
export class EngineModel implements CompiledModel {
  /** Expression of each node cell (topological order), for error positions. */
  readonly sources: readonly string[];
  private digest: string | undefined;

  constructor(
    readonly bundle: ModelBundle,
    readonly members: TenantMembers,
    /** Node cells in topological order (index = slot). */
    readonly cells: readonly Cell[],
    readonly program: Program,
    readonly graph: Adjacency,
    readonly diagnostics: CompileDiagnostics,
  ) {
    this.sources = cells.map((c) => c.expr);
  }

  /** Key → id over node cells (= slots), inputs and dangling keys. */
  get index(): ReadonlyMap<CellKey, number> {
    return this.graph.index;
  }

  /** Full evaluation in topological order (`Model.run`, S15, S20). */
  evaluate(
    values: ReadonlyMap<CellKey, number>,
    overrides?: ReadonlyMap<CellKey, number>,
  ): SlotEvaluation {
    return evaluate(this, values, overrides);
  }

  /** Digest of the bundle and the members in order, computed on first use. */
  get modelDigest(): string {
    this.digest ??= modelDigest(this.bundle, this.members);
    return this.digest;
  }

  /** calc_run cache key: SHA-256 of the model digest and the sorted cells. */
  inputHash(values: ReadonlyMap<CellKey, number>, overrides: ReadonlyMap<CellKey, number>): string {
    return inputHash(this.modelDigest, values, overrides);
  }

  /**
   * Incremental (`Model.rerun`, S23, D3): bitwise equal to `evaluate` of `prev`'s inputs and pins with
   * `changes` applied, running only the dirty cells, with early stop on bitwise-unchanged values.
   */
  rerun(prev: Evaluation, changes: readonly Change[]): RerunEvaluation {
    return rerun(this, prev, changes);
  }

  evaluateBatch(base: Evaluation, vectors: BatchInput): BatchResult {
    void base;
    void vectors;
    throw notImplemented('CompiledModel.evaluateBatch', PENDING_METHODS.evaluateBatch);
  }

  /** Expression, inputs, words; values and drivers with an evaluation (src/explain, ENG-09). */
  explain(cell: CellKey, at?: Evaluation): Explanation {
    return explainCell(this, cell, at);
  }

  /** What feeds `cell`, breadth first: a read-only view over the dependency CSR. */
  upstream(cell: CellKey, depth?: number): CellKey[] {
    return upstream(this, cell, depth);
  }

  /** What `cell` moves, in topological order: a read-only view over the reverse CSR. */
  downstream(cell: CellKey): CellKey[] {
    return downstream(this, cell);
  }
}

/** Compiles one model_version for one tenant's members (array order = evaluation order, S06). */
export function compileModel(
  bundle: ModelBundle,
  members: TenantMembers,
  cache: ParseCache = new Map(),
): EngineModel {
  const symbols = symbolDims(bundle);
  const expanded = expand(bundle, members, cache);
  const order = topoSort(expanded);
  const { program, dangling } = lower(expanded, order, symbols);
  const cells = Array.from(order, (e) => expanded[e]!);
  const graph = buildAdjacency(
    [...program.cellKeys, ...program.inputKeys, ...dangling],
    program.nCells,
    cells.map((c) => c.deps),
  );
  return new EngineModel(bundle, members, cells, program, graph, { dangling });
}

/** `compile(bundle, members)` of 03 §1. */
export function compile(bundle: ModelBundle, members: TenantMembers): CompiledModel {
  return compileModel(bundle, members);
}
