/**
 * Validation rules (docs/spec/schema.json `validation_rules`). `validateInputs` runs the input rules
 * on one post-change state (docs/architecture/04_data_and_api.md section 2, step 4); `validateOutputs`
 * runs VR05 and VR08 on an engine evaluation of it (step 6). `validatePreview` runs both on a
 * what-if session's scratch state, writing nothing.
 */
import {
  INPUT_RULE_IDS,
  VALIDATION_RULES,
  type InputRuleId,
  type RuleId,
  type ValidationEntry,
} from './catalog';
import {
  vr01DomainOwnership,
  vr02SharedServicesOwner,
  vr03UsageKeys,
  vr04RegistryBounds,
  vr06RetirementSplit,
  vr07RetiredApps,
  vr09LineItemKeys,
} from './input-rules';
import { validateOutputs, type OutputEvaluation } from './output-rules';
import type { ValidationState } from './state';
import { vr10CorpInputYears } from './vr10';

export type InputRule = (state: ValidationState) => ValidationEntry[];

/** One pure function per input rule. */
export const INPUT_RULES: Readonly<Record<InputRuleId, InputRule>> = {
  VR01: vr01DomainOwnership,
  VR02: vr02SharedServicesOwner,
  VR03: vr03UsageKeys,
  VR04: vr04RegistryBounds,
  VR06: vr06RetirementSplit,
  VR07: vr07RetiredApps,
  VR09: vr09LineItemKeys,
  VR10: vr10CorpInputYears,
};

/**
 * Every input rule's entries for `state`, in rule order (VR01, VR02, ... VR10). Empty when the state
 * is valid; a changeset is rejected when any entry has severity `error`.
 */
export function validateInputs(state: ValidationState): ValidationEntry[] {
  return INPUT_RULE_IDS.flatMap((id) => INPUT_RULES[id](state));
}

/** A what-if preview: the scratch inputs, and the session's evaluation of them when it has one. */
export interface PreviewState extends ValidationState {
  /** The scratch evaluation; without it only the input rules run. */
  readonly evaluation?: OutputEvaluation;
  /** `CompiledModel.upstream`, so VR08 skips checks a pin feeds (`vr08EngineSelfTest`). */
  readonly upstream?: (cell: string) => readonly string[];
}

const RULE_ORDER: readonly RuleId[] = Object.keys(VALIDATION_RULES) as RuleId[];

/**
 * Every rule's entries for a preview (API-07 pushes them as `warnings{seq}`), in rule order (VR01 ...
 * VR10): the input rules on the scratch state, and VR05 and VR08 on its evaluation when given. Pure:
 * it reads `state` only and writes nothing, so a preview never commits or rejects anything.
 */
export function validatePreview(state: PreviewState): ValidationEntry[] {
  const entries = validateInputs(state);
  if (state.evaluation !== undefined) {
    entries.push(
      ...validateOutputs({
        bundle: state.bundle,
        members: state.members,
        evaluation: state.evaluation,
        ...(state.upstream === undefined ? {} : { upstream: state.upstream }),
      }),
    );
  }
  const rank = (e: ValidationEntry): number => RULE_ORDER.indexOf(e.rule);
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i)
    .map((x) => x.e);
}

export { INPUT_RULE_IDS, VALIDATION_RULES, ruleEntry } from './catalog';
export type { InputRuleId, RuleDef, RuleId, Severity, ValidationEntry } from './catalog';
export {
  LINE_ITEM_KEYS,
  OUT_OF_SCOPE_MEMO_DOMAIN,
  SEED_LINE_ATTRIBUTES,
  vr01DomainOwnership,
  vr02SharedServicesOwner,
  vr03UsageKeys,
  vr04RegistryBounds,
  vr06RetirementSplit,
  vr07RetiredApps,
  vr09LineItemKeys,
} from './input-rules';
export {
  MANAGED_SERVICES_NODE,
  OUTPUT_RULES,
  OUTPUT_RULE_IDS,
  SELF_TEST_NODES,
  nodeMemberKeys,
  validateOutputs,
  vr05ManagedServices,
  vr08EngineSelfTest,
} from './output-rules';
export type { OutputEvaluation, OutputRule, OutputRuleId, OutputState } from './output-rules';
export { RULE_TOLERANCE, toCellKey } from './state';
export type { ValidationState } from './state';
export { CORPORATE_LAYER, vr10CorpInputYears } from './vr10';
