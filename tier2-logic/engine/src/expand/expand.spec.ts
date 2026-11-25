import { describe, expect, it } from 'vitest';
import {
  bundleOf,
  loadSeedModel,
  membersOf,
  readFixture,
  type DepsFixture,
} from '../../test/helpers';
import { EngineError } from '../errors';
import { parse } from '../parse';
import { expand, type Cell } from './expand';
import { MemberTable } from './members';
import { Resolver } from './resolve';
import { symbolDims } from './symbols';
import type { Resolved } from './resolved';

const fixture = readFixture<DepsFixture>('deps.json');

/** The cells of a one-node model, by key. */
function cellsOf(
  nodes: Parameters<typeof bundleOf>[0]['nodes'],
  members: Parameters<typeof membersOf>[0],
  variables: Parameters<typeof bundleOf>[0]['variables'] = [],
): Map<string, Cell> {
  const cells = expand(bundleOf({ variables, nodes }), membersOf(members));
  return new Map(cells.map((c) => [c.key, c]));
}

/** The EngineError a thunk throws. */
function errorOf(f: () => unknown): EngineError {
  try {
    f();
  } catch (e) {
    if (e instanceof EngineError) return e;
    throw e;
  }
  throw new Error('expected an EngineError');
}

/** Cell keys read by a resolved expression, in evaluation order (with repeats). */
function reads(e: Resolved): string[] {
  switch (e.kind) {
    case 'cell':
      return [e.key];
    case 'const':
    case 'missing':
      return [];
    case 'neg':
      return reads(e.arg);
    case 'bin':
      return [...reads(e.left), ...reads(e.right)];
    case 'call':
      return e.args.flatMap(reads);
    case 'agg':
      return e.terms.flatMap(reads);
  }
}

const D = { d: ['p', 'q'] };

