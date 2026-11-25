/**
 * The parsed expression: the tuples of engine.py's `Parser` as a discriminated union (PORTING.md §1).
 * `pos` is the 0-based offset into the source as written: the first token of the construct, except
 * `bin`, whose `pos` is its operator (so a '/' by zero points at the '/').
 */

/** Binary operators, by binding power: comparisons 10, `+ -` 20, `* /` 30, `^` 50. */
export type BinOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '^';

/** Aggregates `fn(var in dim [where cond] [, body])`. */
export type AggFn = 'SUM' | 'COUNT' | 'MAXOVER' | 'MINOVER';

export interface NumAst {
  readonly kind: 'num';
  readonly value: number;
  readonly pos: number;
}
export interface StrAst {
  readonly kind: 'str';
  readonly value: string;
  readonly pos: number;
}
/** Unary minus. Unary plus has no node (Python returns the operand itself). */
export interface NegAst {
  readonly kind: 'neg';
  readonly arg: Ast;
  readonly pos: number;
}
export interface BinAst {
  readonly kind: 'bin';
  readonly op: BinOp;
  readonly left: Ast;
  readonly right: Ast;
  readonly pos: number;
}
/** A function call `fn(args)`; the name is not checked here (the expander checks it, S27). */
export interface CallAst {
  readonly kind: 'call';
  readonly fn: string;
  readonly args: readonly Ast[];
  readonly pos: number;
}
export interface AggAst {
  readonly kind: 'agg';
  readonly fn: AggFn;
  /** The bound variable, e.g. `l` in `SUM(l in line, …)`. */
  readonly var: string;
  readonly dim: string;
  readonly where: Ast | null;
  readonly body: Ast | null;
  readonly pos: number;
}
/** A name: bound variable, attribute access or symbol, with optional explicit indices `[i, …]`. */
export interface RefAst {
  readonly kind: 'ref';
  readonly name: string;
  readonly idx: readonly Ast[] | null;
  readonly pos: number;
}

export type Ast = NumAst | StrAst | NegAst | BinAst | CallAst | AggAst | RefAst;

/** The JSON shape of engine.py's AST tuples: tuples and lists become arrays, `None` becomes null. */
export type PyTuple = number | string | null | readonly PyTuple[];

/**
 * The Python tuple of an AST, as `json.dumps` writes it: `('num', 2.0)` → `['num', 2]`,
 * `('bin', '+', l, r)`, `('call', fn, [args])`, `('agg', fn, var, dim, where, body)`, `('ref', name, idx)`.
 */
export function toPyTuple(ast: Ast): PyTuple {
  switch (ast.kind) {
    case 'num':
    case 'str':
      return [ast.kind, ast.value];
    case 'neg':
      return ['neg', toPyTuple(ast.arg)];
    case 'bin':
      return ['bin', ast.op, toPyTuple(ast.left), toPyTuple(ast.right)];
    case 'call':
      return ['call', ast.fn, ast.args.map(toPyTuple)];
    case 'agg':
      return [
        'agg',
        ast.fn,
        ast.var,
        ast.dim,
        ast.where && toPyTuple(ast.where),
        ast.body && toPyTuple(ast.body),
      ];
    case 'ref':
      return ['ref', ast.name, ast.idx && ast.idx.map(toPyTuple)];
  }
}
