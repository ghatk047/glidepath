export const packageName = '@glidepath/parity';

export { EXIT_ERROR, EXIT_MISS, EXIT_OK, runGate, type GateOptions, type GateResult } from './gate';
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
