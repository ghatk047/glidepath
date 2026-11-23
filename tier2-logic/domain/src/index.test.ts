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

  it('exports the DOM-03 contract: applyChangeset(store, draft, options), its errors and the Recompute hook', () => {
    for (const fn of [
      'applyChangeset',
      'noRecompute',
      'forkName',
      'summaryOf',
      'messagesOf',
      'memberOfRow',
    ] as const) {
      expect(typeof domain[fn]).toBe('function');
    }
    for (const E of [
      domain.ChangesetConflictError,
      domain.ChangesetRejectedError,
      domain.ScenarioNotFoundError,
    ]) {
      expect(E.prototype).toBeInstanceOf(Error);
    }
    expect(domain.BOUNDS_POLICY.ui).toBe('clamp');
    expect(domain.LOCKED_WRITE_ORIGINS).toEqual(['seed']);
  });
});
