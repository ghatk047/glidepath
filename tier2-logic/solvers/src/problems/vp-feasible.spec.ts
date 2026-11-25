/**
 * SOL-05 acceptance: constraints of `minRiskMix({ constraints })`, the VP-feasible plan `vpFeasible()`,
 * binding constraints and shadow prices.
 *
 * 1. Every vp.net ≥ vp.bar from preset C (G5 vs docs/spec/reference/solver_demo_results.json
 *    `min_risk_total_and_vp_bars`): net, VP gaps, risk exposure, Operations binding.
 * 2. Each optional constraint (one_time_cap, rate_share, us_floor, gcc_hiring, eps) binds on a
 *    constructed case.
 * 3. Binding constraints are reported with shadow prices.
 * 4. Infeasible → status infeasible with the plan that maximises min vp.coverage.
 *
 * As in SOL-04, `withDecisionBounds(model, REFERENCE_DECISION_BOUNDS)` widens the SOL-01 bound of lev.L01.cut,
 * lev.L01.rel, lev.L03.pct and lev.L15.pct to the reference greedy's bound (max of C and D), as production does
 * (SOL-12); the demo figures need it.
 *
 * Constructed cases (2): from C, only two lever-intensity inputs may move (the stretch presets are C
 * with those two at their registry max), and g.target_net is moved so the bar sits half of the smaller
 * one-step net gain above C's net: one step of either lever clears it. X is the lever whose step costs
 * less risk exposure but moves the constraint's measure; Y costs more and leaves it alone. Free, the mix
 * takes X; with the constraint at C's value it must take Y, and relaxing the constraint lets X back in,
 * so the constraint binds with a positive shadow price. The levers are picked from the seed tenant's
 * one-step effects (risk exposure, res.tot_ot_it, res.rate_share, res.fte_us, res.fte_gcc), which the
 * tests check first.
 */
import { cellKey, type Evaluation } from '@glidepath/engine';
import { REFERENCE_DECISION_BOUNDS } from '@glidepath/spec';
import { beforeAll, describe, expect, it } from 'vitest';
import { presetValues, readRepoJson, seedModel } from '../../test/helpers';
import { decisionSet, withDecisionBounds } from '../decision-sets';
import { minRiskMix } from '../min-risk';
import type { SolverModel } from '../model';
import type { SolverConstraint, SolverResult } from '../types';
import { vpFeasible } from '../vp-feasible';
import { FEASIBILITY_TOL, riskExposure } from './min-risk';
import { leximin, VP_COVERAGE, withPerVp } from './vp-feasible';

interface DemoVp {
  readonly feasible: boolean;
  readonly steps: number;
  readonly net: number;
  readonly bar: number;
  readonly risk_exposure: number;
  readonly one_time_it: number;
  readonly eps27: number;
  readonly vp_gaps: Record<string, number>;
  readonly inputs_moved_from_C: Record<string, { from: number; to: number }>;
}

const want = readRepoJson<{ min_risk_total_and_vp_bars: DemoVp }>('docs/spec/reference/solver_demo_results.json')
  .min_risk_total_and_vp_bars;

/** Acceptance tolerance on net and risk exposure ($M). */
const TOL = 0.5;
/** The reference rounds VP gaps to 2 decimals. */
const GAP_DIGITS = 2;
const noYield = () => Promise.resolve();
const opts = { yield: noYield };

let model: SolverModel;
beforeAll(async () => {
  const base = await seedModel('C');
  model = withDecisionBounds(base, REFERENCE_DECISION_BOUNDS);
}, 60_000);

const vpIds = () => (model.members.vp ?? []).map((m) => m.id);
const at = (m: SolverModel, r: SolverResult) => m.compiled.rerun(m.base, r.changes);
const slack = (e: Evaluation, v: string) => e.get(cellKey('vp.net', [v])) - e.get(cellKey('vp.bar', [v]));

// ---------------------------------------------------------------------------------------------------
// 1. Total and every VP bar (G5)
// ---------------------------------------------------------------------------------------------------

