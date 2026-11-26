/**
 * SOL-09 / SRC-12 acceptance on the seed tenant from preset C (reference decision bounds, as production
 * builds the model):
 * 1. the ε-constraint sweep over the solvers.json bar levels returns a monotone frontier: a higher bar never
 *    has lower risk exposure (feasible points);
 * 2. the point at the default bar (C's `res.bar`) equals `min_risk_mix`'s answer;
 * 3. every warm-started point equals a cold `min_risk_mix` with the bar moved there;
 * 4. progress per point and cancel (partial frontier); < 10 s.
 */
import { REFERENCE_DECISION_BOUNDS } from '@glidepath/spec';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedModel } from '../../test/helpers';
import { withDecisionBounds } from '../decision-sets';
import { minRiskMix } from '../min-risk';
import type { SolverModel } from '../model';
import { runSolver, type RunOptions } from '../run';
import type { ParetoParams, SolverResult } from '../types';
import { MAX_PARETO_POINTS, monotone, paretoBars, type ParetoPoint } from './pareto';
import { PARETO_DEFAULTS } from './pareto-defaults';

/** 04 §6: minimum-risk mix < 10 s; the whole sweep keeps to the same budget. */
const BUDGET_MS = 10_000;
const noYield = () => Promise.resolve();

let model: SolverModel;
let result: SolverResult<'pareto'>;
let ms: number;
let mix: SolverResult<'min_risk_mix'>;
let bar0: number;

const pareto = (params: ParetoParams = {}, options: RunOptions = { yield: noYield }) =>
  runSolver(model, { problem: 'pareto', params }, options);
const points = (r: SolverResult<'pareto'>): readonly ParetoPoint[] => r.detail!.points;

beforeAll(async () => {
  model = withDecisionBounds(await seedModel('C'), REFERENCE_DECISION_BOUNDS);
  bar0 = model.base.get('res.bar');
  const t0 = performance.now();
  result = await pareto();
  ms = performance.now() - t0;
  mix = await minRiskMix(model, {}, { yield: noYield });
}, 120_000);

describe('SRC-12 acceptance 1: a monotone frontier over the solvers.json bar levels', () => {
  it('visits from..to by step plus the default bar, ascending', () => {
    const { from, to, step } = PARETO_DEFAULTS.sweep;
    const grid = Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
    const bars = points(result).map((p) => p.bar);
    expect(bars).toEqual([...grid, bar0].sort((a, b) => a - b));
    expect(result.metrics.points).toBe(bars.length);
  });

  it('a higher bar never has lower risk exposure, nor lower net (feasible points)', () => {
    const feasible = points(result).filter((p) => p.feasible);
    expect(feasible.length).toBeGreaterThan(2);
    expect(result.metrics.feasible_points).toBe(feasible.length);
    for (let i = 1; i < feasible.length; i++) {
      expect(feasible[i]!.risk).toBeGreaterThanOrEqual(feasible[i - 1]!.risk);
      expect(feasible[i]!.net).toBeGreaterThanOrEqual(feasible[i - 1]!.net);
    }
    for (const p of feasible) expect(p.net).toBeGreaterThanOrEqual(p.bar - 1e-6);
    expect(result.metrics.monotone_conflicts).toBe(0);
  });

  it('bars above what full stretch reaches are infeasible, and stay so above', () => {
    const ps = points(result);
    const first = ps.findIndex((p) => !p.feasible);
    expect(first).toBeGreaterThan(0);
    for (const p of ps.slice(first)) {
      expect(p.feasible).toBe(false);
      expect(p.net).toBeLessThan(p.bar);
    }
  });

  it('every point moves decision cells only, and reports the plan it was measured at', () => {
    for (const p of points(result)) {
      const e = model.compiled.rerun(model.base, p.changes);
      expect(e.get('res.net')).toBeCloseTo(p.net, 9);
      expect(e.get('res.tot_ot_all')).toBeCloseTo(p.oneTime, 9);
    }
  });
});

describe('SRC-12 acceptance 2: the point at the default bar equals min_risk_mix', () => {
  it('same changes, net and risk exposure; the top-level result is that plan', () => {
    const at = points(result).find((p) => p.bar === bar0)!;
    expect(at.feasible).toBe(true);
    expect(at.changes).toEqual(mix.changes);
    expect(at.net).toBe(mix.metrics['res.net']);
    expect(at.risk).toBe(mix.metrics.risk_exposure);
    expect(result.status).toBe(mix.status);
    expect(result.changes).toEqual(mix.changes);
    expect(result.ranked).toEqual(mix.ranked);
    expect(result.binding).toEqual(mix.binding);
    expect(result.metrics['res.bar']).toBe(bar0);
  });
});

describe('SRC-12 acceptance 3: warm start = cold solve', () => {
  /** A cold min_risk_mix from C with `g.target_net` moved so that `res.bar` = bar. */
  async function cold(bar: number): Promise<SolverResult<'min_risk_mix'>> {
    const t = model.base.get('g.target_net');
    const base = model.compiled.rerun(model.base, [{ target: 'variable', cell: 'g.target_net', value: t + bar - bar0 }]);
    expect(base.get('res.bar')).toBeCloseTo(bar, 9);
    return minRiskMix({ ...model, base }, {}, { yield: noYield });
  }

  it.each([120, 135, 150, 160, 165])('bar %d', async (bar) => {
    const p = points(result).find((q) => q.bar === bar)!;
    const c = await cold(bar);
    expect(p.feasible).toBe(c.status === 'feasible');
    expect(p.changes).toEqual(c.changes);
    expect(p.risk).toBeCloseTo(c.metrics.risk_exposure!, 9);
  }, 30_000);
});

