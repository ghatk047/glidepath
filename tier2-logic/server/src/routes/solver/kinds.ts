import type { ProblemId } from '@glidepath/api-contract';
import type { SolverRunKind } from '@glidepath/data-access';

/**
 * `solver_run.kind` of each problem (JOB-02 note: the route maps). The column predates the problem list, so
 * several problems share a kind: both optimisers are `optimize`, a stress run is a `sensitivity` of named
 * shocks. The kind is only a label for lists: `spec.problem` decides what runs and which queue gets the job.
 */
export const KIND_OF_PROBLEM: Readonly<Record<ProblemId, SolverRunKind>> = {
  goal_seek: 'goal_seek',
  breakeven: 'breakeven',
  scenario_blend: 'blend',
  min_risk_mix: 'optimize',
  pareto: 'pareto',
  vp_feasible: 'optimize',
  monte_carlo: 'monte_carlo',
  sensitivity: 'sensitivity',
  stress_presets: 'sensitivity',
};

export const solverKind = (problem: ProblemId): SolverRunKind => KIND_OF_PROBLEM[problem];
