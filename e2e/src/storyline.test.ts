import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readRepoJson, repoRoot } from '@glidepath/int';
import type { GoldenFile } from '@glidepath/parity';
import { specHeadline } from './spec-headline';
import { movedByMinRisk, solverDemo, specProse } from './storyline';
import { readCell, writeCell } from './xlsx';

/**
 * The storyline's numbers (docs/ux/05_demo_storyline.md "Numbers used") are read from the spec
 * bundle, not typed into the spec: these tests pin that each one is there and agrees with the
 * golden results, so a change in `docs/spec/` fails here and not mid-demo.
 */

const golden = readRepoJson<GoldenFile>('docs', 'spec', 'reference', 'golden_results.json');
const storyline = readFileSync(join(repoRoot, 'docs', 'ux', '05_demo_storyline.md'), 'utf8');

describe('specProse', () => {
  it('reads the bar, the growth behind it and the locked share', () => {
    const p = specProse();
    expect(p.bar.value).toBeGreaterThan(0);
    expect(p.growth.value).toBeGreaterThan(0);
    // the bar is the target plus the cost growth (README: "so the gross bar is")
    const bar = golden.scenarios['C']!['res.bar'] as number;
    expect(Math.round(bar * 10) / 10).toBe(p.bar.value);
    expect(p.lockedPct.value).toBeGreaterThan(0);
    expect(p.lockedPct.value).toBeLessThan(100);
  });

  it('agrees with the numbers the storyline quotes', () => {
    const p = specProse();
    expect(storyline).toContain(`bar $${p.bar.value.toFixed(1)}M`);
    expect(storyline).toContain(`growth $${p.growth.value.toFixed(1)}M`);
  });
});

describe('quoted headline of the storyline', () => {
  it('Rates only, C and D rows exist with their net and gap', () => {
    for (const row of ['Rates', 'C', 'D']) {
      const h = specHeadline(row);
      expect(h.net, row).toBeDefined();
      expect(h.gap, row).toBeDefined();
    }
    expect(storyline).toContain(`Rates only $${specHeadline('Rates').net!.value.toFixed(1)}M`);
    expect(storyline).toContain(`D $${specHeadline('D').net!.value.toFixed(1)}M`);
    expect(storyline).toContain(`C net $${specHeadline('C').net!.value.toFixed(1)}M`);
  });
});

describe('solverDemo', () => {
  it('the minimum-risk path reaches the bar, with the risk the storyline quotes', () => {
    const d = solverDemo().min_risk_total_bar;
    expect(Math.round(d.net * 10) / 10).toBe(specProse().bar.value);
    expect(storyline).toContain(`risk $${d.risk_exposure.toFixed(1)}M`);
    expect(movedByMinRisk()).toContain('lev.L17.cola');
  });

  it('the Monte Carlo odds are the storyline P(clear): C 0%, D 4.5%', () => {
    const d = solverDemo();
    expect(`${(d.monte_carlo_C.prob_clear_bar * 100).toFixed(0)}%`).toBe('0%');
    expect(`${(d.monte_carlo_D.prob_clear_bar * 100).toFixed(1)}%`).toBe('4.5%');
    expect(storyline).toContain('P(clear) C 0%, D 4.5%');
  });
});

describe('xlsx cell edit', () => {
  // A real export of the template (committed by the Excel package): edit one cell, keep the rest.
  const fixture = new Uint8Array(
    readFileSync(join(repoRoot, 'tier2-logic', 'excel', 'fixtures', 'precision_export.xlsx')),
  );
  const ref = { sheet: 'Targets', key: 'g.target_net', column: /^c\. balanced/i } as const;

  it('reads and writes a scenario cell found by key and header', async () => {
    expect(await readCell(fixture, ref)).toBeNull();
    const edited = await writeCell(fixture, ref, 105);
    expect(await readCell(edited, ref)).toBe(105);
    // another cell of the same row is untouched
    expect(await readCell(edited, { ...ref, column: 'default' })).toBeCloseTo(100, 6);
  });

  it('names what it cannot find', async () => {
    await expect(readCell(fixture, { ...ref, key: 'no.such' })).rejects.toThrow(/no row for no.such/);
    await expect(readCell(fixture, { ...ref, column: 'Nope' })).rejects.toThrow(/no column/);
    await expect(readCell(fixture, { ...ref, sheet: 'Nope' })).rejects.toThrow(/no sheet/);
  });
});
