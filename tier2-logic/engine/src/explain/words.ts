/**
 * The formula in words (03 §1 Modes, Explain): a cell's chosen expression rendered with spec labels,
 * e.g. `res.tot_iy - res.tot_ot_it` → "CY27 in-year gross savings minus CY27 one-time costs charged to
 * IT". The words describe the expression, not one cell: a reference indexed by a bound variable reads as
 * the symbol's label, a string literal index adds its member's label (`pl.eps['fy27it']` → "Adjusted EPS
 * (FY2027E + IT)"). Names resolve as in engine.py (S10): bound variable, then attribute, then symbol.
 * Parentheses follow the parser's binding powers, so the words group exactly as the expression does.
 */
import type { DimId } from '@glidepath/spec';
import { BINDING_POWER, UNARY_BP, type Ast, type BinOp, type RefAst } from '../parse';
import type { Catalog } from './catalog';

/** Rendered text and how tightly it binds: `ATOM` never needs parentheses, `PHRASE` always does. */
interface Words {
  readonly text: string;
  readonly prec: number;
}

const ATOM = Number.POSITIVE_INFINITY;
/** Phrases (`if … then …`, `the sum of … over …`) are parenthesised when they are an operand. */
const PHRASE = 0;
/** Binding power of `*` and `/`, for SAFEDIV's "a divided by b". */
const DIVIDE_BP = BINDING_POWER['/'];
/** Argument count of a comparison between two ("the smaller of a and b"). */
const PAIR = 2;

const OPERATOR_WORDS: Readonly<Record<BinOp, string>> = {
  '+': 'plus',
  '-': 'minus',
  '*': 'times',
  '/': 'divided by',
  '^': 'to the power of',
  '==': 'equals',
  '!=': 'does not equal',
  '<': 'is less than',
  '<=': 'is at most',
  '>': 'is greater than',
  '>=': 'is at least',
};

const AGGREGATE_WORDS = { SUM: 'the sum', MAXOVER: 'the maximum', MINOVER: 'the minimum' } as const;

/** Names bound while rendering: node dims (name = dim id), then aggregate variables. */
type Bound = ReadonlyMap<string, DimId>;

