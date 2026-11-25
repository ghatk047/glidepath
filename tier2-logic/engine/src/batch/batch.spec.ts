/**
 * ENG-08 acceptance: `evaluateBatch(base, vectors)` runs the downstream closure of the varied inputs in
 * structure-of-arrays form, each lane bitwise equal to a scalar `evaluate`, with IF as a per-lane select
 * and errors per lane.
 */
import type { VariableDef } from '@glidepath/spec';
import { describe, expect, it } from 'vitest';
import { bundleOf, loadSeedModel, membersOf, readRepoJson } from '../../test/helpers';
import { compileModel, type EngineModel } from '../compile';
import { EngineError } from '../errors';
import { findScenario, float64Bits, resolveInputs, type SlotEvaluation } from '../eval';
import type { BatchInput, CellKey, Evaluation } from '../types';
import { LANE_BLOCK } from './batch';

const SEED = 0x5eed_0008;
const LANES = 200;
const PINNED_LANES = 50;
/** Registry bounds missing: draw within ± this share of the base value. */
const SPREAD = 0.5;
/** Each lane runs a full scalar evaluate as the oracle. */
const PROPERTY_TIMEOUT_MS = 60_000;
/** Acceptance tolerance; the test asserts bitwise equality, which implies it. */
const REL = 1e-12;

/** mulberry32: a small seeded PRNG, uniform in [0, 1). */
function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Outcome = { ok: SlotEvaluation; err?: undefined } | { ok?: undefined; err: EngineError };

function outcome(f: () => SlotEvaluation): Outcome {
  try {
    return { ok: f() };
  } catch (e) {
    if (e instanceof EngineError) return { err: e };
    throw e;
  }
}

/** Lane `i` of a batch as plain inputs: the base inputs with the lane's values applied. */
function laneValues(base: Evaluation, input: BatchInput, i: number): Map<CellKey, number> {
  const values = new Map(base.values);
  for (const [k, v] of input.values) values.set(k, v[i]!);
  return values;
}

/** Same error as far as a caller can tell: code, cell, message, position. */
function errorShape(e: EngineError) {
  return { code: e.code, cell: e.cell, message: e.message, pos: e.pos, source: e.source };
}

/**
 * Checks every lane of `evaluateBatch(base, input)` against a scalar `evaluate` of that lane: bitwise
 * equal values (closure cells; every other cell must equal the base), or the same error. Returns how
 * many lanes failed.
 */
function checkLanes(model: EngineModel, base: SlotEvaluation, input: BatchInput): number {
  const batch = model.evaluateBatch(base, input);
  const p = model.program;
  let failures = 0;
  for (let i = 0; i < input.size; i++) {
    const scalar = outcome(() => model.evaluate(laneValues(base, input, i), base.overrides));
    if (scalar.err !== undefined) {
      failures++;
      expect(batch.failed[i], `lane ${i} failed`).toBe(1);
      expect(errorShape(batch.errors.get(i)!), `lane ${i} error`).toEqual(errorShape(scalar.err));
      for (const v of batch.values.values()) expect(v[i]).toBeNaN();
      continue;
    }
    expect(batch.failed[i], `lane ${i} ok`).toBe(0);
    expect(batch.errors.has(i)).toBe(false);
    const ev = scalar.ok;
    for (let c = 0; c < p.nCells; c++) {
      const key = p.cellKeys[c]!;
      const lanes = batch.values.get(key);
      const got = lanes === undefined ? base.slots[c]! : lanes[i]!;
      const want = ev.slots[c]!;
      // NaN sign and payload are not deterministic in V8 (x86's default NaN is negative; constant
      // folding gives a positive one), not even between two scalar runs: every NaN is one value.
      if (Number.isNaN(got) && Number.isNaN(want)) continue;
      if (float64Bits(got) !== float64Bits(want)) {
        // Report through the acceptance tolerance first, then insist on bits.
        const scale = Math.max(Math.abs(want), Number.MIN_VALUE);
        expect(Math.abs(got - want) / scale, `${key} lane ${i}`).toBeLessThanOrEqual(REL);
        expect(float64Bits(got), `${key} lane ${i} bits`).toBe(float64Bits(want));
      }
    }
  }
  expect(batch.failed.reduce((s, f) => s + f, 0)).toBe(failures);
  expect(batch.errors.size).toBe(failures);
  return failures;
}

/** Input cells of `ids` that the model reads, in program order. */
function inputCellsOf(model: EngineModel, test: (id: string) => boolean): CellKey[] {
  return model.program.inputKeys.filter((k) => test(k.split('[')[0]!));
}

