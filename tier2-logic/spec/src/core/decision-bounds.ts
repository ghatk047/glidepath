/**
 * Decision bounds of the solvers (SOL-12): the decision set and per-cell bounds of
 * docs/spec/reference/solvers_demo.py (`DEC`, `lo`, `hi`, `step`, `NEG`), generated into
 * `src/reference/decision-bounds.ts` by `scripts/dump_decision_bounds.py`. Pure data; no IO.
 */
import { REFERENCE_DECISION_BOUNDS } from '../reference/decision-bounds';

export interface DecisionBounds {
  /** `spec_version` of the variables.json the bounds were generated from (the model_version they belong to). */
  readonly specVersion: string;
  /** Seed tenant whose presets set `hi` (`max(C, D)` in the reference). */
  readonly seed: string;
  /** SHA-256 of each source file at generation (repo-relative path to hex digest). */
  readonly sources: Readonly<Record<string, string>>;
  /** Decision variable ids (scalar cells), in registry order. */
  readonly dec: readonly string[];
  /** Lower bound per id. */
  readonly lo: Readonly<Record<string, number>>;
  /** Upper bound per id: the reference's realism cap (no lever beyond full stretch). */
  readonly hi: Readonly<Record<string, number>>;
  /** Greedy step per id. */
  readonly step: Readonly<Record<string, number>>;
  /** Parameters that reduce savings when they grow (the reference's step direction). */
  readonly neg: readonly string[];
}

/**
 * The reference decision bounds of a model version, or null when none were generated for it (a tenant pinned
 * to another `spec_version` keeps the solvers' own default bounds).
 */
export function decisionBoundsFor(specVersion: string): DecisionBounds | null {
  return specVersion === REFERENCE_DECISION_BOUNDS.specVersion ? REFERENCE_DECISION_BOUNDS : null;
}
