import { describe, expect, it } from 'vitest';
import { goldenTargets, runGolden } from './golden';
import { loadParityInputs } from './load';
import { Runner } from './runs';

const inputs = await loadParityInputs();
const runner = new Runner(inputs.bundle, inputs.seed);
const PRESETS = ['rates', 'A', 'B', 'C', 'D'];
const PER_PRESET = 152;

describe('G3 golden parity', () => {
  it('maps golden keys to cells: scalars verbatim, levers.Lnn.f to lev.f[Lnn], vp.<vp>.f to vp.f[<vp>]', () => {
    const targets = goldenTargets(inputs.golden);
    expect(targets).toHaveLength(PRESETS.length * PER_PRESET);
    expect([...new Set(targets.map((t) => t.scenario))]).toEqual(PRESETS);
    const cellOf = (key: string) => targets.find((t) => t.scenario === 'C' && t.key === key)?.cell;
    expect(cellOf('res.net')).toBe('res.net');
    expect(cellOf('pl.eps[fy27b]')).toBe('pl.eps[fy27b]');
    expect(cellOf('levers.L07.cx')).toBe('lev.cx[L07]');
    expect(cellOf('vp.vp_infra.gap_risk')).toBe('vp.gap_risk[vp_infra]');
    expect(() => goldenTargets({ scenarios: { X: { k: 'text' } } })).toThrow(/X\.k/);
  });

  it('evaluates the five presets and matches all 760 values within 1e-6 relative / 1e-9 absolute', () => {
    const report = runGolden(runner, inputs.golden);
    const misses = report.rows.filter((r) => !r.pass).map((r) => `${r.scenario} ${r.key}`);
    expect(misses).toEqual([]);
    expect(`${report.passed}/${report.total}`).toBe('760/760');
  });
});