describe('expansion (expand.spec.ts)', () => {
  it('each node expands over the cartesian product of its dims in member order, or its members subset; keys as Model.key; cell count equals Python', async () => {
    const cells = cellsOf(
      [
        { id: 's', expr: '1' },
        { id: 'n', dims: ['a', 'b'], expr: '1' },
      ],
      { a: ['a2', 'a1'], b: ['b1', 'b2', 'b3'] },
    );
    expect([...cells.keys()]).toEqual([
      's',
      'n[a2,b1]',
      'n[a2,b2]',
      'n[a2,b3]',
      'n[a1,b1]',
      'n[a1,b2]',
      'n[a1,b3]',
    ]);
    expect(cells.get('n[a1,b2]')!.members).toEqual(['a1', 'b2']);
    expect([...cells.values()].map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const { bundle, seed } = await loadSeedModel();
    const aa = expand(bundle, seed.dimensionMembers);
    expect(aa).toHaveLength(fixture.cell_count);
    expect(aa.map((c) => c.key)).toEqual(Object.keys(fixture.cells));
  });

  it('a members subset expands only the listed members in listed order', () => {
    const cells = cellsOf(
      [
        { id: 'v', dims: ['a', 'b'], members: { b: ['b3', 'b1', 'zz'] }, expr: '1' },
        { id: 'w', dims: ['a'], members: { a: [] }, expr: '1' },
      ],
      { a: ['a1', 'a2'], b: ['b1', 'b2', 'b3'] },
    );
    expect([...cells.keys()]).toEqual([
      'v[a1,b3]',
      'v[a1,b1]',
      'v[a1,zz]', // listed ids are not checked against the tenant (Python neither)
      'v[a2,b3]',
      'v[a2,b1]',
      'v[a2,zz]',
      'w[a1]', // an empty list means all members (Python `or`)
      'w[a2]',
    ]);
  });

  it('the first matching case wins, then expr', async () => {
    const lever = { lever: ['L01', 'L02', 'L03', 'L04'] };
    const cells = cellsOf(
      [
        {
          id: 'lev.x',
          dims: ['lever'],
          cases: [
            { when: { lever: ['L01', 'L02'] }, expr: '1' },
            { when: { lever: ['L02', 'L03'] }, expr: '2' },
          ],
          expr: '3',
        },
        {
          id: 'lev.y',
          dims: ['lever'],
          cases: [
            { when: { lever: ['L04'] }, expr: '4' },
            { when: {}, expr: '5' },
            { when: null, expr: '6' },
          ],
        },
      ],
      lever,
    );
    const pick = (k: string) => [cells.get(k)!.expr, cells.get(k)!.caseIndex];
    expect(pick('lev.x[L01]')).toEqual(['1', 0]);
    expect(pick('lev.x[L02]')).toEqual(['1', 0]); // matches cases 0 and 1: the first wins
    expect(pick('lev.x[L03]')).toEqual(['2', 1]);
    expect(pick('lev.x[L04]')).toEqual(['3', -1]); // no case: expr
    expect(pick('lev.y[L04]')).toEqual(['4', 0]);
    expect(pick('lev.y[L01]')).toEqual(['5', 1]); // `when: {}` matches every cell

    const noCase = errorOf(() =>
      cellsOf(
        [{ id: 'z', dims: ['lever'], cases: [{ when: { lever: ['L01'] }, expr: '1' }] }],
        lever,
      ),
    );
    expect(noCase.code).toBe('NO_CASE');
    expect(noCase.cell).toBe('z[L02]');

    // The seed model: 40 cells match more than one case; every cell's choice equals Model.pick_expr.
    const { bundle, seed } = await loadSeedModel();
    let multi = 0;
    for (const c of expand(bundle, seed.dimensionMembers)) {
      expect(c.expr, c.key).toBe(fixture.exprs[fixture.cells[c.key]!.expr]);
      const bind = new Map(c.node.dims.map((d, i) => [d, c.members[i]!]));
      const matching = (c.node.cases ?? []).filter(
        (k) => !k.when || Object.entries(k.when).every(([d, ms]) => ms.includes(bind.get(d)!)),
      );
      if (matching.length > 1) multi++;
    }
    expect(multi).toBe(40);
  });

  it('implicit index takes the innermost binding of each dim', () => {
    const vars = [
      { id: 'g', dims: ['d'] },
      { id: 'y', dims: ['d'] },
      { id: 'h', dims: ['d', 'e'] },
    ];
    const cells = cellsOf(
      [
        { id: 't', dims: ['d'], expr: 'SUM(u in d, g) + g' },
        // Re-binding `d` keeps its first position in env (Python dict), so `u` stays innermost for dim d.
        { id: 'r', dims: ['d'], expr: 'SUM(u in d, SUM(d in d, y))' },
        { id: 'k', dims: ['e'], expr: 'SUM(u in d, h)' },
      ],
      { ...D, e: ['e1'] },
      vars,
    );
    expect(reads(cells.get('t[p]')!.resolved)).toEqual(['g[p]', 'g[q]', 'g[p]']);
    expect(cells.get('t[p]')!.deps).toEqual(['g[p]', 'g[q]']);
    expect(reads(cells.get('r[q]')!.resolved)).toEqual(['y[p]', 'y[p]', 'y[q]', 'y[q]']);
    expect(reads(cells.get('k[e1]')!.resolved)).toEqual(['h[p,e1]', 'h[q,e1]']);

    const none = errorOf(() => cellsOf([{ id: 'n', expr: 'g' }], D, vars));
    expect(none.code).toBe('IMPLICIT_INDEX');
    expect(none.message).toMatch(/cannot implicitly index g on dim d/);
  });

  it('explicit index by a bound variable is positional', () => {
    const cells = cellsOf(
      [{ id: 'n', dims: ['d', 'e'], expr: 'h[d, e] + h[e, d] + SUM(u in d, h[u, e])' }],
      { ...D, e: ['e1'] },
      [{ id: 'h', dims: ['d', 'e'] }],
    );
    // The member's dim is not checked: h[e, d] reads h[e1,p] (a dangling key later, S20).
    expect(reads(cells.get('n[p,e1]')!.resolved)).toEqual([
      'h[p,e1]',
      'h[e1,p]',
      'h[p,e1]',
      'h[q,e1]',
    ]);
  });

  it('explicit index by an attribute of a bound variable (l.domain)', () => {
    const cells = cellsOf(
      [{ id: 'n', dims: ['line', 'vp'], expr: 'SUM(l in line, s[l.domain, vp])' }],
      {
        line: [
          { id: 'l1', domain: 'ops' },
          { id: 'l2', domain: 'crew' },
        ],
        vp: ['v1'],
        domain: ['ops', 'crew'],
      },
      [{ id: 's', dims: ['domain', 'vp'] }],
    );
    expect(reads(cells.get('n[l1,v1]')!.resolved)).toEqual(['s[ops,v1]', 's[crew,v1]']);
  });

  it('a string literal index is used verbatim as the member id', () => {
    const cells = cellsOf([{ id: 'n', expr: "g['q'] + g['no such member'] + g['P']" }], D, [
      { id: 'g', dims: ['d'] },
    ]).get('n');
    // Not checked against the members: a bad literal becomes a dangling key (S20).
    expect(cells!.deps).toEqual(['g[q]', 'g[no such member]', 'g[P]']);
  });

  it('an attribute index is stringified like Python str()', () => {
    const members = {
      d: [
        { id: 'p', n: 7, f: 1.5, b: true, z: null, s: 'q' },
        { id: 'q', n: 7, f: 1.5, b: true, z: null, s: 'p' },
      ],
    };
    const vars = [{ id: 'g', dims: ['d'] }];
    const ok = cellsOf([{ id: 'n', dims: ['d'], expr: 'g[d.s] + g[d.n]' }], members, vars);
    expect(ok.get('n[p]')!.deps).toEqual(['g[q]', 'g[7]']);
    for (const attr of ['f', 'b', 'z']) {
      const e = errorOf(() =>
        cellsOf([{ id: 'n', dims: ['d'], expr: `g[d.${attr}]` }], members, vars),
      );
      expect(e.code, attr).toBe('BAD_INDEX');
    }
    const missing = errorOf(() =>
      cellsOf([{ id: 'n', dims: ['d'], expr: 'g[d.nope]' }], members, vars),
    );
    expect(missing.code).toBe('UNKNOWN_SYMBOL');
    expect(missing.message).toMatch(/has no attribute 'nope'/);
    for (const idx of ['1', 'g', 'd.n + 1', 'x[d]']) {
      const e = errorOf(() =>
        cellsOf([{ id: 'n', dims: ['d'], expr: `g[${idx}]` }], members, vars),
      );
      expect(e.code, idx).toBe('BAD_INDEX');
    }
    const count = errorOf(() =>
      cellsOf([{ id: 'n', dims: ['d'], expr: 'g[d, d]' }], members, vars),
    );
    expect(count.code).toBe('BAD_INDEX');
    expect(count.message).toMatch(/g expects 1 indices, got 2/);
  });

  it('a symbol id wins over attribute access on a bound variable', () => {
    const cells = cellsOf(
      [
        { id: 'vp.growth', dims: ['vp'], expr: '1' },
        { id: 'n', dims: ['vp'], expr: 'vp.growth + vp.weight' },
        { id: 'm', dims: ['vp'], expr: "IF(vp == 'v1', 1, 0)" },
      ],
      { vp: [{ id: 'v1', growth: 100, weight: 2 }] },
    );
    const n = cells.get('n[v1]')!.resolved as Extract<Resolved, { kind: 'bin' }>;
    expect(n.left).toMatchObject({ kind: 'cell', key: 'vp.growth[v1]', sym: 'node' });
    expect(n.right).toMatchObject({ kind: 'const', value: 2 });
    expect(cells.get('n[v1]')!.deps).toEqual(['vp.growth[v1]']);
    // A bare bound variable is its member id (a string), folded at compile time.
    expect(cells.get('m[v1]')!.resolved).toMatchObject({ kind: 'const', value: 1 });
  });

  it('where-filters resolve at compile time and reject cell references', () => {
    const members = {
      pool: [
        { id: 'sw', third_party: 1 },
        { id: 'lab', third_party: 0 },
      ],
      line: [
        { id: 'l1', pool: 'sw', addr: 'open', name: 'x' },
        { id: 'l2', pool: 'lab', addr: 'locked', name: '' },
        { id: 'l3', pool: 'sw', addr: 'locked', name: 'y' },
      ],
    };
    const vars = [
      { id: 'o', dims: ['line'] },
      { id: 'po', dims: ['pool'] },
    ];
    const cells = cellsOf(
      [
        { id: 'a', dims: ['pool'], expr: 'SUM(l in line where l.pool == pool, o[l])' },
        { id: 'b', expr: "SUM(l in line where AND(l.pool == 'sw', l.addr != 'locked'), o[l])" },
        { id: 'c', expr: 'SUM(p in pool where p.third_party == 1, po[p])' },
        { id: 'e', expr: 'COUNT(l in line where l.name) + MAXOVER(l in line where 0, o[l])' },
      ],
      members,
      vars,
    );
    expect(cells.get('a[sw]')!.deps).toEqual(['o[l1]', 'o[l3]']);
    expect(cells.get('a[sw]')!.resolved).toMatchObject({ kind: 'agg', members: ['l1', 'l3'] });
    expect(cells.get('a[lab]')!.deps).toEqual(['o[l2]']);
    expect(cells.get('b')!.deps).toEqual(['o[l1]']);
    expect(cells.get('c')!.deps).toEqual(['po[sw]']);
    // COUNT is a compile-time count (Python truthiness: '' is false); an empty MAXOVER has no terms.
    expect(cells.get('e')!.resolved).toMatchObject({
      kind: 'bin',
      left: { kind: 'const', value: 2 },
      right: { kind: 'agg', fn: 'MAXOVER', terms: [] },
    });

    for (const where of ['o[l] > 0', 'po', 'IF(1, 1, po[l.pool])', 'l.nope == 1']) {
      const e = errorOf(() =>
        cellsOf([{ id: 'x', expr: `SUM(l in line where ${where}, o[l])` }], members, vars),
      );
      expect(e.code, where).toBe(where === 'l.nope == 1' ? 'UNKNOWN_SYMBOL' : 'WHERE_NOT_STATIC');
      expect(e.cell).toBe('x');
    }
    const div = errorOf(() =>
      cellsOf([{ id: 'x', expr: 'SUM(l in line where 1 / 0, o[l])' }], members, vars),
    );
    expect(div.code).toBe('DIV_ZERO');
  });

  it('where-filters evaluate with Python semantics (static Model.ev)', () => {
    const members = membersOf({
      d: [
        { id: 'p', n: 2, s: 'b', l: ['L05', 'L01'], z: null, t: true },
        { id: 'q', n: -3, s: 'a', l: [], z: null, t: false },
        { id: 'r', n: 0, s: '', l: ['L05'], z: null, t: true },
      ],
    });
    const r = new Resolver(symbolDims(bundleOf({ nodes: [] })), new MemberTable(members));
    const env = new Map([['x', { dim: 'd', member: 'p' }]]);
    // Expected: engine.py `Model.ev(parse(e), {'x': ('d', 'p')}, None)` on the same members.
    const table: [string, unknown][] = [
      ['-x.n', -2],
      ['x.n + 1.5', 3.5],
      ['x.n - 4', -2],
      ['x.n * 3', 6],
      ['x.n / 4', 0.5],
      ['x.n ^ 3', 8],
      ['IF(x.s, 1, 2)', 1],
      ['IF(x.z, 1, 2)', 2],
      ['SAFEDIV(1, x.n - 2)', 0],
      ['SAFEDIV(1, x.n - 2, 7)', 7],
      ['SAFEDIV(1, x.n)', 0.5],
      ['MIN(x.n, 1, -1)', -1],
      ['MAX(x.n, 5)', 5],
      ['ABS(0 - x.n)', 2],
      ['OR(0, x.s)', 1],
      ['OR(0, 0)', 0],
      ['NOT(x.s)', 0],
      ['NOT(0)', 1],
      ['AND(1, x.l)', 1],
      ['x.l == x.l', 1],
      ["x.s < 'c'", 1],
      ["x.s >= 'b'", 1],
      ['x.t + 1', 2],
      ['x.t == 1', 1],
      ['x.z == x.z', 1],
      ['x.l != x.n', 1],
      ['SUM(u in d, u.n)', -1],
      ['COUNT(u in d where u.n > 0)', 1],
      ['MAXOVER(u in d, u.n)', 2],
      ['MINOVER(u in d where u.n > 0, u.n)', 2],
      ['MINOVER(u in d where 0, u.n)', 0],
      ['SUM(u in d where u.s < x.s, u.n * 10)', -30],
      ['x.l < x.l', 0],
      ["x == 'p'", 1],
    ];
    for (const [src, want] of table) expect(r.evalStatic(parse(src), env), src).toBe(want);
    // Python raises TypeError on these (TYPE), ZeroDivisionError on '/' by zero (DIV_ZERO).
    for (const [src, code] of [
      ["x.s + 'a'", 'TYPE'],
      ['x.s < 1', 'TYPE'],
      ['x.z < 1', 'TYPE'],
      ['-x.s', 'TYPE'],
      ['MAX(x.s, 1)', 'TYPE'],
      ['1 / (x.n - 2)', 'DIV_ZERO'],
      ['0 ^ -1', 'DIV_ZERO'],
    ] as const) {
      expect(() => r.evalStatic(parse(src), env), src).toThrow(EngineError);
      try {
        r.evalStatic(parse(src), env);
      } catch (e) {
        expect((e as EngineError).code, src).toBe(code);
      }
    }
  });

  it('a string outside a comparison or index is a compile error', () => {
    const vars = [{ id: 'x' }];
    const ok = cellsOf([{ id: 'n', dims: ['d'], expr: "IF(d == 'p', x, 0) + (d < 'q')" }], D, vars);
    expect(reads(ok.get('n[p]')!.resolved)).toEqual(['x']);
    expect(ok.get('n[q]')!.deps).toEqual(['x']); // both IF branches count
    for (const expr of [
      "'abc'",
      'd + 1',
      '-d',
      'MAX(d, 1)',
      "IF(x > 0, 'a', 1)",
      'd == x',
      'IF(d, 1, 0)',
      'd < 1',
    ]) {
      const e = errorOf(() => cellsOf([{ id: 'n', dims: ['d'], expr }], D, vars));
      expect(e.code, expr).toBe('TYPE');
      expect(e.cell, expr).toBe('n[p]');
    }
  });

  it('unknown functions, wrong arity and malformed aggregates fail at compile time', () => {
    const vars = [{ id: 'x' }, { id: 'g', dims: ['d'] }];
    const cases: [string, string][] = [
      ['FOO(1)', 'UNKNOWN_FUNCTION'],
      ['if(1, 2, 3)', 'UNKNOWN_FUNCTION'],
      ['IF(1, 2)', 'ARITY'],
      ['SAFEDIV(1)', 'ARITY'],
      ['SAFEDIV(1, 2, 3, 4)', 'ARITY'],
      ['MIN()', 'ARITY'],
      ['ABS(1, 2)', 'ARITY'],
      ['NOT()', 'ARITY'],
      ['COUNT(u in d, 1)', 'ARITY'],
      ['SUM(u in d)', 'ARITY'],
      ['SUM(u in nodim, 1)', 'UNKNOWN_DIMENSION'],
      ['SUM(u in d where COUNT(v in d, 1), 1)', 'ARITY'],
      ['SUM(u in d where FOO(u), 1)', 'UNKNOWN_FUNCTION'],
      ['nosuch + 1', 'UNKNOWN_SYMBOL'],
      ['x[d]', 'BAD_INDEX'],
    ];
    for (const [expr, code] of cases) {
      const e = errorOf(() => cellsOf([{ id: 'n', dims: ['d'], expr }], D, vars));
      expect(e.code, expr).toBe(code);
    }
    expect(() =>
      cellsOf([{ id: 'n', expr: 'AND() + OR() + SAFEDIV(1, x) + MIN(1, x, 2)' }], D, vars),
    ).not.toThrow();
  });

  it('compile errors carry the cell key and the source position', () => {
    const e = errorOf(() => cellsOf([{ id: 'n', dims: ['d'], expr: '1 + nosuch' }], D));
    expect(e).toMatchObject({ code: 'UNKNOWN_SYMBOL', cell: 'n[p]', pos: 4, source: '1 + nosuch' });
    expect(e.message).toBe("unknown symbol nosuch (cell n[p], at 4 in '1 + nosuch')");
    const syntax = errorOf(() => cellsOf([{ id: 'n', expr: '1 +' }], D));
    expect(syntax).toMatchObject({ code: 'SYNTAX', cell: 'n', pos: 3, source: '1 +' });
    const dim = errorOf(() => cellsOf([{ id: 'n', dims: ['nodim'], expr: '1' }], D));
    expect(dim.code).toBe('UNKNOWN_DIMENSION');
    expect(dim.message).toMatch(/node n/);
  });

  it('a missing attribute in a value position is a MISSING read, not a compile error', () => {
    const cells = cellsOf([{ id: 'n', dims: ['d'], expr: "d.w * 2 + (d.k == 'a')" }], {
      d: [{ id: 'p', w: 3 }],
    });
    const r = cells.get('n[p]')!.resolved as Extract<Resolved, { kind: 'bin' }>;
    expect(r.left).toMatchObject({ kind: 'bin', left: { kind: 'const', value: 3 } });
    expect(r.right).toMatchObject({
      kind: 'bin',
      op: '==',
      left: { kind: 'missing', message: "member 'p' of 'd' has no attribute 'k'" },
    });
  });
});
