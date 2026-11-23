import { toCellKey, type SolverObjective } from '@glidepath/api-contract';

/**
 * Path copy and the spec ids it binds (03_screens "Find a path"; solvers.json `min_risk_mix`).
 * Ids are verbatim from `docs/spec`; words are UX copy. No numbers: every value on the screen
 * comes from tier 2 (the session or a solver run).
 */

/** `min_risk_mix.objective_options`, in the render's order, with the render's words. */
export const OBJECTIVES: readonly {
  readonly id: SolverObjective;
  readonly label: string;
  /** Lower-case name in the result header ("Path found · lowest risk"). */
  readonly short: string;
}[] = [
  { id: 'min_risk_exposure', label: 'Lowest delivery risk', short: 'lowest risk' },
  { id: 'max_risk_adjusted_net', label: 'Most risk-adjusted savings', short: 'most risk-adjusted' },
  { id: 'min_one_time', label: 'Least one-time cost', short: 'least one-time' },
  { id: 'min_people_impact', label: 'Fewest people moves', short: 'fewest people moves' },
  { id: 'min_change', label: 'Smallest change from plan', short: 'smallest change' },
];

/** solvers.json: `min_risk_exposure` is the default objective. */
export const DEFAULT_OBJECTIVE: SolverObjective = 'min_risk_exposure';

/** solvers.json `methods`: `explainable` is the default in the UI (an ordered list of moves). */
export const METHOD = 'explainable' as const;

/** Goal: the bar (`res.bar`) is shown; editing it sets the net target, as on the Cockpit. */
export const GOAL_NODE = 'res.bar';
export const TARGET_VARIABLE = 'g.target_net';

/** Nodes the optional constraints act on (solvers.json `us_floor`, `one_time_cap`). */
export const FLOOR_NODE = 'res.fte_us';
export const CAP_NODE = 'res.tot_ot_it';

/** `SolverResult.metrics` keys: cell keys of the headline nodes. */
export const METRIC = {
  net: toCellKey('res.net'),
  gap: toCellKey('res.gap'),
  risk: toCellKey('res.risk'),
  oneTime: toCellKey('res.tot_ot_it'),
  fteUs: toCellKey('res.fte_us'),
  eps: toCellKey('br.eps27'),
} as const;

/**
 * Metrics named by tier 2 (not cells): expected non-delivery (`min_risk_exposure`), and its
 * references per scenario key, `risk_exposure[C]`, `risk_exposure[D]` (the render's
 * "C: $37.3M · D: $54.8M"); search size `evaluations`, `steps`.
 */
export const RISK_EXPOSURE = 'risk_exposure';
export const EVALUATIONS = 'evaluations';
export const STEPS = 'steps';

/** Preset keys of the quick blend (`scenario_blend`), as the render's "Blend C → D". */
export const BLEND_PAIR = { from: 'C', to: 'D' } as const;

/** Rows of "Compare with C": the start scenario's cells beside the result's metrics. */
export const COMPARE_ROWS: readonly {
  readonly label: string;
  readonly node: string;
  readonly format: 'money' | 'fte' | 'eps';
}[] = [
  { label: 'Net', node: 'res.net', format: 'money' },
  { label: 'Risk-adjusted', node: 'res.risk', format: 'money' },
  { label: 'One-time in IT', node: 'res.tot_ot_it', format: 'money' },
  { label: 'US headcount', node: 'res.fte_us', format: 'fte' },
  { label: 'EPS 27', node: 'br.eps27', format: 'eps' },
];

/** Two-digit calendar year label (`2027` → `CY27`). Text only. */
export const cy = (year: number): string => `CY${String(year).slice(-2)}`;

export const COPY = {
  module: 'Find a path',
  goal: 'Goal',
  goalNote: (year: string | null) => (year ? `net, ${year}` : 'net'),
  editGoal: 'Edit the net target',
  optimiseFor: 'Optimise for',
  holdTo: 'Hold to',
  perVp: 'Every VP clears its own bar',
  usFloor: 'US headcount ≥',
  usFloorName: 'US headcount floor',
  oneTimeCap: 'One-time in IT ≤',
  oneTimeCapName: 'One-time in IT cap, $M',
  stretch: 'No lever past full stretch',
  estimates: 'Estimates stay fixed',
  alwaysOn: 'always on',
  find: 'Find a path',
  finding: 'Finding a path…',
  blendAction: (from: string, to: string) => `Blend ${from} → ${to}`,
  result: 'Path',
  found: (objective: string) => `Path found · ${objective}`,
  notFound: (objective: string) => `No path found · ${objective}`,
  searching: (objective: string) => `Finding a path · ${objective}`,
  blendFound: (from: string, to: string) => `Blend ${from} → ${to}`,
  blendAt: (pct: string, from: string, to: string) =>
    `Bar cleared ${pct} of the way from ${from} to ${to}`,
  noBlend: (from: string, to: string) => `No mix of ${from} and ${to} clears the bar`,
  search: (evaluations: string, steps: string) => `${evaluations} evaluations · ${steps} steps`,
  empty: 'No path on this scenario yet.',
  barCleared: 'Bar cleared',
  barShort: 'Bar not cleared',
  riskExposure: 'Risk exposure',
  oneTimeIt: 'One-time in IT',
  usHeadcount: 'US headcount',
  unchanged: 'unchanged',
  fromNow: (value: string) => `from ${value}`,
  eps: 'EPS 27',
  moves: (from: string) => `Moves from ${from}, most valuable first`,
  tick: (from: string) => `grey tick = ${from}`,
  save: 'Save as scenario',
  saving: 'Saving…',
  saved: 'Saved as scenario',
  compare: (from: string) => `Compare with ${from}`,
  compareTable: (from: string) => `Path compared with ${from}`,
  pathColumn: 'Path',
  failed: 'The run failed.',
} as const;
