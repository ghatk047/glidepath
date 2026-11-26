// SRC-16: the plan module's pure views (the lever business case). No IO.
export {
  BUSINESS_CASE_CELLS,
  BUSINESS_CASE_PARAM_KEYS,
  businessCase,
  businessCaseParams,
  caseMetrics,
  horizonYearKeys,
  irr,
  leverCashFlows,
  npv,
  paybackMonths,
  roi,
  sumCashFlows,
} from './business-case';
export type { BusinessCaseArgs } from './business-case';
export type { BusinessCaseLeverRow, BusinessCaseMetrics, BusinessCaseView, CashFlows } from './types';
