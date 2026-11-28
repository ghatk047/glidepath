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
  WavePlanParams,
} from './types';
export { EXTENSION_PROBLEMS, PROBLEM_IDS } from './types';
export type { ReferenceScenario, SolverModel } from './model';
export { ALL_VPS_KEY, referenceMetricKeys } from './problems/reference-points';
export {
  DECISION_SET_IDS,
  DECISION_SETS,
  clampToBounds,
  decisionSet,
  decisionSets,
  isHeld,
  withDecisionBounds,
} from './decision-sets';
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

// SOL-02: goal seek and breakeven.
export { breakeven, goalSeek } from './goal-seek';
export { BREAKEVEN_OUTPUT, BREAKEVEN_TARGET } from './problems/goal-seek';
export { SCAN_POINTS, isMonotone, scanGrid, seek, seekScalar } from './problems/seek';
export type { SeekOptions, SeekReason, SeekResult, Seeker } from './problems/seek';

// SOL-06 Monte Carlo: the problem, its seeded draws and the 04 §4 defaults.
export type { DistBasis, MonteCarloDist } from './types';
export { MONTE_CARLO_DEFAULTS, drawMonteCarlo, monteCarlo, resolveDists, validateDist } from './problems/monte-carlo';
export type { MonteCarloDefaults, MonteCarloDraws, ProbabilityDef } from './problems/monte-carlo';
// SOL-03: scenario blend.
export { blend } from './blend';
export type { BlendEnd, BlendOptions } from './blend';
export { BLEND_METRICS, BLEND_OUTPUT, BLEND_TARGET, blendCells, blendChanges } from './problems/blend';
export type { BlendCell } from './problems/blend';
// SOL-04: minimum-risk lever mix.
export { minRiskMix } from './min-risk';
export {
  COST_FLOOR,
  DEFAULT_PEOPLE_WEIGHT,
  DEFAULT_SEED,
  FEASIBILITY_TOL,
  MAX_STEPS,
  MIN_RISK_DEFAULTS,
  STEP_DIVISIONS,
  riskExposure,
} from './problems/min-risk';
// SOL-05: VP-feasible plan (min-risk mix with per-VP bars; maximin VP coverage when infeasible).
export { vpFeasible } from './vp-feasible';
export { VP_COVERAGE, leximin, withPerVp } from './problems/vp-feasible';
// SRC-10: vendor consolidation optimizer (F8).
export {
  CONSOLIDATION_PARAMS,
  ConsolidationParamError,
  DEFAULT_NODE_LIMIT,
  SPEND_EPS,
  annuityFactor,
  consolidate,
  paybackMonths,
  resolveConsolidationParams,
} from './sourcing/consolidation';
export type {
  ConsolidationBindingResult,
  ConsolidationInput,
  ConsolidationMoveResult,
  ConsolidationOutcome,
  ConsolidationParamRow,
  ConsolidationVendor,
} from './sourcing/consolidation';
