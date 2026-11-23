import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as domain from './index';

describe('domain', () => {
  it('exports its package.json name as packageName', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name: string;
    };
    expect(domain.packageName).toBe(pkg.name);
  });

  it('exports the DOM-01 contract: changeset vocabulary, draft checks, memberKey, resolveInputs, reverse, ports helpers', () => {
    for (const fn of [
      'memberKey',
      'splitMemberKey',
      'resolveInputs',
      'resolveScenarioChain',
      'reverse',
      'changeRowTarget',
      'checkDraft',
      'draftIssues',
      'modelCacheKey',
    ] as const) {
      expect(typeof domain[fn]).toBe('function');
    }
    expect(domain.CHANGESET_ORIGINS).toContain('ui');
    expect(domain.SCENARIO_KINDS).toContain('preset');
  });

  it('exports the DOM-02 contract: validateInputs(state) and one function per input rule', () => {
    expect(typeof domain.validateInputs).toBe('function');
    expect(Object.keys(domain.INPUT_RULES)).toEqual([...domain.INPUT_RULE_IDS]);
    expect(domain.INPUT_RULES.VR10).toBe(domain.vr10CorpInputYears);
  });
});
