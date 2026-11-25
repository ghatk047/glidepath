export const packageName = '@glidepath/parity';

export {
  EXIT_ERROR,
  EXIT_MISS,
  EXIT_OK,
  EXPECTED_TOTALS,
  runGate,
  type GateOptions,
  type GateResult,
} from './gate';
export {
  evaluateVector,
  FUZZ_TENANTS,
  runFuzz,
  runOracle,
  type FuzzOptions,
  type FuzzReport,
  type FuzzResult,
  type OracleRun,
  type OracleVector,
  type SetSummary,
  type TenantFuzzReport,
  type VectorRow,
} from './fuzz';
export {
  compareVector,
  decode,
  diffOf,
  fuzzClose,
  outcome,
  PY_ERROR_CODES,
  type CellDiff,
  type OracleError,
  type OracleFile,
  type OracleResult,
  type OracleValue,
  type TsOutcome,
  type VectorComparison,
  type VectorStatus,
} from './fuzz-compare';
export {
  boundedVariables,
  DEFAULT_FUZZ_SEED,
  drawValue,
  drawVectors,
  EDGE_SHARE,
  EDGE_VECTORS,
  LOCAL_MAX_VARIABLES,
  rngOf,
  UNIFORM_VECTORS,
  type BoundedVariable,
  type DrawOptions,
  type FuzzVector,
  type VectorKind,
  type VectorSet,
  type VectorValues,
} from './fuzz-vectors';
export {
  goldenTargets,
  runGolden,
  type GoldenFile,
  type GoldenReport,
  type GoldenRow,
  type GoldenTarget,
} from './golden';
export { loadParityInputs, paths, repoRoot, type ParityInputs } from './load';
export {
  REPLAY_RULES,
  ruleFor,
  runReplay,
  type ParityReportFile,
  type ReplayReport,
  type ReplayRow,
  type ReplayRule,
} from './replay';
export { goldenClose, pyRound, replayClose } from './round';
export { cbOffRun, parityRun, plainRun, Runner, type RunConfig } from './runs';
export {
  runSolverGate,
  SOLVER_ITEMS,
  TOLERANCES as SOLVER_TOLERANCES,
  type SolverGateOptions,
  type SolverGateResult,
  type SolverReport,
  type SolverRow,
} from './solvers-gate';
