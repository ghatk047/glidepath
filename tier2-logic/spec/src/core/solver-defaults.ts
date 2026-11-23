/**
 * Defaults of the solvers' optional constraints that the spec states in prose (MOD-11): the GCC hiring capacity
 * of docs/spec/solvers.json, generated into `src/reference/solver-defaults.ts` by
 * `scripts/dump_solver_defaults.py`. Pure data; no IO.
 */
import { REFERENCE_SOLVER_DEFAULTS } from '../reference/solver-defaults';

export interface SolverDefaults {
  /** `spec_version` of the variables.json the defaults were generated from. */
  readonly specVersion: string;
  /** SHA-256 of each source file at generation (repo-relative path to hex digest). */
  readonly sources: Readonly<Record<string, string>>;
  /** `gcc_hiring` capacity (`res.fte_gcc - hc.gcc <=` it). */
  readonly gcc_hiring: number;
}

/** The solver defaults of a model version, or null when none were generated for it. */
export function solverDefaultsFor(specVersion: string): SolverDefaults | null {
  return specVersion === REFERENCE_SOLVER_DEFAULTS.specVersion ? REFERENCE_SOLVER_DEFAULTS : null;
}
