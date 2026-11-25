/**
 * SOL-05 contract entry point `vpFeasible()`: `runSolver` on the `vp_feasible` problem
 * (src/problems/vp-feasible.ts), with abort and progress like any solver.
 */
import type { SolverModel } from './model';
import { runSolver, type RunOptions } from './run';
import type { SolverResult, VpFeasibleParams } from './types';

/**
 * Plan where every VP clears its own bar (03 §3 `vp_feasible`): the minimum-risk mix with `per_vp` bars;
 * when that is infeasible, the plan that maximises the minimum `vp.coverage` (status `infeasible`).
 */
export function vpFeasible(
  model: SolverModel,
  params: VpFeasibleParams = {},
  options?: RunOptions,
): Promise<SolverResult<'vp_feasible'>> {
  return runSolver(model, { problem: 'vp_feasible', params }, options);
}
