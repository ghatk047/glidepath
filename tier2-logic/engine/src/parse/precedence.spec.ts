import { describe, expect, it } from 'vitest';
import { toPyTuple } from './ast';
import { parse } from './parse';
import { BINDING_POWER, UNARY_BP } from './parser';

const t = (src: string) => toPyTuple(parse(src));
const r = (name: string) => ['ref', name, null];
const bin = (op: string, a: unknown, b: unknown) => ['bin', op, a, b];

describe('binding powers (precedence.spec.ts)', () => {
  it('binding powers identical to Parser.BP: comparisons 10, + - 20, * / 30, unary 40, ^ 50', () => {
    expect(BINDING_POWER).toEqual({
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
    });
    expect(UNARY_BP).toBe(40);
  });

  // Expected trees: engine.py `parse` output (CPython 3.13), copied verbatim.
  it("'^' is right-associative", () => {
    expect(t('a^b^c')).toEqual(bin('^', r('a'), bin('^', r('b'), r('c'))));
    expect(t('a^-b^c')).toEqual(bin('^', r('a'), ['neg', bin('^', r('b'), r('c'))]));
    expect(t('a*b^c')).toEqual(bin('*', r('a'), bin('^', r('b'), r('c'))));
  });

  it('every other binary operator is left-associative', () => {
    expect(t('a-b-c')).toEqual(bin('-', bin('-', r('a'), r('b')), r('c')));
    expect(t('a/b/c')).toEqual(bin('/', bin('/', r('a'), r('b')), r('c')));
    expect(t('a+b*c')).toEqual(bin('+', r('a'), bin('*', r('b'), r('c'))));
    expect(t('(a+b)*c')).toEqual(bin('*', bin('+', r('a'), r('b')), r('c')));
  });

  it('unary minus binds at 40 and unary plus adds no node', () => {
    expect(t('-a^b')).toEqual(['neg', bin('^', r('a'), r('b'))]);
    expect(t('-a*b')).toEqual(bin('*', ['neg', r('a')], r('b')));
    expect(t('-a-b')).toEqual(bin('-', ['neg', r('a')], r('b')));
    expect(t('2^-1')).toEqual(bin('^', ['num', 2], ['neg', ['num', 1]]));
    expect(t('--a')).toEqual(['neg', ['neg', r('a')]]);
    expect(t('1 + -2 * 3')).toEqual(
      bin('+', ['num', 1], bin('*', ['neg', ['num', 2]], ['num', 3])),
    );
    expect(t("+'x'")).toEqual(['str', 'x']);
    expect(t('+a')).toEqual(r('a'));
  });

  it('comparisons bind loosest and do not chain', () => {
    expect(t('a<b<c')).toEqual(bin('<', bin('<', r('a'), r('b')), r('c')));
    expect(t('a < b == c')).toEqual(bin('==', bin('<', r('a'), r('b')), r('c')));
    expect(t('a==b+1')).toEqual(bin('==', r('a'), bin('+', r('b'), ['num', 1])));
  });
});
