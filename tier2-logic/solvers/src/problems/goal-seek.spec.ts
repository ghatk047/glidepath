/**
 * SOL-02 acceptance 2–4 on the seed tenant (preset C): goal seek agrees with a bisection oracle; breakeven has one row
 * per lever-intensity input; goal seek < 1 s and breakeven < 2 s. Plus parameter checks, abort, progress.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readRepoJson, seedModel } from '../../test/helpers';
import { decisionSet, type DecisionVariable } from '../decision-sets';
import { breakeven, goalSeek } from '../goal-seek';
import type { SolverModel } from '../model';
import { BREAKEVEN_OUTPUT, BREAKEVEN_TARGET } from './goal-seek';

const OUTPUT = 'res.gap';
/** Wider test bounds: registry min + this many registry ranges, so some single levers can close the C gap. */
const WIDEN = 4;
/** 03 §3: breakeven < 2 s (solvers.json has no breakeven target). */
const BREAKEVEN_BUDGET_MS = 2000;

let model: SolverModel;
let levers: DecisionVariable[];
beforeAll(async () => {
  model = await seedModel('C');
  levers = decisionSet(model, 'lever_intensity');
});

const noYield = () => Promise.resolve();
const outputAt = (cell: string, x: number): number =>
  model.compiled.rerun(model.base, [{ target: 'variable', cell, value: x }]).get(OUTPUT);

