/**
 * SOL-01 acceptance 4: the ranked-move helper (cell, from, to, impact) shared by all solvers. Oracle:
 * the engine's scalar `rerun` from the start point.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { seedModel } from '../test/helpers';
import { decisionSet, type DecisionVariable } from './decision-sets';
import { SolverError } from './errors';
import type { SolverModel } from './model';
import { rankMoves } from './ranked';
import { runSolver } from './run';
import type { Change } from './types';

const OUTPUT = 'res.net';
const REL = 1e-9;

let model: SolverModel;
let set: DecisionVariable[];
let changes: Change[];
beforeAll(async () => {
  model = await seedModel();
  set = decisionSet(model, 'lever_intensity');
  // Every lever-intensity input to its upper bound.
  changes = set.filter((d) => d.hi !== d.value).map((d) => ({ target: 'variable', cell: d.cell, value: d.hi }));
});

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(REL * Math.max(1, Math.abs(b)));

describe('SOL-01 ranked moves: (cell, from, to, impact) helper shared by all solvers', () => {
  it('alone: each impact is the output change of that move alone, sorted by |impact|', () => {
    expect(changes.length).toBeGreaterThan(3);
    const y0 = model.base.get(OUTPUT);
    const rows = rankMoves(model, changes, OUTPUT);
    expect(rows).toHaveLength(changes.length);
    expect(new Set(rows.map((r) => r.cell))).toEqual(new Set(changes.map((c) => c.cell)));
    for (const r of rows) {
      expect(Object.keys(r)).toEqual(['cell', 'from', 'to', 'impact']);
      expect(r.from).toBe(model.base.get(r.cell));
      const oracle = model.compiled.rerun(model.base, [{ target: 'variable', cell: r.cell, value: r.to }]).get(OUTPUT) - y0;
      close(r.impact, oracle);
    }
    for (let i = 1; i < rows.length; i++) expect(Math.abs(rows[i - 1]!.impact)).toBeGreaterThanOrEqual(Math.abs(rows[i]!.impact));
  });

  it('path: cumulative steps in the given order, impacts summing to the total change', () => {
    const rows = rankMoves(model, changes, OUTPUT, { mode: 'path' });
    expect(rows.map((r) => r.cell)).toEqual(changes.map((c) => c.cell));
    const total = model.compiled.rerun(model.base, changes).get(OUTPUT) - model.base.get(OUTPUT);
    close(rows.reduce((s, r) => s + r.impact, 0), total);
    // Step k equals rerun(first k+1) − rerun(first k).
    const k = 2;
    const before = model.compiled.rerun(model.base, changes.slice(0, k)).get(OUTPUT);
    const after = model.compiled.rerun(model.base, changes.slice(0, k + 1)).get(OUTPUT);
    close(rows[k]!.impact, after - before);
    // A cell moved twice: the second move starts where the first left it.
    const c = changes[0]!;
    const twice = rankMoves(model, [c, { ...c, value: set[0]!.lo }], OUTPUT, { mode: 'path' });
    expect(twice[1]!.from).toBe(c.value);
    const sorted = rankMoves(model, changes, OUTPUT, { mode: 'path', order: 'impact' });
    expect(Math.abs(sorted[0]!.impact)).toBe(Math.max(...rows.map((r) => Math.abs(r.impact))));
  });

  it('given order, an output the moves do not reach, an input as output, no moves', () => {
    const given = rankMoves(model, changes, OUTPUT, { order: 'given' });
    expect(given.map((r) => r.cell)).toEqual(changes.map((c) => c.cell));
    const own = changes[0]!;
    const onInput = rankMoves(model, [own], own.cell);
    expect(onInput[0]!.impact).toBe(own.value - model.base.get(own.cell));
    const other = set.find((d) => d.cell !== own.cell)!.cell;
    expect(rankMoves(model, [own], other)[0]!.impact).toBe(0);
    expect(rankMoves(model, [], OUTPUT)).toEqual([]);
    expect(() => rankMoves(model, [own], 'no.such.cell')).toThrow(SolverError);
  });

  it('a failing lane throws its engine error', () => {
    const failing = {
      ...model,
      compiled: {
        ...model.compiled,
        evaluateBatch: () => ({ size: 1, values: new Map(), failed: Uint8Array.of(1), errors: new Map([[0, new Error('lane 0')]]) }),
      },
    } as unknown as SolverModel;
    expect(() => rankMoves(failing, [changes[0]!], OUTPUT)).toThrow('lane 0');
  });

  it('is the same helper every solver gets from its run', async () => {
    const r = await runSolver(model, { problem: 'min_risk_mix', params: {} }, {
      problems: { min_risk_mix: (run) => ({ status: 'feasible', changes, ranked: run.rank(changes, OUTPUT, { mode: 'path' }) }) },
    });
    expect(r.ranked).toEqual(rankMoves(model, changes, OUTPUT, { mode: 'path' }));
  });
});
