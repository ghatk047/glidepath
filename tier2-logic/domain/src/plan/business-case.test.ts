// SRC-16 acceptance: a hand-built fixture, plus the AA seed (preset C) evaluated by the real engine and
// reconciled to golden_results.json.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileModel, findScenario, resolveInputs as engineInputs } from '@glidepath/engine';
import type { Member, TenantMembers } from '@glidepath/spec';
import { loadModelBundleFromDir, readTenantSeed } from '@glidepath/spec/node';
import { describe, expect, it } from 'vitest';
import { SourcingDataError, readSourcingParams } from '../sourcing/params';
import { repoRoot } from '../test-support/schema-json';
import { SEED_DIR, SPEC_DIR } from '../test-support/seed-state';
import { engineCell } from '../views/read';
import type { ViewEvaluation } from '../views/types';
import * as domain from '../index';
import {
  businessCase,
  horizonYearKeys,
  irr,
  leverCashFlows,
  npv,
  paybackMonths,
  roi,
} from './index';

const near = (a: number | null, b: number, tol = 1e-9): void => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThanOrEqual(Math.max(tol * Math.abs(b), tol));
};
/** The parity rule (tools/parity): round to 6 decimals as golden_results.json does, then 1e-6 relative / 1e-9 absolute. */
const closeGolden = (a: number, b: number): void => {
  const r = Math.round(a * 1e6) / 1e6;
  expect(Math.abs(r - b)).toBeLessThanOrEqual(Math.max(1e-6 * Math.abs(b), 1e-9));
};

const param = (id: string, value: number, min: number, max: number, step: number): Member => ({
  id,
  label: id,
  group: 'business_case',
  value,
  unit: '',
  min,
  max,
  step,
});
const PARAMS = readSourcingParams([param('discount_rate', 0.1, 0, 1, 0.01), param('horizon_years', 3, 1, 10, 1)]);

/** Four levers: ramped with a one-time cost, no one-time cost, a cost with no saving, and switched off. */
const FIXTURE_MEMBERS: TenantMembers = {
  lever: [
    { id: 'L2', label: 'No one-time', order: 2 },
    { id: 'L1', label: 'Ramped', order: 1 },
    { id: 'L3', label: 'Cost only', order: 3 },
    { id: 'L4', label: 'Off', order: 4 },
  ],
  iyear: [{ id: 'fy26', label: 'FY26' }, { id: 'fy27', label: 'FY27' }],
};
const LEVERS: Record<string, { iy: number; rr: number; ot: number; s: number; r: number }> = {
  // a step at month 1: 0.5 a month in year 1 (6), then 1 a month (12)
  L1: { iy: 6, rr: 12, ot: 10, s: 1, r: 1 },
  L2: { iy: 3, rr: 4, ot: 0, s: 4, r: 3 },
  L3: { iy: 0, rr: 0, ot: 2, s: 1, r: 1 },
  L4: { iy: 0, rr: 0, ot: 0, s: 1, r: 1 },
};
function fixtureEv(levers = LEVERS): ViewEvaluation {
  const cells = new Map<string, number>();
  for (const [id, l] of Object.entries(levers)) {
    cells.set(engineCell('lev.iy', id), l.iy);
    cells.set(engineCell('lev.rr', id), l.rr);
    cells.set(engineCell('lev.ot', id), l.ot);
    cells.set(engineCell('lev.eff_start', id), l.s);
    cells.set(engineCell('lev.ramp', id), l.r);
  }
  return { get: (c) => cells.get(c) ?? 0, has: (c) => cells.has(c) };
}

