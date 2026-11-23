/**
 * The package's problem implementations, one per `solvers.json` problem id. Each later SOL item replaces
 * its entry; until then the entry rejects with NOT_IMPLEMENTED naming the item.
 */
import { SolverError } from '../errors';
import type { ProblemSolver, ProblemTable } from '../run';
import type { ProblemId } from '../types';
import { breakevenProblem, goalSeekProblem } from './goal-seek';
import { monteCarlo } from './monte-carlo';

/** Backlog item that implements each problem (docs/backlog/SOL.md). */
export const PENDING_PROBLEMS: Readonly<Record<ProblemId, string>> = {
  goal_seek: 'SOL-02',
  breakeven: 'SOL-02',
  scenario_blend: 'SOL-03',
  min_risk_mix: 'SOL-04',
  vp_feasible: 'SOL-05',
  monte_carlo: 'SOL-06',
  sensitivity: 'SOL-07',
  stress_presets: 'SOL-08',
  pareto: 'SOL-09',
};

const pending =
  <P extends ProblemId>(problem: P): ProblemSolver<P> =>
  () => {
    throw new SolverError('NOT_IMPLEMENTED', `${problem} lands with ${PENDING_PROBLEMS[problem]}`);
  };

export const PROBLEMS: ProblemTable = {
  goal_seek: goalSeekProblem,
  breakeven: breakevenProblem,
  scenario_blend: pending('scenario_blend'),
  min_risk_mix: pending('min_risk_mix'),
  pareto: pending('pareto'),
  vp_feasible: pending('vp_feasible'),
  monte_carlo: monteCarlo,
  sensitivity: async (run, params) => (await import('./sensitivity')).sensitivity(run, params),
  stress_presets: async (run, params) => (await import('./stress')).stressPresetsProblem(run, params),
};