describe('SRC-12 acceptance 4: progress, cancel and budget', () => {
  it(`runs in < ${BUDGET_MS} ms`, () => {
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('reports progress per point, rising to 1', async () => {
    const reports: { f: number; note: string | undefined }[] = [];
    await pareto({ sweep: { from: 130, to: 150, step: 10 } }, {
      yield: noYield,
      progressIntervalMs: 0,
      progress: (f, note) => reports.push({ f, note }),
    });
    const perPoint = reports.filter((r) => /^bar .* \(\d+\/4\)$/.test(r.note ?? ''));
    expect(perPoint.map((r) => r.note!.replace(/^.*\((\d+)\/4\)$/, '$1'))).toEqual(['1', '2', '3', '4']);
    for (let i = 1; i < reports.length; i++) expect(reports[i]!.f).toBeGreaterThanOrEqual(reports[i - 1]!.f - 1e-12);
    expect(reports.at(-1)!.f).toBe(1);
  }, 30_000);

  it('cancels at the next batch with the frontier so far', async () => {
    const ac = new AbortController();
    const r = await pareto(
      {},
      {
        signal: ac.signal,
        yield: noYield,
        progressIntervalMs: 0,
        progress: (_f, note) => {
          if (note !== undefined && / \(3\/22\)$/.test(note)) ac.abort();
        },
      },
    );
    expect(r.status).toBe('cancelled');
    const got = points(r);
    expect(got.length).toBeGreaterThanOrEqual(3);
    expect(got.length).toBeLessThan(22);
    expect(r.changes).toEqual(mix.changes);
  }, 30_000);

  it('cancelled before the default-bar plan: no plan, no points', async () => {
    const ac = new AbortController();
    let batches = 0;
    const r = await pareto({}, {
      signal: ac.signal,
      yield: () => {
        batches += 1;
        if (batches === 3) ac.abort();
        return Promise.resolve();
      },
    });
    expect(r.status).toBe('cancelled');
    expect(r.changes).toEqual([]);
    expect(r.detail).toBeUndefined();
  });
});

describe('SRC-12 options and errors', () => {
  it('axis one_time minimises res.tot_ot_all; one-time cost never falls as the bar rises', async () => {
    const r = await pareto({ axis: 'one_time', sweep: { from: 120, to: 160, step: 10 } });
    const one = await minRiskMix(model, { objective: 'min_one_time' }, { yield: noYield });
    expect(r.changes).toEqual(one.changes);
    const feasible = points(r).filter((p) => p.feasible);
    expect(feasible.length).toBeGreaterThan(2);
    for (let i = 1; i < feasible.length; i++) expect(feasible[i]!.oneTime).toBeGreaterThanOrEqual(feasible[i - 1]!.oneTime - 1e-9);
  }, 30_000);

  it('production: the default-bar point equals min_risk_mix production', async () => {
    const r = await pareto({ method: 'production', sweep: { from: 140, to: 150, step: 10 } });
    const prod = await minRiskMix(model, { method: 'production' }, { yield: noYield });
    expect(r.changes).toEqual(prod.changes);
    expect(points(r).find((p) => p.bar === bar0)!.changes).toEqual(prod.changes);
    expect(r.diagnostics.seed).toBe(prod.diagnostics.seed);
  }, 30_000);

  it('rejects bad sweeps and axes', async () => {
    await expect(pareto({ sweep: { from: 100, to: 200, step: 0 } })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(pareto({ sweep: { from: 200, to: 100, step: 5 } })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(pareto({ sweep: { from: 0, to: MAX_PARETO_POINTS, step: 1 } })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(pareto({ axis: 'nope' as never })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
  });
});

describe('paretoBars and monotone', () => {
  it('inserts the default bar inside the range, replaces a grid point it equals, leaves it out outside', () => {
    expect(paretoBars({ from: 100, to: 110, step: 5 }, 107)).toEqual([100, 105, 107, 110]);
    expect(paretoBars({ from: 100, to: 110, step: 5 }, 105)).toEqual([100, 105, 110]);
    expect(paretoBars({ from: 100, to: 110, step: 5 }, 143)).toEqual([100, 105, 110]);
    expect(paretoBars({ from: 100, to: 112, step: 5 }, 90)).toEqual([100, 105, 110]);
    expect(() => paretoBars({ from: Number.NaN, to: 1, step: 1 }, 0)).toThrow();
  });

  const pt = (bar: number, objective: number, feasible = true, anchor = false) => ({
    point: { bar, net: bar, risk: objective, oneTime: 0, feasible, changes: [] },
    objective,
    anchor,
  });

  it('a lower bar takes a higher feasible plan whose objective is lower (keeping its own bar)', () => {
    const ps = [pt(100, 5), pt(105, 4), pt(110, 6), pt(115, 9, false)];
    expect(monotone(ps)).toEqual({ repaired: 1, conflicts: 0 });
    expect(ps.map((p) => [p.point.bar, p.objective, p.point.net])).toEqual([
      [100, 4, 105],
      [105, 4, 105],
      [110, 6, 110],
      [115, 9, 115],
    ]);
  });

  it('an infeasible lower bar takes a higher feasible plan; the default-bar point is never replaced', () => {
    const ps = [pt(100, 3, false), pt(105, 5, true, true), pt(110, 4)];
    expect(monotone(ps)).toEqual({ repaired: 1, conflicts: 1 });
    expect(ps[0]!.point).toMatchObject({ bar: 100, feasible: true, net: 110 });
    expect(ps[1]!.objective).toBe(5);
  });
});
