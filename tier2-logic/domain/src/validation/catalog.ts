/**
 * The validation rules of docs/spec/schema.json `validation_rules`, verbatim: id, rule text and
 * severity. The domain is pure and cannot read the spec at run time, so the catalog is kept here and
 * catalog.test.ts fails if it drifts from schema.json.
 */
import type { VRId } from '@glidepath/spec/generated';

/** A rule id, verbatim from schema.json: `VR01` to `VR10`. */
export type RuleId = VRId;

/** Severity of an entry: `error` blocks a changeset, `warning` is reported only. */
export type Severity = 'error' | 'warning';

export interface RuleDef {
  /** The rule text of schema.json, verbatim. */
  readonly rule: string;
  /** The leading word of schema.json's severity. */
  readonly severity: Severity;
  /** The rest of schema.json's severity, without its parentheses (e.g. VR04's handling note). */
  readonly note?: string;
}

/** Every rule of schema.json `validation_rules`, in spec order. */
export const VALIDATION_RULES = {
  VR01: {
    rule: 'org.dom_share sums to 1 over vp for every domain except out_of_scope_memo (which sums to 0)',
    severity: 'error',
  },
  VR02: {
    rule: 'exactly one vp has org.ss_flag = 1 when g.chargeback_on = 1',
    severity: 'error',
  },
  VR03: {
    rule: 'org.usage_override sums to 1 when org.usage_override_on = 1',
    severity: 'error',
  },
  VR04: {
    rule: 'value within variable_def min/max',
    severity: 'warning',
    note: 'UI clamps sliders; import flags',
  },
  VR05: {
    rule: 'lv.ms0 >= 0 (contractor T&M cost cannot exceed the SI pool)',
    severity: 'error',
  },
  VR06: { rule: 'lev.L09.split_sw + lev.L09.split_cloud <= 1', severity: 'error' },
  VR07: { rule: 'lev.L09.n <= portfolio.apps', severity: 'error' },
  VR08: { rule: 'lev.rr_check = 0 and vp.check = 0 (engine self-test)', severity: 'error' },
  VR09: {
    rule: 'every line_item.pool_id in canonical_pool; domain_key and vendor_key exist',
    severity: 'error',
  },
  VR10: { rule: 'corp inputs present for every year an expression uses', severity: 'error' },
} as const satisfies Readonly<Record<RuleId, RuleDef>>;

/**
 * The input rules: they read only inputs and members, so they run before any engine evaluation.
 * VR05 and VR08 read engine outputs and run after the engine (DOM-05).
 */
export const INPUT_RULE_IDS = [
  'VR01',
  'VR02',
  'VR03',
  'VR04',
  'VR06',
  'VR07',
  'VR09',
  'VR10',
] as const satisfies readonly RuleId[];
export type InputRuleId = (typeof INPUT_RULE_IDS)[number];

/**
 * One rule result. Structurally the `Violation` of contract/api-contract (problem.ts), so the server
 * passes entries to tier 1 unchanged.
 */
export interface ValidationEntry {
  readonly rule: RuleId;
  readonly severity: Severity;
  /**
   * The cells the entry points at, as the contract's CellKey `id[member_key]` (`g.chargeback_on[]`
   * for a scalar). A structural row is `dim[member]`, e.g. `line[it_001]`.
   */
  readonly cells: readonly string[];
  /** One line of cause and fix, for the UI error chip. */
  readonly message: string;
}

/** An entry of `rule` with the rule's severity from the catalog. */
export function ruleEntry(
  rule: RuleId,
  cells: readonly string[],
  message: string,
): ValidationEntry {
  return { rule, severity: VALIDATION_RULES[rule].severity, cells, message };
}
