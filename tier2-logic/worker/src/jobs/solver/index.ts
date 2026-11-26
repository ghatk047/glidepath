/**
 * Solver jobs (JOB-03): `solver.min_risk_mix`, `solver.vp_feasible`, `solver.monte_carlo`, `solver.wave_plan` (SRC-15), and, behind the
 * `JOB_SOLVER_PARETO` / `JOB_SOLVER_SOBOL` flags, `solver.pareto` and `solver.sensitivity`. Importing this
 * module registers them; tests import `runSolverJob` and `registerSolverHandlers` and pass their own deps.
 */
import './register';

export { runSolverJob } from './run';
export type { SolverHandlerSpec, SolverJobResult } from './run';
export { loadSolverInput, specOf } from './load';
export type { SolverJobInput } from './load';
export { saveAsScenario, toDraftChange, SOLVER_KIND } from './save';
export type { SavedScenario, SaveInput } from './save';
export { defaultSolverDeps, DEFAULT_STRETCH_PRESETS } from './deps';
export type { DefaultSolverDepsOptions } from './deps';
export { registerSolverHandlers, solverQueues, CORE_QUEUES } from './register';
export {
  NO_FLAGS,
  QUEUE_MIN_RISK_MIX,
  QUEUE_MONTE_CARLO,
  QUEUE_PARETO,
  QUEUE_SENSITIVITY,
  QUEUE_VP_FEASIBLE,
  QUEUE_WAVE_PLAN,
  FEASIBLE_ONLY_PROBLEMS,
  SAVING_PROBLEMS,
  SolverJobError,
  solverFlagsFromEnv,
} from './types';
export type { SolverFlags, SolverJobContext, SolverJobDeps, SolverJobPayload, StoredSolverResult } from './types';
