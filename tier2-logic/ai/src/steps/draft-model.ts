import { engineValues, resolveInputs, type ResolvedInput } from '@glidepath/domain';
import { compile as engineCompile, type CompiledModel, type Evaluation } from '@glidepath/engine';
import type { InputValue, ModelBundle, TenantMembers, TenantSeed } from '@glidepath/spec';

/**
 * Shared by steps 4 and 5: the seed draft as the states the rules and the engine see. A draft is a tenant seed (five
 * files), so its states are the tenant defaults and each scenario over them, resolved the way the database view does
 * (`resolveInputs` of the domain). Pure.
 */

/** The compiler steps 4 and 5 use; defaults to the engine's `compile`. Tests and the worker may pass a cached one. */
export type CompileDraft = (bundle: ModelBundle, members: TenantMembers) => CompiledModel;

/** One state of a draft: `scope` null is the tenant defaults, else a scenario id. */
export interface DraftState {
  readonly scope: string | null;
  readonly values: readonly ResolvedInput[];
  /** The scenario's pinned node cells (engine CellKeys). */
  readonly overrides: ReadonlyMap<string, number>;
}

/** Seed values (`{ var: number | { memberKey: number } }`) as input rows. */
export function valueRows(values: Readonly<Record<string, InputValue>>): { var_key: string; member_key: string; value: number }[] {
  return Object.entries(values).flatMap(([var_key, v]) =>
    typeof v === 'number'
      ? [{ var_key, member_key: '', value: v }]
      : Object.entries(v).map(([member_key, value]) => ({ var_key, member_key, value })),
  );
}

/** The tenant defaults, then every scenario of the draft resolved over them, in file order. */
export function draftStates(draft: TenantSeed, bundle: Pick<ModelBundle, 'variables'>): DraftState[] {
  const defaults = valueRows(draft.variableValues);
  const variables = bundle.variables.map((v) => v.id);
  const states: DraftState[] = [{ scope: null, values: resolveInputs(defaults, [], [], { variables }).values, overrides: new Map() }];
  for (const s of draft.scenarios.scenarios) {
    const chain = [{ scenario_id: s.id, values: valueRows(s.values) }];
    states.push({
      scope: s.id,
      values: resolveInputs(defaults, chain, [], { variables }).values,
      overrides: new Map(Object.entries(s.overrides ?? {})),
    });
  }
  return states;
}

/** Evaluate one state on a compiled draft. */
export const evaluateState = (model: CompiledModel, state: DraftState): Evaluation =>
  model.evaluate(engineValues(state.values), state.overrides);

export const defaultCompile: CompileDraft = engineCompile;

/** An error's message, for reports. */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
