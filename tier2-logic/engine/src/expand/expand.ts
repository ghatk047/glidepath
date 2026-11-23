/**
 * The expansion half of `Model._expand` (engine.py L264-275): every node over the cartesian product of
 * its dims (or its `members` subset), the chosen expression per cell, its resolution and its deps.
 * The topological half (L276-293) is `topoSort` (ENG-04).
 */
import type { MemberId, ModelBundle, NodeDef, TenantMembers } from '@glidepath/spec';
import { EngineError } from '../errors';
import { parse, type Ast, type ParseCache } from '../parse';
import type { CellKey } from '../types';
import { pickExpr } from './cases';
import { cellKey, combos } from './keys';
import { MemberTable } from './members';
import type { Resolved } from './resolved';
import { Resolver, type Binding } from './resolve';
import { symbolDims } from './symbols';

/** One node cell, in expansion order. */
export interface Cell {
  readonly key: CellKey;
  /** Position in expansion order (node order of formula_graph.json, then combos). */
  readonly index: number;
  readonly node: NodeDef;
  /** The cell's member per node dim (`combo` in Python), in `node.dims` order. */
  readonly members: readonly MemberId[];
  /** The chosen expression (S08) and where it came from: a case index, or -1 for `expr`. */
  readonly expr: string;
  readonly caseIndex: number;
  readonly ast: Ast;
  readonly resolved: Resolved;
  /** Distinct keys read (node cells, input cells, dangling keys), in first-reference order. */
  readonly deps: readonly CellKey[];
}

/** Adds the cell (and its expression, when known) to an error raised without that context. */
function inCell(e: unknown, key: CellKey, source?: string): unknown {
  if (!(e instanceof EngineError) || e.cell !== undefined) return e;
  const at = e.pos !== undefined ? { pos: e.pos, source: e.source ?? source ?? '' } : undefined;
  return new EngineError(e.code, `${e.message} (cell ${key})`, key, at);
}

/**
 * `expand(bundle, members)`: cells of every node in expansion order. Compile errors (EngineError with
 * the cell key and source position): SYNTAX, UNKNOWN_SYMBOL, UNKNOWN_DIMENSION, NO_CASE, BAD_INDEX,
 * IMPLICIT_INDEX, WHERE_NOT_STATIC, UNKNOWN_FUNCTION, ARITY, TYPE.
 */
export function expand(
  bundle: ModelBundle,
  members: TenantMembers,
  cache: ParseCache = new Map(),
): Cell[] {
  const table = new MemberTable(members);
  const resolver = new Resolver(symbolDims(bundle), table);
  const cells: Cell[] = [];
  for (const node of bundle.nodes) {
    const dims = node.dims ?? [];
    let all: MemberId[][];
    try {
      all = combos(dims, table, node.members);
    } catch (e) {
      throw e instanceof EngineError
        ? new EngineError(e.code, `${e.message} (node ${node.id})`)
        : e;
    }
    for (const combo of all) {
      const key = cellKey(node.id, combo);
      const env = new Map<string, Binding>();
      const bind = new Map<string, MemberId>();
      dims.forEach((d, i) => {
        env.set(d, { dim: d, member: combo[i]! });
        bind.set(d, combo[i]!);
      });
      let picked: ReturnType<typeof pickExpr>;
      let ast: Ast;
      try {
        picked = pickExpr(node, bind);
        ast = parse(picked.expr, cache);
      } catch (e) {
        throw inCell(e, key);
      }
      const { expr, deps } = resolver.resolveCell(ast, env, key, picked.expr);
      cells.push({
        key,
        index: cells.length,
        node,
        members: combo,
        expr: picked.expr,
        caseIndex: picked.caseIndex,
        ast,
        resolved: expr,
        deps,
      });
    }
  }
  return cells;
}
