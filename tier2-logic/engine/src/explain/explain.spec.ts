import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DimensionDef, ModelBundle } from '@glidepath/spec';
import { describe, expect, it } from 'vitest';
import {
  bundleOf,
  loadSeedModel,
  membersOf,
  readFixture,
  readRepoJson,
  repo,
} from '../../test/helpers';
import { compileModel } from '../compile';
import { EngineError } from '../errors';
import { findScenario, float64Bits, resolveInputs } from '../eval';
import { parse } from '../parse';
import type { Evaluation, Explanation } from '../types';
import { Catalog } from './catalog';
import { FD_STEP, localSensitivities } from './drivers';
import { formulaInWords } from './words';

/** `explain.json` written by `test/fixtures/dump_explain.py` (Model.rerun finite differences). */
interface ExplainFixture {
  sources: Record<string, string>;
  runs: Record<
    'plain' | 'parity',
    Record<string, { value: string; candidates: number; rows: [string, string][] }>
  >;
}

const byKey = (a: readonly [string, ...unknown[]], b: readonly [string, ...unknown[]]) =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;

/** The forward-difference step for `x`, exactly as drivers.ts and dump_explain.py take it. */
function step(x: number): { xh: number; h: number } {
  const xh = x + Math.max(Math.abs(x), 1) * FD_STEP;
  return { xh, h: xh - x };
}

/** Drivers sorted by |sensitivity|, non-increasing, each consistent with its own fields. */
function expectRankedDrivers(ex: Explanation, at: Evaluation) {
  const y = at.get(ex.cell);
  ex.drivers.forEach((d, i) => {
    if (i > 0)
      expect(Math.abs(d.sensitivity)).toBeLessThanOrEqual(Math.abs(ex.drivers[i - 1]!.sensitivity));
    expect(d.value).toBe(at.get(d.cell));
    expect(d.sensitivity).toBe(d.derivative * d.value);
    expect(d.sensitivity).not.toBe(0);
    expect(d.elasticity).toBe(y !== 0 ? d.sensitivity / y : null);
  });
}

