// SRC-06, SRC-08, SRC-09: pure sourcing views over the lines, the scenario's evaluation and the tenant
// dimensions contract, benchmark and sourcing_param. No IO; every number comes from data or parameters.
export { PERCENTILES, USD_PER_MUSD, benchmarkGap, poolLeverSavings } from './benchmarks';
export { SOURCING_CELLS, VendorDirectory, counted, sourcingLines, sourcingYears, thirdPartyPools } from './lines';
export type { LineItemColumns, SourcingYears } from './lines';
export { SOURCING_PARAM_KEYS, SourcingDataError, readSourcingParams } from './params';
export type { SourcingParamsLookup } from './params';
export { isoMonth, monthIndex, parseMonth, renewalCalendar } from './renewals';
export type { RenewalCalendarArgs } from './renewals';
export { RENEWAL_STATUSES } from './types';
export type {
  BenchmarkGapView,
  BenchmarkPercentile,
  BenchmarkRow,
  BenchmarkTotals,
  RenewalCalendarView,
  RenewalMonthRow,
  RenewalRow,
  RenewalStatus,
  RenewalTotals,
  SourcingLine,
  SourcingParamRow,
  VendorSpendRow,
  VendorSpendTotals,
  VendorSpendView,
} from './types';
export { ADDRESSABLE_TAGS, NO_VENDOR, TOP_VENDORS, bucketNames, vendorSpend } from './vendor-spend';
