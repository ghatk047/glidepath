import type { QuickSolverSpec, SolverSpec } from '@glidepath/api-contract';

/**
 * Plan screen words and the solver questions it asks (SRC-18). Every number shown is tier 2's; the only
 * numbers here are display choices (the percent cap), never business values.
 */

/**
 * The named shocks of `solvers.json` (`problems[stress_presets].examples[].name`), verbatim and in spec order.
 * Tier 2 holds their definitions; the contract (`StressPresetsParams`) asks for at least one name and offers no
 * list route, so the names are spec ids here, like Path's `BLEND_PAIR`.
 */
export const STRESS_PRESETS: readonly string[] = [
  'GCC hiring freeze',
  'Vendors win COLA',
  'Programme starts in Q2',
  'All one-time costs on IT',
  'Fuel +30c',
];

/** Short column words for the stress outputs tier 2 reports (wire cell keys); others read their node label. */
export const STRESS_COLUMNS: Readonly<Record<string, string>> = {
  'res.net[]': 'Δ Net',
  'res.gap[]': 'Δ Gap',
  'br.eps27[]': 'Δ EPS',
};

/** Breakeven: every lever-intensity input against `res.gap[] = 0`, all tier 2's defaults. */
export const breakevenSpec = { problem: 'breakeven', params: {} } as const satisfies QuickSolverSpec;

export const stressSpec = (presets: readonly string[]): QuickSolverSpec => ({
  problem: 'stress_presets',
  params: { presets: [...presets] },
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
  breakeven: 'Breakeven by lever',
  stress: 'Stress tests',
  businessCase: 'Business case',
  waves: 'Wave planner',
  run: 'Run',
  rerun: 'Run again',
  failed: 'The run failed',
  stale: 'from earlier inputs',
  noRun: 'No run on this scenario yet.',
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
