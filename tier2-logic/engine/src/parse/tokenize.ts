/**
 * Tokenizer: port of `TOK` and `tokenize` (engine.py L20-38). PORTING.md S28.
 *
 * Differences from Python, none of which changes a token of an ASCII expression:
 * - Python strips the source and reports offsets into the stripped text; here offsets are into the
 *   source as written (the spec text), so an error points at the real character.
 * - Python's `\s` and `\d` are Unicode-aware. Here whitespace is exactly Python's ASCII whitespace
 *   (`str.isspace()` below U+0080) and digits are `0-9`, so non-ASCII outside a string literal is a
 *   SYNTAX error instead of a Unicode digit or space. Every spec expression is ASCII (tested).
 */
import { EngineError } from '../errors';

/** Python's ASCII whitespace: `[c for c in map(chr, range(128)) if c.isspace()]`. */
const WS = '[\\t\\n\\v\\f\\r\\x1c-\\x1f ]';

/**
 * `TOK` of engine.py with the sticky flag: leading whitespace, then one of number | 'string' |
 * identifier | operator, as an ordered alternation (first alternative that matches wins, like Python).
 * Groups: 1 number, 2 string with quotes, 3 identifier, 4 operator.
 */
export const TOKEN_RE = new RegExp(
  `${WS}*(?:` +
    '(\\d+\\.\\d*(?:[eE][-+]?\\d+)?|\\d*\\.\\d+(?:[eE][-+]?\\d+)?|\\d+(?:[eE][-+]?\\d+)?)' +
    "|('(?:[^'])*')" +
    '|([A-Za-z_][A-Za-z0-9_.]*)' +
    '|(==|!=|<=|>=|[-+*/^()\\[\\],<>])' +
    ')',
  'y',
);

const LEADING_WS = new RegExp(`^${WS}*`);
const TRAILING_WS = new RegExp(`${WS}*$`);

/** The operators of the language, as the tokenizer emits them. */
export type Operator =
  '==' | '!=' | '<=' | '>=' | '<' | '>' | '+' | '-' | '*' | '/' | '^' | '(' | ')' | '[' | ']' | ',';

/** One token. `pos` is the 0-based offset of its first character in the source as written. */
export type Token =
  | { readonly kind: 'num'; readonly value: number; readonly pos: number }
  | { readonly kind: 'str'; readonly value: string; readonly pos: number }
  | { readonly kind: 'id'; readonly value: string; readonly pos: number }
  | { readonly kind: 'op'; readonly value: Operator; readonly pos: number }
  | { readonly kind: 'end'; readonly value: null; readonly pos: number };

export type TokenKind = Token['kind'];

/** First code point Python `repr()` prints verbatim, DEL, and the snippet length of a bad-token message. */
const PRINTABLE_FROM = 0x20;
const DEL = 0x7f;
const HEX = 16;
const HEX_WIDTH = 2;
const SNIPPET = 20;
/** Python's float `repr()` switches to exponent notation at 1e16. */
const REPR_EXP_FROM = 1e16;

/** Python `repr()` of a str, for error messages that read like engine.py's. */
export function pyRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (c < PRINTABLE_FROM || c === DEL)
      out += `\\x${c.toString(HEX).padStart(HEX_WIDTH, '0')}`;
    else out += ch;
  }
  return `${quote}${out}${quote}`;
}

/** Python `repr()` of a float, close enough for messages: `2.0`, `0.5`, `1e+16`. */
function floatRepr(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < REPR_EXP_FROM) return v.toFixed(1);
  return String(v).replace(/e(\d)/, 'e+$1');
}

/** Python `repr()` of a token tuple, e.g. `('op', ')')`, `('num', 2.0)`, `('end', None)`. */
export function tokenRepr(tok: Token): string {
  const v =
    tok.kind === 'end' ? 'None' : tok.kind === 'num' ? floatRepr(tok.value) : pyRepr(tok.value);
  return `('${tok.kind}', ${v})`;
}

/**
 * `tokenize(s)`: the tokens of `src`, ending with an `end` token. Numbers are float64 (`Number` of the
 * matched text, correctly rounded like Python `float()`); a string token's value has no quotes and no
 * escapes. Throws `EngineError` SYNTAX with the offset and the source on an unknown character.
 */
export function tokenize(src: string): Token[] {
  const start = LEADING_WS.exec(src)![0].length;
  const end = Math.max(start, src.length - TRAILING_WS.exec(src)![0].length);
  const out: Token[] = [];
  let pos = start;
  while (pos < end) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m || TOKEN_RE.lastIndex === pos) {
      const at = pos + LEADING_WS.exec(src.slice(pos))![0].length;
      throw new EngineError(
        'SYNTAX',
        `bad token at ${at}: ${pyRepr(src.slice(at, at + SNIPPET))} in ${pyRepr(src)}`,
        undefined,
        { pos: at, source: src },
      );
    }
    const [text, num, str, ident, op] = m;
    const tokPos = TOKEN_RE.lastIndex - (num ?? str ?? ident ?? op ?? text).length;
    if (num !== undefined) out.push({ kind: 'num', value: Number(num), pos: tokPos });
    else if (str !== undefined) out.push({ kind: 'str', value: str.slice(1, -1), pos: tokPos });
    else if (ident !== undefined) out.push({ kind: 'id', value: ident, pos: tokPos });
    else out.push({ kind: 'op', value: op as Operator, pos: tokPos });
    pos = TOKEN_RE.lastIndex;
  }
  out.push({ kind: 'end', value: null, pos: end });
  return out;
}