const atom = (text: string): Words => ({ text, prec: ATOM });
const phrase = (text: string): Words => ({ text, prec: PHRASE });
const wrap = (w: Words, needed: boolean) => (needed ? `(${w.text})` : w.text);
/** "a", "a and b", "a, b and c". */
const list = (items: readonly string[], conj: string) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]!}`;

/**
 * `expr` of a cell of a node with `dims`, in words. `dims` are bound under their own names, as
 * engine.py binds them (`env = {d: (d, m)}`).
 */
export function formulaInWords(ast: Ast, catalog: Catalog, dims: readonly DimId[] = []): string {
  return render(ast, catalog, new Map(dims.map((d) => [d, d]))).text;
}

function render(ast: Ast, c: Catalog, bound: Bound): Words {
  switch (ast.kind) {
    case 'num':
      return atom(String(ast.value));
    case 'str':
      return atom(`'${ast.value}'`);
    case 'neg': {
      const arg = render(ast.arg, c, bound);
      return { text: `minus ${wrap(arg, arg.prec < UNARY_BP)}`, prec: UNARY_BP };
    }
    case 'bin':
      return binary(ast.op, ast.left, ast.right, c, bound);
    case 'call':
      return call(ast.fn, ast.args, c, bound);
    case 'agg': {
      const inner = new Map(bound).set(ast.var, ast.dim);
      const over = c.dim(ast.dim);
      const where = ast.where ? ` where ${render(ast.where, c, inner).text}` : '';
      if (ast.fn === 'COUNT') return phrase(`the number of ${over}${where}`);
      const body = ast.body ? render(ast.body, c, inner) : atom('0');
      return phrase(
        `${AGGREGATE_WORDS[ast.fn]} of ${wrap(body, body.prec === PHRASE)} over ${over}${where}`,
      );
    }
    case 'ref':
      return atom(reference(ast, c, bound));
  }
}

function binary(op: BinOp, left: Ast, right: Ast, c: Catalog, bound: Bound): Words {
  const bp = BINDING_POWER[op];
  const rightAssoc = op === '^';
  // A string compared with a bound variable (or an attribute named after a dimension) is a member id:
  // read it as that member's label.
  const l = operand(left, right, c, bound);
  const r = operand(right, left, c, bound);
  const lt = wrap(l, l.prec < bp || (rightAssoc && l.prec === bp));
  const rt = wrap(r, r.prec < bp || (!rightAssoc && r.prec === bp));
  return { text: `${lt} ${OPERATOR_WORDS[op]} ${rt}`, prec: bp };
}

function operand(ast: Ast, other: Ast, c: Catalog, bound: Bound): Words {
  if (ast.kind === 'str') {
    const label = c.member(memberDim(other, c, bound), ast.value);
    if (label !== undefined) return atom(label);
  }
  return render(ast, c, bound);
}

/** The dimension whose member id a bare name evaluates to: a bound variable, or `v.<dim id>`. */
function memberDim(ast: Ast, c: Catalog, bound: Bound): DimId | undefined {
  if (ast.kind !== 'ref' || ast.idx !== null) return undefined;
  const dim = bound.get(ast.name);
  if (dim !== undefined) return dim;
  const attr = attribute(ast.name, c, bound);
  return attr && c.hasDim(attr.attr) ? attr.attr : undefined;
}

/** `v.attr` with `v` bound and `v.attr` not a symbol id (S10). */
function attribute(name: string, c: Catalog, bound: Bound): { dim: DimId; attr: string } | null {
  const dot = name.indexOf('.');
  if (dot <= 0 || c.symbols.has(name)) return null;
  const dim = bound.get(name.slice(0, dot));
  return dim === undefined ? null : { dim, attr: name.slice(dot + 1) };
}

function reference(ast: RefAst, c: Catalog, bound: Bound): string {
  const { name, idx } = ast;
  if (idx === null) {
    const dim = bound.get(name);
    if (dim !== undefined) return c.dim(dim);
    const attr = attribute(name, c, bound);
    if (attr) return `${attr.attr} of ${c.dim(attr.dim)}`;
  }
  const { label } = c.symbol(name);
  const dims = c.symbols.get(name)?.dims ?? [];
  const parts = (idx ?? []).flatMap((a, i) => {
    const w = indexWords(a, dims[i], c, bound);
    return w === null ? [] : [w];
  });
  return parts.length > 0 ? `${label} (${parts.join(', ')})` : label;
}

/** An explicit index in words: a literal names its member; a bound variable reads generically. */
function indexWords(a: Ast, dim: DimId | undefined, c: Catalog, bound: Bound): string | null {
  if (a.kind === 'str') return c.member(dim, a.value) ?? a.value;
  if (a.kind === 'ref' && a.idx === null && !bound.has(a.name)) {
    const attr = attribute(a.name, c, bound);
    if (attr) return `${attr.attr} of ${c.dim(attr.dim)}`;
  }
  return null;
}

function call(fn: string, args: readonly Ast[], c: Catalog, bound: Bound): Words {
  const w = args.map((a) => render(a, c, bound));
  const unlessAtom = (x: Words) => wrap(x, x.prec !== ATOM);
  const unlessPhrase = (x: Words) => wrap(x, x.prec === PHRASE);
  switch (fn) {
    case 'IF':
      return phrase(
        `if ${unlessPhrase(w[0]!)} then ${unlessPhrase(w[1]!)}, otherwise ${w[2]!.text}`,
      );
    case 'SAFEDIV': {
      const [num, den, alt] = w as [Words, Words, Words | undefined];
      const fallback = alt ? unlessPhrase(alt) : '0';
      return phrase(
        `${wrap(num, num.prec < DIVIDE_BP)} divided by ${wrap(den, den.prec <= DIVIDE_BP)} (${fallback} if zero)`,
      );
    }
    case 'MIN':
    case 'MAX': {
      if (w.length === 1) return w[0]!;
      // Comparative for two arguments ("the smaller of a and b"), superlative for more.
      const pair = w.length === PAIR;
      const word = fn === 'MIN' ? (pair ? 'smaller' : 'smallest') : pair ? 'larger' : 'largest';
      return phrase(`the ${word} of ${list(w.map(unlessAtom), 'and')}`);
    }
    case 'ABS':
      return phrase(`the absolute value of ${unlessAtom(w[0]!)}`);
    case 'AND':
    case 'OR':
      if (w.length === 0) return atom(fn === 'AND' ? 'true' : 'false');
      if (w.length === 1) return w[0]!;
      return phrase(list(w.map(unlessPhrase), fn === 'AND' ? 'and' : 'or'));
    case 'NOT':
      return phrase(`not ${unlessAtom(w[0]!)}`);
    default:
      // Unreachable for a compiled model (unknown functions fail at compile time, S27).
      return atom(`${fn}(${w.map((x) => x.text).join(', ')})`);
  }
}
