/**
 * SOL-02 contract entry points `goalSeek()` and `breakeven()`: `runSolver` on the `goal_seek` and
 * `breakeven` problems (src/problems/goal-seek.ts), with abort and progress like any solver.
 */
import type { SolverModel } from './model';
import { runSolver, type RunOptions } from './run';
import type { BreakevenParams, GoalSeekParams, SolverResult } from './types';

/** Solves one input cell so that `params.output` hits `params.target` (03 §3 `goal_seek`). */
export function goalSeek(model: SolverModel, params: GoalSeekParams, options?: RunOptions): Promise<SolverResult<'goal_seek'>> {
  return runSolver(model, { problem: 'goal_seek', params }, options);
}

/** One row per lever-intensity input (or per given input): current, needed, feasible (03 §3 `breakeven`). */
export function breakeven(
  model: SolverModel,
  params: BreakevenParams = {},
  options?: RunOptions,
): Promise<SolverResult<'breakeven'>> {
  return runSolver(model, { problem: 'breakeven', params }, options);
}
