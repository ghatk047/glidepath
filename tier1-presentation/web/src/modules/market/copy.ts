/**
 * Market copy and the spec ids it binds (03_screens "Shareholder view"). Ids are verbatim from
 * `docs/spec`; words are UX copy. No numbers: every value on the screen comes from tier 2.
 */

export const COPY = {
  module: 'Shareholder view',
  traceLabel: (year: string | null) => `From IT savings to share price · ${year ?? ''}`.trimEnd(),
  traceList: 'From IT savings to share price',
  showFormulas: 'Show formulas',
  driversLabel: 'Drivers · FY27',
  reset: 'Reset',
  valuation: 'Valuation multiple',
  valuationBasis: 'Valuation basis',
  basisEv: 'EV / EBITDAR',
  basisPe: 'P/E',
  peWeight: 'P/E weight',
  epsLabel: 'Adjusted EPS',
  epsUnit: '$ / share',
  priceLabel: 'Share price',
  withoutIt: 'Without IT program',
  withIt: 'With IT program',
  worth: 'The program is worth',
  fuelTail: 'a gallon of jet fuel.',
  moreDrivers: 'More drivers',
  moreDriversName: (n: number | null) => (n === null ? 'More drivers' : `More drivers · ${n}`),
  laborGroup: 'Labor group',
  sharesNote: 'm shares',
  vsBase: 'vs base',
  note: 'Every number on this screen is the engine’s: a driver writes to the scenario, tier 2 recalculates, and the chain above shows each step.',
} as const;

/** The year the Drivers dials edit (FY27, a member of the `iyear` dimension). */
export const DRIVER_YEAR = 'fy27';

/** Members of the `year` dimension the share price panel and the chain read. */
export const YEAR = { base: 'fy27b', withIt: 'fy27it' } as const;

/** Short names of the `year` members as the render labels the EPS bars; else the member's label. */
export const YEAR_SHORT: Readonly<Record<string, string>> = {
  fy25: 'FY25A',
  fy26: 'FY26E',
  fy27b: 'FY27E base',
  fy27it: 'FY27E + IT',
};

/** The chain, in order (03_screens: Trace (12)). */
export const TRACE_IDS = [
  'res.net',
  'pnl.o27',
  'res.tot_ot_all',
  'br.ebitda27',
  'br.eps27',
  'br.px27',
  'br.mcap27',
] as const;
export type TraceId = (typeof TRACE_IDS)[number];

/** Labels and notes of the chain nodes (copy only). */
export const TRACE_COPY: Readonly<Record<TraceId, { label: string; note?: string }>> = {
  'res.net': { label: 'IT net savings', note: 'Cash test vs CY26' },
  'pnl.o27': { label: 'P&L opex saved', note: 'opex lines only' },
  'res.tot_ot_all': { label: 'One-time', note: 'P&L bears all of it' },
  'br.ebitda27': { label: 'EBITDA', note: 'after profit sharing' },
  'br.eps27': { label: 'EPS' },
  'br.px27': { label: 'Share price' },
  'br.mcap27': { label: 'Market cap' },
};

/** The six dials in render order (the labor dial has a group picker: no all-group node exists). */
export const DIALS = [
  { id: 'corp.brent', label: 'Brent' },
  { id: 'corp.crack', label: 'Jet crack' },
  { id: 'corp.gdp', label: 'US GDP' },
  { id: 'corp.lab_wage_g', label: 'Labor pay' },
  { id: 'corp.ac_add', label: 'Aircraft added' },
  { id: 'corp.sofr', label: 'SOFR' },
] as const;

export const LABOR_VARIABLE = 'corp.lab_wage_g';
export const VALUATION = { ev: 'corp.ev_mult', pe: 'corp.pe', weight: 'corp.w_pe' } as const;

/** Registry group "More drivers" lists in full. */
export const CORPORATE_GROUP = 'Corporate drivers';

/** "More drivers" sections in order. Presentation grouping of the registry ids, not data. */
export const DRIVER_GROUPS = [
  { key: 'macro', label: 'Macro' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'demand', label: 'Demand' },
  { key: 'labor', label: 'Labor' },
  { key: 'fleet', label: 'Fleet' },
  { key: 'airports', label: 'Airports' },
  { key: 'financing', label: 'Financing' },
  { key: 'tax', label: 'Tax' },
  { key: 'valuation', label: 'Valuation' },
] as const;
export type DriverGroupKey = (typeof DRIVER_GROUPS)[number]['key'];

const g = (key: DriverGroupKey, ids: string): [string, DriverGroupKey][] =>
  ids.split(' ').map((id) => [`corp.${id}`, key]);

/** Group of each corporate driver id. An id missing here lands in "Other" (none is dropped). */
export const DRIVER_GROUP_OF: Readonly<Record<string, DriverGroupKey>> = Object.fromEntries([
  ...g('macro', 'gdp gdp_ref yield_gdp lf_gdp cpi fx_share usd'),
  ...g('fuel', 'brent crack fuel_tax fuel_mode jet_direct gpa25 fuel_eff'),
  ...g(
    'demand',
    'asm25 asm_g lf yield25 yield_g cargo25 cargo_g other25 other_g oth25 oth_vol oth_prem',
  ),
  ...g('labor', 'ben_load lab_hc25 lab_rate25 lab_hc_g lab_wage_g ps_rate it_swb it_swb_mode'),
  ...g(
    'fleet',
    'ac25 ac_add lease_n lease_rate25 lease_g dpa25 dpa_g oda25 oda_g mxr25 mx_infl dep25 gauge_g oplease slb',
  ),
  ...g('airports', 'aptr25 apt_infl sell_pct reg25 reg_da25 reg_cap_g reg_infl'),
  ...g(
    'financing',
    'si sofr debt_open debt_chg fix_share fix_rate flt_spread cash_open cash_spread oth_inc shares buyback capex wc oth_inv oth_fin pension cal_ocf25 cal_fcf25 cal_cash25',
  ),
  ...g('tax', 'tax cash_tax'),
  ...g(
    'valuation',
    'price_now pe ev_mult w_pe it_on it_risk it_ot_si it_override cust_opex cust_capex cust_ot cust_opex28 cust_capex28',
  ),
]);
