// SRC-16 (feature F9): the lever business case — savings by year, NPV, payback, IRR and ROI per lever
// and for the portfolio — a pure view over the scenario's evaluation and the `business_case`
// `sourcing_param` members. No number is defaulted here (the parameters live in
// tier3-data/seed/aa/sourcing.json).
//
// Cash flows (the spec's own multi-year reading, 03b pnl layer):
// - year 1 (the plan year) saves `lev.iy`, the CY27 in-year saving with its ramp (Σ lev.iy = res.tot_iy);
// - years 2..H save the full run-rate `lev.rr`, as `pnl.o28 + pnl.c28` (= `res.tot_rr`) does for CY28;
// - the one-time cost is all of `lev.ot` (the economic cost, before `g.ot_in_year` and the IT /
//   outside-IT funding split `g.ot_out_share` that `res.tot_ot_it` and `res.net` apply).
// Timing: the one-time cost falls at t0 (start of the plan year, undiscounted, including any part
// pre-funded the year before); a year's savings are discounted from its end: NPV = −OT + Σ_k S_k/(1+r)^k.
// IRR solves the same annual flows for NPV = 0. Payback runs month by month: year-1 savings follow the
// lever's linear ramp (`lev.eff_start`, `lev.ramp`, as `levers.monthly`), later years a twelfth of the
// run-rate a month, and the crossing month is interpolated linearly.
import type { Member, TenantMembers } from '@glidepath/spec';
import { sourcingYears } from '../sourcing/lines';
import { SourcingDataError, memberLabel } from '../sourcing/params';
import type { SourcingParamsLookup } from '../sourcing/params';
import { LEVER_DIM, MONTHS_IN_YEAR, rampWeights } from '../views/levers';
import { inDisplayOrder, membersOf, valueOf } from '../views/read';
import type { ViewEvaluation } from '../views/types';
import type { BusinessCaseLeverRow, BusinessCaseMetrics, BusinessCaseView, CashFlows } from './types';

/** The `sourcing_param` keys of the business case (group `business_case`). */
export const BUSINESS_CASE_PARAM_KEYS = {
  discountRate: 'discount_rate',
  horizonYears: 'horizon_years',
} as const;

/** The engine cells the business case reads, verbatim from formula_graph.json. */
export const BUSINESS_CASE_CELLS = {
  inYear: 'lev.iy',
  runRate: 'lev.rr',
  oneTime: 'lev.ot',
  effStart: 'lev.eff_start',
  ramp: 'lev.ramp',
} as const;

/** Bisection steps of the IRR (the bracket halves each step: far below float resolution). */
const IRR_STEPS = 200;
/** Doublings of the IRR's upper bracket before it gives up (2^60: any finite rate a lever can have). */
const IRR_DOUBLINGS = 60;

// ---------------------------------------------------------------------------------- cash flows

/**
 * A lever's cash flows over `horizonYears`: year 1 saves `inYear`, spread over its months by the ramp
 * weights (as `levers.monthly`, so the months sum to `inYear`); years 2..H save `runRate`, a twelfth a month.
 */
export function leverCashFlows(args: {
  inYear: number;
  runRate: number;
  oneTime: number;
  effStart: number;
  ramp: number;
  horizonYears: number;
}): CashFlows {
  const w = rampWeights(args.effStart, args.ramp);
  const wSum = w.reduce((s, x) => s + x, 0);
  const year1 = w.map((x) => (wSum === 0 ? args.inYear / MONTHS_IN_YEAR : (args.inYear * x) / wSum));
  const later = Array.from({ length: (args.horizonYears - 1) * MONTHS_IN_YEAR }, () => args.runRate / MONTHS_IN_YEAR);
  return {
    oneTime: args.oneTime,
    runRate: args.runRate,
    annual: [args.inYear, ...Array.from({ length: args.horizonYears - 1 }, () => args.runRate)],
    monthly: [...year1, ...later],
  };
}

/** The element-wise sum of cash flows of the same horizon (the portfolio). */
export function sumCashFlows(flows: readonly CashFlows[], horizonYears: number): CashFlows {
  const add = (pick: (f: CashFlows) => readonly number[], n: number): number[] =>
    Array.from({ length: n }, (_, i) => flows.reduce((s, f) => s + (pick(f)[i] ?? 0), 0));
  return {
    oneTime: flows.reduce((s, f) => s + f.oneTime, 0),
    runRate: flows.reduce((s, f) => s + f.runRate, 0),
    annual: add((f) => f.annual, horizonYears),
    monthly: add((f) => f.monthly, horizonYears * MONTHS_IN_YEAR),
  };
}

// ---------------------------------------------------------------------------------- measures

/** NPV at `rate`: the one-time cost at t0, each year's savings at its end. */
export function npv(rate: number, oneTime: number, annual: readonly number[]): number {
  return annual.reduce((s, x, k) => s + x / (1 + rate) ** (k + 1), -oneTime);
}

/**
 * Months until the cumulative cash (−one-time, then the monthly savings) reaches 0, interpolated within the
 * month; 0 with no one-time cost; null when it never does within the months given.
 */
export function paybackMonths(oneTime: number, monthly: readonly number[]): number | null {
  if (oneTime <= 0) return 0;
  let cum = -oneTime;
  for (let i = 0; i < monthly.length; i++) {
    const m = monthly[i] ?? 0;
    if (m > 0 && cum + m >= 0) return i + -cum / m;
    cum += m;
  }
  return null;
}

/**
 * The rate at which the NPV of the annual flows is 0, by bisection on (−1, ∞). Null when it is not defined:
 * no one-time cost, no positive saving, or no sign change of the NPV over the rates.
 */
