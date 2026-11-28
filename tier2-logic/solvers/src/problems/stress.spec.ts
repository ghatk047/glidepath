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
const stressPresets = (m: SolverModel, params: { presets?: string[]; scales?: Record<string, number> }, o = { yield: noYield }) =>
  runSolver(m, { problem: 'stress_presets', params }, o);

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
      expect(Object.keys(d.delta)).toEqual(['res.net', 'res.gap', 'br.eps27', 'res.risk']);
      expect(d.scale).toBe(1);
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

describe('SRC-18 shock sizes, the catalog and the risk-adjusted net', () => {
  it('the result lists every shock with its definition, whatever was asked', async () => {
    const r = await run([specPresets[1]!.name]);
    expect(r.detail!.catalog.map((p) => p.name)).toEqual(specPresets.map((p) => p.name));
    expect(r.detail!.catalog[0]).toEqual({ name: specPresets[0]!.name, ...(specPresets[0]!.set ? { set: specPresets[0]!.set } : {}), ...(specPresets[0]!.shift ? { shift: specPresets[0]!.shift } : {}) });
  });

  it('a scale multiplies each move from the start point; 1 is the shock as written, 0 no shock', () => {
    const fuel = specPresets.find((p) => p.name === 'Fuel +30c')!;
    const at = (k: number) => presetChanges(model, fuel, k);
    expect(at(1)).toEqual(presetChanges(model, fuel));
    for (const c of at(2).filter((x) => x.cell.startsWith('corp.jet_direct['))) {
      expect(c.value).toBeCloseTo(Math.min(4.5, model.base.get(c.cell) + 0.6), 9);
    }
    for (const c of at(0)) expect(c.value).toBeCloseTo(model.base.get(c.cell), 12);
    // Discrete cells stay whole and in range: a Q2 start shifted by 1.5 × 3 months.
    const q2 = specPresets.find((p) => p.name === 'Programme starts in Q2')!;
    for (const c of presetChanges(model, q2, 1.5).filter((x) => x.cell.startsWith('lev.start['))) {
      expect(Number.isInteger(c.value)).toBe(true);
      expect(c.value).toBeLessThanOrEqual(12);
    }
  });

  it('scales reach the run: a half shock moves net less than the written one (a set to 0 cannot go further); bad scales are refused', async () => {
    const name = 'GCC hiring freeze';
    const once = (await run([name])).detail!.presets[0]!;
    const half = (await stressPresets(model, { presets: [name], scales: { [name]: 0.5 } })).detail!.presets[0]!;
    expect(half.scale).toBe(0.5);
    expect(Math.abs(half.delta['res.net']!)).toBeLessThan(Math.abs(once.delta['res.net']!));
    expect(Math.abs(half.delta['res.net']!)).toBeGreaterThan(0);
    // Doubling a shock that already sets its inputs to the registry floor is held at the floor.
    const twice = (await stressPresets(model, { presets: [name], scales: { [name]: 2 } })).detail!.presets[0]!;
    expect(twice.delta['res.net']).toBeCloseTo(once.delta['res.net']!, 9);
    await expect(stressPresets(model, { presets: [name], scales: { [name]: -1 } })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(stressPresets(model, { scales: { nope: 1 } })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    // Absent presets = every shock.
    expect((await stressPresets(model, {}, { yield: noYield })).detail!.presets).toHaveLength(specPresets.length);
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
