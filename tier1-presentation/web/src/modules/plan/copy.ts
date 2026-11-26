import type { QuickSolverSpec, SolverSpec } from '@glidepath/api-contract';

/**
 * Plan screen words and the solver questions it asks (SRC-18). Every number shown is tier 2's; the only
 * numbers here are display choices (the percent cap), never business values.
 */

/** Short column words for the stress outputs tier 2 reports (wire cell keys); others read their node label. */
export const STRESS_COLUMNS: Readonly<Record<string, string>> = {
  'res.net[]': 'Δ Net',
  'res.gap[]': 'Δ Gap',
  'br.eps27[]': 'Δ EPS',
  'res.risk[]': 'Δ Risk-adj',
};

/** The breakeven output (tier 2's default, `res.gap[]`): its node formats a row's best-value gap. */
export const BREAKEVEN_OUTPUT_NODE = 'res.gap';

/** Step of a shock's scale stepper (a UI choice; the bounds are the contract's `STRESS_SCALE_MIN/MAX`). */
export const SCALE_STEP = 0.25;

/** Breakeven: every lever-intensity input against `res.gap[] = 0`, all tier 2's defaults. */
export const breakevenSpec = { problem: 'breakeven', params: {} } as const satisfies QuickSolverSpec;

/**
 * The stress question: every shock tier 2 knows unless some are switched off (`on`: the names to run, `null` =
 * all), each at its scale (absent = as written). Shock names come from tier 2's `detail.catalog`.
 */
export const stressSpec = (
  on: readonly string[] | null,
  scales: Readonly<Record<string, number>>,
): QuickSolverSpec => ({
  problem: 'stress_presets',
  params: {
    ...(on === null ? {} : { presets: [...on] }),
    ...(Object.keys(scales).length === 0 ? {} : { scales: { ...scales } }),
  },
});

/** Wave plan: tier 2 fills the caps and the window from the tenant's `wave_plan` parameters. */
export const waveSpec = { problem: 'wave_plan', params: {} } as const satisfies SolverSpec;

/**
 * IRR and ROI on lever cases run to thousands of percent; above this (a fraction, 5 = 500%) the table reads
 * ">500%". A display choice only.
 */
export const PCT_CAP = 5;

/** `sourcing_param` groups edited on this screen (seed: tier3-data/seed/aa/sourcing.json). */
export const GROUP = { businessCase: 'business_case', wavePlan: 'wave_plan' } as const;

export const COPY = {
  module: 'Plan',
  scrollBreakeven: 'Breakeven rows (scrolls)',
  scrollBusinessCase: 'Business case rows (scrolls)',
  scrollWaves: 'Wave plan details (scrolls)',
  breakeven: 'Breakeven by lever',
  stress: 'Stress tests',
  businessCase: 'Business case',
  waves: 'Wave planner',
  run: 'Run',
  rerun: 'Run again',
  failed: 'The run failed',
  stale: 'from earlier inputs',
  noRun: 'No run on this scenario yet.',
  best: 'best',
  scale: 'Size',
  notReachable: 'not reachable in range',
  beyondRange: 'outside range',
  reachable: 'reachable',
  presets: 'Shocks',
  openScenario: 'Open as scenario',
  opening: 'Saving…',
  saved: 'Wave plan saved as a scenario',
  never: 'never',
  noMoves: 'No start month moves under these caps.',
  bound: 'Bound by',
  sizesFixed: 'Shock sizes are set by tier 2',
} as const;