describe('SOL-05 acceptance 1: every vp.net >= vp.bar from C (G5 vs min_risk_total_and_vp_bars)', () => {
  let mix: SolverResult<'min_risk_mix'>;
  let vp: SolverResult<'vp_feasible'>;
  beforeAll(async () => {
    mix = await minRiskMix(model, { constraints: [{ id: 'per_vp' }] }, opts);
    vp = await vpFeasible(model, {}, opts);
  }, 60_000);

  it('net 148.13 ± 0.5, all VP gaps >= 0, risk exposure 43.63 ± 0.5, Operations has the smallest slack (binding)', () => {
    for (const r of [mix, vp]) {
      expect(r.status).toBe('feasible');
      const e = at(model, r);
      expect(Math.abs(e.get('res.net') - want.net)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(riskExposure(e, model.members) - want.risk_exposure)).toBeLessThanOrEqual(TOL);
      expect(e.get('res.net')).toBeGreaterThanOrEqual(e.get('res.bar'));
      const slacks = vpIds().map((v) => [v, slack(e, v)] as const);
      for (const [v, s] of slacks) {
        expect(s).toBeGreaterThanOrEqual(-FEASIBILITY_TOL);
        expect(s).toBeCloseTo(want.vp_gaps[v]!, GAP_DIGITS);
      }
      // The reference's tightest VP (Operations) is the smallest slack here, and binding.
      const tightest = Object.entries(want.vp_gaps).sort((a, b) => a[1] - b[1])[0]![0];
      expect(tightest).toBe('vp_operations');
      expect([...slacks].sort((a, b) => a[1] - b[1])[0]![0]).toBe(tightest);
      const b = r.binding?.find((x) => x.constraint === `per_vp[${tightest}]`);
      expect(b).toBeDefined();
      expect(b!.shadowPrice).toBeGreaterThan(0);
    }
  });

  it('matches the reference plan: moved inputs, steps, headline numbers', () => {
    const moved = Object.fromEntries(mix.changes.map((c) => [c.cell, c.value]));
    expect(Object.keys(moved).sort()).toEqual(Object.keys(want.inputs_moved_from_C).sort());
    for (const [cell, { from, to }] of Object.entries(want.inputs_moved_from_C)) {
      expect(model.base.get(cell)).toBeCloseTo(from, 9);
      expect(moved[cell]).toBeCloseTo(to, 9);
    }
    expect(mix.metrics.steps).toBe(want.steps);
    expect(mix.metrics['res.net']).toBeCloseTo(want.net, 2);
    expect(mix.metrics.risk_exposure).toBeCloseTo(want.risk_exposure, 2);
    expect(mix.metrics['res.tot_ot_it']).toBeCloseTo(want.one_time_it, 2);
    expect(mix.metrics['br.eps27']).toBeCloseTo(want.eps27, 4);
  });

  it('vpFeasible is the min-risk mix with per_vp, plus VP coverage', () => {
    expect(vp.changes).toEqual(mix.changes);
    expect(vp.binding).toEqual(mix.binding);
    const e = at(model, vp);
    expect(vp.detail?.coverage.map((c) => c.vp)).toEqual(vpIds());
    for (const c of vp.detail!.coverage) {
      expect(c.coverage).toBe(e.get(cellKey(VP_COVERAGE, [c.vp])));
      expect(c.coverage).toBeGreaterThanOrEqual(1);
    }
    expect(vp.metrics.min_coverage).toBe(Math.min(...vp.detail!.coverage.map((c) => c.coverage)));
  });
});

// ---------------------------------------------------------------------------------------------------
// 2. Each optional constraint binds on a constructed case
// ---------------------------------------------------------------------------------------------------

/** C with only `cells` movable (up to their registry max) and the bar half a step above C's net. */
async function constructed(cells: readonly string[]): Promise<SolverModel> {
  const base = await seedModel('C');
  const stretch = new Map(await presetValues('C'));
  const reg = new Map(base.bundle.variables.map((v) => [v.id, v]));
  for (const cell of cells) stretch.set(cell, reg.get(cell)!.max!);
  const m0: SolverModel = { ...base, stretch: [stretch] };
  const ds = decisionSet(m0, 'lever_intensity');
  const movable = ds.filter((d) => d.hi > d.value + FEASIBILITY_TOL).map((d) => d.cell);
  expect(movable.sort()).toEqual([...cells].sort());
  const netStep = (cell: string) => {
    const d = ds.find((x) => x.cell === cell)!;
    return base.compiled.rerun(base.base, [{ target: 'variable', cell, value: d.value + d.step! }]).get('res.net') - base.base.get('res.net');
  };
  const gap = Math.min(...cells.map(netStep)) / 2;
  const target = base.base.get('g.target_net') - (base.base.get('res.bar') - base.base.get('res.net')) + gap;
  const start = base.compiled.rerun(base.base, [{ target: 'variable', cell: 'g.target_net', value: target }]);
  expect(start.get('res.bar') - start.get('res.net')).toBeCloseTo(gap, 9);
  return { ...m0, base: start };
}

