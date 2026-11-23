/**
 * SOL-04 contract entry point `minRiskMix()`: `runSolver` on the `min_risk_mix` problem
 * (src/problems/min-risk.ts), with abort and progress like any solver.
 */
import type { SolverModel } from './model';
import { runSolver, type RunOptions } from './run';
import type { MinRiskMixParams, SolverResult } from './types';

/** Minimum-risk lever mix that clears the bar (03 §3 `min_risk_mix`); `{}` = min risk exposure, total bar. */
export function minRiskMix(
  model: SolverModel,
  params: MinRiskMixParams = {},
  options?: RunOptions,
): Promise<SolverResult<'min_risk_mix'>> {
  return runSolver(model, { problem: 'min_risk_mix', params }, options);
}
