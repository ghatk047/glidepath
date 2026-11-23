/**
 * Cockpit copy and the spec ids it binds (03_screens "Path to the bar"). Ids are verbatim from
 * `docs/spec`; words are UX copy. No numbers: every value on the screen comes from tier 2.
 */

/** Net savings panel (gauge, hero, stat row). */
export const NET_NODES = {
  net: 'res.net',
  bar: 'res.bar',
  target: 'res.target',
  gap: 'res.gap',
  risk: 'res.risk',
  runRate: 'res.tot_rr',
  oneTimeIt: 'res.tot_ot_it',
} as const;

/** The input behind `res.target` (edited from the "of $X bar" number, as in the prototype). */
export const TARGET_VARIABLE = 'g.target_net';

/** Cells the `bridge` view (ADR-021, DOM-06) carries, in step order. */
export const BRIDGE_CELLS = [
  'base.total',
  'base.headwinds',
  'res.tot_iy',
  'res.tot_ot_it',
  'res.cy27_outlay',
] as const;

/**
 * Short labels of the hero inputs as the Cockpit render shows them. Which inputs are hero comes
 * from the registry (`ui.hero`, via the bundle); an id not listed here shows its registry label.
 */
export const HERO_LABELS: Readonly<Record<string, string>> = {
  'g.target_net': 'Net target',
  'g.ot_out_share': 'One-time funded outside IT',
  'hc.us': 'US FTE',
  'hc.gcc': 'GCC FTE',
  'hc.ctr': 'Contractors',
};

/** Registry units drawn as a stepper (head counts); every other hero input is a slider. */
export const STEPPER_UNITS: ReadonlySet<string> = new Set(['FTE']);

/** VP rings: one tile per active member of the `vp` dimension (`/members`), cells `id[vp]`. */
export const VP_DIM = 'vp';
export const VP_NODES = {
  net: 'vp.net',
  bar: 'vp.bar',
  gap: 'vp.gap',
  outlay: 'vp.outlay',
} as const;

/**
 * Short VP names as the Cockpit render shows them, by `vp` member key. A member not listed here
 * (another tenant, a fifth VP) shows its `/members` label.
 */
export const VP_LABELS: Readonly<Record<string, string>> = {
  vp_commercial: 'Commercial',
  vp_operations: 'Operations',
  vp_corporate: 'Corporate',
  vp_infra: 'Infra & Other',
};

/**
 * Shareholder view: the IT effect on EPS and share price (`br.eps27`, `br.px27`), EPS and price
 * without and with the programme (`pl.eps`, `val.px` on the `year` members `fy27b` → `fy27it`)
 * and the jet-fuel equivalent. Member keys are the spec's, verbatim.
 */
export const SHAREHOLDER_NODES = {
  eps: 'br.eps27',
  price: 'br.px27',
  epsLevel: 'pl.eps',
  priceLevel: 'val.px',
  fuel: 'br.fuel_equiv_cents',
} as const;
export const SHAREHOLDER_YEARS = { before: 'fy27b', after: 'fy27it' } as const;

/**
 * Odds: cells read from the Monte Carlo `solver_run` result's `detail`: the net distribution
 * (histogram, P10 / P50 / P90, P(net ≥ bar)) and the bar line at the bar's P50, as the
 * prototype draws it.
 */
export const ODDS_CELLS = { net: 'res.net', bar: 'res.bar' } as const;

/**
 * Fastest path: `metrics` keys read from the min-risk (`min_risk_mix`) `solver_run` result.
 * `res.net` is a model cell, so it is keyed in the contract's cell-key form `res.net[]` (tier 2
 * maps every solver's cells to it, API-13; the panel builds the key with `toCellKey`);
 * `risk_exposure` as the solver names it (expected non-delivery); `people_moves`, the number of
 * moves on people levers (no solver sends it yet: absent, the clause is left out, nothing guessed).
 */
export const PATH_METRICS = {
  net: 'res.net',
  risk: 'risk_exposure',
  people: 'people_moves',
} as const;
/** Moves listed on the tile (render: the first three of tier 2's ranked list). */
export const PATH_TOP_MOVES = 3;

/**
 * Short names of solver moves as the renders show them (prototype `SHORT`). A variable not
 * listed here shows its registry label.
 */
