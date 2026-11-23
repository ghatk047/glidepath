import { describe, expect, it } from 'vitest';
import {
  bundleOf,
  loadSeedModel,
  membersOf,
  pyRound,
  readFixture,
  readRepoJson,
  withinGolden,
} from '../../test/helpers';
import { compileModel } from '../compile';
import { EngineError } from '../errors';
import { float64Bits } from './input-hash';
import { findScenario, resolveInputs } from './inputs';

type Nodes = Parameters<typeof bundleOf>[0]['nodes'];
type Vars = Parameters<typeof bundleOf>[0]['variables'];

interface Setup {
  variables?: Vars;
  members?: Parameters<typeof membersOf>[0];
  values?: Record<string, number>;
  overrides?: Record<string, number>;
}

/** Compile a synthetic model; scalar variables `x, y, z, n, f` unless `variables` says otherwise. */
function modelOf(nodes: Nodes, setup: Setup = {}) {
  const variables = setup.variables ?? ['x', 'y', 'z', 'n', 'f'].map((id) => ({ id }));
  return compileModel(bundleOf({ variables, nodes }), membersOf(setup.members ?? {}));
}

function run(nodes: Nodes, setup: Setup = {}) {
  return modelOf(nodes, setup).evaluate(
    new Map(Object.entries(setup.values ?? {})),
    new Map(Object.entries(setup.overrides ?? {})),
  );
}

