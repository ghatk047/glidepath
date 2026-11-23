import { describe, expect, it } from 'vitest';
import {
  A11Y_MODULES,
  A11Y_THEMES,
  LIGHTHOUSE_A11Y_MIN,
  LIGHTHOUSE_MODULES,
  blocking,
  describeViolation,
  failedA11yAudits,
  lighthousePercent,
  meetsLighthouseMin,
} from './a11y';

const v = (id: string, impact: string | null, n = 1) => ({
  id,
  impact,
  help: `${id} help`,
  nodes: Array.from({ length: n }, (_, i) => ({ target: [`#a${i}`, '.b'] })),
});

describe('a11y gate helpers', () => {
  it('covers the eight modules and both themes', () => {
    expect(A11Y_MODULES).toHaveLength(8);
    expect([...A11Y_THEMES].sort()).toEqual(['cruise', 'daylight']);
    for (const m of LIGHTHOUSE_MODULES) expect(A11Y_MODULES).toContain(m);
  });

  it('counts serious and critical as blocking, moderate and minor as not', () => {
    const all = [
      v('a', 'critical'),
      v('b', 'serious'),
      v('c', 'moderate'),
      v('d', 'minor'),
      v('e', null),
    ];
    expect(blocking(all).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('words a violation with its rule, impact and targets', () => {
    expect(describeViolation(v('color-contrast', 'serious', 5))).toBe(
      'color-contrast [serious]: color-contrast help at #a0 .b | #a1 .b | #a2 .b (+2 more)',
    );
  });

  it('adds the failure summary of the first node when axe gives one', () => {
    const withWhy = {
      ...v('color-contrast', 'serious'),
      nodes: [{ target: ['.a'], failureSummary: 'Fix any of the following:\n  ratio 2.1:1' }],
    };
    expect(describeViolation(withWhy)).toBe(
      'color-contrast [serious]: color-contrast help at .a -- Fix any of the following: ratio 2.1:1',
    );
  });

  it('reads the Lighthouse score on the 0..100 scale and holds the line at 95', () => {
    expect(LIGHTHOUSE_A11Y_MIN).toBe(95);
    expect(lighthousePercent(0.949)).toBe(95); // Lighthouse rounds the same way
    expect(meetsLighthouseMin(0.95)).toBe(true);
    expect(meetsLighthouseMin(0.944)).toBe(false);
    expect(meetsLighthouseMin(null)).toBe(false);
  });

  it('lists the weighted audits that failed, not the ones that pass or do not apply', () => {
    const lhr = {
      categories: {
        accessibility: {
          score: 0.9,
          auditRefs: [
            { id: 'a', weight: 10 },
            { id: 'b', weight: 10 },
            { id: 'c', weight: 10 },
            { id: 'd', weight: 0 },
          ],
        },
      },
      audits: {
        a: { title: 'A', score: 0, scoreDisplayMode: 'binary' },
        b: { title: 'B', score: 1, scoreDisplayMode: 'binary' },
        c: { title: 'C', score: null, scoreDisplayMode: 'notApplicable' },
        d: { title: 'D', score: 0, scoreDisplayMode: 'binary' },
      },
    };
    expect(failedA11yAudits(lhr)).toEqual(['a: A']);
  });
});
