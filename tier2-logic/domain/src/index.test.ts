import { describe, expect, it } from 'vitest';
import * as domain from './index';

describe('domain', () => {
  it('exports its package name', () => {
    expect(domain.packageName).toBe('@glidepath/domain');
  });

  it('exports the DOM-01 contract: changeset vocabulary, memberKey, resolveInputs, reverse, ports helpers', () => {
    for (const fn of [
      'memberKey',
      'splitMemberKey',
      'resolveInputs',
      'resolveScenarioChain',
      'reverse',
      'changeRowTarget',
      'modelCacheKey',
    ] as const) {
      expect(typeof domain[fn]).toBe('function');
    }
    expect(domain.CHANGESET_ORIGINS).toContain('ui');
    expect(domain.SCENARIO_KINDS).toContain('preset');
  });
});
