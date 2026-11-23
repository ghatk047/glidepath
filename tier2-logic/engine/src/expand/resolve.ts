/**
 * Static resolution of one cell's expression: `Model._idx`, `Model.resolve`, `Model.where_ok` and
 * `Model.deps` (engine.py L153-202), plus the static path of `Model.ev` (`get=None`, used by where-
 * filters). One walk builds the resolved expression and the dependency set, like Python's `deps`:
 * both IF branches count, aggregates only over members that pass `where`.
 *
 * Compile-time checks Python makes only at run time, or never (PORTING.md D1): unknown functions and
 * arity (S27), malformed aggregates (S27), strings outside comparisons and indices (S26), any symbol in a
 * `where` (S05), non-string non-integer attribute indices (S21).
 */
import type { BinOp, Ast } from '../parse';
import type { DimId, MemberId } from '@glidepath/spec';
import { EngineError, type EngineErrorCode } from '../errors';
import { pyDiv, pyMax, pyMin, pyPow, pySum, pyTruthy } from '../eval/pyops';
import type { CellKey } from '../types';
import { cellKey } from './keys';
import type { MemberTable } from './members';
import {
  COMPARISONS,
  FUNCTIONS,
  isFunction,
  isNumeric,
  type ConstValue,
  type FnName,
  type Resolved,
} from './resolved';
import type { SymbolTable } from './symbols';

/** Argument index of SAFEDIV's optional alternative (`SAFEDIV(a, b, alt)`). */
const SAFEDIV_ALT = 2;

/** A bound variable: a node dim (`pool`) or an aggregate variable (`l`), with its member. */
export interface Binding {
  readonly dim: DimId;
  readonly member: MemberId;
}

/**
 * Variable name → binding, in insertion order (Python dict). Bind with `new Map(env).set(v, b)`:
 * re-binding a name keeps its first position, as in Python (S01).
 */
export type Env = ReadonlyMap<string, Binding>;

/** Python `bool(v)` of a compile-time value (S16): NaN true, empty string/list false, None false. */
export function pyTruthyValue(v: ConstValue): boolean {
  if (typeof v === 'number') return pyTruthy(v);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 0;
  if (v === null) return false;
  return v.length > 0;
}

/** Python `a == b` between JSON values: numbers and bools numerically, lists elementwise. */
export function pyEquals(a: ConstValue, b: ConstValue): boolean {
  if (isNumeric(a) && isNumeric(b)) return Number(a) === Number(b);
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => pyEquals(x, b[i]!));
  }
  return false;
}

const order = (op: BinOp, c: number): boolean =>
  op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;

/**
 * Python comparison of two compile-time values (S13): `==`/`!=` never raise; ordering works for two
 * numbers, two strings or two lists, anything else raises TypeError in Python (TYPE here).
 */
export function pyCompareValues(op: BinOp, a: ConstValue, b: ConstValue): boolean {
  if (op === '==') return pyEquals(a, b);
  if (op === '!=') return !pyEquals(a, b);
  if (isNumeric(a) && isNumeric(b)) {
    const x = Number(a);
    const y = Number(b);
    return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
  }
  if (typeof a === 'string' && typeof b === 'string') return order(op, a < b ? -1 : a > b ? 1 : 0);
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (!pyEquals(a[i]!, b[i]!)) return pyCompareValues(op, a[i]!, b[i]!);
    }
    return order(op, a.length - b.length);
  }
  throw new EngineError('TYPE', `'${op}' not supported between ${pyType(a)} and ${pyType(b)}`);
}

/** Python type name of a compile-time value, for messages. */
export function pyType(v: ConstValue): string {
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'string') return 'str';
  if (v === null) return 'NoneType';
  return 'list';
}

/** Python `str()` of an attribute used as an index: strings verbatim, integers in decimal (S21). */
function indexString(v: ConstValue): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isInteger(v)) return BigInt(v).toString();
  return undefined;
}

/** Split `l.pool` into the variable and the attribute name at the first dot. */
function splitAttr(name: string): [string, string] {
  const dot = name.indexOf('.');
  return [name.slice(0, dot), name.slice(dot + 1)];
}

