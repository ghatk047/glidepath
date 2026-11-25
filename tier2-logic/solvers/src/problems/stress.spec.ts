/**
 * SOL-08 acceptance on the seed tenant (preset C): each named shock of solvers.json is applied as changes
 * and evaluated (one test per example); presets come from the spec, never code; < 1 s.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readRepoJson, seedModel } from '../../test/helpers';
import type { SolverModel } from '../model';
import { runSolver } from '../run';
import { STRESS_OUTPUTS, parseStressPresets, presetChanges, type StressPreset } from './stress';

const solversJson = readRepoJson<unknown>('docs/spec/solvers.json');
const specPresets = parseStressPresets(solversJson);
const noYield = () => Promise.resolve();

let model: SolverModel;
beforeAll(async () => {
  model = { ...(await seedModel('C')), presets: specPresets };
});

const run = (names: string[], m: SolverModel = model) =>
  runSolver(m, { problem: 'stress_presets', params: { presets: names } }, { yield: noYield });

/** Oracle: apply the preset's changes with the scalar incremental engine. */
function oracle(preset: StressPreset) {
  const e = model.compiled.rerun(model.base, presetChanges(model, preset));
  return Object.fromEntries(STRESS_OUTPUTS.map((o) => [o, e.get(o)]));
}

describe('SOL-08 each named shock is applied as changes and evaluated, returning net/gap/EPS deltas', () => {
  it('the spec lists the five examples', () => {
    expect(specPresets.map((p) => p.name)).toEqual([
      'GCC hiring freeze',
      'Vendors win COLA',
      'Programme starts in Q2',
      'All one-time costs on IT',
      'Fuel +30c',
    ]);
  });

  for (const name of [
    'GCC hiring freeze',
    'Vendors win COLA',
    'Programme starts in Q2',
    'All one-time costs on IT',
    'Fuel +30c',
  ]) {
    it(`example: ${name}`, async () => {
      const preset = specPresets.find((p) => p.name === name)!;
      const r = await run([name]);
      const d = r.detail!.presets[0]!;
      expect(d.name).toBe(name);
      const want = oracle(preset);
      for (const o of STRESS_OUTPUTS) {
        expect(d.outputs[o]).toBeCloseTo(want[o]!, 9);
        expect(d.delta[o]).toBeCloseTo(want[o]! - model.base.get(o), 9);
      }
      expect(Object.keys(d.delta)).toEqual(['res.net', 'res.gap', 'br.eps27']);
      // A real shock moves the plan (the preset is not a no-op), and one preset returns its changes.
      expect(r.changes.length).toBeGreaterThan(0);
      // (Fuel is a corporate driver: it can move EPS but not the IT net.)
      expect(STRESS_OUTPUTS.reduce((a, o) => a + Math.abs(d.delta[o]!), 0)).toBeGreaterThan(0);
    });
  }

  it('semantics: absolute set, signed delta, dimensioned cells, shift within registry range', () => {
    const by = (n: string) => presetChanges(model, specPresets.find((p) => p.name === n)!);
    expect(by('GCC hiring freeze').map((c) => [c.cell, c.value])).toEqual([
      ['lev.L03.pct', 0],
      ['lev.L04.pct', 0],
      ['lev.L05.bf', 0],
    ]);
    const fuel = by('Fuel +30c');
    const jet = fuel.filter((c) => c.cell.startsWith('corp.jet_direct['));
    expect(jet.length).toBeGreaterThan(1);
    for (const c of jet) expect(c.value).toBeCloseTo(model.base.get(c.cell) + 0.3, 12);
    expect(fuel.filter((c) => c.cell.startsWith('corp.fuel_mode[')).every((c) => c.value === 0)).toBe(true);
    const q2 = by('Programme starts in Q2');
    expect(q2.find((c) => c.cell === 'g.head_start')!.value).toBe(0);
    const starts = q2.filter((c) => c.cell.startsWith('lev.start['));
    expect(starts.length).toBe(17);
    for (const c of starts) expect(c.value).toBe(Math.min(12, model.base.get(c.cell) + 3));
    expect(presetChanges(model, { name: 'x', shift: { 'lev.start': 100 } }).every((c) => c.value === 12)).toBe(true);
    expect(presetChanges(model, { name: 'x', set: { 'g.ot_out_share': '0.25' } })[0]!.value).toBe(0.25);
  });

  it('several presets run in one batch: lanes equal the one-at-a-time results', async () => {
    const all = await run([]);
    expect(all.detail!.presets.map((p) => p.name)).toEqual(specPresets.map((p) => p.name));
    expect(all.changes).toEqual([]);
    expect(all.diagnostics.iterations).toBe(1);
    for (const p of all.detail!.presets) {
      const alone = (await run([p.name])).detail!.presets[0]!;
      for (const o of STRESS_OUTPUTS) expect(p.outputs[o]).toBeCloseTo(alone.outputs[o]!, 9);
    }
    expect(all.metrics['res.net']).toBe(model.base.get('res.net'));
  });
});

describe('SOL-08 presets are read from solvers.json, never coded', () => {
  it('an extra fixture example appears in the results', async () => {
    const doc = structuredClone(solversJson) as { problems: { id: string; examples?: unknown[] }[] };
    doc.problems.find((p) => p.id === 'stress_presets')!.examples!.push({
      name: 'Fixture: vendors win most COLA',
      set: { 'lev.L17.cola': 0.2 },
    });
    const presets = parseStressPresets(doc);
    expect(presets).toHaveLength(specPresets.length + 1);
    const r = await run([], { ...model, presets });
    const names = r.detail!.presets.map((p) => p.name);
    expect(names).toContain('Fixture: vendors win most COLA');
    expect(names).toHaveLength(specPresets.length + 1);
    const fx = r.detail!.presets.find((p) => p.name.startsWith('Fixture'))!;
    expect(fx.delta['res.net']).toBeLessThan(0);
  });

  it('parameters are checked: unknown preset, unknown variable, bad value, malformed spec', async () => {
    await expect(run(['nope'])).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    const bad = (p: StressPreset) => run([p.name], { ...model, presets: [p] });
    await expect(bad({ name: 'a', set: { 'no.such': 1 } })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(bad({ name: 'b', set: { 'g.ot_out_share': 'abc' } })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    expect(parseStressPresets({})).toEqual([]);
    expect(parseStressPresets({ problems: [{ id: 'stress_presets' }] })).toEqual([]);
    expect(() => parseStressPresets({ problems: [{ id: 'stress_presets', examples: {} }] })).toThrow();
    expect(() => parseStressPresets({ problems: [{ id: 'stress_presets', examples: [{}] }] })).toThrow();
    const none = await run([], { ...model, presets: undefined });
    expect(none.detail!.presets).toEqual([]);
  });

  it('a single preset returns its changes as the result moves', async () => {
    const r = await run(['Vendors win COLA']);
    expect(r.changes).toEqual([{ target: 'variable', cell: 'lev.L17.cola', value: 0 }]);
  });
});

describe('SOL-08 perf: all presets in < 1 s', () => {
  it('runs every example under the 1 s budget', async () => {
    const t = performance.now();
    await run([]);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});