describe('evaluateBatch (03 §1 Modes, Batch) on the seed tenant', async () => {
  const { bundle, seed } = await loadSeedModel();
  const model = compileModel(bundle, seed.dimensionMembers);
  const variables = new Map<string, VariableDef>(bundle.variables.map((v) => [v.id, v]));
  const plain = resolveInputs(bundle, seed.variableValues, findScenario(seed.scenarios, 'C'));
  const base = model.evaluate(plain.values, plain.overrides);
  const report = readRepoJson<{ parity_overrides: Record<string, number> }>(
    'docs/spec/reference/parity_report.json',
  );
  const parity = resolveInputs(bundle, seed.variableValues, findScenario(seed.scenarios, 'C'), {
    overrides: report.parity_overrides,
    values: { 'corp.it_swb_mode': 0 },
  });
  const pinnedBase = model.evaluate(parity.values, parity.overrides);

  /** N random lanes over `cells`, within registry bounds (± SPREAD of the base value when unbounded). */
  function draw(
    cells: readonly CellKey[],
    at: Evaluation,
    n: number,
    rng: () => number,
  ): BatchInput {
    const values = new Map<CellKey, Float64Array>();
    for (const cell of cells) {
      const v = variables.get(cell.split('[')[0]!)!;
      const x = at.get(cell);
      const lo = v.min ?? x - SPREAD * Math.abs(x);
      const hi = v.max ?? x + SPREAD * Math.abs(x);
      const lanes = new Float64Array(n);
      for (let i = 0; i < n; i++) lanes[i] = lo + (hi - lo) * rng();
      values.set(cell, lanes);
    }
    return { size: n, values };
  }

  it('evaluateBatch computes only the downstream closure of the varied inputs in Float64Array(N) per slot', () => {
    const realize = inputCellsOf(model, (id) => id === 'lev.realize');
    expect(realize.length).toBeGreaterThan(0);
    const input = draw(realize, base, LANES, rngOf(SEED));
    const batch = model.evaluateBatch(base, input);

    const closure = new Set(realize.flatMap((k) => model.downstream(k)));
    const expected = model.program.cellKeys.filter((k) => closure.has(k));
    expect([...batch.values.keys()]).toEqual(expected);
    expect(batch.diagnostics.computed).toEqual(expected);
    expect(expected.length).toBeLessThan(model.program.nCells);
    for (const lanes of batch.values.values()) {
      expect(lanes).toBeInstanceOf(Float64Array);
      expect(lanes.length).toBe(LANES);
    }
    expect(batch.values.has('res.net')).toBe(true);
    expect(batch.size).toBe(LANES);
    expect(batch.failed).toEqual(new Uint8Array(LANES));

    // A pin cuts the closure: the pinned cell and what only it feeds keep the base value.
    const pinned = [...pinnedBase.overrides.keys()];
    const cut = model.evaluateBatch(pinnedBase, input);
    for (const k of pinned) expect(cut.values.has(k)).toBe(false);
    expect(cut.values.size).toBeLessThanOrEqual(batch.values.size);
  });

  it(
    'each lane equals scalar evaluate within 1e-12 relative for 200 seeded random vectors',
    () => {
      const rng = rngOf(SEED + 1);
      // Every lever input and pool growth: realisation, start, ramp, confidence, intensities.
      const cells = inputCellsOf(
        model,
        (id) => id.startsWith('lev.') || id === 'pool.growth',
      ).filter((k) => variables.get(k.split('[')[0]!)!.type === 'number');
      expect(cells.length).toBeGreaterThan(LANE_BLOCK / 8);
      checkLanes(model, base, draw(cells, base, LANES, rng));
      // With pins in the base (the parity overrides).
      checkLanes(model, pinnedBase, draw(cells, pinnedBase, PINNED_LANES, rng));
    },
    PROPERTY_TIMEOUT_MS,
  );
});