/** The resolution of one cell: its expression with constants folded and refs as keys, and its deps. */
export interface ResolvedCell {
  readonly expr: Resolved;
  /** Distinct keys the expression reads, in first-reference order (Python `cdeps`, as a set). */
  readonly deps: readonly CellKey[];
}

/**
 * Resolves the expressions of a model's cells against its symbols and the tenant's members. One
 * instance per `expand`; `resolveCell` sets the cell context its errors carry.
 */
export class Resolver {
  private cell: CellKey | undefined;
  private source = '';

  constructor(
    readonly symbols: SymbolTable,
    readonly table: MemberTable,
  ) {}

  /** `Model.deps` + resolution of the cell `cell`, whose chosen expression `source` parsed to `ast`. */
  resolveCell(ast: Ast, env: Env, cell: CellKey, source: string): ResolvedCell {
    this.cell = cell;
    this.source = source;
    const deps = new Set<CellKey>();
    const expr = this.resolveAst(ast, env, deps);
    this.numeric(expr, 'a cell value');
    return { expr, deps: [...deps] };
  }

  /** An `EngineError` naming the current cell and the position in its expression. */
  fail(code: EngineErrorCode, message: string, pos: number): EngineError {
    const where =
      this.cell === undefined ? '' : ` (cell ${this.cell}, at ${pos} in '${this.source}')`;
    return new EngineError(code, `${message}${where}`, this.cell, { pos, source: this.source });
  }

  /** Member ids of `dim` (UNKNOWN_DIMENSION with the cell context). */
  private dimIds(dim: DimId, pos: number): readonly MemberId[] {
    if (!this.table.has(dim))
      throw this.fail('UNKNOWN_DIMENSION', `unknown dimension '${dim}'`, pos);
    return this.table.ids(dim);
  }

  /** A string, None or list may only be compared or used as an index (S26). */
  private numeric(e: Resolved, what: string): void {
    if (e.kind === 'const' && !isNumeric(e.value)) {
      throw this.fail(
        'TYPE',
        `${pyType(e.value)} ${JSON.stringify(e.value)} used as ${what}`,
        e.pos,
      );
    }
  }

  /** The value of attribute `attr` of the member bound to `v`, or undefined when there is none. */
  private attribute(b: Binding, attr: string): ConstValue | undefined {
    return this.table.attr(b.dim, b.member, attr);
  }

  private missingAttr(b: Binding, attr: string): string {
    return `member '${b.member}' of '${b.dim}' has no attribute '${attr}'`;
  }