/** One step of `cell` from the model's start point. */
function oneStep(m: SolverModel, cell: string): Evaluation {
  const d = decisionSet(m, 'lever_intensity').find((x) => x.cell === cell)!;
  return m.compiled.rerun(m.base, [{ target: 'variable', cell, value: d.value + d.step! }]);
}

interface Case {
  readonly id: Exclude<SolverConstraint['id'], 'total' | 'per_vp'>;
  /** Cheaper in risk exposure, moves the constraint's measure the wrong way. */
  readonly x: string;
  /** Dearer in risk exposure, leaves the measure alone. */
  readonly y: string;
  /** The constraint's measure at a point. */
  readonly measure: (e: Evaluation) => number;
  /** +1: a cap (measure <= value), −1: a floor (measure >= value). */
  readonly sense: 1 | -1;
}

const CASES: readonly Case[] = [
  { id: 'one_time_cap', x: 'lev.L16.pct', y: 'lev.L17.cola', measure: (e) => e.get('res.tot_ot_it'), sense: 1 },
  { id: 'rate_share', x: 'lev.L08.cut', y: 'lev.L17.cola', measure: (e) => e.get('res.rate_share'), sense: 1 },
  { id: 'us_floor', x: 'lev.L05.nb', y: 'lev.L05.vac', measure: (e) => e.get('res.fte_us'), sense: -1 },
  { id: 'gcc_hiring', x: 'lev.L03.pct', y: 'lev.L05.vac', measure: (e) => e.get('res.fte_gcc') - e.get('hc.gcc'), sense: 1 },
];