/** Scalar bisection oracle on [lo, hi] for output = target; null when the ends do not bracket it. */
function bisect(cell: string, lo: number, hi: number, target: number, tol: number): number | null {
  let flo = outputAt(cell, lo) - target;
  const fhi = outputAt(cell, hi) - target;
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (Math.sign(flo) === Math.sign(fhi)) return null;
  while (hi - lo > tol) {
    const mid = (lo + hi) / 2;
    const fm = outputAt(cell, mid) - target;
    if (fm === 0) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

describe("SOL-02 seed tenant, preset C: goal seek of one lever-intensity input on res.gap = 0 agrees with a bisection oracle within the input's registry step", () => {
  it('matches the oracle on every lever-intensity input whose widened range brackets res.gap = 0', async () => {
    let compared = 0;
    for (const d of levers) {
      const lo = d.min!;
      const hi = d.min! + WIDEN * (d.max! - d.min!);
      const oracle = bisect(d.cell, lo, hi, 0, d.step! / 8);
      if (oracle === null) continue;
      const r = await goalSeek(model, { var: d.cell, output: OUTPUT, target: 0, bounds: [lo, hi] }, { yield: noYield });
      expect(r.status, d.cell).toBe('optimal');
      expect(r.detail!.reachable).toBe(true);
      expect(Math.abs(r.detail!.value - oracle), d.cell).toBeLessThanOrEqual(d.step!);
      expect(Math.abs(r.detail!.output)).toBeLessThan(1e-6);
      expect(r.changes).toEqual([{ target: 'variable', cell: d.cell, value: r.detail!.value }]);
      expect(r.ranked).toHaveLength(1);
      expect(r.ranked[0]!.impact).toBeCloseTo(-model.base.get(OUTPUT), 6);
      expect(r.metrics).toMatchObject({ [OUTPUT]: r.detail!.output, target: 0 });
      compared += 1;
    }
    expect(compared).toBeGreaterThanOrEqual(5);
  });

  it('within the registry range (default bounds) no single lever closes the C gap: unreachable with the closest value', async () => {
    const d = levers.find((l) => l.cell === 'lev.L10.rcut')!;
    const r = await goalSeek(model, { var: d.cell, output: OUTPUT, target: 0 }, { yield: noYield });
    expect(r.status).toBe('unreachable');
    expect(r.detail).toMatchObject({ value: d.max, reachable: false });
    expect(r.detail!.output).toBeCloseTo(outputAt(d.cell, d.max!), 9);
    expect(r.changes).toEqual([{ target: 'variable', cell: d.cell, value: d.max }]);
  });

  it('solves any output and target, and returns no change when the start value already solves it', async () => {
    const d = levers[0]!;
    const r = await goalSeek(model, { var: d.cell, output: 'res.net', target: model.base.get('res.net'), bounds: [d.value, d.max!] });
    expect(r.status).toBe('optimal');
    expect(r.changes).toEqual([]);
    expect(r.ranked).toEqual([]);
  });

  it('rejects bad parameters with BAD_PARAMS', async () => {
    const d = levers[0]!;
    const bad = (params: unknown) => goalSeek(model, params as never);
    await expect(bad(undefined)).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(bad({ var: 'nope', output: OUTPUT, target: 0 })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(bad({ var: OUTPUT, output: OUTPUT, target: 0 })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(bad({ var: d.cell, output: 'res.nope', target: 0 })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(bad({ var: d.cell, output: OUTPUT, target: Number.NaN })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(bad({ var: d.cell, output: OUTPUT, target: 0, bounds: [1, 0] })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(bad({ var: d.cell, output: OUTPUT, target: 0, bounds: [0, Infinity] })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    const unbounded = model.bundle.variables.find((v) => (v.min === null || v.max === null) && v.dims.length === 0 && model.base.values.has(v.id));
    if (unbounded !== undefined) {
      await expect(bad({ var: unbounded.id, output: OUTPUT, target: 0 })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    }
  });
});

describe('SOL-02 breakeven: one row per lever-intensity input with current, needed, feasible? (rows = decision set size)', () => {
  it('defaults to res.gap = 0 over the lever_intensity set: one row per input, in set order', async () => {
    expect(BREAKEVEN_OUTPUT).toBe('res.gap');
    expect(BREAKEVEN_TARGET).toBe(0);
    const r = await breakeven(model, {}, { yield: noYield });
    const rows = r.detail!.rows;
    expect(rows).toHaveLength(levers.length);
    expect(rows.map((x) => x.cell)).toEqual(levers.map((d) => d.cell));
    rows.forEach((row, i) => {
      const d = levers[i]!;
      expect(row).toMatchObject({ current: d.value, min: d.lo, max: d.hi });
      expect(typeof row.feasible).toBe('boolean');
      if (row.needed !== null) expect(Math.abs(outputAt(row.cell, row.needed))).toBeLessThan(1e-6);
    });
    expect(r.changes).toEqual([]);
    expect(r.metrics).toMatchObject({ rows: levers.length, target: 0 });
    // At C (gap ≈ −$23.7M) no lever alone closes the gap within its stretch range.
    expect(r.status).toBe(rows.some((x) => x.feasible) ? 'optimal' : 'unreachable');
  });

  it('needed is feasible inside the decision range, not feasible inside the registry range only, null otherwise', async () => {
    // A target between the C gap and zero: some levers reach it within range, some only beyond it.
    const target = model.base.get(OUTPUT) + 3;
    const r = await breakeven(model, { target }, { yield: noYield });
    const rows = r.detail!.rows;
    expect(rows).toHaveLength(levers.length);
    let feasible = 0;
    let beyond = 0;
    let none = 0;
    rows.forEach((row, i) => {
      const d = levers[i]!;
      if (row.needed === null) {
        none += 1;
        expect(row.feasible).toBe(false);
        return;
      }
      expect(outputAt(row.cell, row.needed)).toBeCloseTo(target, 6);
      if (row.feasible) {
        feasible += 1;
        expect(row.needed).toBeGreaterThanOrEqual(d.lo);
        expect(row.needed).toBeLessThanOrEqual(d.hi);
      } else {
        beyond += 1;
        expect(row.needed).toBeGreaterThanOrEqual(d.min!);
        expect(row.needed).toBeLessThanOrEqual(d.max!);
      }
    });
    expect(feasible).toBeGreaterThan(0);
    expect(none).toBeGreaterThan(0);
    expect(feasible + beyond + none).toBe(levers.length);
    expect(r.status).toBe('optimal');
    expect(r.metrics.feasible).toBe(feasible);
  });

  it('SRC-18: a row not feasible reports its best value in range and the output there; feasible rows none', async () => {
    const r = await breakeven(model, {}, { yield: noYield });
    const rows = r.detail!.rows;
    expect(rows.some((x) => !x.feasible)).toBe(true);
    rows.forEach((row, i) => {
      const d = levers[i]!;
      if (row.feasible) {
        expect(row.best).toBeNull();
        expect(row.bestOutput).toBeNull();
        return;
      }
      // The closest value the decision range holds, and the gap it leaves (the engine's output there).
      expect(row.best).not.toBeNull();
      expect(row.best!).toBeGreaterThanOrEqual(d.lo);
      expect(row.best!).toBeLessThanOrEqual(d.hi);
      expect(row.bestOutput!).toBeCloseTo(outputAt(row.cell, row.best!), 9);
      // No value of the range comes closer to the target than the best one (a coarse check on the ends).
      const dist = (x: number) => Math.abs(outputAt(row.cell, x) - BREAKEVEN_TARGET);
      expect(Math.abs(row.bestOutput! - BREAKEVEN_TARGET)).toBeLessThanOrEqual(Math.min(dist(d.lo), dist(d.hi)) + 1e-9);
    });
  });

  it('takes explicit inputs, inside or outside the set (registry range), and rejects bad ones', async () => {
    const estimate = model.bundle.variables.find(
      (v) => v.id.startsWith('lev.L') && v.kind === 'estimate' && v.dims.length === 0 && v.min !== null && v.max !== null,
    );
    const inputs = [levers[0]!.cell, ...(estimate === undefined ? [] : [estimate.id])];
    const r = await breakeven(model, { inputs, output: 'res.net', target: model.base.get('res.net') + 1 }, { yield: noYield });
    expect(r.detail!.rows.map((x) => x.cell)).toEqual(inputs);
    if (estimate !== undefined) expect(r.detail!.rows[1]).toMatchObject({ min: estimate.min, max: estimate.max });
    await expect(breakeven(model, { inputs: [] })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(breakeven(model, { inputs: ['res.net'] })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(breakeven(model, { output: 'res.nope' })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
  });

  it('reports progress and stops on abort with the rows found so far', async () => {
    const notes: number[] = [];
    const done = await breakeven(model, {}, { yield: noYield, progressIntervalMs: 0, progress: (f) => notes.push(f) });
    expect(notes.at(-1)).toBe(1);
    expect(done.status).not.toBe('cancelled');

    const ac = new AbortController();
    let batches = 0;
    const r = await breakeven(model, {}, {
      signal: ac.signal,
      yield: () => {
        batches += 1;
        if (batches === 2) ac.abort();
        return Promise.resolve();
      },
    });
    expect(r.status).toBe('cancelled');
    expect(r.detail!.rows).toHaveLength(levers.length);
    expect(r.diagnostics.iterations).toBe(1);
    expect(r.detail!.rows.every((x) => x.needed === null)).toBe(true);
  });
});

describe('SOL-02 perf: goal seek < 1 s, breakeven < 2 s on the seed tenant', () => {
  it('meets the budgets of solvers.json performance_targets.goal_seek_s and 03 §3', async () => {
    const targets = readRepoJson<{ performance_targets: { goal_seek_s: number } }>('docs/spec/solvers.json').performance_targets;
    const d = levers.find((l) => l.cell === 'lev.L10.rcut')!;
    const params = { var: d.cell, output: OUTPUT, target: 0, bounds: [d.min!, d.min! + WIDEN * (d.max! - d.min!)] as const };
    await goalSeek(model, params); // warm-up
    let t = performance.now();
    const g = await goalSeek(model, params);
    const goalMs = performance.now() - t;
    expect(g.status).toBe('optimal');
    expect(goalMs).toBeLessThan(targets.goal_seek_s * 1000);

    t = performance.now();
    const b = await breakeven(model);
    const breakevenMs = performance.now() - t;
    expect(b.detail!.rows).toHaveLength(levers.length);
    expect(breakevenMs).toBeLessThan(BREAKEVEN_BUDGET_MS);
  });
});