  /**
   * One walk of `Model.deps` that also builds the resolved expression. Name lookup (S10): bound
   * variable, then attribute of a bound variable when the name is not a symbol id, then symbol.
   */
  resolveAst(ast: Ast, env: Env, deps: Set<CellKey>): Resolved {
    const pos = ast.pos;
    switch (ast.kind) {
      case 'num':
      case 'str':
        return { kind: 'const', value: ast.value, pos };
      case 'neg': {
        const arg = this.resolveAst(ast.arg, env, deps);
        this.numeric(arg, "the operand of unary '-'");
        return { kind: 'neg', arg, pos };
      }
      case 'bin': {
        const left = this.resolveAst(ast.left, env, deps);
        const right = this.resolveAst(ast.right, env, deps);
        if (COMPARISONS.has(ast.op)) return this.compare(ast.op, left, right, pos);
        this.numeric(left, `an operand of '${ast.op}'`);
        this.numeric(right, `an operand of '${ast.op}'`);
        return { kind: 'bin', op: ast.op, left, right, pos };
      }
      case 'call': {
        const fn = ast.fn;
        this.checkCall(fn, ast.args.length, pos);
        const args = ast.args.map((a) => this.resolveAst(a, env, deps));
        if (fn === 'IF') {
          const [c, a, b] = args as [Resolved, Resolved, Resolved];
          if (c.kind === 'const') {
            // A condition known at compile time picks its branch; deps keep both (Model.deps L189-191).
            this.numeric(c, 'an IF condition');
            return pyTruthyValue(c.value) ? a : b;
          }
          this.numeric(a, 'an IF result');
          this.numeric(b, 'an IF result');
          return { kind: 'call', fn, args, pos };
        }
        args.forEach((a) => this.numeric(a, `an argument of ${fn}`));
        return { kind: 'call', fn, args, pos };
      }
      case 'agg': {
        const ids = this.dimIds(ast.dim, pos);
        this.checkAgg(ast);
        if (ast.where) this.checkStatic(ast.where, new Set([...env.keys(), ast.var]));
        const terms: Resolved[] = [];
        const members: MemberId[] = [];
        for (const m of ids) {
          const e2 = new Map(env).set(ast.var, { dim: ast.dim, member: m });
          if (ast.where && !this.whereOk(ast.where, e2)) continue;
          members.push(m);
          if (ast.body) {
            const t = this.resolveAst(ast.body, e2, deps);
            this.numeric(t, `a term of ${ast.fn}`);
            terms.push(t);
          }
        }
        if (ast.fn === 'COUNT') return { kind: 'const', value: members.length, pos };
        return { kind: 'agg', fn: ast.fn, terms, members, pos };
      }
      case 'ref': {
        const name = ast.name;
        if (ast.idx === null) {
          const bound = env.get(name);
          if (bound) return { kind: 'const', value: bound.member, pos };
          if (name.includes('.') && !this.symbols.has(name)) {
            const [v, attr] = splitAttr(name);
            const b = env.get(v);
            if (b) {
              const value = this.attribute(b, attr);
              return value === undefined
                ? { kind: 'missing', message: this.missingAttr(b, attr), pos }
                : { kind: 'const', value, pos };
            }
          }
        }
        const key = this.resolveRef(name, ast.idx, env, pos);
        deps.add(key);
        return { kind: 'cell', key, symbol: name, sym: this.symbols.get(name)!.kind, pos };
      }
    }
  }

  /** A comparison: folded when both sides are constants; a string may only meet a string (S26). */
  private compare(op: BinOp, left: Resolved, right: Resolved, pos: number): Resolved {
    if (left.kind === 'const' && right.kind === 'const') {
      return {
        kind: 'const',
        value: this.staticCompare(op, left.value, right.value, pos) ? 1 : 0,
        pos,
      };
    }
    const missing = left.kind === 'missing' || right.kind === 'missing';
    const operand = (e: Resolved): Resolved => {
      if (e.kind !== 'const' || isNumeric(e.value)) return e;
      // Unreachable: the missing attribute raises before the comparison runs.
      if (missing) return { kind: 'const', value: NaN, pos: e.pos };
      throw this.fail(
        'TYPE',
        `${pyType(e.value)} ${JSON.stringify(e.value)} compared with a cell value in '${op}'`,
        e.pos,
      );
    };
    return { kind: 'bin', op, left: operand(left), right: operand(right), pos };
  }

  private staticCompare(op: BinOp, a: ConstValue, b: ConstValue, pos: number): boolean {
    try {
      return pyCompareValues(op, a, b);
    } catch (e) {
      throw e instanceof EngineError ? this.fail(e.code, e.message, pos) : e;
    }
  }

