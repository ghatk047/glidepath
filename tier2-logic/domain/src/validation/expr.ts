/**
 * The expression language of docs/spec/03_formula_graph.md section 2, parsed as
 * `docs/spec/reference/engine.py` does (tokenizer and Pratt parser, same binding powers). VR10 only
 * needs which cells an expression reads, so this is the parser alone, without evaluation. The engine
 * (ENG-02/03) owns the full compiler; VR10 can switch to its dependency queries once they exist.
 */

export type Ast =
  | { readonly k: 'num'; readonly value: number }
  | { readonly k: 'str'; readonly value: string }
  | { readonly k: 'neg'; readonly arg: Ast }
  | { readonly k: 'bin'; readonly op: string; readonly left: Ast; readonly right: Ast }
  | { readonly k: 'call'; readonly fn: string; readonly args: readonly Ast[] }
  | {
      readonly k: 'agg';
      readonly fn: string;
      /** The variable the aggregate binds, e.g. `l` in `SUM(l in line ...)`. */
      readonly variable: string;
      readonly dim: string;
      readonly where: Ast | null;
      readonly body: Ast | null;
    }
  | { readonly k: 'ref'; readonly name: string; readonly index: readonly Ast[] | null };

type Token =
  | { readonly kind: 'num'; readonly value: number }
  | { readonly kind: 'str' | 'id' | 'op'; readonly value: string }
  | { readonly kind: 'end' };

