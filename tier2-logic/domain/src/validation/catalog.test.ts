import { VRIds } from '@glidepath/spec/generated';
import { describe, expect, it } from 'vitest';
import { schemaJson } from '../test-support/schema-json';
import { INPUT_RULE_IDS, VALIDATION_RULES, ruleEntry, type RuleDef } from './catalog';
import { INPUT_RULES } from './index';

describe('rule severities come from schema.json validation_rules', () => {
  it('the catalog is schema.json validation_rules verbatim: ids in order, rule text and severity', () => {
    const fromCatalog = Object.entries(VALIDATION_RULES).map(([id, def]: [string, RuleDef]) => ({
      id,
      rule: def.rule,
      severity: def.note === undefined ? def.severity : `${def.severity} (${def.note})`,
    }));
    expect(fromCatalog).toEqual(schemaJson.validation_rules);
    expect(Object.keys(VALIDATION_RULES)).toEqual([...VRIds]);
  });

  it('one function per input rule, in rule order; VR05 and VR08 (engine outputs) are not input rules', () => {
    expect(Object.keys(INPUT_RULES)).toEqual([...INPUT_RULE_IDS]);
    expect(VRIds.filter((id) => !(INPUT_RULE_IDS as readonly string[]).includes(id))).toEqual([
      'VR05',
      'VR08',
    ]);
  });

  it('an entry takes its severity from the catalog', () => {
    expect(ruleEntry('VR04', ['g.target_net[]'], 'x.').severity).toBe('warning');
    expect(ruleEntry('VR01', [], 'x.').severity).toBe('error');
  });
});