  /** Known function with an allowed number of arguments (S27). */
  private checkCall(fn: string, n: number, pos: number): asserts fn is FnName {
    if (!isFunction(fn)) throw this.fail('UNKNOWN_FUNCTION', `unknown function ${fn}`, pos);
    const { min, max } = FUNCTIONS[fn];
    if (n < min || n > max) {
      const want =
        min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min} to ${max}`;
      throw this.fail('ARITY', `${fn} takes ${want} argument(s), got ${n}`, pos);
    }
  }

  /** `COUNT` takes no body; `SUM`, `MAXOVER`, `MINOVER` need one (S27). */
  private checkAgg(ast: Extract<Ast, { kind: 'agg' }>): void {
    if (ast.fn === 'COUNT' && ast.body !== null) {
      throw this.fail('ARITY', 'COUNT takes no body: COUNT(x in dim [where cond])', ast.pos);
    }
    if (ast.fn !== 'COUNT' && ast.body === null) {
      throw this.fail(
        'ARITY',
        `${ast.fn} needs a body: ${ast.fn}(x in dim [where cond], expr)`,
        ast.pos,
      );
    }
  }

  /**
   * A `where` may read only bound variables and their attributes, never a symbol, even in a branch
   * Python would not evaluate (S05). Functions and aggregates inside it are checked like elsewhere.
   */
  private checkStatic(ast: Ast, bound: ReadonlySet<string>): void {
    switch (ast.kind) {
      case 'num':
      case 'str':
        return;
      case 'neg':
        return this.checkStatic(ast.arg, bound);
      case 'bin':
        this.checkStatic(ast.left, bound);
        return this.checkStatic(ast.right, bound);
      case 'call':
        this.checkCall(ast.fn, ast.args.length, ast.pos);
        return ast.args.forEach((a) => this.checkStatic(a, bound));
      case 'agg': {
        this.dimIds(ast.dim, ast.pos);
        this.checkAgg(ast);
        const inner = new Set([...bound, ast.var]);
        if (ast.where) this.checkStatic(ast.where, inner);
        if (ast.body) this.checkStatic(ast.body, inner);
        return;
      }
      case 'ref': {
        const name = ast.name;
        const isStatic =
          ast.idx === null &&
          (bound.has(name) ||
            (name.includes('.') && !this.symbols.has(name) && bound.has(splitAttr(name)[0])));
        if (!isStatic) {
          throw this.fail(
            'WHERE_NOT_STATIC',
            `cell reference ${name} not allowed in a where clause (only bound variables and attributes)`,
            ast.pos,
          );
        }
      }
    }
  }

  /** `Model.where_ok`: Python truthiness of the static value (S05, S16). */
  whereOk(ast: Ast, env: Env): boolean {
    return pyTruthyValue(this.evalStatic(ast, env));
  }

  /** A numeric compile-time value, or TYPE. */
  private num(v: ConstValue, what: string, pos: number): number {
    if (!isNumeric(v))
      throw this.fail('TYPE', `${pyType(v)} ${JSON.stringify(v)} used as ${what}`, pos);
    return Number(v);
  }

  /**
   * `Model.ev(ast, env, None)`: Python semantics over compile-time values. IF and SAFEDIV are lazy,
   * everything else eager; errors (`/` by zero, TYPE) are compile errors of the cell.
   */
  evalStatic(ast: Ast, env: Env): ConstValue {
    const pos = ast.pos;
    switch (ast.kind) {
      case 'num':
      case 'str':
        return ast.value;
      case 'neg':
        return -this.num(this.evalStatic(ast.arg, env), "the operand of unary '-'", pos);
      case 'bin': {
        const a = this.evalStatic(ast.left, env);
        const b = this.evalStatic(ast.right, env);
        if (COMPARISONS.has(ast.op)) return this.staticCompare(ast.op, a, b, pos) ? 1 : 0;
        const x = this.num(a, `an operand of '${ast.op}'`, pos);
        const y = this.num(b, `an operand of '${ast.op}'`, pos);
        return this.arith(ast.op, x, y, pos);
      }
      case 'call': {
        const args = ast.args;
        if (ast.fn === 'IF') {
          return pyTruthyValue(this.evalStatic(args[0]!, env))
            ? this.evalStatic(args[1]!, env)
            : this.evalStatic(args[2]!, env);
        }
        if (ast.fn === 'SAFEDIV') {
          const b = this.num(this.evalStatic(args[1]!, env), 'a SAFEDIV divisor', pos);
          if (b === 0)
            return args.length > SAFEDIV_ALT ? this.evalStatic(args[SAFEDIV_ALT]!, env) : 0;
          return this.num(this.evalStatic(args[0]!, env), 'a SAFEDIV numerator', pos) / b;
        }
        const vals = args.map((a) => this.evalStatic(a, env));
        switch (ast.fn) {
          case 'MIN':
            return pyMin(vals.map((v) => this.num(v, 'an argument of MIN', pos)));
          case 'MAX':
            return pyMax(vals.map((v) => this.num(v, 'an argument of MAX', pos)));
          case 'ABS':
            return Math.abs(this.num(vals[0]!, 'an argument of ABS', pos));
          case 'AND':
            return vals.every(pyTruthyValue) ? 1 : 0;
          case 'OR':
            return vals.some(pyTruthyValue) ? 1 : 0;
          default: // NOT (checkStatic admitted only known functions)
            return pyTruthyValue(vals[0]!) ? 0 : 1;
        }
      }
      case 'agg': {
        const acc: number[] = [];
        for (const m of this.dimIds(ast.dim, pos)) {
          const e2 = new Map(env).set(ast.var, { dim: ast.dim, member: m });
          if (ast.where && !pyTruthyValue(this.evalStatic(ast.where, e2))) continue;
          acc.push(
            ast.fn === 'COUNT'
              ? 1
              : this.num(this.evalStatic(ast.body!, e2), `a term of ${ast.fn}`, pos),
          );
        }
        if (ast.fn === 'SUM' || ast.fn === 'COUNT') return pySum(acc);
        if (acc.length === 0) return 0;
        return ast.fn === 'MAXOVER' ? pyMax(acc) : pyMin(acc);
      }
      case 'ref': {
        const bound = env.get(ast.name);
        if (bound) return bound.member;
        // checkStatic admitted only bound variables and attributes of bound variables.
        const [v, attr] = splitAttr(ast.name);
        const b = env.get(v)!;
        const value = this.attribute(b, attr);
        if (value === undefined) throw this.fail('UNKNOWN_SYMBOL', this.missingAttr(b, attr), pos);
        return value;
      }
    }
  }

  private arith(op: BinOp, x: number, y: number, pos: number): number {
    try {
      switch (op) {
        case '+':
          return x + y;
        case '-':
          return x - y;
        case '*':
          return x * y;
        case '/':
          return pyDiv(x, y);
        default: // '^'
          return pyPow(x, y);
      }
    } catch (e) {
      throw e instanceof EngineError ? this.fail(e.code, e.message, pos) : e;
    }
  }

  /** `Model._idx`: one explicit index → member id (S14, S21). */
  resolveIndex(ast: Ast, env: Env): MemberId {
    if (ast.kind === 'str') return ast.value;
    if (ast.kind === 'ref' && ast.idx === null) {
      const bound = env.get(ast.name);
      if (bound) return bound.member;
      if (ast.name.includes('.') && !this.symbols.has(ast.name)) {
        const [v, attr] = splitAttr(ast.name);
        const b = env.get(v);
        if (b) {
          const value = this.attribute(b, attr);
          if (value === undefined)
            throw this.fail('UNKNOWN_SYMBOL', this.missingAttr(b, attr), ast.pos);
          const s = indexString(value);
          if (s === undefined) {
            throw this.fail(
              'BAD_INDEX',
              `attribute ${ast.name} = ${JSON.stringify(value)} (${pyType(value)}) cannot be a member id`,
              ast.pos,
            );
          }
          return s;
        }
      }
    }
    throw this.fail(
      'BAD_INDEX',
      'index must be a dim variable, an attribute of one or a string literal',
      ast.pos,
    );
  }

  /**
   * `Model.resolve`: the key a symbol reference reads. Explicit indices are positional and all or
   * nothing; without them each dim takes the innermost (last inserted) binding of that dim (S01).
   */
  resolveRef(name: string, idx: readonly Ast[] | null, env: Env, pos: number): CellKey {
    const info = this.symbols.get(name);
    if (!info) throw this.fail('UNKNOWN_SYMBOL', `unknown symbol ${name}`, pos);
    const dims = info.dims;
    if (idx !== null) {
      if (idx.length !== dims.length) {
        throw this.fail(
          'BAD_INDEX',
          `${name} expects ${dims.length} indices, got ${idx.length}`,
          pos,
        );
      }
      return cellKey(
        name,
        idx.map((a) => this.resolveIndex(a, env)),
      );
    }
    const bindings = [...env.values()].reverse();
    const mem = dims.map((d) => {
      const b = bindings.find((x) => x.dim === d);
      if (!b) {
        throw this.fail(
          'IMPLICIT_INDEX',
          `cannot implicitly index ${name} on dim ${d}: no bound variable of that dim`,
          pos,
        );
      }
      return b.member;
    });
    return cellKey(name, mem);
  }
}