describe('evaluateBatch lanes, masks and errors', () => {
  const vars = ['x', 'y', 'z', 'n', 'f'].map((id) => ({ id }));
  type Nodes = Parameters<typeof bundleOf>[0]['nodes'];

  function modelOf(nodes: Nodes, members: Parameters<typeof membersOf>[0] = {}, variables = vars) {
    return compileModel(bundleOf({ variables, nodes }), membersOf(members));
  }

  const lanes = (xs: number[]) => Float64Array.from(xs);
  const batchOf = (values: Record<string, number[]>): BatchInput => {
    const entries = Object.entries(values);
    return {
      size: entries[0]![1].length,
      values: new Map(entries.map(([k, v]) => [k, lanes(v)])),
    };
  };

  it('IF is an elementwise select; an error in a non-taken branch does not poison a lane, a taken-branch division by zero marks that lane failed', () => {
    const model = modelOf([
      // Guarded: lanes with x == 0 take the else branch and never divide.
      { id: 'g', expr: 'IF(x != 0, 1 / x, -1)' },
      // Unguarded on y: lanes with y > 0 divide by x.
      { id: 'h', expr: 'IF(y > 0, 10 / x, y)' },
      { id: 'u', expr: 'g + h' },
      // Not downstream of x or y.
      { id: 'k', expr: 'z * 2' },
    ]);
    const base = model.evaluate(
      new Map([
        ['x', 2],
        ['y', 1],
        ['z', 3],
      ]),
    );
    const input = batchOf({ x: [0, 4, 0, -2, 0], y: [-1, 1, 1, 0, 0] });
    const batch = model.evaluateBatch(base, input);

    expect([...batch.values.keys()]).toEqual(['g', 'h', 'u']);
    // Lane 0: x = 0, guard false → g = -1 (no error); y ≤ 0 → h = y.
    expect(batch.values.get('g')![0]).toBe(-1);
    expect(batch.values.get('h')![0]).toBe(-1);
    // Lane 1: both divide.
    expect(batch.values.get('g')![1]).toBe(0.25);
    expect(batch.values.get('h')![1]).toBe(2.5);
    // Lane 2: x = 0 and y > 0: the taken branch of h divides by zero → this lane only fails.
    expect([...batch.failed]).toEqual([0, 0, 1, 0, 0]);
    for (const v of batch.values.values()) expect(v[2]).toBeNaN();
    const err = batch.errors.get(2)!;
    expect(err).toBeInstanceOf(EngineError);
    expect(err.code).toBe('DIV_ZERO');
    expect(err.cell).toBe('h');
    expect(err.pos).toBe('IF(y > 0, 10 / x, y)'.indexOf('/'));
    // Lanes 3 and 4 each take their own path.
    expect(batch.values.get('u')![3]).toBe(-0.5 + 0);
    expect(batch.values.get('u')![4]).toBe(-1 + 0);
    expect(batch.values.has('k')).toBe(false);
    // Same as the scalar engine, lane by lane.
    checkLanes(model, base, input);
  });

  it('SAFEDIV, nested IF, lists, aggregates and pow match scalar evaluate lane by lane, errors included', () => {
    const model = modelOf(
      [
        { id: 'a', expr: 'SAFEDIV(x, y, z) + SAFEDIV(z, x)' },
        { id: 'b', expr: 'IF(x > 0, IF(y > 0, x / y, y ^ 0.5), IF(z == 0, 0, -x / z))' },
        { id: 'c', expr: 'MIN(x, y, z) - MAX(x, y) + ABS(z) - NOT(x) + AND(x, y) + OR(z, 0)' },
        { id: 'd', expr: 'x ^ y' },
        { id: 'e', dims: ['m'], expr: 'f * x' },
        { id: 's', expr: 'SUM(u in m, e[u]) + MAXOVER(u in m, e[u]) - MINOVER(u in m, e[u])' },
        { id: 't', expr: '-a + b * c - (d == 1) + (d != 1) + (d < 1) + (d <= 1) + (d >= 1) + s' },
      ],
      { m: ['m1', 'm2', 'm3'] },
      [
        ...vars.filter((v) => v.id !== 'f'),
        { id: 'f', dims: ['m'] } as { id: string; dims?: string[] },
      ],
    );
    const base = model.evaluate(
      new Map([
        ['x', 1],
        ['y', 2],
        ['z', 3],
        ['f[m1]', 0.1],
        ['f[m2]', 1e16],
        ['f[m3]', -1e16],
      ]),
    );
    const rng = rngOf(SEED + 2);
    const pick = [0, -0, 1, -1, 2, -2.5, 0.5, NaN, Infinity, 1e308];
    const n = LANE_BLOCK * 2 + 37; // several blocks, the last partial
    const values = new Map<CellKey, Float64Array>();
    for (const k of ['x', 'y', 'z', 'f[m2]']) {
      const v = new Float64Array(n);
      for (let i = 0; i < n; i++) v[i] = pick[Math.floor(rng() * pick.length)]!;
      values.set(k, v);
    }
    const failures = checkLanes(model, base, { size: n, values });
    expect(failures).toBeGreaterThan(0);
    expect(failures).toBeLessThan(n);
  });

  it('a lane fails with MISSING where it reads a missing input or dangling key, and only there', () => {
    const model = modelOf(
      [
        { id: 'a', dims: ['d'], members: { d: ['p'] }, expr: '1' },
        { id: 'r', expr: 'IF(x > 0, y, 1)' },
        { id: 'q', expr: "IF(x < 0, a['q'], 2)" },
      ],
      { d: ['p', 'q'] },
    );
    expect(model.diagnostics.dangling).toEqual(['a[q]']);
    const base = model.evaluate(new Map([['x', 0]]));
    const input = batchOf({ x: [0, 1, -1] });
    const batch = model.evaluateBatch(base, input);
    expect([...batch.failed]).toEqual([0, 1, 1]);
    expect(batch.errors.get(1)!.code).toBe('MISSING');
    expect(batch.errors.get(1)!.cell).toBe('r');
    expect(batch.errors.get(2)!.cell).toBe('q');
    checkLanes(model, base, input);
    // A varied input counts as provided in every lane.
    const withY = model.evaluateBatch(base, batchOf({ x: [1, 1], y: [5, 6] }));
    expect(withY.values.get('r')).toEqual(lanes([5, 6]));
  });

  it('every lane may fail, and lanes keep failing independently across blocks', () => {
    const model = modelOf([
      { id: 'r', expr: '1 / x' },
      { id: 's', expr: 'r + 1' },
    ]);
    const base = model.evaluate(new Map([['x', 1]]));
    const n = LANE_BLOCK + 3;
    const x = new Float64Array(n).fill(0);
    x[LANE_BLOCK + 1] = 4;
    const batch = model.evaluateBatch(base, { size: n, values: new Map([['x', x]]) });
    expect(batch.errors.size).toBe(n - 1);
    expect(batch.values.get('s')![LANE_BLOCK + 1]).toBe(1.25);
    const zeros = model.evaluateBatch(base, { size: 2, values: new Map([['x', lanes([0, 0])]]) });
    expect([...zeros.failed]).toEqual([1, 1]);
  });

  it('rejects a bad request and ignores keys the model does not read', () => {
    const model = modelOf([{ id: 'r', expr: 'x + 1' }]);
    const base = model.evaluate(new Map([['x', 1]]));
    const codeOf = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as EngineError).code;
      }
      return 'none';
    };
    expect(codeOf(() => model.evaluateBatch(base, { size: -1, values: new Map() }))).toBe(
      'BAD_INPUT',
    );
    expect(codeOf(() => model.evaluateBatch(base, { size: 1.5, values: new Map() }))).toBe(
      'BAD_INPUT',
    );
    expect(codeOf(() => model.evaluateBatch(base, batchOf({ r: [1] })))).toBe('BAD_INPUT');
    expect(
      codeOf(() => model.evaluateBatch(base, { size: 2, values: new Map([['x', lanes([1])]]) })),
    ).toBe('BAD_INPUT');

    const ignored = model.evaluateBatch(base, batchOf({ zz: [1, 2], y: [3, 4] }));
    expect(ignored.diagnostics.ignored).toEqual(['zz', 'y']);
    expect(ignored.values.size).toBe(0);

    const empty = model.evaluateBatch(base, { size: 0, values: new Map([['x', lanes([])]]) });
    expect(empty.values.get('r')).toEqual(lanes([]));
  });

  it('takes any Evaluation as the base: one of another model is evaluated first', () => {
    const model = modelOf([{ id: 'r', expr: 'x * y' }]);
    const other = modelOf([{ id: 'r', expr: 'x * y' }]);
    const base = other.evaluate(
      new Map([
        ['x', 2],
        ['y', 3],
      ]),
    );
    const batch = model.evaluateBatch(base, batchOf({ x: [1, 5] }));
    expect(batch.values.get('r')).toEqual(lanes([3, 15]));
    // A pinned cell is not in the closure; its users read the pin.
    const pinnedModel = modelOf([
      { id: 'r', expr: 'x * y' },
      { id: 'w', expr: 'r + x' },
    ]);
    const pinned = pinnedModel.evaluate(
      new Map([
        ['x', 2],
        ['y', 3],
      ]),
      new Map([['r', 100]]),
    );
    const cut = pinnedModel.evaluateBatch(pinned, batchOf({ y: [1, 5] }));
    expect(cut.values.size).toBe(0);
    const through = pinnedModel.evaluateBatch(pinned, batchOf({ x: [1, 5] }));
    expect([...through.values.keys()]).toEqual(['w']);
    expect(through.values.get('w')).toEqual(lanes([101, 105]));
  });
});
