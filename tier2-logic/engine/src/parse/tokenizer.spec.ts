import { describe, expect, it } from 'vitest';
import { TOKEN_RE, tokenize, type Token } from './tokenize';

/** Tokens as engine.py's `tokenize` prints them: `[kind, value]`, `end` with null. */
const py = (src: string) => tokenize(src).map((t: Token) => [t.kind, t.value]);

// Expected values: output of engine.py `tokenize` (CPython 3.13), copied verbatim.
const TABLE: readonly (readonly [src: string, tokens: readonly (readonly [string, unknown])[]])[] =
  [
    ['1', [['num', 1]]],
    ['1.', [['num', 1]]],
    ['.5', [['num', 0.5]]],
    ['1.e5', [['num', 100000]]],
    ['1e-3', [['num', 0.001]]],
    ['2.5E+10', [['num', 25000000000]]],
    ['12.34e2', [['num', 1234]]],
    ['007', [['num', 7]]],
    [
      '1e',
      [
        ['num', 1],
        ['id', 'e'],
      ],
    ],
    [
      '1.2.3',
      [
        ['num', 1.2],
        ['num', 0.3],
      ],
    ],
    [
      '1..2',
      [
        ['num', 1],
        ['num', 0.2],
      ],
    ],
    [
      '.5.5',
      [
        ['num', 0.5],
        ['num', 0.5],
      ],
    ],
    ['e5', [['id', 'e5']]],
    [
      '3e5x',
      [
        ['num', 300000],
        ['id', 'x'],
      ],
    ],
    ["'abc'", [['str', 'abc']]],
    ["''", [['str', '']]],
    ["'a b,c'", [['str', 'a b,c']]],
    ['lev.L01.rr', [['id', 'lev.L01.rr']]],
    ['_x9', [['id', '_x9']]],
    ['a.b.', [['id', 'a.b.']]],
    [
      'x == y != z <= w >= v < u > t',
      [
        ['id', 'x'],
        ['op', '=='],
        ['id', 'y'],
        ['op', '!='],
        ['id', 'z'],
        ['op', '<='],
        ['id', 'w'],
        ['op', '>='],
        ['id', 'v'],
        ['op', '<'],
        ['id', 'u'],
        ['op', '>'],
        ['id', 't'],
      ],
    ],
    [
      '+-*/^()[],',
      ['+', '-', '*', '/', '^', '(', ')', '[', ']', ','].map((o) => ['op', o] as const),
    ],
    [
      'f (x)',
      [
        ['id', 'f'],
        ['op', '('],
        ['id', 'x'],
        ['op', ')'],
      ],
    ],
    [
      'a[ i ]',
      [
        ['id', 'a'],
        ['op', '['],
        ['id', 'i'],
        ['op', ']'],
      ],
    ],
    [
      '  a + b  ',
      [
        ['id', 'a'],
        ['op', '+'],
        ['id', 'b'],
      ],
    ],
  ];

describe('tokenizer (tokenizer.spec.ts)', () => {
  it('tokenizer matches engine.py TOK on edge cases', () => {
    for (const [src, tokens] of TABLE) {
      expect(py(src), src).toEqual([...tokens.map((t) => [...t]), ['end', null]]);
    }
  });

  it('numbers are float64 with exponent and leading dot, parsed like Python float()', () => {
    expect(tokenize('0.1')[0]!.value).toBe(0.1);
    expect(tokenize('1e308')[0]!.value).toBe(1e308);
    expect(tokenize('1e400')[0]!.value).toBe(Infinity); // Python float('1e400') = inf
    expect(tokenize('2.2250738585072014e-308')[0]!.value).toBe(2.2250738585072014e-308);
  });

  it('only the listed operators: =, !, %, &&, #, $ and an unterminated string are SYNTAX errors', () => {
    for (const [src, pos] of [
      ['a = b', 2],
      ['a ! b', 2],
      ['a % b', 2],
      ['a && b', 2],
      ["'abc", 0],
      ['a # b', 2],
      ['$x', 0],
    ] as const) {
      expect(() => tokenize(src), src).toThrow(/^bad token at \d+: .* in /);
      try {
        tokenize(src);
      } catch (e) {
        expect(e).toMatchObject({ name: 'EngineError', code: 'SYNTAX', pos, source: src });
      }
    }
  });

  it('positions are offsets into the source as written (not the stripped text)', () => {
    expect(tokenize('  a +\tb[ 1 ]').map((t) => t.pos)).toEqual([2, 4, 6, 7, 9, 11, 12]);
    expect(tokenize("x == 'q r'").map((t) => t.pos)).toEqual([0, 2, 5, 10]);
  });

  it('whitespace is Python ASCII whitespace; non-ASCII outside a string literal is SYNTAX', () => {
    expect(py('\x0ba\x1c+\x1fb\x0c')).toEqual([
      ['id', 'a'],
      ['op', '+'],
      ['id', 'b'],
      ['end', null],
    ]);
    expect(() => tokenize('a + b')).toThrow(/bad token/);
    expect(() => tokenize('٣')).toThrow(/bad token/); // Arabic-Indic digit: Python \d, not here
    expect(py("'café'")).toEqual([
      ['str', 'café'],
      ['end', null],
    ]);
  });

  it('TOKEN_RE is sticky and keeps the four groups of TOK', () => {
    expect(TOKEN_RE.sticky).toBe(true);
    TOKEN_RE.lastIndex = 0;
    const m = TOKEN_RE.exec(' 1.5e3')!;
    expect([m[1], m[2], m[3], m[4]]).toEqual(['1.5e3', undefined, undefined, undefined]);
  });
});