export function irr(oneTime: number, annual: readonly number[]): number | null {
  if (!(oneTime > 0) || !annual.some((x) => x > 0)) return null;
  const f = (r: number) => npv(r, oneTime, annual);
  const at0 = f(0);
  if (at0 === 0) return 0;
  let lo: number;
  let hi: number;
  if (at0 > 0) {
    lo = 0;
    hi = 1;
    let n = 0;
    while (f(hi) > 0) {
      if (++n > IRR_DOUBLINGS) return null;
      lo = hi;
      hi *= 2;
    }
  } else {
    lo = -1 + Number.EPSILON;
    hi = 0;
    if (!(f(lo) > 0)) return null;
  }
  for (let i = 0; i < IRR_STEPS && hi - lo > Number.EPSILON * Math.max(1, Math.abs(lo)); i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** (Σ savings − one-time) / one-time; null with no one-time cost. */
export function roi(oneTime: number, annual: readonly number[]): number | null {
  if (!(oneTime > 0)) return null;
  return (annual.reduce((s, x) => s + x, 0) - oneTime) / oneTime;
}

/** Every measure of a cash-flow profile at `discountRate`, savings keyed by `years`. */
export function caseMetrics(flows: CashFlows, discountRate: number, years: readonly string[]): BusinessCaseMetrics {
  return {
    savings: Object.fromEntries(years.map((y, i) => [y, flows.annual[i] ?? 0])),
    oneTime: flows.oneTime,
    runRate: flows.runRate,
    npv: npv(discountRate, flows.oneTime, flows.annual),
    paybackMonths: paybackMonths(flows.oneTime, flows.monthly),
    irr: irr(flows.oneTime, flows.annual),
    roi: roi(flows.oneTime, flows.annual),
  };
}

// ---------------------------------------------------------------------------------- years and parameters

/**
 * The horizon's year keys: the plan year's key, then the same key with its trailing number counted up
 * (`fy27` → `fy28`, `fy29`, …). Structural, from the model's members: no year is written here.
 */
export function horizonYearKeys(planYear: string, horizonYears: number): string[] {
  const m = /^(.*?)(\d+)$/.exec(planYear);
  if (!m) throw new SourcingDataError(`the plan year key '${planYear}' does not end in a year number`);
  const [, prefix = '', digits = ''] = m;
  return Array.from({ length: horizonYears }, (_, k) => `${prefix}${String(Number(digits) + k).padStart(digits.length, '0')}`);
}

/** The discount rate (a fraction above −1) and the horizon (a whole number of years, at least 1). */
export function businessCaseParams(params: SourcingParamsLookup): { discountRate: number; horizonYears: number } {
  const discountRate = params.value(BUSINESS_CASE_PARAM_KEYS.discountRate);
  const horizonYears = params.value(BUSINESS_CASE_PARAM_KEYS.horizonYears);
  if (!(discountRate > -1)) throw new SourcingDataError(`sourcing_param ${BUSINESS_CASE_PARAM_KEYS.discountRate} must be above -1`);
  if (!Number.isInteger(horizonYears) || horizonYears < 1) {
    throw new SourcingDataError(`sourcing_param ${BUSINESS_CASE_PARAM_KEYS.horizonYears} must be a whole number of years, at least 1`);
  }
  return { discountRate, horizonYears };
}

// ---------------------------------------------------------------------------------- the view

export interface BusinessCaseArgs {
  readonly scenarioId: string;
  /** The scenario's evaluation (lev.iy, lev.rr, lev.ot, lev.eff_start, lev.ramp by lever). */
  readonly ev: ViewEvaluation;
  /** The tenant's members: `lever` (rows, labels, `order`) and `iyear` (the plan year is the last). */
  readonly members: TenantMembers;
  /** The tenant's `sourcing_param` members (`discount_rate`, `horizon_years`). */
  readonly params: SourcingParamsLookup;
}

function leverFlows(ev: ViewEvaluation, lever: Member, horizonYears: number): CashFlows {
  const c = BUSINESS_CASE_CELLS;
  return leverCashFlows({
    inYear: valueOf(ev, c.inYear, lever.id),
    runRate: valueOf(ev, c.runRate, lever.id),
    oneTime: valueOf(ev, c.oneTime, lever.id),
    effStart: valueOf(ev, c.effStart, lever.id),
    ramp: valueOf(ev, c.ramp, lever.id),
    horizonYears,
  });
}

/**
 * The lever business case of a scenario: each lever (display order) and the portfolio — the measures of the
 * summed cash flows, not sums of the levers' measures. Throws `SourcingDataError` when a parameter is
 * missing or unusable, or the model has no plan year.
 */
export function businessCase(args: BusinessCaseArgs): BusinessCaseView {
  const { discountRate, horizonYears } = businessCaseParams(args.params);
  const { planYear } = sourcingYears(args.members);
  if (planYear === '') throw new SourcingDataError('the model has no iyear members: no plan year');
  const years = horizonYearKeys(planYear, horizonYears);
  const levers = inDisplayOrder(membersOf(args.members, LEVER_DIM)).map((lever) => ({
    lever,
    flows: leverFlows(args.ev, lever, horizonYears),
  }));
  const rows: BusinessCaseLeverRow[] = levers.map(({ lever, flows }) => ({
    lever: lever.id,
    label: memberLabel(lever),
    ...caseMetrics(flows, discountRate, years),
  }));
  const totals = caseMetrics(sumCashFlows(levers.map((l) => l.flows), horizonYears), discountRate, years);
  return { scenarioId: args.scenarioId, discountRate, years, levers: rows, totals };
}
