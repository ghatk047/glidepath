import { z } from 'zod';
import { IsoDate, MemberKey, OneLine, ScenarioId } from './ids';

/**
 * Sourcing module (SRC-03, features F5-F8 of `docs/backlog/SRC.md`): tier-2 views over the seeded
 * lines and the tenant dimensions `vendor`, `contract`, `benchmark` and `sourcing_param`.
 *
 * - `GET  /api/t/:tenant/sourcing/vendors?scenario=`     `VendorSpend`       (F5 spend cube)
 * - `GET  /api/t/:tenant/sourcing/renewals?scenario=`    `RenewalCalendar`   (F6 renewal calendar)
 * - `GET  /api/t/:tenant/sourcing/benchmarks?scenario=`  `BenchmarkGap`      (F7 should-cost)
 * - `GET  /api/t/:tenant/sourcing/params[?scenario=]`    `SourcingParams`    (editable parameters)
 * - `POST /api/t/:tenant/sourcing/consolidation`         `ConsolidationResult` (F8 optimizer)
 *
 * Units: money is `$M` (millions of US dollars, the model's unit); a `share`, `cut` or `rate` is a
 * fraction (0.08 = 8%); HHI is on the 0..10 000 scale (sum of squared percentage shares). Every number
 * is computed by tier 2; tier 1 renders them as they come and does no arithmetic.
 */

/** A fraction in [0, 1]. */
const Fraction = z.number().min(0).max(1);
/** Money in $M. */
const Money = z.number();
/** Calendar month, `YYYY-MM`. */
export const IsoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be YYYY-MM');
export type IsoMonth = z.infer<typeof IsoMonth>;

/** Key of a `sourcing_param` member (e.g. `discount_rate`, `concentration_cap`). */
export const SourcingParamKey = MemberKey;
export type SourcingParamKey = z.infer<typeof SourcingParamKey>;

/** `?scenario=` of the sourcing reads: the scenario whose levers and members are read. */
export const SourcingQuery = z.object({ scenario: ScenarioId });
export type SourcingQuery = z.infer<typeof SourcingQuery>;

/** `?scenario=` is optional on the params read: absent = the tenant's committed members. */
export const SourcingParamsQuery = z.object({ scenario: ScenarioId.optional() });
export type SourcingParamsQuery = z.infer<typeof SourcingParamsQuery>;

// ---------------------------------------------------------------------------
// F5 · Vendor spend cube
// ---------------------------------------------------------------------------

/** One vendor: third-party spend of the in-scope, non-memo lines naming it. */
export const VendorSpendRow = z.object({
  /** Vendor name as the lines carry it. */
  vendor: OneLine,
  /** The `vendor` dimension member it maps to; `null` for tail vendors with no member. */
  vendorKey: MemberKey.nullable(),
  /** `vendor.preferred` of the member (false when `vendorKey` is null). */
  preferred: z.boolean(),
  /** An aggregate bucket such as "Various" (`vendor_bucket` member): listed after every named vendor and left out of HHI, top-5 share and the vendor count. */
  aggregate: z.boolean(),
  /** Annual spend, $M (sum of qty x unit cost over its lines). */
  spend: Money,
  /** spend / third-party total. */
  share: Fraction,
  /** Running share in the order of `vendors` (descending spend). */
  cumulativeShare: Fraction,
  /** Number of lines naming the vendor. */
  lineCount: z.number().int().nonnegative(),
  /** `pool` members its lines sit in. */
  pools: z.array(MemberKey),
  /** `lever` members whose allocation touches its lines. */
  levers: z.array(MemberKey),
  /** Share of its spend on lines tagged addressable or partly addressable. */
  addressableShare: Fraction,
});
export type VendorSpendRow = z.infer<typeof VendorSpendRow>;

export const VendorSpendTotals = z.object({
  /** Third-party spend, $M (reconciles to the third-party baseline). */
  thirdPartySpend: Money,
  /** Herfindahl-Hirschman index of vendor shares, 0..10 000. */
  hhi: z.number().min(0).max(10_000),
  /** Share of the five largest vendors. */
  top5Share: Fraction,
  /** Share of preferred vendors. */
  preferredShare: Fraction,
  vendorCount: z.number().int().nonnegative(),
});
export type VendorSpendTotals = z.infer<typeof VendorSpendTotals>;

