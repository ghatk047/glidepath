/* eslint-disable no-magic-numbers -- the 04 §4 / solvers.json monte_carlo defaults, checked against the spec text by defaults.spec.ts */
/**
 * Monte Carlo defaults of docs/spec/04_solvers_simulation.md §4 and `solvers.json` `problems.monte_carlo`
 * (`default_distributions`, `correlation`, `iterations`, `outputs`). The spec states them as prose, so
 * they live here as data; `defaults.spec.ts` checks every number against the spec text. Each one is a
 * default only: `MonteCarloParams` overrides it per run, and `variable_def.dist` per input.
 */
import type { CellKey, MonteCarloDist } from '../../types';

export interface ProbabilityDef {
  /** Metric name in `SolverResult.metrics`. */
  readonly metric: string;
  readonly cell: CellKey;
  readonly against: CellKey;
}

export interface MonteCarloDefaults {
  /** "2,000 default (seeded, reproducible)". */
  readonly iterations: number;
  /** Seed when the caller gives none: the reference run's (`solvers_demo.py`), so a run is reproducible. */
  readonly seed: number;
  /** Default distribution per variable id (04 §4 Distributions). */
  readonly dists: Readonly<Record<string, MonteCarloDist>>;
  /** The variable whose cells the lever-family copula correlates (realisation per lever). */
  readonly correlatedVar: string;
  /** The dimension of `correlatedVar` that correlation groups list members of. */
  readonly correlatedDim: string;
  /** Default correlation groups: labour levers L01–L08 and technology levers L09–L16 (+ L17), ρ = 0.5. */
  readonly correlation: readonly { readonly levers: readonly string[]; readonly rho: number }[];
  /** P10/P50/P90 and histograms: net, bar, gap, EPS and share price. */
  readonly outputs: readonly CellKey[];
  /** P(cell ≥ against): clear the bar; clear the target ignoring growth. */
  readonly probabilities: readonly ProbabilityDef[];
  /** P(clear) per member of `dim`: `cell[m] ≥ against[m]` (per VP). */
  readonly perMember: { readonly dim: string; readonly metric: string; readonly cell: string; readonly against: string };
  /** Variance contribution: Spearman rank correlation of each `correlatedVar` cell with this output. */
  readonly contributionTo: CellKey;
  readonly bins: number;
  readonly batchSize: number;
  /** Shape weight of the PERT mode when a `pert` distribution gives none. */
  readonly pertLambda: number;
}

const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `L${String(from + i).padStart(2, '0')}`);

export const MONTE_CARLO_DEFAULTS: MonteCarloDefaults = {
  iterations: 2000,
  seed: 20261204,
  dists: {
    // 1.2 × Beta(K·c/1.2, K·(1 − c/1.2)), K = 4, c = lever confidence (mean = confidence).
    'lev.realize': { type: 'confidence_beta', concentration: 4, scale: 1.2, confidence: 'lev.conf' },
    // start + U{0,1,2} months slip.
    'lev.start': { type: 'discrete', values: [0, 1, 2], basis: 'shift' },
    // Triangular(0.7 g, g, 1.4 g).
    'pool.growth': { type: 'triangular', min: 0.7, mode: 1, max: 1.4, basis: 'relative' },
  },
  correlatedVar: 'lev.realize',
  correlatedDim: 'lever',
  // Labour L01–L08 and technology L09–L16 (04 §4). The reference run that produced
  // solver_demo_results.json (`solvers_demo.py`: family = labour if lever number ≤ 8, else tech) also puts
  // L17 in the tech family; it is kept there so the defaults reproduce the G5 reference figures.
  correlation: [
    { levers: range(1, 8), rho: 0.5 },
    { levers: range(9, 17), rho: 0.5 },
  ],
  // val.px is per year: the CY27 price with the IT programme (`fy27it`).
  outputs: ['res.net', 'res.bar', 'res.gap', 'br.eps27', 'val.px[fy27it]'],
  probabilities: [
    { metric: 'p_clear_bar', cell: 'res.net', against: 'res.bar' },
    { metric: 'p_clear_target', cell: 'res.net', against: 'res.target' },
  ],
  perMember: { dim: 'vp', metric: 'p_clear_vp', cell: 'vp.net', against: 'vp.bar' },
  contributionTo: 'res.net',
  bins: 20,
  batchSize: 500,
  pertLambda: 4,
};
