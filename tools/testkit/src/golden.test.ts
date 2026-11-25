import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { closeToGolden, golden, goldenDeltaV03, goldenEntries, goldenResultsPath, goldenScenarios } from './index';

const raw = JSON.parse(readFileSync(goldenResultsPath, 'utf8')) as {
  scenarios: Record<string, Record<string, unknown>>;
  unified_minus_v03: Record<string, Record<string, number>>;
};

describe('golden(scenario, key)', () => {
  it('lists the five scenarios of golden_results.json', () => {
    expect(goldenScenarios()).toEqual(Object.keys(raw.scenarios));
    expect(goldenScenarios()).toEqual(['rates', 'A', 'B', 'C', 'D']);
  });

  it('returns flat spec keys verbatim, including indexed ones', () => {
    expect(golden('C', 'res.net')).toBe(raw.scenarios.C?.['res.net']);
    expect(golden('rates', 'pl.eps[fy27b]')).toBe(raw.scenarios.rates?.['pl.eps[fy27b]']);
  });

  it('returns nested lever and VP cells by dotted path', () => {
    const levers = raw.scenarios.C?.levers as Record<string, Record<string, number>>;
    const vp = raw.scenarios.C?.vp as Record<string, Record<string, number>>;
    expect(golden('C', 'levers.L02.rr')).toBe(levers.L02?.rr);
    expect(golden('C', 'vp.vp_commercial.net')).toBe(vp.vp_commercial?.net);
  });

  it('throws on an unknown scenario or key', () => {
    expect(() => golden('Z', 'res.net')).toThrow(/unknown scenario 'Z'/);
    expect(() => golden('C', 'res.nope')).toThrow(/no key 'res.nope'/);
    expect(() => golden('C', 'levers.L99.rr')).toThrow(/no key/);
  });

  it('goldenEntries covers every numeric cell of a scenario', () => {
    for (const id of goldenScenarios()) {
      const s = raw.scenarios[id] as Record<string, unknown>;
      let n = 0;
      for (const [k, v] of Object.entries(s)) {
        if (typeof v === 'number') n++;
        else for (const cells of Object.values(v as Record<string, Record<string, number>>)) n += Object.keys(cells).length;
        void k;
      }
      const entries = goldenEntries(id);
      expect(entries.size).toBe(n);
      for (const [k, v] of entries) expect(golden(id, k)).toBe(v);
    }
  });

  it('goldenDeltaV03 reads unified_minus_v03; closeToGolden uses 1e-6 relative', () => {
    expect(goldenDeltaV03('C', 'res.net')).toBe(raw.unified_minus_v03.C?.['res.net']);
    expect(() => goldenDeltaV03('C', 'nope')).toThrow();
    expect(closeToGolden(golden('C', 'res.net') * (1 + 5e-7), golden('C', 'res.net'))).toBe(true);
    expect(closeToGolden(golden('C', 'res.net') * (1 + 5e-6), golden('C', 'res.net'))).toBe(false);
  });
});