/** Value of node `r` = `expr` over the scalar inputs. */
function value(expr: string, values: Record<string, number> = {}): number {
  return run([{ id: 'r', expr }], { values }).get('r');
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

describe('evaluate (Model.run)', () => {
  it('evaluate runs the program in topological order', () => {
    // Listed users-first: each cell must still see its deps computed.
    const ev = run(
      [
        { id: 'c', expr: 'b + a' },
        { id: 'b', expr: 'a * 2' },
        { id: 'a', expr: 'x + 1' },
      ],
      { values: { x: 3 } },
    );
    expect([ev.get('a'), ev.get('b'), ev.get('c')]).toEqual([4, 8, 12]);
    expect(ev.get('x')).toBe(3);
    expect(ev.has('c') && ev.has('x')).toBe(true);
    expect(ev.has('nope')).toBe(false);
    expect(errorOf(() => ev.get('nope')).code).toBe('UNKNOWN_CELL');
    expect([...ev.values]).toEqual([['x', 3]]);
  });

  it('an override replaces a node cell without evaluating it', () => {
    const nodes: Nodes = [
      { id: 'a', expr: 'x / y' },
      { id: 'b', expr: 'a + 1' },
    ];
    const values = { x: 1, y: 0 };
    expect(errorOf(() => run(nodes, { values })).code).toBe('DIV_ZERO');
    // The pinned cell's expression is not run (its error cannot raise) and downstream reads the pin.
    const ev = run(nodes, { values, overrides: { a: 41, x: 7, ghost: 1 } });
    expect([ev.get('a'), ev.get('b'), ev.get('x')]).toEqual([41, 42, 1]);
    // Only node cells can be pinned; other keys are ignored, as in Python, and reported.
    expect([...ev.overrides]).toEqual([['a', 41]]);
    expect(ev.diagnostics.ignoredOverrides).toEqual(['x', 'ghost']);
  });

  it("'/' by zero throws DIV_ZERO naming the cell", () => {
    for (const y of [0, -0]) {
      const e = errorOf(() => value('x / y', { x: 1, y }));
      expect(e.code).toBe('DIV_ZERO');
      expect(e.cell).toBe('r');
      expect(e.message).toBe("while computing r: division by zero (at 2 in 'x / y')");
      expect([e.pos, e.source]).toEqual([2, 'x / y']);
    }
    // Both operands are evaluated before the divisor check: reading the missing `n` fails first.
    expect(errorOf(() => value('n / y', { y: 0 })).code).toBe('MISSING');
    // A NaN or infinite divisor does not throw; overflow is not an error (Python float '/').
    expect(value('x / y', { x: 1, y: NaN })).toBeNaN();
    expect(value('x / y', { x: 1, y: Infinity })).toBe(0);
    expect(value('x / y', { x: 1e308, y: 1e-10 })).toBe(Infinity);
  });

  it('SAFEDIV returns alt (default 0) on a zero divisor without evaluating the numerator', () => {
    // `n` is never provided: reading it would raise MISSING.
    expect(value('SAFEDIV(n, y)', { y: 0 })).toBe(0);
    expect(value('SAFEDIV(n, y, x)', { x: 5, y: -0 })).toBe(5);
    expect(value('SAFEDIV(x, y, n)', { x: 6, y: 3 })).toBe(2);
    // The alt is evaluated only on a zero divisor; a NaN divisor gives NaN, not the alt.
    expect(errorOf(() => value('SAFEDIV(x, y, n)', { x: 6, y: 0 })).code).toBe('MISSING');
    expect(value('SAFEDIV(x, y, z)', { x: 6, y: NaN, z: 9 })).toBeNaN();
  });

  it('IF evaluates only the taken branch', () => {
    expect(value('IF(f, x, x / y)', { f: 1, x: 2, y: 0 })).toBe(2);
    expect(value('IF(f, x / y, x)', { f: 0, x: 2, y: 0 })).toBe(2);
    // Python truthiness: NaN is true, ±0 false.
    expect(value('IF(f, 1, 2)', { f: NaN })).toBe(1);
    expect(value('IF(f, 1, 2)', { f: -0 })).toBe(2);
    expect(errorOf(() => value('IF(f, x / y, x)', { f: 1, x: 2, y: 0 })).code).toBe('DIV_ZERO');
  });

  it('comparisons return 1 or 0 and do not chain', () => {
    const v = { x: 1, y: 2 };
    expect(
      ['x < y', 'x <= y', 'x > y', 'x >= y', 'x == y', 'x != y'].map((e) => value(e, v)),
    ).toEqual([1, 1, 0, 0, 0, 1]);
    // `x < y < z` is `(x < y) < z`: (3 < 2) = 0, and 0 < 0.5.
    expect(value('x < y < z', { x: 3, y: 2, z: 0.5 })).toBe(1);
    // NaN compares false except `!=`.
    expect(['x == x', 'x != x', 'x < y', 'x >= y'].map((e) => value(e, { x: NaN, y: 1 }))).toEqual([
      0, 1, 0, 0,
    ]);
  });

  it('MIN and MAX fold like Python min() and max()', () => {
    const v = { x: 3, y: 1, z: 2 };
    expect([value('MIN(x, y, z)', v), value('MAX(x, y, z)', v), value('MIN(x)', v)]).toEqual([
      1, 3, 3,
    ]);
    // The first value is replaced only by a strictly smaller (larger) one.
    expect(value('MIN(n, x)', { n: NaN, x: 1 })).toBeNaN();
    expect(value('MAX(x, n)', { n: NaN, x: 1 })).toBe(1);
    expect(Object.is(value('MIN(x, y)', { x: 0, y: -0 }), 0)).toBe(true);
    expect(Object.is(value('MAX(x, y)', { x: -0, y: 0 }), -0)).toBe(true);
  });

  it('ABS is the absolute value', () => {
    expect([value('ABS(x)', { x: -3.5 }), value('ABS(x)', { x: 2 })]).toEqual([3.5, 2]);
    expect(Object.is(value('ABS(x)', { x: -0 }), 0)).toBe(true);
  });

  it('AND, OR and NOT evaluate every argument', () => {
    const v = { x: 1, y: 0, n: NaN };
    expect(['AND(x, n)', 'AND(x, y)', 'AND()'].map((e) => value(e, v))).toEqual([1, 0, 1]);
    expect(['OR(y, n)', 'OR(y, y)', 'OR()'].map((e) => value(e, v))).toEqual([1, 0, 0]);
    expect(['NOT(y)', 'NOT(x)', 'NOT(n)'].map((e) => value(e, v))).toEqual([1, 0, 0]);
    // Eager: an error in any argument raises even when the result is already known.
    expect(errorOf(() => value('AND(y, x / y)', v)).code).toBe('DIV_ZERO');
    expect(errorOf(() => value('OR(x, x / y)', v)).code).toBe('DIV_ZERO');
    expect(errorOf(() => value('NOT(x / y)', v)).code).toBe('DIV_ZERO');
  });

  it('SUM and COUNT are floats (SUM compensated in member order)', () => {
    const setup: Setup = {
      variables: [{ id: 'v', dims: ['d'] }],
      members: {
        d: [
          { id: 'p', w: 1 },
          { id: 'q', w: 0 },
          { id: 'r', w: 1 },
        ],
      },
      values: { 'v[p]': 1e16, 'v[q]': 1, 'v[r]': -1e16 },
    };
    const ev = run(
      [
        { id: 's', expr: 'SUM(u in d, v[u])' },
        { id: 'c', expr: 'COUNT(u in d where u.w == 1)' },
        { id: 'e', expr: 'SUM(u in d where u.w == 2, v[u])' },
        { id: 'z', expr: 'SUM(u in d, 0 - 0)' },
      ],
      setup,
    );
    // CPython >= 3.12 sum(): 1e16 + 1 - 1e16 = 1 (a naive fold gives 0).
    expect([ev.get('s'), ev.get('c'), ev.get('e')]).toEqual([1, 2, 0]);
    expect(Object.is(ev.get('z'), 0)).toBe(true);
  });

  it('MAXOVER and MINOVER of an empty set are 0', () => {
    const setup: Setup = {
      variables: [{ id: 'v', dims: ['d'] }],
      members: {
        d: [
          { id: 'p', w: 1 },
          { id: 'q', w: 0 },
        ],
      },
      values: { 'v[p]': -4, 'v[q]': 7 },
    };
    const ev = run(
      [
        { id: 'hi', expr: 'MAXOVER(u in d, v[u])' },
        { id: 'lo', expr: 'MINOVER(u in d, v[u])' },
        { id: 'hi0', expr: 'MAXOVER(u in d where u.w == 2, v[u])' },
        { id: 'lo0', expr: 'MINOVER(u in d where u.w == 2, v[u])' },
        { id: 'one', expr: 'MINOVER(u in d where u.w == 0, v[u])' },
      ],
      setup,
    );
    expect(['hi', 'lo', 'hi0', 'lo0', 'one'].map((k) => ev.get(k))).toEqual([7, -4, 0, 0, 7]);
  });

  it("'^' follows Python float pow (DIV_ZERO, OVERFLOW, COMPLEX)", () => {
    expect(value('x ^ y', { x: 2, y: 10 })).toBe(1024);
    expect(value('x ^ y ^ z', { x: 2, y: 3, z: 2 })).toBe(512);
    expect(errorOf(() => value('x ^ y', { x: 0, y: -1 })).code).toBe('DIV_ZERO');
    expect(errorOf(() => value('x ^ y', { x: 10, y: 400 })).code).toBe('OVERFLOW');
    const e = errorOf(() => value('x ^ y', { x: -8, y: 1 / 3 }));
    expect([e.code, e.cell, e.pos]).toEqual(['COMPLEX', 'r', 2]);
  });

  it('a missing input raises MISSING only when read, naming the cell being computed', () => {
    // Not read: the untaken branch.
    expect(value('IF(f, n, 1)', { f: 0 })).toBe(1);
    const e = errorOf(() =>
      run(
        [
          { id: 'a', expr: 'x + 1' },
          { id: 'r', expr: 'a + IF(f, 2 * n, 1)' },
        ],
        { values: { x: 1, f: 1 } },
      ),
    );
    expect([e.code, e.cell]).toEqual(['MISSING', 'r']);
    expect(e.message).toBe("while computing r: missing n (at 14 in 'a + IF(f, 2 * n, 1)')");
  });

  it('a dangling key or a missing attribute raises MISSING when read', () => {
    const members = { d: [{ id: 'p', w: 2 }, { id: 'q' }] };
    const nodes: Nodes = [
      { id: 'a', dims: ['d'], members: { d: ['p'] }, expr: '1' },
      { id: 'b', expr: "IF(f, a['q'], 3)" },
      { id: 'w', dims: ['d'], expr: 'IF(f, d.w, 0)' },
    ];
    const model = modelOf(nodes, { members });
    expect(model.diagnostics.dangling).toEqual(['a[q]']);
    const off = model.evaluate(new Map([['f', 0]]));
    expect([off.get('b'), off.get('w[q]')]).toEqual([3, 0]);
    const e = errorOf(() => model.evaluate(new Map([['f', 1]])));
    expect([e.code, e.cell, e.message.startsWith('while computing b: missing a[q]')]).toEqual([
      'MISSING',
      'b',
      true,
    ]);
    // With `b` pinned, the next read that fails is the missing attribute `w` of member q.
    const attr = errorOf(() => model.evaluate(new Map([['f', 1]]), new Map([['b', 0]])));
    expect([attr.code, attr.cell]).toEqual(['MISSING', 'w[q]']);
  });
});

describe('evaluate on the seed tenant', async () => {
  const { bundle, seed } = await loadSeedModel();
  const model = compileModel(bundle, seed.dimensionMembers);
  const inputsOf = (sid: string) =>
    resolveInputs(bundle, seed.variableValues, findScenario(seed.scenarios, sid));

  it('smoke: C preset res.net, res.gap, res.risk, br.eps27 match golden_results.json', () => {
    const golden = readRepoJson<{ scenarios: Record<string, Record<string, unknown>> }>(
      'docs/spec/reference/golden_results.json',
    ).scenarios.C!;
    const { values, overrides } = inputsOf('C');
    const ev = model.evaluate(values, overrides);
    for (const key of ['res.net', 'res.gap', 'res.risk', 'br.eps27']) {
      const ts = ev.get(key);
      expect(withinGolden(pyRound(ts, 6), golden[key] as number), `${key}: ${ts}`).toBe(true);
    }
  });

  it('every cell of preset C matches engine.py bitwise, plain and with the parity overrides', () => {
    const fx = readFixture<{ order: string[]; plain: string[]; parity: string[] }>('run_c.json');
    const report = readRepoJson<{ parity_overrides: Record<string, number> }>(
      'docs/spec/reference/parity_report.json',
    );
    expect(model.program.cellKeys).toEqual(fx.order);
    const plain = inputsOf('C');
    const parity = resolveInputs(bundle, seed.variableValues, findScenario(seed.scenarios, 'C'), {
      overrides: report.parity_overrides,
      values: { 'corp.it_swb_mode': 0 },
    });
    for (const [name, inputs] of [
      ['plain', plain],
      ['parity', parity],
    ] as const) {
      const ev = model.evaluate(inputs.values, inputs.overrides);
      const bits = fx.order.map((k) => float64Bits(ev.get(k)));
      const diff = fx.order.filter((_, i) => bits[i] !== fx[name][i]);
      expect(diff, name).toEqual([]);
    }
  });
});
