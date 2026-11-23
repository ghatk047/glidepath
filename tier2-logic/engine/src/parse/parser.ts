/**
 * Pratt parser: port of `Parser` (engine.py L41-107). PORTING.md S11, S12, S13.
 */
import { EngineError } from '../errors';
import type { AggFn, Ast, BinOp } from './ast';
import { pyRepr, tokenize, tokenRepr, type Token, type TokenKind } from './tokenize';

/** `Parser.BP`: comparisons 10, `+ -` 20, `* /` 30, `^` 50. Unary minus binds at 40 (`UNARY_BP`). */
export const BINDING_POWER: Readonly<Record<BinOp, number>> = {
  '==': 10,
  '!=': 10,
  '<': 10,
  '<=': 10,
  '>': 10,
  '>=': 10,
  '+': 20,
  '-': 20,
  '*': 30,
  '/': 30,
  '^': 50,
};

/** Operand binding power of prefix `-` and `+` (`self.expr(40)` in `Parser.nud`). */
export const UNARY_BP = 40;

/** `AGG`: names that parse as an aggregate when followed by `(`. Upper case only. */
export const AGGREGATES: ReadonlySet<string> = new Set<AggFn>([
  'SUM',
  'COUNT',
  'MAXOVER',
  'MINOVER',
]);

const isBinOp = (v: string): v is BinOp => Object.hasOwn(BINDING_POWER, v);

export class Parser {
  private readonly t: Token[];
  private i = 0;

  /** Tokenizes `src` (SYNTAX error on a bad character) and keeps it for messages. */
  constructor(readonly src: string) {
    this.t = tokenize(src);
  }

  /** `peek`: the next token, not consumed. */
  peek(): Token {
    return this.t[this.i]!;
  }

  /** `peek() == (kind, value)` in Python: kind and value both match. */
  private peekIs(kind: TokenKind, value: string): boolean {
    const tok = this.peek();
    return tok.kind === kind && tok.value === value;
  }

  /** `nxt`: consume and return the next token. */
  next(): Token {
    return this.t[this.i++]!;
  }

  /** `expect`: consume the next token; SYNTAX error unless it has `kind` (and `value`, when given). */
  expect(kind: TokenKind, value?: string): Token {
    const tok = this.next();
    if (tok.kind !== kind || (value !== undefined && tok.value !== value)) {
      throw this.error(`expected ${value ?? kind}, got ${tokenRepr(tok)}`, tok.pos);
    }
    return tok;
  }

  /** `parse`: one expression, then the end of the input. */
  parse(): Ast {
    const e = this.expr(0);
    this.expect('end');
    return e;
  }

  /** `expr(rbp)`: operand, then binary operators binding tighter than `rbp`; `^` is right-associative. */
  expr(rbp: number): Ast {
    let left = this.nud(this.next());
    for (;;) {
      const tok = this.peek();
      if (tok.kind !== 'op' || !isBinOp(tok.value)) break;
      const op = tok.value;
      const bp = BINDING_POWER[op];
      if (bp <= rbp) break;
      this.next();
      const right = this.expr(op === '^' ? bp - 1 : bp);
      left = { kind: 'bin', op, left, right, pos: tok.pos };
    }
    return left;
  }

  /** `nud`: the operand that starts with `tok`. */
  nud(tok: Token): Ast {
    const pos = tok.pos;
    switch (tok.kind) {
      case 'num':
        return { kind: 'num', value: tok.value, pos };
      case 'str':
        return { kind: 'str', value: tok.value, pos };
      case 'op':
        if (tok.value === '-') return { kind: 'neg', arg: this.expr(UNARY_BP), pos };
        if (tok.value === '+') return this.expr(UNARY_BP);
        if (tok.value === '(') {
          const e = this.expr(0);
          this.expect('op', ')');
          return e;
        }
        break;
      case 'id':
        return this.identifier(tok.value, pos);
      case 'end':
        break;
    }
    throw this.error(`unexpected ${tokenRepr(tok)}`, pos);
  }

  /** The `k == "id"` branch of `nud`: aggregate, call, or reference with optional `[i, …]`. */
  private identifier(v: string, pos: number): Ast {
    if (this.peekIs('op', '(')) {
      this.next();
      if (AGGREGATES.has(v)) {
        const variable = this.expect('id').value as string;
        const kw = this.expect('id');
        if (kw.value !== 'in') throw this.error("expected 'in'", kw.pos);
        const dim = this.expect('id').value as string;
        let where: Ast | null = null;
        if (this.peekIs('id', 'where')) {
          this.next();
          where = this.expr(0);
        }
        let body: Ast | null = null;
        if (this.peekIs('op', ',')) {
          this.next();
          body = this.expr(0);
        }
        this.expect('op', ')');
        return { kind: 'agg', fn: v as AggFn, var: variable, dim, where, body, pos };
      }
      const args: Ast[] = [];
      if (!this.peekIs('op', ')')) {
        args.push(this.expr(0));
        while (this.peekIs('op', ',')) {
          this.next();
          args.push(this.expr(0));
        }
      }
      this.expect('op', ')');
      return { kind: 'call', fn: v, args, pos };
    }
    let idx: Ast[] | null = null;
    if (this.peekIs('op', '[')) {
      this.next();
      idx = [this.expr(0)];
      while (this.peekIs('op', ',')) {
        this.next();
        idx.push(this.expr(0));
      }
      this.expect('op', ']');
    }
    return { kind: 'ref', name: v, idx, pos };
  }

  private error(message: string, pos: number): EngineError {
    return new EngineError('SYNTAX', `${message} at ${pos} in ${pyRepr(this.src)}`, undefined, {
      pos,
      source: this.src,
    });
  }
}
