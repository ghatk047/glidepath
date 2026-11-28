// SRC-16 view-model. Domain may not import contract/api-contract (02 §1), so these mirror the contract's
// plan.ts schemas field for field (`BusinessCase`, `BusinessCaseRow`, `BusinessCaseTotals`); the server
// parses the payload with `BusinessCase`, which brands the keys.

/** The measures of one lever, or of the portfolio (the sum of the levers' cash flows). $M; fractions. */
export interface BusinessCaseMetrics {
  /** Savings by year key, one entry per year of the horizon. */
  readonly savings: Readonly<Record<string, number>>;
  /** One-time cost (`lev.ot`, before the funding split). */
  readonly oneTime: number;
  /** Annual run-rate saving at full ramp (`lev.rr`). */
  readonly runRate: number;
  /** Net present value of the savings less the one-time cost, at the discount rate. */
  readonly npv: number;
  /** Months until cumulative savings repay the one-time cost; 0 with no one-time cost; null if never in the horizon. */
  readonly paybackMonths: number | null;
  /** Internal rate of return; null when not defined (no one-time cost, or no sign change). */
  readonly irr: number | null;
  /** (Σ savings over the horizon − one-time) / one-time; null with no one-time cost. */
  readonly roi: number | null;
}

/** One lever's case (contract `BusinessCaseRow`). */
export interface BusinessCaseLeverRow extends BusinessCaseMetrics {
  readonly lever: string;
  readonly label: string;
}

/** `GET plan/business-case` (contract `BusinessCase`). */
export interface BusinessCaseView {
  readonly scenarioId: string;
  readonly discountRate: number;
  readonly years: readonly string[];
  readonly levers: readonly BusinessCaseLeverRow[];
  readonly totals: BusinessCaseMetrics;
}

/** A cash-flow profile: the one-time cost at t0, the savings by year (end of year) and by month. */
export interface CashFlows {
  readonly oneTime: number;
  readonly runRate: number;
  /** Savings of plan year 1..H. */
  readonly annual: readonly number[];
  /** Savings of month 1..12H from the start of the plan year. */
  readonly monthly: readonly number[];
}
