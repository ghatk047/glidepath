import { z } from 'zod';
import { MemberKey, OneLine, ScenarioId } from './ids';

/**
 * Plan module (SRC-03, feature F9 of `docs/backlog/SRC.md`): the lever business case, a tier-2 view
 * over the engine's lever outputs at the `sourcing_param` discount rate.
 *
 * - `GET /api/t/:tenant/plan/business-case?scenario=`  `BusinessCase`
 *
 * F1 breakeven, F3 stress tests and F10 the wave planner run as solver problems (`breakeven`,
 * `stress_presets`, `wave_plan`) through the solver-run routes, not here.
 *
 * Units: money is `$M`; `discountRate`, `irr` and `roi` are fractions (0.1 = 10%).
 */

/** `?scenario=` of the plan reads. */
export const PlanQuery = z.object({ scenario: ScenarioId });
export type PlanQuery = z.infer<typeof PlanQuery>;

/** Savings by `year` member key (e.g. `fy27`, `fy28`), $M; one entry per year of `BusinessCase.years`. */
export const SavingsByYear = z.record(MemberKey, z.number());
export type SavingsByYear = z.infer<typeof SavingsByYear>;

const metrics = {
  savings: SavingsByYear,
  /** One-time cost, $M. */
  oneTime: z.number(),
  /** Annual run-rate saving at full ramp, $M. */
  runRate: z.number(),
  /** Net present value of savings less one-time cost at `discountRate`, $M. */
  npv: z.number(),
  /** Months until cumulative savings repay the one-time cost; 0 with no one-time cost, null if never. */
  paybackMonths: z.number().nonnegative().nullable(),
  /** Internal rate of return; null when not defined (no one-time cost, or no sign change). */
  irr: z.number().nullable(),
  /** (total savings - one-time) / one-time over the horizon; null with no one-time cost. */
  roi: z.number().nullable(),
};

/** One lever's case. */
export const BusinessCaseRow = z.object({
  /** `lever` member key. */
  lever: MemberKey,
  label: OneLine,
  ...metrics,
});
export type BusinessCaseRow = z.infer<typeof BusinessCaseRow>;

/** Portfolio totals: the same measures over the sum of the levers' cash flows. */
export const BusinessCaseTotals = z.object(metrics);
export type BusinessCaseTotals = z.infer<typeof BusinessCaseTotals>;

/** `GET /api/t/:tenant/plan/business-case?scenario=`. `levers` in lever order. */
export const BusinessCase = z.object({
  scenarioId: ScenarioId,
  /** Discount rate used, a fraction (the `discount_rate` sourcing parameter). */
  discountRate: z.number(),
  /** The horizon: `year` member keys in order; `savings` records are keyed by these. */
  years: z.array(MemberKey).min(1),
  levers: z.array(BusinessCaseRow),
  totals: BusinessCaseTotals,
});
export type BusinessCase = z.infer<typeof BusinessCase>;
