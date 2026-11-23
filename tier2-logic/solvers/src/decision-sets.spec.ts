/**
 * SOL-01 acceptance 2: lever_intensity = scalar, scenario-varying, kind=decision lev.L* inputs; bounds
 * [registry min, min(registry max, max(C, D))]; estimates never move. Oracle: the DEC/lo/hi of
 * docs/spec/reference/solvers_demo.py, dumped by test/fixtures/dump_dec.py.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VariableDef } from '@glidepath/spec';
import { beforeAll, describe, expect, it } from 'vitest';
import { presetValues, repo, seedModel } from '../test/helpers';
import { DECISION_SET_IDS, DECISION_SETS, clampToBounds, decisionSet, decisionSets, isHeld } from './decision-sets';
import { SolverError } from './errors';
import type { SolverModel } from './model';
import { runSolver } from './run';

interface DecFixture {
  sources: Record<string, string>;
  dec: string[];
  lo: Record<string, number>;
  hi: Record<string, number>;
  step: Record<string, number>;
  neg: string[];
}
const fixture = JSON.parse(readFileSync(resolve(repo, 'tier2-logic/solvers/test/fixtures/dec.json'), 'utf8')) as DecFixture;

let model: SolverModel;
let registry: Map<string, VariableDef>;
let presetC: Map<string, number>;
let presetD: Map<string, number>;
beforeAll(async () => {
  model = await seedModel('C', ['C', 'D']);
  registry = new Map(model.bundle.variables.map((v) => [v.id, v]));
  presetC = await presetValues('C');
  presetD = await presetValues('D');
});

describe('SOL-01 decision sets: lever_intensity equals solvers_demo.py DEC; estimates never move', () => {
  it('the fixture was dumped from the current spec, seed and demo', () => {
    for (const [rel, sha] of Object.entries(fixture.sources)) {
      expect(createHash('sha256').update(readFileSync(resolve(repo, rel))).digest('hex'), rel).toBe(sha);
    }
  });

  it('seed tenant lever_intensity set equals solvers_demo.py DEC, in registry order', () => {
    const set = decisionSet(model, 'lever_intensity');
    expect(set.map((d) => d.id)).toEqual(fixture.dec);
    expect(set.map((d) => d.cell)).toEqual(fixture.dec);
    for (const d of set) {
      const v = registry.get(d.id)!;
      expect(v.kind).toBe('decision');
      expect(v.dims).toEqual([]);
      expect(v.scenario_varies).toBe(true);
      expect(d.id.startsWith('lev.L')).toBe(true);
      expect(d.members).toEqual([]);
      expect(d.step).toBe(fixture.step[d.id]);
      expect(d.value).toBe(presetC.get(d.cell));
    }
  });

  it('bounds are [registry min, min(registry max, max(C, D))]', () => {
    const capped: string[] = [];
    for (const d of decisionSet(model, 'lever_intensity')) {
      const v = registry.get(d.id)!;
      const stretch = Math.max(presetC.get(d.cell)!, presetD.get(d.cell)!);
      expect(d.lo).toBe(v.min);
      expect(d.lo).toBe(fixture.lo[d.id]);
      expect(d.hi).toBe(Math.min(v.max!, stretch));
      // The demo caps at max(C, D) only; the registry max is the tighter bound where they differ.
      expect(fixture.hi[d.id]).toBe(stretch);
      if (d.hi !== fixture.hi[d.id]) {
        expect(fixture.hi[d.id]).toBeGreaterThan(v.max!);
        capped.push(d.id);
      }
    }
    expect(capped).toEqual(fixture.dec.filter((id) => fixture.hi[id]! > registry.get(id)!.max!));
    // The seed tenant has such inputs (a preset above the registry max), so the min() is exercised.
    expect(capped.length).toBeGreaterThan(0);
  });

  it('estimates never move: no set holds an estimate or a simulation input', () => {
    const all = decisionSets(model, DECISION_SETS);
    expect(all.length).toBeGreaterThan(0);
    for (const d of all) {
      expect(isHeld(registry.get(d.id)!)).toBe(false);
      expect(['estimate', 'simulation']).not.toContain(d.kind);
    }
    // The demo's NEG list holds the estimates a first optimiser run wrongly moved (04 §1).
    const ids = new Set(all.map((d) => d.id));
    for (const id of fixture.neg) {
      if (registry.get(id)!.kind === 'estimate') expect(ids.has(id), id).toBe(false);
    }
    const leverEstimates = model.bundle.variables.filter((v) => v.id.startsWith('lev.L') && v.kind === 'estimate');
    expect(leverEstimates.length).toBeGreaterThan(0);
    for (const v of leverEstimates) expect(ids.has(v.id), v.id).toBe(false);
  });

  it('estimates never move: runSolver rejects a result that moves one', async () => {
    const estimate = model.bundle.variables.find((v) => v.id.startsWith('lev.L') && v.kind === 'estimate')!;
    const decision = decisionSet(model, 'lever_intensity')[0]!;
    const moving = (cell: string) => ({
      min_risk_mix: () => ({ status: 'feasible' as const, changes: [{ target: 'variable' as const, cell, value: 0 }] }),
    });
    await expect(
      runSolver(model, { problem: 'min_risk_mix', params: {} }, { problems: moving(estimate.id) }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_MOVE', message: expect.stringContaining('held fixed') });
    const ok = await runSolver(model, { problem: 'min_risk_mix', params: {} }, { problems: moving(decision.cell) });
    expect(ok.changes).toEqual([{ target: 'variable', cell: decision.cell, value: 0 }]);
  });
});

describe('SOL-01 decision sets: timing, switch, funding and bounds options', () => {
  it('lever_timing and lever_switch expand per lever member with registry bounds', () => {
    const levers = model.members['lever']!.map((m) => m.id);
    const timing = decisionSet(model, 'lever_timing');
    const expected = DECISION_SET_IDS.lever_timing.flatMap((id) =>
      levers.map((l) => `${id}[${l}]`).filter((c) => model.base.has(c)),
    );
    expect(timing.map((d) => d.cell)).toEqual(expected);
    for (const d of timing) {
      const v = registry.get(d.id)!;
      expect([d.lo, d.hi]).toEqual([v.min, v.max]);
      expect(d.members).toHaveLength(1);
    }
    const sw = decisionSet(model, 'lever_switch');
    expect(new Set(sw.map((d) => d.id))).toEqual(new Set(DECISION_SET_IDS.lever_switch));
    expect(sw.length).toBeGreaterThan(0);
  });

  it('funding holds the policy input the spec names', () => {
    const f = decisionSet(model, 'funding');
    expect(f.map((d) => d.cell)).toEqual([...DECISION_SET_IDS.funding]);
    expect(f[0]!.value).toBe(model.base.get(f[0]!.cell));
  });

  it('every id a set names appears in solvers.json decision_variable_sets', () => {
    const spec = JSON.parse(readFileSync(resolve(repo, 'docs/spec/solvers.json'), 'utf8')) as {
      decision_variable_sets: Record<string, string>;
    };
    expect(Object.keys(spec.decision_variable_sets)).toEqual([...DECISION_SETS]);
    for (const [set, ids] of Object.entries(DECISION_SET_IDS)) {
      for (const id of ids) expect(spec.decision_variable_sets[set]).toContain(id);
    }
    expect(spec.decision_variable_sets['lever_intensity']).toContain('lev.Lxx');
  });

  it('without stretch presets the cap is the registry max; caps widen a bound', () => {
    const plain = decisionSet({ ...model, stretch: [] }, 'lever_intensity');
    for (const d of plain) expect(d.hi).toBe(registry.get(d.id)!.max);
    const first = plain[0]!;
    const widened = decisionSet({ ...model, caps: new Map([[first.cell, first.max! * 2]]) }, 'lever_intensity');
    expect(widened[0]!.hi).toBe(first.max! * 2);
    // A cap under the lower bound collapses to it.
    const under = decisionSet({ ...model, caps: new Map([[first.cell, first.lo - 1]]) }, 'lever_intensity');
    expect(under[0]!.hi).toBe(first.lo);
    expect(clampToBounds(first, first.hi + 1)).toBe(first.hi);
    expect(clampToBounds(first, first.lo - 1)).toBe(first.lo);
  });

  it('decisionSets is the union without duplicates; bad inputs throw SolverError', () => {
    const both = decisionSets(model, ['lever_intensity', 'lever_intensity', 'funding']);
    expect(both).toHaveLength(decisionSet(model, 'lever_intensity').length + 1);
    expect(() => decisionSet(model, 'nope' as never)).toThrow(SolverError);
    expect(() => decisionSet({ ...model, members: {} }, 'lever_timing')).toThrow(/no members for dimension lever/);
  });

  it('a registry variable without a range cannot move', () => {
    const v = registry.get(DECISION_SET_IDS.funding[0])!;
    const bundle = { variables: model.bundle.variables.map((x) => (x === v ? { ...x, min: null, max: null } : x)) };
    const [d] = decisionSet({ ...model, bundle }, 'funding');
    expect([d!.lo, d!.hi]).toEqual([d!.value, d!.value]);
  });
});