describe('measures', () => {
  it('NPV discounts each year from its end, the one-time cost at t0', () => {
    near(npv(0.1, 100, [110]), 0);
    near(npv(0.1, 10, [6, 12, 12]), -10 + 6 / 1.1 + 12 / 1.21 + 12 / 1.331);
    near(npv(0, 10, [6, 12, 12]), 20);
  });

  it('IRR solves NPV = 0: 10% on 100 -> 110, large rates for cheap levers, negative when savings fall short', () => {
    near(irr(100, [110]), 0.1, 1e-12);
    // 100 = 60x + 60x² with x = 1/(1+r)
    near(irr(100, [60, 60]), 120 / (Math.sqrt(60 * 60 + 4 * 60 * 100) - 60) - 1, 1e-9);
    const big = irr(1, [20, 20, 20])!;
    near(npv(big, 1, [20, 20, 20]), 0, 1e-6);
    expect(big).toBeGreaterThan(18);
    const neg = irr(100, [30, 30])!;
    expect(neg).toBeLessThan(0);
    near(npv(neg, 100, [30, 30]), 0, 1e-6);
  });

  it('IRR is not applicable with no one-time cost or no positive saving', () => {
    expect(irr(0, [5, 5])).toBeNull();
    expect(irr(10, [0, 0])).toBeNull();
    expect(irr(10, [-1, -1])).toBeNull();
  });

  it('payback interpolates the crossing month; 0 with no one-time cost; null if never', () => {
    expect(paybackMonths(0, [1, 1])).toBe(0);
    near(paybackMonths(3, [1, 1, 2, 2]), 2.5);
    near(paybackMonths(2, [1, 1]), 2);
    expect(paybackMonths(5, [1, 1])).toBeNull();
    expect(paybackMonths(1, [0, -1])).toBeNull();
  });

  it('ROI over the horizon; null with no one-time cost', () => {
    near(roi(10, [6, 12, 12]), 2);
    expect(roi(0, [6])).toBeNull();
  });

  it('cash flows: year 1 follows the ramp and sums to lev.iy, later years run at lev.rr', () => {
    // start in month 7, a 3-month ramp: weights 1/3, 2/3, 1, 1, 1, 1 (Σ 5)
    const f = leverCashFlows({ inYear: 5, runRate: 12, oneTime: 4, effStart: 7, ramp: 3, horizonYears: 2 });
    expect(f.annual).toEqual([5, 12]);
    expect(f.monthly).toHaveLength(24);
    near(f.monthly.slice(0, 12).reduce((s, x) => s + x, 0), 5);
    expect(f.monthly.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    near(f.monthly[6]!, 1 / 3);
    near(f.monthly[12]!, 1);
    // cumulative: 1/3 + 2/3 = 1 after month 8, +1 +1 +1 = 4 after month 11
    near(paybackMonths(f.oneTime, f.monthly), 11);
  });

  it('year keys count up from the plan year', () => {
    expect(horizonYearKeys('fy27', 3)).toEqual(['fy27', 'fy28', 'fy29']);
    expect(horizonYearKeys('fy09', 2)).toEqual(['fy09', 'fy10']);
    expect(() => horizonYearKeys('plan', 2)).toThrow(SourcingDataError);
  });
});

describe('businessCase on a fixture', () => {
  const view = businessCase({ scenarioId: 'sc', ev: fixtureEv(), members: FIXTURE_MEMBERS, params: PARAMS });
  const row = (id: string) => view.levers.find((l) => l.lever === id)!;

  it('per lever: savings by year, one-time, NPV, payback, IRR and ROI', () => {
    expect(view.scenarioId).toBe('sc');
    expect(view.discountRate).toBe(0.1);
    expect(view.years).toEqual(['fy27', 'fy28', 'fy29']);
    expect(view.levers.map((l) => l.lever)).toEqual(['L1', 'L2', 'L3', 'L4']);
    const l1 = row('L1');
    expect(l1).toMatchObject({ label: 'Ramped', savings: { fy27: 6, fy28: 12, fy29: 12 }, oneTime: 10, runRate: 12 });
    near(l1.npv, -10 + 6 / 1.1 + 12 / 1.21 + 12 / 1.331);
    // 0.5 a month for 12 months leaves -4; 1 a month repays it by month 16
    near(l1.paybackMonths, 16);
    near(l1.roi, 2);
    near(npv(l1.irr!, 10, [6, 12, 12]), 0, 1e-9);
  });

  it('a lever with no one-time cost reports payback 0 and IRR and ROI as not applicable', () => {
    expect(row('L2')).toMatchObject({ oneTime: 0, paybackMonths: 0, irr: null, roi: null });
    near(row('L2').npv, 3 / 1.1 + 4 / 1.21 + 4 / 1.331);
    expect(row('L4')).toMatchObject({ npv: 0, paybackMonths: 0, irr: null, roi: null });
  });

  it('a one-time cost with no saving never pays back and has no IRR', () => {
    expect(row('L3')).toMatchObject({ npv: -2, paybackMonths: null, irr: null, roi: -1 });
  });

  it('totals are the measures of the summed cash flows', () => {
    const t = view.totals;
    expect(t.savings).toEqual({ fy27: 9, fy28: 16, fy29: 16 });
    expect(t.oneTime).toBe(12);
    expect(t.runRate).toBe(16);
    near(t.npv, view.levers.reduce((s, l) => s + l.npv, 0));
    near(t.roi, (41 - 12) / 12);
    near(npv(t.irr!, 12, [9, 16, 16]), 0, 1e-9);
    expect(t.paybackMonths).toBeGreaterThan(0);
  });

  it('a missing or unusable parameter is a SourcingDataError that names it', () => {
    const run = (params: Member[]) => () =>
      businessCase({ scenarioId: 'sc', ev: fixtureEv(), members: FIXTURE_MEMBERS, params: readSourcingParams(params) });
    expect(run([param('horizon_years', 3, 1, 10, 1)])).toThrow(/discount_rate/);
    expect(run([param('discount_rate', 0.1, 0, 1, 0.01)])).toThrow(/horizon_years/);
    expect(run([param('discount_rate', 0.1, 0, 1, 0.01), param('horizon_years', 2.5, 1, 10, 1)])).toThrow(SourcingDataError);
    expect(() => businessCase({ scenarioId: 'sc', ev: fixtureEv(), members: { lever: FIXTURE_MEMBERS.lever! }, params: PARAMS })).toThrow(/plan year/);
  });

  it('is exported by the package', () => {
    expect(domain.businessCase).toBe(businessCase);
  });
});

// ---------------------------------------------------------------------------------- AA seed, real engine

type GoldenScenario = Record<string, unknown> & { levers: Record<string, { rr: number; iy: number; ot: number }> };
const golden = JSON.parse(readFileSync(resolve(repoRoot, 'docs/spec/reference/golden_results.json'), 'utf8')) as {
  scenarios: Record<string, GoldenScenario>;
};

describe('reference seed (preset C) against golden_results.json', async () => {
  const [bundle, seed] = await Promise.all([loadModelBundleFromDir(SPEC_DIR), readTenantSeed(SEED_DIR)]);
  const members: TenantMembers = seed.dimensionMembers;
  const model = compileModel(bundle, members);
  const { values, overrides } = engineInputs(bundle, seed.variableValues, findScenario(seed.scenarios, 'C'));
  const ev = model.evaluate(values, overrides);
  const sourcing = JSON.parse(readFileSync(resolve(repoRoot, 'tier3-data/seed/aa/sourcing.json'), 'utf8')) as {
    dimensions: { sourcing_param: Member[] };
  };
  const params = readSourcingParams(sourcing.dimensions.sourcing_param);
  const view = businessCase({ scenarioId: 'C', ev, members, params });
  const g = golden.scenarios['C']!;
  const num = (k: string) => g[k] as number;
  const [plan, next] = view.years;

  it('reads the business_case parameters and keys the horizon from the plan year', () => {
    expect(view.discountRate).toBe(params.value('discount_rate'));
    expect(view.years).toHaveLength(params.value('horizon_years'));
    expect(plan).toBe('fy27');
    expect(next).toBe('fy28');
  });

  it('per lever: plan-year savings, run-rate and one-time are the golden lev.iy, lev.rr, lev.ot', () => {
    expect(view.levers.map((l) => l.lever).sort()).toEqual(Object.keys(g.levers).sort());
    for (const l of view.levers) {
      const gl = g.levers[l.lever]!;
      closeGolden(l.savings[plan!]!, gl.iy);
      closeGolden(l.runRate, gl.rr);
      closeGolden(l.oneTime, gl.ot);
      closeGolden(l.savings[next!]!, gl.rr);
    }
  });

  it('portfolio savings for the plan year reconcile to res.net and its components', () => {
    const t = view.totals;
    closeGolden(t.savings[plan!]!, num('res.tot_iy'));
    closeGolden(t.oneTime, Object.values(g.levers).reduce((s, l) => s + l.ot, 0));
    // res.net = res.tot_iy − res.tot_ot_raw × g.ot_in_year × (1 − g.ot_out_share)
    const otIt = t.oneTime * ev.get(engineCell('g.ot_in_year')) * (1 - ev.get(engineCell('g.ot_out_share')));
    closeGolden(otIt, num('res.tot_ot_it'));
    closeGolden(t.savings[plan!]! - otIt, num('res.net'));
    // year 2 is the spec's CY28 run-rate: pnl.o28 + pnl.c28 = res.tot_rr
    closeGolden(t.savings[next!]!, num('res.tot_rr'));
    closeGolden(t.savings[next!]!, num('pnl.o28') + num('pnl.c28'));
    closeGolden(t.runRate, num('res.tot_rr'));
  });

  it('the measures are consistent: NPV at the IRR is 0, ROI and payback within the horizon', () => {
    for (const m of [...view.levers, view.totals]) {
      const annual = view.years.map((y) => m.savings[y]!);
      near(m.npv, npv(view.discountRate, m.oneTime, annual));
      if (m.irr !== null) near(npv(m.irr, m.oneTime, annual), 0, 1e-6);
      if (m.oneTime === 0) expect(m).toMatchObject({ paybackMonths: 0, irr: null, roi: null });
      if (m.paybackMonths !== null) expect(m.paybackMonths).toBeLessThanOrEqual(12 * view.years.length);
    }
    expect(view.totals.npv).toBeGreaterThan(0);
  });

  it('prints the case', () => {
    const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
    const lines = [...view.levers, { lever: 'TOTAL', label: '', ...view.totals }].map(
      (l) =>
        `${l.lever.padEnd(6)} ot ${l.oneTime.toFixed(3).padStart(8)} rr ${l.runRate.toFixed(3).padStart(8)} npv ${l.npv.toFixed(3).padStart(9)} payback ${(l.paybackMonths === null ? 'never' : l.paybackMonths.toFixed(2)).padStart(6)} irr ${pct(l.irr).padStart(9)} roi ${pct(l.roi).padStart(9)}`,
    );
    console.log(`business case C @ ${view.discountRate} over ${view.years.join(',')}\n${lines.join('\n')}`);
    expect(lines).toHaveLength(view.levers.length + 1);
  });
});
