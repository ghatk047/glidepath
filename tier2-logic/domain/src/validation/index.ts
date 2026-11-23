/**
 * Validation rules (docs/spec/schema.json `validation_rules`). `validateInputs` runs the input rules
 * on one post-change state (docs/architecture/04_data_and_api.md section 2, step 4); VR05 and VR08
 * read engine outputs and follow in DOM-05.
 */
import { INPUT_RULE_IDS, type InputRuleId, type ValidationEntry } from './catalog';
import {
  vr01DomainOwnership,
  vr02SharedServicesOwner,
  vr03UsageKeys,
  vr04RegistryBounds,
  vr06RetirementSplit,
  vr07RetiredApps,
  vr09LineItemKeys,
} from './input-rules';
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
export { RULE_TOLERANCE, toCellKey } from './state';
export type { ValidationState } from './state';
export { CORPORATE_LAYER, vr10CorpInputYears } from './vr10';