describe('SOL-05 acceptance 2: each optional constraint binds on a constructed case', () => {
  for (const c of CASES) {
    it(`${c.id} binds: ${c.x} is cheaper but breaks it, the plan takes ${c.y}`, async () => {
      const m = await constructed([c.x, c.y]);
      const risk = (e: Evaluation) => riskExposure(e, m.members);
      const ex = oneStep(m, c.x);
      const ey = oneStep(m, c.y);
      // The premise: X costs less risk; X moves the measure past C's value, Y does not.
      expect(risk(ex)).toBeLessThan(risk(ey));
      const value = c.measure(m.base);
      expect(c.sense * (c.measure(ex) - value)).toBeGreaterThan(0);
      expect(c.sense * (c.measure(ey) - value)).toBeLessThanOrEqual(FEASIBILITY_TOL);

      const free = await minRiskMix(m, {}, opts);
      expect(free.status).toBe('feasible');
      expect(free.changes.map((ch) => ch.cell)).toEqual([c.x]);

      const r = await minRiskMix(m, { constraints: [{ id: c.id, value }] }, opts);
      expect(r.status).toBe('feasible');
      expect(r.changes.map((ch) => ch.cell)).toEqual([c.y]);
      expect(c.sense * (c.measure(at(m, r)) - value)).toBeLessThanOrEqual(FEASIBILITY_TOL);
      expect(r.metrics.objective).toBeGreaterThan(free.metrics.objective!);
      const b = r.binding?.find((x) => x.constraint === c.id);
      expect(b).toBeDefined();
      expect(b!.shadowPrice).toBeGreaterThan(0);
    });
  }

  it('eps binds: the floor needs a second step of the lever the bar needs one of', async () => {
    const y = 'lev.L17.cola';
    const m = await constructed([y]);
    const d = decisionSet(m, 'lever_intensity').find((x) => x.cell === y)!;
    const eps = (k: number) => m.compiled.rerun(m.base, [{ target: 'variable', cell: y, value: d.value + k * d.step! }]).get('br.eps27');
    expect(eps(2)).toBeGreaterThan(eps(1));
    const floor = (eps(1) + eps(2)) / 2;

    const free = await minRiskMix(m, {}, opts);
    expect(free.metrics.steps).toBe(1);
    const r = await minRiskMix(m, { constraints: [{ id: 'eps', value: floor }] }, opts);
    expect(r.status).toBe('feasible');
    expect(r.metrics.steps).toBe(2);
    expect(r.metrics['br.eps27']).toBeGreaterThanOrEqual(floor);
    const b = r.binding?.find((x) => x.constraint === 'eps');
    expect(b).toBeDefined();
    expect(b!.shadowPrice).toBeGreaterThan(0);
    // The total bar holds with a full step to spare: not binding.
    expect(r.binding?.some((x) => x.constraint === 'total')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
// 3. Binding constraints with shadow prices
// ---------------------------------------------------------------------------------------------------

describe('SOL-05 acceptance 3: binding constraints with shadow prices', () => {
  it('reports held, active constraints whose relaxation lowers the objective, with a positive shadow price', async () => {
    const loose = 1e6;
    const r = await minRiskMix(
      model,
      {
        constraints: [
          { id: 'per_vp' },
          { id: 'rate_share', value: model.base.get('res.rate_share') },
          { id: 'one_time_cap', value: loose },
          { id: 'eps', value: -loose },
        ],
      },
      opts,
    );
    expect(r.status).toBe('feasible');
    const e = at(model, r);
    const ids = (r.binding ?? []).map((b) => b.constraint);
    expect(ids).toContain('rate_share');
    // Loose constraints never bind.
    expect(ids).not.toContain('one_time_cap');
    expect(ids).not.toContain('eps');
    for (const b of r.binding ?? []) {
      expect(Number.isFinite(b.shadowPrice)).toBe(true);
      expect(b.shadowPrice).toBeGreaterThan(0);
    }
    // A binding cap is held at the plan. (A greedy is not monotone in its constraints: dropping the cap
    // altogether can end on a plan no cheaper, so the shadow price is local: one relaxation step.)
    expect(e.get('res.rate_share')).toBeLessThanOrEqual(model.base.get('res.rate_share') + FEASIBILITY_TOL);
  });

  it('the total bar binds on the total-only plan; an infeasible plan reports none', async () => {
    const total = await minRiskMix(model, {}, opts);
    const b = total.binding?.find((x) => x.constraint === 'total');
    expect(b?.shadowPrice).toBeGreaterThan(0);
    const none = await minRiskMix(model, { constraints: [{ id: 'eps', value: 1e6 }] }, opts);
    expect(none.status).toBe('infeasible');
    expect(none.binding).toEqual([]);
  });

  it('production method reports binding constraints too', async () => {
    const r = await minRiskMix(model, { method: 'production', constraints: [{ id: 'per_vp' }] }, opts);
    expect(r.status).toBe('feasible');
    expect((r.binding ?? []).length).toBeGreaterThan(0);
    for (const b of r.binding!) expect(b.shadowPrice).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------
// 4. Infeasible: maximise the minimum VP coverage
// ---------------------------------------------------------------------------------------------------

describe('SOL-05 acceptance 4: infeasible → status infeasible with the plan that maximises min vp.coverage', () => {
  let high: SolverModel;
  let r: SolverResult<'vp_feasible'>;
  const minCov = (e: Evaluation) => Math.min(...vpIds().map((v) => e.get(cellKey(VP_COVERAGE, [v]))));
  beforeAll(async () => {
    // The CIO target at its registry max: no plan within bounds clears every VP bar.
    const max = model.bundle.variables.find((v) => v.id === 'g.target_net')!.max!;
    high = { ...model, base: model.compiled.rerun(model.base, [{ target: 'variable', cell: 'g.target_net', value: max }]) };
    r = await vpFeasible(high, {}, opts);
  }, 60_000);

  it('status infeasible, coverage per VP, no binding constraints', () => {
    expect(r.status).toBe('infeasible');
    expect(r.binding).toEqual([]);
    const e = at(high, r);
    expect(r.detail?.coverage.map((c) => c.vp)).toEqual(vpIds());
    for (const c of r.detail!.coverage) expect(c.coverage).toBe(e.get(cellKey(VP_COVERAGE, [c.vp])));
    expect(r.metrics.min_coverage).toBe(minCov(e));
    expect(minCov(e)).toBeLessThan(1);
  });

  it('min coverage beats the start and the min-risk mix, and no single step raises it', async () => {
    const e = at(high, r);
    expect(minCov(e)).toBeGreaterThan(minCov(high.base));
    const mix = await minRiskMix(high, { constraints: [{ id: 'per_vp' }] }, opts);
    expect(mix.status).toBe('infeasible');
    expect(minCov(e)).toBeGreaterThanOrEqual(minCov(at(high, mix)) - FEASIBILITY_TOL);
    // Local maximin: every one-step move from the plan leaves the minimum coverage no higher.
    const plan = new Map(r.changes.map((c) => [c.cell, c.value]));
    for (const d of decisionSet(high, 'lever_intensity')) {
      const x = (plan.get(d.cell) ?? d.value) + d.step!;
      if (x > d.hi + FEASIBILITY_TOL) continue;
      const moved = high.compiled.rerun(e, [{ target: 'variable', cell: d.cell, value: x }]);
      expect(minCov(moved)).toBeLessThanOrEqual(minCov(e) + FEASIBILITY_TOL);
    }
  });

  it('keeps the guards while it maximises', async () => {
    const cap = high.base.get('res.tot_ot_it');
    const g = await vpFeasible(high, { constraints: [{ id: 'one_time_cap', value: cap }] }, opts);
    expect(g.status).toBe('infeasible');
    expect(at(high, g).get('res.tot_ot_it')).toBeLessThanOrEqual(cap + FEASIBILITY_TOL);
    expect(g.metrics.min_coverage).toBeGreaterThan(minCov(high.base));
  });
});

// ---------------------------------------------------------------------------------------------------
// Options and errors
// ---------------------------------------------------------------------------------------------------

describe('SOL-05 options and errors', () => {
  it('withPerVp adds per_vp once; leximin compares sorted vectors', () => {
    expect(withPerVp(undefined)).toEqual([{ id: 'per_vp' }]);
    expect(withPerVp([{ id: 'per_vp', vps: ['vp_infra'] }])).toEqual([{ id: 'per_vp', vps: ['vp_infra'] }]);
    expect(withPerVp([{ id: 'eps', value: 0 }])).toEqual([{ id: 'eps', value: 0 }, { id: 'per_vp' }]);
    expect(leximin([0.5, 0.9], [0.5, 0.8])).toBe(1);
    expect(leximin([0.4, 1], [0.5, 0.6])).toBe(-1);
    expect(leximin([0.5, 0.6], [0.5, 0.6])).toBe(0);
  });

  it('a per_vp subset constrains and reports only those VPs', async () => {
    const [v] = vpIds();
    const r = await vpFeasible(model, { constraints: [{ id: 'per_vp', vps: [v!] }] }, opts);
    expect(r.status).toBe('feasible');
    expect(r.detail?.coverage.map((c) => c.vp)).toEqual([v]);
    expect(slack(at(model, r), v!)).toBeGreaterThanOrEqual(-FEASIBILITY_TOL);
  });

  it('rejects a model without VP coverage or VP members', async () => {
    const noVp: SolverModel = { ...model, members: { ...model.members, vp: [] } };
    await expect(vpFeasible(noVp, {}, opts)).rejects.toMatchObject({ code: 'BAD_MODEL' });
    const v = vpIds()[0]!;
    const cell = cellKey(VP_COVERAGE, [v]);
    const base = new Proxy(model.base, {
      get(target, prop, receiver) {
        if (prop === 'has') return (c: string) => c !== cell && target.has(c);
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    await expect(vpFeasible({ ...model, base }, {}, opts)).rejects.toMatchObject({ code: 'BAD_MODEL' });
  });

  it('cancels with the partial plan', async () => {
    const ac = new AbortController();
    let batches = 0;
    const r = await vpFeasible(
      model,
      {},
      {
        signal: ac.signal,
        yield: () => {
          batches += 1;
          if (batches === 6) ac.abort();
          return Promise.resolve();
        },
      },
    );
    expect(r.status).toBe('cancelled');
    expect(r.changes.length).toBeGreaterThan(0);
  });
});