/** `GET /api/t/:tenant/sourcing/vendors?scenario=`. `vendors` sorted by spend, descending. */
export const VendorSpend = z.object({
  scenarioId: ScenarioId,
  /** `year` member the spend is taken from (the baseline year). */
  year: MemberKey,
  vendors: z.array(VendorSpendRow),
  totals: VendorSpendTotals,
});
export type VendorSpend = z.infer<typeof VendorSpend>;

// ---------------------------------------------------------------------------
// F6 · Renewal calendar
// ---------------------------------------------------------------------------

/**
 * Status of a renewal from its notice deadline (thresholds are `sourcing_param` members):
 * `overdue` deadline passed, `act_now` inside the act window, `plan` inside the plan window, `later`.
 */
export const RenewalStatus = z.enum(['overdue', 'act_now', 'plan', 'later']);
export type RenewalStatus = z.infer<typeof RenewalStatus>;

export const RenewalRow = z.object({
  /** `contract` member key. */
  contract: MemberKey,
  vendor: OneLine,
  vendorKey: MemberKey.nullable(),
  category: OneLine,
  /** Annual contract value, $M. */
  annualValue: Money,
  renewalMonth: IsoMonth,
  noticeDeadline: IsoDate,
  /** Days from `asOf` to the notice deadline; negative once it has passed. */
  daysToDeadline: z.number().int(),
  status: RenewalStatus,
  /** Cost of the contract's escalator if it renews unchanged, $M a year. */
  escalatorExposure: Money,
  /** Negotiation target cut, a fraction. */
  targetCut: Fraction,
  /** Saving of that cut that lands in the plan year (from the renewal month on), $M. */
  capture: Money,
});
export type RenewalRow = z.infer<typeof RenewalRow>;

export const RenewalMonth = z.object({
  month: IsoMonth,
  renewals: z.number().int().nonnegative(),
  annualValue: Money,
  capture: Money,
});
export type RenewalMonth = z.infer<typeof RenewalMonth>;

export const RenewalTotals = z.object({
  contracts: z.number().int().nonnegative(),
  annualValue: Money,
  escalatorExposure: Money,
  capture: Money,
  /** Count of renewals per status (every status present, zero allowed). */
  byStatus: z.object({
    overdue: z.number().int().nonnegative(),
    act_now: z.number().int().nonnegative(),
    plan: z.number().int().nonnegative(),
    later: z.number().int().nonnegative(),
  }),
});
export type RenewalTotals = z.infer<typeof RenewalTotals>;

/** `GET /api/t/:tenant/sourcing/renewals?scenario=`. `renewals` sorted by notice deadline. */
export const RenewalCalendar = z.object({
  scenarioId: ScenarioId,
  /** The date days and statuses are counted from (tier 2's today). */
  asOf: IsoDate,
  /** `iyear` / `year` member of the plan year the capture is counted in. */
  planYear: MemberKey,
  renewals: z.array(RenewalRow),
  totals: RenewalTotals,
  /** One entry per month of the window, in order, months without renewals included. */
  byMonth: z.array(RenewalMonth),
});
export type RenewalCalendar = z.infer<typeof RenewalCalendar>;

// ---------------------------------------------------------------------------
// F7 · Should-cost benchmarks
// ---------------------------------------------------------------------------

export const BenchmarkPercentile = z.enum(['p25', 'median', 'p75']);
export type BenchmarkPercentile = z.infer<typeof BenchmarkPercentile>;

/** One benchmarked line: unit cost against the benchmark's percentiles. */
export const BenchmarkRow = z.object({
  /** `benchmark` member key. */
  benchmark: MemberKey,
  /** `line` member key. */
  line: MemberKey,
  label: OneLine,
  pool: MemberKey,
  /** Unit of quantity, e.g. "FTE", "TB-month", "seat". */
  unit: OneLine,
  qty: z.number(),
  /** $ per unit (not $M). */
  unitCost: z.number(),
  p25: z.number(),
  median: z.number(),
  p75: z.number(),
  /** The percentile the gap is measured against (a `sourcing_param`). */
  percentile: BenchmarkPercentile,
  /** max(0, unitCost - chosen percentile), $ per unit. */
  gapPerUnit: z.number().nonnegative(),
  /** gapPerUnit x qty, $M. */
  opportunity: Money,
  /** The part of the opportunity judged capturable, $M. */
  capturable: Money,
});
export type BenchmarkRow = z.infer<typeof BenchmarkRow>;

export const BenchmarkTotals = z.object({
  opportunity: Money,
  capturable: Money,
  /** Savings the scenario's levers already take on the benchmarked pools, $M. */
  leverSavings: Money,
  /** capturable - leverSavings (negative = the levers already go further than the benchmark). */
  headroom: Money,
});
export type BenchmarkTotals = z.infer<typeof BenchmarkTotals>;