export const MOVE_LABELS: Readonly<Record<string, string>> = {
  'lev.L01.cut': 'SI change portfolio cut',
  'lev.L01.rel': 'Run-side capacity released',
  'lev.L01.ot_pct': 'One-time (PMO)',
  'lev.L02.cut': 'Consulting spend cut',
  'lev.L03.pct': 'Onshore roles relocated',
  'lev.L03.tc': 'Transition cost / role',
  'lev.L04.pct': 'SI offshore → GCC',
  'lev.L04.tc': 'Conversion cost / head',
  'lev.L04.pf': 'GCC productivity',
  'lev.L05.nb': 'US leavers not backfilled',
  'lev.L05.bf': '…backfilled in GCC',
  'lev.L05.sl': 'Spans & layers',
  'lev.L05.rel': 'Targeted relocation',
  'lev.L05.vac': 'Vacancy harvest',
  'lev.L05.sev': 'Severance multiple',
  'lev.L06.gain': 'AI productivity gain',
  'lev.L06.cap': 'Captured in price',
  'lev.L06.tool': 'AI tooling run cost',
  'lev.L07.pct': 'Tail SI → panel',
  'lev.L07.diff': 'Panel rate advantage',
  'lev.L07.ot_pct': 'Transition one-time',
  'lev.L08.cov': 'SI spend reopened',
  'lev.L08.cut': 'Headline rate cut',
  'lev.L08.leak': 'Vendor leakage',
  'lev.L09.n': 'Apps retired',
  'lev.L09.dc': 'Decommission cost / app',
  'lev.L10.shelf': 'Shelfware harvested',
  'lev.L10.ms': 'Microsoft optimisation',
  'lev.L10.rcut': 'Renewal saving',
  'lev.L10.ren': 'Share renewing in 2027',
  'lev.L11.pct': 'Cloud cost reduction',
  'lev.L11.setup': 'FinOps one-time',
  'lev.L12.tpm': 'Maintenance → TPM',
  'lev.L12.life': 'Refresh deferred',
  'lev.L12.colo': 'Colo consolidation',
  'lev.L12.tpm_saving': 'TPM saving rate',
  'lev.L13.pct': 'Network reduction',
  'lev.L13.ot_pct': 'SD-WAN one-time',
  'lev.L14.pct': 'End-user reduction',
  'lev.L15.pct': 'Platform volume & tiers',
  'lev.L16.pct': 'Invoice & rebate recovery',
  'lev.L17.cola': 'Vendor COLA refused',
  'lev.L17.sw': 'Software uplifts avoided',
  'lev.L17.cl': 'Cloud growth contained',
};

/** Two-digit calendar year label (`2027` → `CY27`). Text only. */
export const cy = (year: number): string => `CY${String(year).slice(-2)}`;

export const COPY = {
  module: 'Cockpit',
  netLabel: (year: string) => `Net savings · ${year}`,
  bridgeLabel: (from: string, to: string) => `${from} → ${to} outlay`,
  inputsLabel: 'Your inputs',
  axisNote: (floor: string) => `axis starts at ${floor}`,
  of: 'of',
  bar: 'bar',
  risk: 'Risk-adjusted',
  /** The run-rate is the exit rate of the target year, read in the year after it. */
  runRate: (year: number | null) => (year === null ? 'Run-rate' : `${String(year)} run-rate`),
  oneTimeIt: 'One-time in IT',
  allInputs: (count: number | null) => (count === null ? 'All inputs' : `All ${String(count)}`),
  allInputsName: (count: number | null) =>
    // starts with the visible text ("All 194"): WCAG 2.5.3, label in name
    count === null ? 'All inputs: find any' : `All ${String(count)} inputs: find any`,
  edited: 'edited',
  editTarget: 'Edit the net target',
  // VP rings
  openVps: (name: string) => `${name}: open VPs`,
  // Shareholder view
  shareholderLabel: (year: number | null) =>
    year === null ? 'Shareholder view' : `Shareholder view · ${String(year)}`,
  openMarket: 'Open the shareholder view',
  eps: 'EPS',
  sharePrice: 'Share price',
  epsYear: (year: number | null) => (year === null ? 'EPS' : `EPS ${String(year)}`),
  price: 'Price',
  fuelBefore: 'Same as',
  fuelAfter: 'off every gallon of jet fuel',
  // Odds
  oddsLabel: 'Odds',
  p50: (text: string) => `P50 ${text}`,
  chanceOfClearing: 'chance of clearing the bar',
  runs: (text: string) => `${text} runs`,
  notSimulated: 'This scenario has not been simulated.',
  /**
   * The empty state's action (03_screens, 02 §6). The count is tier 2's default, as its look-up
   * answered (`trials`); until then the action carries no number. Tier 1 sends no count either.
   */
  runTrials: (trials: string | null) => (trials === null ? 'Run trials' : `Run ${trials} trials`),
  distribution: 'Distribution of net savings',
  // Fastest path
  pathLabel: 'Fastest path to the bar',
  moves: (n: number) => `${String(n)} ${n === 1 ? 'move' : 'moves'}`,
  riskExposure: (text: string) => `risk exposure ${text}`,
  people: (n: number) =>
    n === 0 ? 'no people levers' : `${String(n)} people ${n === 1 ? 'lever' : 'levers'}`,
  noPath: 'No path has been found for this scenario yet.',
  showPath: 'Show me a path',
  topMoves: 'Top moves',
  startFailed: 'The run could not start',
} as const;
