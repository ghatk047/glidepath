import { describe, expect, it } from 'vitest';
import { EngineError } from '../errors';
import { toPyTuple, type Ast } from './ast';
import { parse, type ParseCache } from './parse';
import { AGGREGATES } from './parser';

describe('AST kinds (parser.spec.ts)', () => {
  it('AST kinds num, str, neg, bin, call, agg(fn, var, dim, where, body), ref(name, idx)', () => {
    expect(parse('1.5')).toEqual({ kind: 'num', value: 1.5, pos: 0 });
    expect(parse(" 's'")).toEqual({ kind: 'str', value: 's', pos: 1 });
    expect(parse('-x')).toEqual({
      kind: 'neg',
      arg: { kind: 'ref', name: 'x', idx: null, pos: 1 },
      pos: 0,
    });
    expect(parse('a / b')).toMatchObject({ kind: 'bin', op: '/', pos: 2 });
    expect(parse('IF(a, 1, 2)')).toMatchObject({ kind: 'call', fn: 'IF', pos: 0 });
    expect((parse('f()') as Extract<Ast, { kind: 'call' }>).args).toEqual([]);
    expect(parse('SUM(l in line where l.pool == pool, x[l])')).toMatchObject({
      kind: 'agg',
      fn: 'SUM',
      var: 'l',
      dim: 'line',
      where: { kind: 'bin', op: '==' },
      body: { kind: 'ref', name: 'x', idx: [{ kind: 'ref', name: 'l', idx: null }] },
    });
    expect(parse('COUNT(x in d)')).toMatchObject({ kind: 'agg', where: null, body: null });
    expect(parse("x[i, 'a', l.domain]")).toMatchObject({
      kind: 'ref',
      name: 'x',
      idx: [
        { kind: 'ref', name: 'i' },
        { kind: 'str', value: 'a' },
        { kind: 'ref', name: 'l.domain' },
      ],
    });
    expect(parse('lev.L01.rr')).toEqual({ kind: 'ref', name: 'lev.L01.rr', idx: null, pos: 0 });
  });

  it('toPyTuple gives the Python tuple shape', () => {
    // engine.py `parse` output, copied verbatim.
    expect(toPyTuple(parse('SUM(l in line where l.pool == pool, x[l])'))).toEqual([
      'agg',
      'SUM',
      'l',
      'line',
      ['bin', '==', ['ref', 'l.pool', null], ['ref', 'pool', null]],
      ['ref', 'x', [['ref', 'l', null]]],
    ]);
    expect(toPyTuple(parse('COUNT(x in d)'))).toEqual(['agg', 'COUNT', 'x', 'd', null, null]);
    expect(toPyTuple(parse('MAXOVER(u in vp, a[u])'))).toEqual([
      'agg',
      'MAXOVER',
      'u',
      'vp',
      null,
      ['ref', 'a', [['ref', 'u', null]]],
    ]);
    expect(toPyTuple(parse('IF(a, 1, 2)'))).toEqual([
      'call',
      'IF',
      [
        ['ref', 'a', null],
        ['num', 1],
        ['num', 2],
      ],
    ]);
    expect(toPyTuple(parse('f()'))).toEqual(['call', 'f', []]);
  });

  it('aggregates are upper case and only when followed by "("', () => {
    expect([...AGGREGATES].sort()).toEqual(['COUNT', 'MAXOVER', 'MINOVER', 'SUM']);
    expect(parse('SUM')).toMatchObject({ kind: 'ref', name: 'SUM' });
    expect(parse('sum(a, b)')).toMatchObject({ kind: 'call', fn: 'sum' });
    expect(parse('SUM[x]')).toMatchObject({ kind: 'ref', name: 'SUM' });
  });

  it('parse caches each source text once per cache', () => {
    const cache: ParseCache = new Map();
    const a = parse('a + b', cache);
    expect(parse('a + b', cache)).toBe(a);
    expect(cache.size).toBe(1);
    expect(parse('a + b')).not.toBe(a);
  });
});

describe('syntax errors (parser.spec.ts)', () => {
  // Python messages (engine.py), for the same inputs: see the comment on each row.
  const CASES: readonly (readonly [src: string, message: RegExp, pos: number])[] = [
    ['', /^unexpected \('end', None\) at 0 in ''$/, 0], // unexpected ('end', None) in ''
    ['a +', /^unexpected \('end', None\) at 3 in 'a \+'$/, 3],
    ['(a', /^expected \), got \('end', None\) at 2 in '\(a'$/, 2], // expected ), got ('end', None)
    ['f(a,', /^unexpected \('end', None\) at 4/, 4],
    ['SUM(l on line, x)', /^expected 'in' at 6/, 6], // expected 'in'
    ['SUM(l in line x)', /^expected \), got \('id', 'x'\) at 14/, 14],
    ['a b', /^expected end, got \('id', 'b'\) at 2 in 'a b'$/, 2],
    ['x[]', /^unexpected \('op', '\]'\) at 2/, 2],
    [')', /^unexpected \('op', '\)'\) at 0/, 0],
    ['SUM(1 in d)', /^expected id, got \('num', 1\.0\) at 4/, 4],
    ['a[1', /^expected \], got \('end', None\) at 3/, 3],
    ['*a', /^unexpected \('op', '\*'\) at 0/, 0],
    ['  x y  ', /^expected end, got \('id', 'y'\) at 4 in ' {2}x y {2}'$/, 4],
    ['a ? b', /^bad token at 2: '\? b' in 'a \? b'$/, 2],
  ];

  it('syntax errors carry position and source text', () => {
    for (const [src, message, pos] of CASES) {
      let err: unknown;
      try {
        parse(src);
      } catch (e) {
        err = e;
      }
      expect(err, src).toBeInstanceOf(EngineError);
      const e = err as EngineError;
      expect(e.code, src).toBe('SYNTAX');
      expect(e.message, src).toMatch(message);
      expect(e.pos, src).toBe(pos);
      expect(e.source, src).toBe(src);
      expect(e.cell, src).toBeUndefined();
    }
  });
});