/** `GET /api/t/:tenant/sourcing/benchmarks?scenario=`. `rows` sorted by opportunity, descending. */
export const BenchmarkGap = z.object({
  scenarioId: ScenarioId,
  rows: z.array(BenchmarkRow),
  totals: BenchmarkTotals,
});
export type BenchmarkGap = z.infer<typeof BenchmarkGap>;

// ---------------------------------------------------------------------------
// Sourcing parameters (`sourcing_param` members)
// ---------------------------------------------------------------------------

/** One `sourcing_param` member: the same shape as a registry entry. Edited through a changeset. */
export const SourcingParam = z
  .object({
    key: SourcingParamKey,
    label: OneLine,
    /** Panel the parameter belongs to, e.g. "consolidation", "renewals", "business case". */
    group: OneLine,
    value: z.number(),
    /** Display unit, e.g. "%", "$M", "months"; empty when unitless. */
    unit: z.string(),
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
  })
  .refine((p) => p.min <= p.value && p.value <= p.max, {
    message: 'value must lie in [min, max]',
    path: ['value'],
  });
export type SourcingParam = z.infer<typeof SourcingParam>;

/** `GET /api/t/:tenant/sourcing/params`. */
export const SourcingParams = z.object({ params: z.array(SourcingParam) });
export type SourcingParams = z.infer<typeof SourcingParams>;

// ---------------------------------------------------------------------------
// F8 · Vendor consolidation optimizer
// ---------------------------------------------------------------------------

/**
 * `POST /api/t/:tenant/sourcing/consolidation`: run the optimizer on the scenario's spend cube.
 * `params` overrides `sourcing_param` values for this run only (what-if, nothing is written);
 * absent keys take the members' values. Only pools listed as `consolidation_scope` members are considered.
 */
export const ConsolidationRequest = z.object({
  scenarioId: ScenarioId,
  params: z.record(SourcingParamKey, z.number()).optional(),
});
export type ConsolidationRequest = z.infer<typeof ConsolidationRequest>;

/** One move of tail spend to a preferred vendor. */
export const ConsolidationMove = z.object({
  from: OneLine,
  fromKey: MemberKey.nullable(),
  to: OneLine,
  toKey: MemberKey.nullable(),
  /** `pool` member the spend moves in (a move stays inside one pool the receiving vendor already serves). */
  pool: MemberKey,
  /** Annual spend moved, $M. */
  spendMoved: Money,
  /** Annual saving of the move, $M. */
  annualSaving: Money,
  /** One-time transition cost, $M. */
  oneTimeCost: Money,
  /** Months for the saving to repay the one-time cost; 0 when there is none, null when never. */
  paybackMonths: z.number().nonnegative().nullable(),
  /** Net benefit over the business-case horizon, $M: NPV of the savings at the discount rate less the one-time cost. */
  netBenefit: Money,
});
export type ConsolidationMove = z.infer<typeof ConsolidationMove>;

export const ConsolidationTotals = z.object({
  spendMoved: Money,
  annualSaving: Money,
  oneTimeCost: Money,
  paybackMonths: z.number().nonnegative().nullable(),
  vendorsBefore: z.number().int().nonnegative(),
  vendorsAfter: z.number().int().nonnegative(),
});
export type ConsolidationTotals = z.infer<typeof ConsolidationTotals>;

/** A constraint that stopped the optimizer going further: a `sourcing_param` and its limit. */
export const ConsolidationBinding = z.object({
  param: SourcingParamKey,
  label: OneLine,
  value: z.number(),
});
export type ConsolidationBinding = z.infer<typeof ConsolidationBinding>;

/** The optimizer's answer. `moves` ranked by net benefit, descending. */
export const ConsolidationResult = z.object({
  scenarioId: ScenarioId,
  moves: z.array(ConsolidationMove),
  totals: ConsolidationTotals,
  hhiBefore: z.number().min(0).max(10_000),
  hhiAfter: z.number().min(0).max(10_000),
  /** Largest single vendor share after the moves. */
  topVendorShareAfter: Fraction,
  binding: z.array(ConsolidationBinding),
  /** The parameter values the run used (members merged with the request's overrides). */
  params: z.record(SourcingParamKey, z.number()),
  /** True when the optimizer's search finished inside its budget: no plan of moves does better. */
  exact: z.boolean(),
});
export type ConsolidationResult = z.infer<typeof ConsolidationResult>;