/** engine.py TOK: number, 'string', identifier (dots allowed), operator. */
const TOKEN =
  /\s*(?:(\d+\.\d*(?:[eE][-+]?\d+)?|\d*\.\d+(?:[eE][-+]?\d+)?|\d+(?:[eE][-+]?\d+)?)|('[^']*')|([A-Za-z_][A-Za-z0-9_.]*)|(==|!=|<=|>=|[-+*/^()[\],<>]))/y;

export const AGGREGATES: ReadonlySet<string> = new Set(['SUM', 'COUNT', 'MAXOVER', 'MINOVER']);

export function tokenize(src: string): Token[] {
  const s = src.trim();
  const out: Token[] = [];
  let pos = 0;
  while (pos < s.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(s);
    if (!m || m.index + m[0].length === pos) {
      throw new SyntaxError(`bad token at ${pos} in '${src}'`);
    }
    const [, num, str, id, op] = m;
    if (num !== undefined) out.push({ kind: 'num', value: Number(num) });
    else if (str !== undefined) out.push({ kind: 'str', value: str.slice(1, -1) });
    else if (id !== undefined) out.push({ kind: 'id', value: id });
    else out.push({ kind: 'op', value: op! });
    pos = m.index + m[0].length;
  }
  out.push({ kind: 'end' });
  return out;
}

// engine.py Parser.BP; prefix minus and plus bind at NEG.
const CMP = 10;
const ADD = 20;
const MUL = 30;
const NEG = 40;
const POW = 50;
const BINDING_POWER: Readonly<Record<string, number>> = {
  '==': CMP,
  '!=': CMP,
  '<': CMP,
  '<=': CMP,
  '>': CMP,
  '>=': CMP,
  '+': ADD,
  '-': ADD,
  '*': MUL,
  '/': MUL,
  '^': POW,
};

class Parser {
  private readonly tokens: Token[];
  private i = 0;

  constructor(private readonly src: string) {
    this.tokens = tokenize(src);
  }

  parse(): Ast {
    const e = this.expr(0);
    this.expect('end');
    return e;
  }

  private peek(): Token {
    return this.tokens[this.i]!;
  }

  private next(): Token {
    return this.tokens[this.i++]!;
  }

  private at(kind: Token['kind'], value?: string): boolean {
    const t = this.peek();
    return t.kind === kind && (value === undefined || ('value' in t && t.value === value));
  }

  private expect(kind: Token['kind'], value?: string): Token {
    const t = this.next();
    if (t.kind !== kind || (value !== undefined && !('value' in t && t.value === value))) {
      throw new SyntaxError(
        `expected ${value ?? kind}, got ${'value' in t ? t.value : t.kind} in '${this.src}'`,
      );
    }
    return t;
  }

  private ident(): string {
    return (this.expect('id') as { value: string }).value;
  }

  private expr(rbp: number): Ast {
    let left = this.nud(this.next());
    for (;;) {
      const t = this.peek();
      if (t.kind !== 'op') break;
      const bp = BINDING_POWER[t.value];
      if (bp === undefined || bp <= rbp) break;
      this.next();
      // `^` is right-associative.
      const right = this.expr(t.value === '^' ? bp - 1 : bp);
      left = { k: 'bin', op: t.value, left, right };
    }
    return left;
  }

  private list(close: string): Ast[] {
    const items = [this.expr(0)];
    while (this.at('op', ',')) {
      this.next();
      items.push(this.expr(0));
    }
    this.expect('op', close);
    return items;
  }

  private nud(t: Token): Ast {
    switch (t.kind) {
      case 'num':
        return { k: 'num', value: t.value };
      case 'str':
        return { k: 'str', value: t.value };
      case 'op':
        if (t.value === '-') return { k: 'neg', arg: this.expr(NEG) };
        if (t.value === '+') return this.expr(NEG);
        if (t.value === '(') {
          const e = this.expr(0);
          this.expect('op', ')');
          return e;
        }
        break;
      case 'id':
        if (this.at('op', '(')) {
          this.next();
          if (AGGREGATES.has(t.value)) return this.aggregate(t.value);
          if (this.at('op', ')')) {
            this.next();
            return { k: 'call', fn: t.value, args: [] };
          }
          return { k: 'call', fn: t.value, args: this.list(')') };
        }
        if (this.at('op', '[')) {
          this.next();
          return { k: 'ref', name: t.value, index: this.list(']') };
        }
        return { k: 'ref', name: t.value, index: null };
      case 'end':
        break;
    }
    throw new SyntaxError(`unexpected ${'value' in t ? t.value : t.kind} in '${this.src}'`);
  }

  /** `FN(x in dim [where cond] [, body])`, after `FN(`. */
  private aggregate(fn: string): Ast {
    const variable = this.ident();
    if (this.ident() !== 'in') throw new SyntaxError(`expected 'in' in '${this.src}'`);
    const dim = this.ident();
    let where: Ast | null = null;
    if (this.at('id', 'where')) {
      this.next();
      where = this.expr(0);
    }
    let body: Ast | null = null;
    if (this.at('op', ',')) {
      this.next();
      body = this.expr(0);
    }
    this.expect('op', ')');
    return { k: 'agg', fn, variable, dim, where, body };
  }
}

/** Parsed expressions by source text: a model's expressions are parsed once. */
const parsed = new Map<string, Ast>();
const MAX_CACHED = 4096;

/** Parse one expression; throws SyntaxError naming the expression. */
export function parseExpression(src: string): Ast {
  let ast = parsed.get(src);
  if (!ast) {
    ast = new Parser(src).parse();
    if (parsed.size >= MAX_CACHED) parsed.clear();
    parsed.set(src, ast);
  }
  return ast;
}

const namesOf = new WeakMap<Ast, ReadonlySet<string>>();

/** Every symbol an expression names in a reference (bound variables and attributes included). */
export function referencedNames(ast: Ast): ReadonlySet<string> {
  let names = namesOf.get(ast);
  if (names) return names;
  const out = new Set<string>();
  const walk = (a: Ast): void => {
    switch (a.k) {
      case 'num':
      case 'str':
        return;
      case 'neg':
        return walk(a.arg);
      case 'bin':
        walk(a.left);
        return walk(a.right);
      case 'call':
        return a.args.forEach(walk);
      case 'agg':
        if (a.where) walk(a.where);
        if (a.body) walk(a.body);
        return;
      case 'ref':
        out.add(a.name);
        a.index?.forEach(walk);
        return;
    }
  };
  walk(ast);
  names = out;
  namesOf.set(ast, names);
  return names;
}
