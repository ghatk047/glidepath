import { describe, expect, it } from 'vitest';
import { readRepoJson } from '@glidepath/int';
import type { GoldenFile } from '@glidepath/parity';
import { HEADLINE_CELLS, parseSpecNumber, specHeadline, type HeadlineKey } from './spec-headline';

/**
 * The spec's quoted headline numbers (`docs/spec/README.md`) are what INT-03 asserts on the
 * Cockpit, so the reader is tested here: every quoted number must be the golden value of the same
 * spec id, rounded to as many decimals as the spec quotes.
 */

const golden = readRepoJson<GoldenFile>('docs', 'spec', 'reference', 'golden_results.json');
const PRESETS = ['A', 'B', 'C', 'D'] as const;
const KEYS = Object.keys(HEADLINE_CELLS) as HeadlineKey[];

const round = (v: number, decimals: number) => {
  const f = 10 ** decimals;
  return (Math.sign(v) * Math.round(Math.abs(v) * f)) / f;
};

describe('specHeadline', () => {
  it('reads the quoted numbers of preset C with their decimals', () => {
    const c = specHeadline('C');
    expect(c.net).toMatchObject({ value: 119.3, decimals: 1 });
    expect(c.gap).toMatchObject({ value: -23.7, decimals: 1 });
    expect(c.risk).toMatchObject({ value: 82, decimals: 1 });
    expect(c.eps27).toMatchObject({ value: 0.091, decimals: 3 });
    expect(c.eps27?.text).toBe('+$0.091');
  });

  it.each(PRESETS)('every number quoted for %s is its golden cell rounded', (preset) => {
    const quoted = specHeadline(preset);
    const cells = golden.scenarios[preset] as Record<string, number> | undefined;
    expect(cells, `golden has ${preset}`).toBeDefined();
    const checked = KEYS.filter((k) => quoted[k]);
    expect(checked.length).toBeGreaterThan(0);
    for (const key of checked) {
      const { value, decimals } = quoted[key]!;
      const cell = HEADLINE_CELLS[key];
      expect(round(cells![cell]!, decimals), `${preset}.${cell}`).toBe(value);
    }
  });

  it('rejects cells that are not numbers and keeps the minus sign', () => {
    expect(parseSpecNumber('')).toBeNull();
    expect(parseSpecNumber('Balanced')).toBeNull();
    expect(parseSpecNumber('−134.9')).toMatchObject({ value: -134.9, decimals: 1 });
    expect(parseSpecNumber('+$1.02')).toMatchObject({ value: 1.02, decimals: 2 });
    expect(parseSpecNumber('**119.3**')).toMatchObject({ value: 119.3, decimals: 1 });
  });

  it('throws when the spec has no such row', () => {
    expect(() => specHeadline('Z')).toThrow(/no row for scenario Z/);
  });
});
