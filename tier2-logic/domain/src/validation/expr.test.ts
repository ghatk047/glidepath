import { loadModelBundleFromDir } from '@glidepath/spec/node';
import { describe, expect, it } from 'vitest';
import { SPEC_DIR } from '../test-support/seed-state';
import { parseExpression, referencedNames, tokenize, type Ast } from './expr';

const num = (value: number): Ast => ({ k: 'num', value });
const ref = (name: string, index: Ast[] | null = null): Ast => ({ k: 'ref', name, index });
const bin = (op: string, left: Ast, right: Ast): Ast => ({ k: 'bin', op, left, right });

describe('expression parser (port of the reference engine.py parser, for VR10)', () => {
  it('parses every expression of formula_graph.json', async () => {
    const bundle = await loadModelBundleFromDir(SPEC_DIR);
    const sources = bundle.nodes.flatMap((n) => [
      ...(n.expr === undefined ? [] : [n.expr]),
      ...(n.cases ?? []).map((c) => c.expr),
    ]);
    expect(sources.length).toBeGreaterThan(bundle.nodes.length);
    for (const s of sources) expect(() => parseExpression(s), s).not.toThrow();
  });

  it('tokenizes numbers, strings, dotted identifiers and operators', () => {
    expect(tokenize(" 1.5e3 .5 2. 'fy25' corp.gdp <= ^ ")).toEqual([
      { kind: 'num', value: 1500 },
      { kind: 'num', value: 0.5 },
      { kind: 'num', value: 2 },
      { kind: 'str', value: 'fy25' },
      { kind: 'id', value: 'corp.gdp' },
      { kind: 'op', value: '<=' },
      { kind: 'op', value: '^' },
      { kind: 'end' },
    ]);
    expect(() => tokenize('1 $ 2')).toThrow(/bad token at 1 in '1 \$ 2'/);
  });

  it('binds as the reference: comparison < additive < multiplicative < unary < right-associative power', () => {
    expect(parseExpression('a + b * c ^ d ^ e >= -f')).toEqual(
      bin(
        '>=',
        bin('+', ref('a'), bin('*', ref('b'), bin('^', ref('c'), bin('^', ref('d'), ref('e'))))),
        { k: 'neg', arg: ref('f') },
      ),
    );
    expect(parseExpression('+(1 - 2) - 3')).toEqual(bin('-', bin('-', num(1), num(2)), num(3)));
  });

  it('parses references, calls and aggregates', () => {
    expect(parseExpression("pl.asm[year.prev, 'fy25']")).toEqual(
      ref('pl.asm', [ref('year.prev'), { k: 'str', value: 'fy25' }]),
    );
    expect(parseExpression('NOW()')).toEqual({ k: 'call', fn: 'NOW', args: [] });
    expect(parseExpression('SUM(l in line where l.pool == pool, x[l])')).toEqual({
      k: 'agg',
      fn: 'SUM',
      variable: 'l',
      dim: 'line',
      where: bin('==', ref('l.pool'), ref('pool')),
      body: ref('x', [ref('l')]),
    });
    expect(parseExpression('COUNT(v in vendor)')).toMatchObject({ where: null, body: null });
  });

  it('rejects malformed expressions, naming them', () => {
    expect(() => parseExpression('IF(1, 2')).toThrow(/expected \), got end in 'IF\(1, 2'/);
    expect(() => parseExpression('SUM(x of line, 1)')).toThrow(/expected 'in'/);
    expect(() => parseExpression(') + 1')).toThrow(/unexpected \)/);
    expect(() => parseExpression('1 2')).toThrow(/expected end, got 2/);
    expect(() => parseExpression('1 +')).toThrow(/unexpected end/);
    expect(() => parseExpression('SUM(1 in line)')).toThrow(/expected id/);
  });

  it('parses each source once, and lists the names an expression references', () => {
    const src = "IF(corp.it_on == 1, SUM(y in year where y.it == 0, corp.g[y.in]), corp.s['x'])";
    expect(parseExpression(src)).toBe(parseExpression(src));
    expect([...referencedNames(parseExpression(src))].sort()).toEqual([
      'corp.g',
      'corp.it_on',
      'corp.s',
      'y.in',
      'y.it',
    ]);
    expect(referencedNames(parseExpression(src))).toBe(referencedNames(parseExpression(src)));
    expect([...referencedNames(parseExpression("-a + 'b'"))]).toEqual(['a']);
  });
});