describe('explain on the seed tenant (explain.spec.ts)', async () => {
  const { bundle, seed } = await loadSeedModel();
  const model = compileModel(bundle, seed.dimensionMembers);
  const fixture = readFixture<ExplainFixture>('explain.json');
  const report = readRepoJson<{ parity_overrides: Record<string, number> }>(
    'docs/spec/reference/parity_report.json',
  );
  const inputs = {
    plain: resolveInputs(bundle, seed.variableValues, findScenario(seed.scenarios, 'C')),
    parity: resolveInputs(bundle, seed.variableValues, findScenario(seed.scenarios, 'C'), {
      overrides: report.parity_overrides,
      values: { 'corp.it_swb_mode': 0 },
    }),
  };
  const evals = {
    plain: model.evaluate(inputs.plain.values, inputs.plain.overrides),
    parity: model.evaluate(inputs.parity.values, inputs.parity.overrides),
  };

  it('the fixture was generated from the current spec, seed and engine.py', () => {
    for (const [rel, sha] of Object.entries(fixture.sources)) {
      const actual = createHash('sha256')
        .update(readFileSync(resolve(repo, rel)))
        .digest('hex');
      expect(actual, `${rel} changed: re-run test/fixtures/dump_explain.py`).toBe(sha);
    }
  });

  it('explain(cell) returns expression, resolved inputs with values, formula in words from spec labels, and top drivers by local sensitivity via rerun (res.net, br.eps27)', () => {
    const ev = evals.plain;
    const net = model.explain('res.net', ev);
    expect(net).toMatchObject({
      cell: 'res.net',
      id: 'res.net',
      kind: 'node',
      label: 'NET CY27 outlay reduction (CIO test)',
      unit: '$M',
      expression: 'res.tot_iy - res.tot_ot_it',
      value: ev.get('res.net'),
      pinned: false,
      words: 'CY27 in-year gross savings minus CY27 one-time costs charged to IT',
    });
    expect(net.inputs).toEqual([
      {
        cell: 'res.tot_iy',
        id: 'res.tot_iy',
        kind: 'node',
        label: 'CY27 in-year gross savings',
        unit: '$M',
        value: ev.get('res.tot_iy'),
      },
      {
        cell: 'res.tot_ot_it',
        id: 'res.tot_ot_it',
        kind: 'node',
        label: 'CY27 one-time costs charged to IT',
        unit: '$M',
        value: ev.get('res.tot_ot_it'),
      },
    ]);

    const eps = model.explain('br.eps27', ev);
    expect(eps).toMatchObject({
      kind: 'node',
      label: 'IT effect on eps, CY27',
      unit: '$',
      expression: "pl.eps['fy27it'] - pl.eps['fy27b']",
      value: ev.get('br.eps27'),
      words: 'Adjusted EPS (FY2027E + IT) minus Adjusted EPS (FY2027E base)',
    });
    expect(eps.inputs.map((r) => [r.cell, r.label, r.value])).toEqual([
      ['pl.eps[fy27it]', 'Adjusted EPS', ev.get('pl.eps[fy27it]')],
      ['pl.eps[fy27b]', 'Adjusted EPS', ev.get('pl.eps[fy27b]')],
    ]);

    // Top drivers: inputs far upstream, ranked by |∂y/∂x · x|.
    expect(net.drivers.slice(0, 3).map((d) => d.cell)).toEqual([
      'lev.realize[L10]',
      'lev.on[L10]',
      'hc.us_seed',
    ]);
    expect(eps.drivers.slice(0, 3).map((d) => d.cell)).toEqual([
      'corp.it_on',
      'corp.shares[fy27]',
      'g.ot_in_year',
    ]);
    expect(net.drivers[0]).toMatchObject({ id: 'lev.realize', kind: 'input', value: 1 });
    for (const ex of [net, eps]) {
      expectRankedDrivers(ex, ev);
      // Every candidate is upstream of the cell; "via rerun": model.rerun (ENG-07) and a full evaluation
      // with the driver moved by the same step give the same derivative, bit for bit.
      const up = new Set(model.upstream(ex.cell));
      for (const d of ex.drivers) expect(up.has(d.cell), d.cell).toBe(true);
      for (const d of ex.drivers.slice(0, 10)) {
        const { xh, h } = step(d.value);
        const derivative = (y1: number) => float64Bits((y1 - ev.get(ex.cell)) / h);
        const rerun = model.rerun(ev, [{ target: 'variable', cell: d.cell, value: xh }]);
        expect(derivative(rerun.get(ex.cell)), `${ex.cell} by ${d.cell}`).toBe(
          float64Bits(d.derivative),
        );
        const full = model.evaluate(new Map(inputs.plain.values).set(d.cell, xh));
        expect(derivative(full.get(ex.cell)), `${ex.cell} by ${d.cell}`).toBe(
          float64Bits(d.derivative),
        );
      }
    }
  });

  it('every candidate derivative equals Model.rerun bitwise, plain and with the parity pins', () => {
    for (const run of ['plain', 'parity'] as const) {
      const ev = evals[run];
      for (const [target, ref] of Object.entries(fixture.runs[run])) {
        const where = `${run} ${target}`;
        expect(float64Bits(ev.get(target)), where).toBe(ref.value);
        const all = localSensitivities(model, target, ev);
        expect(all, where).toHaveLength(ref.candidates);
        const rows = all
          .filter((s) => s.derivative !== 0)
          .map((s): [string, string] => [s.cell, float64Bits(s.derivative)])
          .sort(byKey);
        expect(rows, where).toEqual(ref.rows);
        // explain keeps exactly the candidates whose sensitivity is not 0, ranked.
        const ex = model.explain(target, ev);
        const expected = all.filter((s) => s.derivative * s.value !== 0).map((s) => s.cell);
        expect(ex.drivers.map((d) => d.cell).sort(), where).toEqual(expected.sort());
        expectRankedDrivers(ex, ev);
      }
    }
    // With the parity pins, pinned node cells drive and nothing under a pin does.
    const pinned = model.explain('res.net', evals.parity).drivers.filter((d) => d.kind === 'node');
    expect(pinned.length).toBeGreaterThan(0);
    for (const d of pinned) expect(evals.parity.overrides.has(d.cell), d.cell).toBe(true);
    const top = model.explain('res.net', evals.parity).drivers[0]!;
    expect(top.cell).toBe('lv.sw');
    // A pinned driver moves by moving its pin (an override change for model.rerun).
    const { xh, h } = step(top.value);
    const moved = model.rerun(evals.parity, [{ target: 'override', cell: top.cell, value: xh }]);
    expect(float64Bits((moved.get('res.net') - evals.parity.get('res.net')) / h)).toBe(
      float64Bits(top.derivative),
    );
  });

  it('explains every node cell without an evaluation: structure only, words from labels', () => {
    for (const key of model.program.cellKeys) {
      const ex = model.explain(key);
      expect(ex.value, key).toBeUndefined();
      expect(ex.drivers, key).toEqual([]);
      expect(
        ex.inputs.map((r) => r.cell),
        key,
      ).toEqual(model.upstream(key, 1));
      expect(
        ex.inputs.every((r) => r.value === undefined),
        key,
      ).toBe(true);
      expect(ex.words, key).not.toMatch(/undefined|\[object|NaN|^$/);
    }
  });
});

/** A bundle whose nodes and variables carry the given labels and units, with labelled dimensions. */
function labelled(
  bundle: ModelBundle,
  labels: Record<string, string>,
  dimensions: DimensionDef[] = [],
): ModelBundle {
  const relabel = <T extends { id: string; label: string; unit: string }>(x: T): T => ({
    ...x,
    label: labels[x.id] ?? x.label,
    unit: labels[x.id] === undefined ? x.unit : '$M',
  });
  return {
    ...bundle,
    variables: bundle.variables.map(relabel),
    nodes: bundle.nodes.map(relabel),
    dimensions,
  };
}

const dim = (id: string, label: string, attributes: string[] = []): DimensionDef => ({
  id,
  label,
  scope: 'tenant',
  attributes,
});

describe('formula in words (explain.spec.ts)', () => {
  const bundle = labelled(
    bundleOf({
      variables: [
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
        { id: 'amt', dims: ['line'] },
        { id: 'share', dims: ['pool'] },
        { id: 'line.amt', dims: ['line'] },
        { id: 'blank' },
      ],
      nodes: [{ id: 'n', dims: ['line'], expr: '1' }],
    }),
    {
      a: 'Alpha',
      b: 'Beta',
      c: 'Gamma',
      amt: 'Amount',
      share: 'Share',
      'line.amt': 'Line amount',
      blank: '',
    },
    [dim('line', 'Cost line', ['pool', 'weight', 'flag']), dim('pool', 'Cost pool')],
  );
  const members = membersOf({
    line: [
      { id: 'l1', label: 'First line', pool: 'p1', weight: 2, flag: 1 },
      { id: 'l2', pool: 'p2', weight: 3, flag: 0 },
    ],
    pool: [
      { id: 'p1', label: 'Pool one' },
      { id: 'p2', label: '' },
    ],
  });
  const catalog = new Catalog(bundle, members);
  const words = (expr: string, dims: string[] = []) => formulaInWords(parse(expr), catalog, dims);

  it('operators read as words and group exactly as the parser does', () => {
    expect(words('a + b * c')).toBe('Alpha plus Beta times Gamma');
    expect(words('(a + b) * c')).toBe('(Alpha plus Beta) times Gamma');
    expect(words('a - b - c')).toBe('Alpha minus Beta minus Gamma');
    expect(words('a - (b - c)')).toBe('Alpha minus (Beta minus Gamma)');
    expect(words('a / b / 2')).toBe('Alpha divided by Beta divided by 2');
    expect(words('a ^ b ^ c')).toBe('Alpha to the power of Beta to the power of Gamma');
    expect(words('(a ^ b) ^ c')).toBe('(Alpha to the power of Beta) to the power of Gamma');
    expect(words('-a * b')).toBe('minus Alpha times Beta');
    expect(words('-(a * b)')).toBe('minus (Alpha times Beta)');
    expect(words('(-a) ^ 2')).toBe('(minus Alpha) to the power of 2');
    expect(words('a == b')).toBe('Alpha equals Beta');
    expect(words('a != 0.5')).toBe('Alpha does not equal 0.5');
    expect(words('a < b + 1')).toBe('Alpha is less than Beta plus 1');
    expect(words('(a < b) + 1')).toBe('(Alpha is less than Beta) plus 1');
    expect(words('a <= b')).toBe('Alpha is at most Beta');
    expect(words('a >= b')).toBe('Alpha is at least Beta');
    expect(words('blank')).toBe('blank');
  });

  it('functions read as phrases, parenthesised when they are an operand', () => {
    expect(words('IF(a > 0, b, c)')).toBe('if Alpha is greater than 0 then Beta, otherwise Gamma');
    expect(words('IF(a > 0, b, IF(a < 0, c, 0))')).toBe(
      'if Alpha is greater than 0 then Beta, otherwise if Alpha is less than 0 then Gamma, otherwise 0',
    );
    expect(words('IF(IF(a, b, c), 1, 2)')).toBe(
      'if (if Alpha then Beta, otherwise Gamma) then 1, otherwise 2',
    );
    expect(words('IF(a, b, c) * 2')).toBe('(if Alpha then Beta, otherwise Gamma) times 2');
    expect(words('SAFEDIV(a + b, c, 1)')).toBe('(Alpha plus Beta) divided by Gamma (1 if zero)');
    expect(words('SAFEDIV(a, b * c)')).toBe('Alpha divided by (Beta times Gamma) (0 if zero)');
    expect(words('MIN(a, b)')).toBe('the smaller of Alpha and Beta');
    expect(words('MAX(a, b - c, 0)')).toBe('the largest of Alpha, (Beta minus Gamma) and 0');
    expect(words('MIN(a, b, c)')).toBe('the smallest of Alpha, Beta and Gamma');
    expect(words('MAX(a, b)')).toBe('the larger of Alpha and Beta');
    expect(words('MAX(a)')).toBe('Alpha');
    expect(words('ABS(a - b)')).toBe('the absolute value of (Alpha minus Beta)');
    expect(words('AND(a > 0, OR(b > 0, c > 0))')).toBe(
      'Alpha is greater than 0 and (Beta is greater than 0 or Gamma is greater than 0)',
    );
    expect(words('AND()')).toBe('true');
    expect(words('OR()')).toBe('false');
    expect(words('OR(a)')).toBe('Alpha');
    expect(words('NOT(a)')).toBe('not Alpha');
    expect(words('NOT(a > b)')).toBe('not (Alpha is greater than Beta)');
  });

  it('aggregates, bound variables, attributes and literal indices read with dimension and member labels', () => {
    expect(words("SUM(l in line where l.pool == 'p1', amt[l])")).toBe(
      'the sum of Amount over Cost line where pool of Cost line equals Pool one',
    );
    expect(words("SUM(l in line where l.pool == 'p2', amt[l])")).toBe(
      "the sum of Amount over Cost line where pool of Cost line equals 'p2'",
    );
    expect(words('COUNT(l in line where l.flag == 1)')).toBe(
      'the number of Cost line where flag of Cost line equals 1',
    );
    expect(words('MAXOVER(l in line, amt[l] * l.weight)')).toBe(
      'the maximum of Amount times weight of Cost line over Cost line',
    );
    expect(words('MINOVER(l in line, IF(amt[l] > 0, amt[l], 0))')).toBe(
      'the minimum of (if Amount is greater than 0 then Amount, otherwise 0) over Cost line',
    );
    expect(words('SUM(l in line, amt[l]) * 2')).toBe('(the sum of Amount over Cost line) times 2');
    expect(words("amt['l1'] - amt['zz']")).toBe('Amount (First line) minus Amount (zz)');
    expect(words('SUM(l in line, share[l.pool])')).toBe(
      'the sum of Share (pool of Cost line) over Cost line',
    );
    // A node over `line`: `line` is bound; `line.amt` is a symbol (S10), `line.weight` an attribute.
    expect(words('amt * line.weight + line.amt', ['line'])).toBe(
      'Amount times weight of Cost line plus Line amount',
    );
    expect(words("IF(line == 'l1', 1, 0)", ['line'])).toBe(
      'if Cost line equals First line then 1, otherwise 0',
    );
    expect(words("'l1' == line", ['line'])).toBe('First line equals Cost line');
    // Unlabelled dimension: its id.
    expect(words('SUM(x in other, a)')).toBe('the sum of Alpha over other');
  });
});

describe('explain on small models (explain.spec.ts)', () => {
  const variables = ['x', 'y', 'z', 'm'].map((id) => ({ id }));
  const compileOf = (nodes: Parameters<typeof bundleOf>[0]['nodes']) =>
    compileModel(
      bundleOf({ variables: [...variables, { id: 'w', dims: ['d'] }], nodes }),
      membersOf({ d: ['p', 'q'] }),
    );

  it('pins: a pinned cell drives, what is under it does not, and a pinned target has no drivers', () => {
    const model = compileOf([
      { id: 'p', expr: 'x * 3' },
      { id: 'q', expr: 'y * x' },
      { id: 'r', expr: 'p + q' },
    ]);
    const ev = model.evaluate(
      new Map([
        ['x', 2],
        ['y', 5],
      ]),
      new Map([['p', 10]]),
    );
    expect(localSensitivities(model, 'r', ev).map((s) => s.cell)).toEqual(['p', 'y', 'x']);
    const ex = model.explain('r', ev);
    expect(ex.value).toBe(20);
    expect(ex.drivers.map((d) => [d.cell, d.kind, d.derivative])).toEqual([
      ['p', 'node', 1],
      ['y', 'input', 2],
      ['x', 'input', 5],
    ]);
    expect(ex.drivers.map((d) => d.sensitivity)).toEqual([10, 10, 10]);
    expect(ex.drivers[0]!.elasticity).toBe(0.5);
    const pinned = model.explain('p', ev);
    expect([pinned.pinned, pinned.value, pinned.drivers]).toEqual([true, 10, []]);
    expect(pinned.inputs).toEqual([
      { cell: 'x', id: 'x', kind: 'input', label: 'x', unit: '', value: 2 },
    ]);
  });

  it('a step that makes a "/" by zero reachable gives no driver; zero values and zero cells', () => {
    const model = compileOf([
      { id: 'd', expr: 'IF(x > 1, 1 / (y - 3), 0) + z * m' },
      { id: 'e', expr: 'z - z' },
    ]);
    // x = 1 exactly: the step takes the IF branch, which divides by y - 3 = 0.
    const ev = model.evaluate(
      new Map([
        ['x', 1],
        ['y', 3],
        ['z', 0],
        ['m', 4],
      ]),
    );
    const all = localSensitivities(model, 'd', ev);
    expect(all.map((s) => [s.cell, s.derivative])).toEqual([
      ['x', Number.NaN],
      ['y', 0],
      ['z', 4],
      ['m', 0],
    ]);
    // z has a derivative but z = 0, so its sensitivity is 0: not a driver. Nothing else drives.
    expect(model.explain('d', ev).drivers).toEqual([]);
    // A cell that is 0 has no elasticity.
    const ev2 = model.evaluate(
      new Map([
        ['x', 0],
        ['y', 3],
        ['z', 2],
        ['m', 4],
      ]),
    );
    expect(
      model.explain('d', ev2).drivers.map((d) => [d.cell, d.sensitivity, d.elasticity]),
    ).toEqual([
      ['z', 8, 1],
      ['m', 8, 1],
    ]);
    expect(model.explain('e', ev2)).toMatchObject({ value: 0, drivers: [] });
  });

  it('a missing input in an untaken branch is no candidate; equal sensitivities keep upstream order', () => {
    const model = compileOf([
      { id: 'a', expr: 'x + y' },
      { id: 'r', expr: 'IF(z, m, a)' },
    ]);
    const ev = model.evaluate(
      new Map([
        ['x', 1],
        ['y', 1],
        ['z', 0],
      ]),
    );
    expect(localSensitivities(model, 'r', ev).map((s) => s.cell)).toEqual(['z', 'x', 'y']);
    expect(model.explain('r', ev).drivers.map((d) => d.cell)).toEqual(['x', 'y']);
    expect(model.explain('r', ev).inputs).toEqual([
      { cell: 'z', id: 'z', kind: 'input', label: 'z', unit: '', value: 0 },
      { cell: 'm', id: 'm', kind: 'input', label: 'm', unit: '' },
      { cell: 'a', id: 'a', kind: 'node', label: 'a', unit: '', value: 2 },
    ]);
  });

  it('explains inputs (also unread ones) and the chosen case; other keys are UNKNOWN_CELL', () => {
    const model = compileOf([
      {
        id: 'a',
        dims: ['d'],
        members: { d: ['p'] },
        cases: [{ when: { d: ['p'] }, expr: 'w * 2' }],
        expr: 'w',
      },
      { id: 'b', expr: "IF(x, a['q'], a['p'])" },
    ]);
    const ev = model.evaluate(
      new Map([
        ['w[p]', 3],
        ['w[q]', 4],
        ['x', 0],
      ]),
    );
    expect(model.explain('a[p]', ev)).toMatchObject({
      expression: 'w * 2',
      words: 'w times 2',
      value: 6,
    });
    expect(model.explain('x', ev)).toEqual({
      cell: 'x',
      id: 'x',
      kind: 'input',
      label: 'x',
      unit: '',
      value: 0,
      expression: null,
      pinned: false,
      inputs: [],
      words: 'Input: x',
      drivers: [],
    });
    // w[q] and y are inputs no formula reads.
    expect(model.explain('w[q]', ev)).toMatchObject({ kind: 'input', value: 4, inputs: [] });
    expect(model.explain('y', ev)).not.toHaveProperty('value');
    // a[q] is a dangling key (subset gap): no cell to explain.
    expect(model.explain('b').inputs.map((r) => [r.cell, r.kind])).toEqual([
      ['x', 'input'],
      ['a[q]', 'node'],
      ['a[p]', 'node'],
    ]);
    expect(model.explain('b', ev).inputs[1]).not.toHaveProperty('value');
    const err = (() => {
      try {
        model.explain('a[q]');
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe('UNKNOWN_CELL');
    expect((err as EngineError).message).toBe('no cell (dangling key) a[q]');
    expect(() => model.explain('nope')).toThrow('unknown cell nope');
    expect(() => localSensitivities(model, 'x', ev)).toThrow(/x is not a node cell/);
  });
});
