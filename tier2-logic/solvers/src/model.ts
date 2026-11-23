import type { StressPreset } from './problems/stress';
import type { CellKey, CompiledModel, Evaluation, ModelBundle, TenantMembers } from '@glidepath/engine';

/**
 * What every solver runs on (the `model` of `runSolver(model, params, …)`): a compiled model, the
 * evaluation of the start scenario, and the registry. Tier 2 builds it from the session or the job's
 * scenario; the solvers never read tier 3.
 */
export interface SolverModel {
  readonly compiled: CompiledModel;
  /** Evaluation of the start point (the scenario's committed inputs and pins). */
  readonly base: Evaluation;
  /** The model_version: variables (registry: kind, min, max, step, dims, scenario_varies). */
  readonly bundle: Pick<ModelBundle, 'variables'>;
  /** Tenant members, in evaluation order: dimensioned decision variables expand over them. */
  readonly members: TenantMembers;
  /**
   * Resolved inputs of the presets whose per-cell maximum is the stretch cap of a lever-intensity input
   * (`solvers.json` `decision_variable_sets.lever_intensity`: "stretch cap default = max(C, D) preset
   * value"). Which presets count is tenant data the caller supplies; absent or empty = no stretch cap.
   */
  readonly stretch?: readonly ReadonlyMap<CellKey, number>[];
  /** User-widened caps per cell (04 §1: "The user can widen it"); replace the stretch-capped upper bound. */
  readonly caps?: ReadonlyMap<CellKey, number>;
  /**
   * Named shocks of `solvers.json` `problems[stress_presets].examples` (`parseStressPresets`). Tenant and
   * spec data the caller supplies; the `stress_presets` problem has no list of its own.
   */
  readonly presets?: readonly StressPreset[];
  /**
   * Resolved inputs of the scenarios a `scenario_blend` may name as `from` / `to`, by scenario id
   * (`v_inputs_resolved`). Tenant data the caller supplies; the solvers never read tier 3.
   */
  readonly scenarios?: ReadonlyMap<string, ReadonlyMap<CellKey, number>>;
}
