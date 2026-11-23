/**
 * @glidepath/solvers: goal seek to Monte Carlo and Sobol, pure functions over a `CompiledModel`
 * (docs/architecture/03_engine_and_solvers.md §3). No IO.
 */

export const packageName = '@glidepath/solvers';

// SOL-01 framework: result and parameter types, decision sets, runSolver (abort, progress), ranked moves.
export type {
  BindingConstraint,
  Bounds,
  BreakevenParams,
  CellKey,
  Change,
  DecisionSetId,
  GoalSeekParams,
  MinRiskMixParams,
  MonteCarloParams,
  OptimiserMethod,
  OptimiserParams,
  ParetoParams,
  ProblemId,
  RankedMove,
  ScenarioBlendParams,
  SensitivityMethod,
  SensitivityParams,
  SolverConstraint,
  SolverDetailMap,
  SolverDiagnostics,
  SolverObjective,
  SolverOutcome,
  SolverParamsMap,
  SolverResult,
  SolverSpec,
  SolverStatus,
  StressPresetsParams,
  VpFeasibleParams,
} from './types';
export type { SolverModel } from './model';
export { DECISION_SET_IDS, DECISION_SETS, clampToBounds, decisionSet, decisionSets, isHeld } from './decision-sets';
export type { DecisionVariable } from './decision-sets';
export { runSolver, SolverRun } from './run';
export type { ProblemSolver, ProblemTable, RunOptions } from './run';
export { PROGRESS_INTERVAL_MS, ProgressThrottle, systemClock } from './progress';
export type { Clock, ProgressFn } from './progress';
export { rankMoves } from './ranked';
export type { RankOptions } from './ranked';
export { SolverCancelled, SolverError } from './errors';
export type { SolverErrorCode } from './errors';
export { PENDING_PROBLEMS, PROBLEMS } from './problems';
// SOL-07 tornado sensitivity.
export { TORNADO_CATEGORIES, defaultTornadoCategory, tornado } from './tornado';
export type { Tornado, TornadoCategory, TornadoItem, TornadoModel, TornadoOptions, TornadoPoint } from './tornado';
