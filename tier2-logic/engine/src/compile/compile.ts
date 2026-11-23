/**
 * `compile(bundle, members)` (docs/architecture/03 §1): parse → expand → toposort → lower → adjacency.
 * The result replaces engine.py's `Model` object: immutable, pure, shareable across sessions.
 */
import type { ModelBundle, TenantMembers } from '@glidepath/spec';
import { notImplemented } from '../errors';
import { expand, symbolDims, type Cell } from '../expand';
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
import { buildAdjacency, downstreamOf, upstreamOf, type Adjacency } from './csr';
import { lower } from './lower';
import type { Program } from './program';
import { topoSort } from './toposort';

/** Which backlog item builds each `CompiledModel` method that is not built yet. */
export const PENDING_METHODS = {
  evaluate: 'ENG-05',
  inputHash: 'ENG-05',
  rerun: 'ENG-07',
  evaluateBatch: 'ENG-08',
  explain: 'ENG-09',
} as const satisfies Partial<Record<keyof CompiledModel, string>>;

/** What compile found that is not an error. */
export interface CompileDiagnostics {
  /** Node keys read without a cell (subset gap, bad literal): MISSING only when read (S20). */
  readonly dangling: readonly CellKey[];
}

/** The compiled model. `compile` returns it as a `CompiledModel`; tests and tools may inspect more. */
export class EngineModel implements CompiledModel {
  constructor(
    readonly bundle: ModelBundle,
    readonly members: TenantMembers,
    /** Node cells in topological order (index = slot). */
    readonly cells: readonly Cell[],
    readonly program: Program,
    readonly graph: Adjacency,
    readonly diagnostics: CompileDiagnostics,
  ) {}

  evaluate(): Evaluation {
    throw notImplemented('CompiledModel.evaluate', PENDING_METHODS.evaluate);
  }

  inputHash(): string {
    throw notImplemented('CompiledModel.inputHash', PENDING_METHODS.inputHash);
  }

  rerun(prev: Evaluation, changes: readonly Change[]): Evaluation {
    void prev;
    void changes;
    throw notImplemented('CompiledModel.rerun', PENDING_METHODS.rerun);
  }

  evaluateBatch(base: Evaluation, vectors: BatchInput): BatchResult {
    void base;
    void vectors;
    throw notImplemented('CompiledModel.evaluateBatch', PENDING_METHODS.evaluateBatch);
  }

  explain(cell: CellKey, at?: Evaluation): Explanation {
    void cell;
    void at;
    throw notImplemented('CompiledModel.explain', PENDING_METHODS.explain);
  }

  /** Raw upstream over the dependency CSR (ENG-09 adds explain on top). */
  upstream(cell: CellKey, depth?: number): CellKey[] {
    return upstreamOf(this.graph, cell, depth);
  }

  /** Raw downstream over the reverse CSR, in topological order. */
  downstream(cell: CellKey): CellKey[] {
    return downstreamOf(this.graph, cell);
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
