// Sourcing view-models (SRC-06, SRC-08, SRC-09). Domain may not import contract/api-contract (02 §1:
// domain -> spec, engine), so these mirror contract/api-contract/src/sourcing.ts field for field:
// `VendorSpend`, `RenewalCalendar`, `BenchmarkGap`, `SourcingParams`. Keys are plain strings here; the
// server parses each payload with the contract schema, which brands them.

/** One baseline line as the sourcing views read it (members + line_item columns + the scenario's values). */
export interface SourcingLine {
  readonly id: string;
  readonly label: string;
  readonly pool: string;
  /** Vendor name as the line carries it (line_item.vendor_text). */
  readonly vendor: string;
  /** line_item.vendor_key, when the line names a `vendor` member itself. */
  readonly vendorKey: string | null;
  readonly qty: number;
  readonly unit: string;
  readonly addr: string;
  readonly inScope: boolean;
  readonly memo: boolean;
  readonly leverIds: readonly string[];
  /** `line.amount`, $M: the line's input amount in the scenario (qty x unit cost on the seed). */
  readonly amount: number;
  /** `base.line_outlay`, $M: the line's outlay in the scenario (amount x headcount scale). */
  readonly outlay: number;
}

// ---------------------------------------------------------------------------- F5 vendor spend

export interface VendorSpendRow {
  readonly vendor: string;
  readonly vendorKey: string | null;
  readonly preferred: boolean;
  /** An aggregate bucket (`vendor_bucket` member): listed last, left out of HHI, top-5 and the count. */
  readonly aggregate: boolean;
  readonly spend: number;
  readonly share: number;
  readonly cumulativeShare: number;
  readonly lineCount: number;
  readonly pools: readonly string[];
  readonly levers: readonly string[];
  readonly addressableShare: number;
}

export interface VendorSpendTotals {
  readonly thirdPartySpend: number;
  readonly hhi: number;
  readonly top5Share: number;
  readonly preferredShare: number;
  readonly vendorCount: number;
}

export interface VendorSpendView {
  readonly scenarioId: string;
  readonly year: string;
  readonly vendors: readonly VendorSpendRow[];
  readonly totals: VendorSpendTotals;
}

// ---------------------------------------------------------------------------- F6 renewals

export type RenewalStatus = 'overdue' | 'act_now' | 'plan' | 'later';
export const RENEWAL_STATUSES: readonly RenewalStatus[] = ['overdue', 'act_now', 'plan', 'later'];

export interface RenewalRow {
  readonly contract: string;
  readonly vendor: string;
  readonly vendorKey: string | null;
  readonly category: string;
  readonly annualValue: number;
  readonly renewalMonth: string;
  readonly noticeDeadline: string;
  readonly daysToDeadline: number;
  readonly status: RenewalStatus;
  readonly escalatorExposure: number;
  readonly targetCut: number;
  readonly capture: number;
}

export interface RenewalMonthRow {
  readonly month: string;
  readonly renewals: number;
  readonly annualValue: number;
  readonly capture: number;
}

export interface RenewalTotals {
  readonly contracts: number;
  readonly annualValue: number;
  readonly escalatorExposure: number;
  readonly capture: number;
  readonly byStatus: Readonly<Record<RenewalStatus, number>>;
}

export interface RenewalCalendarView {
  readonly scenarioId: string;
  readonly asOf: string;
  readonly planYear: string;
  readonly renewals: readonly RenewalRow[];
  readonly totals: RenewalTotals;
  readonly byMonth: readonly RenewalMonthRow[];
}

// ---------------------------------------------------------------------------- F7 benchmarks

export type BenchmarkPercentile = 'p25' | 'median' | 'p75';

export interface BenchmarkRow {
  readonly benchmark: string;
  readonly line: string;
  readonly label: string;
  readonly pool: string;
  readonly unit: string;
  readonly qty: number;
  readonly unitCost: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly percentile: BenchmarkPercentile;
  readonly gapPerUnit: number;
  readonly opportunity: number;
  readonly capturable: number;
}

export interface BenchmarkTotals {
  readonly opportunity: number;
  readonly capturable: number;
  readonly leverSavings: number;
  readonly headroom: number;
}

export interface BenchmarkGapView {
  readonly scenarioId: string;
  readonly rows: readonly BenchmarkRow[];
  readonly totals: BenchmarkTotals;
}

// ---------------------------------------------------------------------------- parameters

export interface SourcingParamRow {
  readonly key: string;
  readonly label: string;
  readonly group: string;
  readonly value: number;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}
