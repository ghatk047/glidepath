/**
 * SRC-14 acceptance on the seed tenant from preset C:
 * 1. the plan never breaches the quarterly one-time cap or the launches-per-quarter cap (property test over
 *    random caps and windows, every plan re-checked on the engine);
 * 2. the plan's objective is ≥ the start point's when the start point is feasible;
 * 3. it returns ranked moves (lever, start month from → to) and binding constraints;
 * 4. progress and cancel.
 */
import { cellKey, type CellKey, type Evaluation } from '@glidepath/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedModel } from '../../test/helpers';
import { SolverError } from '../errors';
import type { SolverModel } from '../model';
import { runSolver, type RunOptions } from '../run';
import type { SolverResult, WavePlanParams } from '../types';
import { MAX_PASSES, QUARTERS, WAVE_CONSTRAINTS, leverOneTime, quarterOf } from './wave-plan';

const noYield = () => Promise.resolve();
const TOL = 1e-9;

let model: SolverModel;
let levers: string[];

const plan = (params: WavePlanParams = {}, options: RunOptions = { yield: noYield }, m: SolverModel = model) =>
  runSolver(m, { problem: 'wave_plan', params }, options);

/** Quarter loads of a plan, read back from the engine (never from the result's detail). */
function loadsOn(m: SolverModel, e: Evaluation) {
  const ot = new Array<number>(QUARTERS).fill(0);
  const n = new Array<number>(QUARTERS).fill(0);
  for (const l of m.members['lever']!.map((x) => x.id)) {
    if (!(e.get(cellKey('lev.on', [l])) > 0.5)) continue;
    const q = quarterOf(e.get(cellKey('lev.start', [l]))) - 1;
    ot[q] = ot[q]! + leverOneTime(e, l);
    n[q] = n[q]! + 1;
  }
  return { ot, n };
}

const evalOf = (r: SolverResult<'wave_plan'>, m: SolverModel = model) => m.compiled.rerun(m.base, r.changes);

/** mulberry32: the property test's seeded draws. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

beforeAll(async () => {
  model = await seedModel('C');
  levers = model.members['lever']!.map((l) => l.id);
}, 60_000);

describe('SRC-14 acceptance 1: never breaches the quarterly one-time cap or the launch cap', () => {
  it('property: random caps and windows; a plan reported feasible keeps every cap on the engine', async () => {
    const rand = rng(20261204);
    const largest = Math.max(...levers.map((l) => leverOneTime(model.base, l)));
    let feasible = 0;
    let infeasible = 0;
    for (let k = 0; k < 24; k++) {
      const cap = Math.round(rand() * 30 * 100) / 100;
      const launches = 1 + Math.floor(rand() * 8);
      const from = 1 + Math.floor(rand() * 4);
      const to = Math.max(from + 2, 6 + Math.floor(rand() * 7));
      const params: WavePlanParams = { quarterlyOneTimeCap: cap, maxLaunchesPerQuarter: launches, ...(k % 3 === 0 ? { window: { from, to: Math.min(12, to) } } : {}) };
      const r = await plan(params);
      const e = evalOf(r);
      const { ot, n } = loadsOn(model, e);
      // The detail is the engine's plan.
      r.detail!.quarters.forEach((q, i) => {
        expect(q.oneTime).toBeCloseTo(ot[i]!, 9);
        expect(q.launches).toBe(n[i]);
        expect(q.cap).toBe(cap);
        expect(q.launchCap).toBe(launches);
      });
      // Moves only start months, within the window.
      for (const c of r.changes) {
        expect(c.cell.startsWith('lev.start[')).toBe(true);
        expect(Number.isInteger(c.value)).toBe(true);
        if (params.window) {
          expect(c.value).toBeGreaterThanOrEqual(params.window.from);
          expect(c.value).toBeLessThanOrEqual(params.window.to);
        }
      }
      if (r.status === 'infeasible') {
        infeasible += 1;
        expect(r.metrics.violation).toBeGreaterThan(0);
        expect(r.binding!.length).toBeGreaterThan(0);
        // An infeasible plan names a breached quarter that really is over its cap.
        const breached = ot.some((x) => x > cap + TOL) || n.some((x) => x > launches);
        expect(breached).toBe(true);
      } else {
        feasible += 1;
        for (let q = 0; q < QUARTERS; q++) {
          expect(ot[q]!).toBeLessThanOrEqual(cap + TOL * Math.max(1, cap));
          expect(n[q]!).toBeLessThanOrEqual(launches);
        }
      }
      // With room for every lever (cap ≥ the largest lever, 4 quarters × launches ≥ levers, loose total),
      // the planner finds a feasible plan.
      if (cap >= largest && launches * QUARTERS >= levers.length && cap * QUARTERS >= 2 * model.base.get('res.tot_ot_it') && !params.window) {
        expect(r.status).not.toBe('infeasible');
      }
    }
    expect(feasible).toBeGreaterThan(0);
    expect(infeasible).toBeGreaterThan(0);
  }, 60_000);

  it('a cap below the largest lever one-time is infeasible: least-violation plan, the breached quarter binding', async () => {
    const sizes = levers.map((l) => ({ l, ot: leverOneTime(model.base, l) })).sort((a, b) => b.ot - a.ot);
    const cap = sizes[0]!.ot - 0.01;
    const r = await plan({ quarterlyOneTimeCap: cap });
    expect(r.status).toBe('infeasible');
    const q = r.detail!.levers.find((x) => x.lever === sizes[0]!.l)!.quarter;
    expect(r.binding!.map((b) => b.constraint)).toContain(`${WAVE_CONSTRAINTS.oneTime}[Q${q}]`);
    // That quarter holds the big lever alone (everything else moved out where it could).
    const { ot } = loadsOn(model, evalOf(r));
    expect(ot[q - 1]!).toBeCloseTo(sizes[0]!.ot, 9);
  });

  it('no caps: every lever at its own best month (effective start January), status optimal', async () => {
    const r = await plan({});
    expect(r.status).toBe('optimal');
    // lev.eff_start = MAX(1, lev.start − g.head_start): months up to 1 + head start are all best; ties keep the start.
    const head = model.base.get('g.head_start');
    for (const l of r.detail!.levers) {
      expect(Math.max(1, l.to - head)).toBe(1);
      if (l.to !== l.from) expect(l.from - head).toBeGreaterThan(1);
    }
    expect(r.metrics.violation).toBe(0);
    expect(r.binding).toEqual([]);
  });
});

describe('SRC-14 acceptance 2: objective ≥ the start point when the start point is feasible', () => {
  it('caps the start point meets exactly: the plan is at least as good, net and risk-adjusted', async () => {
    const { ot, n } = loadsOn(model, model.base);
    const params = { quarterlyOneTimeCap: Math.max(...ot), maxLaunchesPerQuarter: Math.max(...n) };
    for (const objective of ['net', 'risk_adjusted'] as const) {
      const r = await plan({ ...params, objective });
      expect(r.status).not.toBe('infeasible');
      const cell: CellKey = objective === 'net' ? 'res.net' : 'res.risk';
      const after = evalOf(r).get(cell);
      expect(after).toBeGreaterThanOrEqual(model.base.get(cell) - TOL);
      expect(r.metrics.objective).toBeCloseTo(after, 9);
      expect(r.metrics.objective_before).toBeCloseTo(model.base.get(cell), 9);
      expect(r.detail!.netBefore).toBeCloseTo(model.base.get('res.net'), 9);
      expect(r.detail!.netAfter).toBeCloseTo(evalOf(r).get('res.net'), 9);
    }
  });

  it('property: random caps the start point meets never lower the objective', async () => {
    const { ot, n } = loadsOn(model, model.base);
    const rand = rng(7);
    for (let k = 0; k < 8; k++) {
      const cap = Math.max(...ot) * (1 + rand());
      const launches = Math.max(...n) + Math.floor(rand() * 3);
      const r = await plan({ quarterlyOneTimeCap: cap, maxLaunchesPerQuarter: launches });
      expect(r.metrics.objective).toBeGreaterThanOrEqual(model.base.get('res.net') - TOL);
    }
  });

  it('the priced gains add up: Σ ranked impacts (each move alone) = the plan’s objective gain on the engine', async () => {
    const r = await plan({ quarterlyOneTimeCap: 20, maxLaunchesPerQuarter: 6 });
    const sum = r.ranked.reduce((s, m) => s + m.impact, 0);
    expect(sum).toBeCloseTo(evalOf(r).get('res.net') - model.base.get('res.net'), 6);
  });
});

describe('SRC-14 acceptance 3: ranked moves and binding constraints', () => {
  it('default-like caps: ranked lev.start moves by |impact|, binding caps with shadow prices', async () => {
    const r = await plan({ quarterlyOneTimeCap: 20, maxLaunchesPerQuarter: 5 });
    expect(r.ranked.length).toBe(r.changes.length);
    expect(r.ranked.length).toBeGreaterThan(0);
    for (let i = 1; i < r.ranked.length; i++) {
      expect(Math.abs(r.ranked[i - 1]!.impact)).toBeGreaterThanOrEqual(Math.abs(r.ranked[i]!.impact));
    }
    for (const m of r.ranked) {
      expect(m.cell).toMatch(/^lev\.start\[L\d\d\]$/);
      expect(m.from).toBe(model.base.get(m.cell));
      const row = r.detail!.levers.find((l) => `lev.start[${l.lever}]` === m.cell)!;
      expect(row.from).toBe(m.from);
      expect(row.to).toBe(m.to);
      expect(row.quarter).toBe(quarterOf(m.to));
    }
    expect(r.binding!.length).toBeGreaterThan(0);
    for (const b of r.binding!) {
      expect(b.constraint).toMatch(/^(quarterly_one_time|launches)\[Q[1-4]\]$/);
      expect(Number.isFinite(b.shadowPrice)).toBe(true);
      expect(b.shadowPrice).toBeGreaterThanOrEqual(0);
    }
    // Detail: every lever that is on, and the four quarters.
    expect(r.detail!.levers.map((l) => l.lever)).toEqual(levers);
    expect(r.detail!.quarters.map((q) => q.quarter)).toEqual([1, 2, 3, 4]);
  });

  it('only the named levers move; the others keep their month and still fill their quarter', async () => {
    const named = ['L01', 'L05', 'L10'];
    const r = await plan({ quarterlyOneTimeCap: 15, maxLaunchesPerQuarter: 9, levers: named });
    for (const c of r.changes) expect(named.map((l) => `lev.start[${l}]`)).toContain(c.cell);
    const { n } = loadsOn(model, evalOf(r));
    expect(n.reduce((a, b) => a + b, 0)).toBe(levers.length);
  });

  it('an off lever never counts and never moves', async () => {
    const base = model.compiled.rerun(model.base, [{ target: 'variable', cell: 'lev.on[L09]', value: 0 }]);
    const off: SolverModel = { ...model, base };
    const r = await plan({ quarterlyOneTimeCap: 10, maxLaunchesPerQuarter: 5 }, { yield: noYield }, off);
    expect(r.detail!.levers.map((l) => l.lever)).not.toContain('L09');
    expect(r.changes.map((c) => c.cell)).not.toContain('lev.start[L09]');
    expect(r.detail!.quarters.reduce((s, q) => s + q.launches, 0)).toBe(levers.length - 1);
  });

  it('a start outside the window is moved inside it', async () => {
    const r = await plan({ window: { from: 4, to: 9 } });
    for (const l of r.detail!.levers) {
      expect(l.to).toBeGreaterThanOrEqual(4);
      expect(l.to).toBeLessThanOrEqual(9);
    }
    expect(r.status).toBe('optimal');
  });

  it('rejects bad parameters', async () => {
    const bad: WavePlanParams[] = [
      { window: { from: 5, to: 3 } },
      { window: { from: 0, to: 3 } },
      { quarterlyOneTimeCap: -1 },
      { maxLaunchesPerQuarter: 1.5 },
      { levers: ['L99'] },
      { objective: 'nope' as never },
    ];
    for (const p of bad) await expect(plan(p)).rejects.toBeInstanceOf(SolverError);
  });
});

describe('SRC-14 acceptance 4: progress and cancel', () => {
  it('reports progress up to 1 with notes, and stays within its pass budget', async () => {
    const calls: { f: number; note?: string }[] = [];
    const r = await plan(
      { quarterlyOneTimeCap: 10, maxLaunchesPerQuarter: 5 },
      { yield: noYield, progressIntervalMs: 0, progress: (f, note) => calls.push({ f, ...(note === undefined ? {} : { note }) }) },
    );
    expect(calls.length).toBeGreaterThan(2);
    for (let i = 1; i < calls.length; i++) expect(calls[i]!.f).toBeGreaterThanOrEqual(calls[i - 1]!.f);
    expect(calls.at(-1)!.f).toBe(1);
    expect(calls.some((c) => c.note?.startsWith('repair'))).toBe(true);
    expect(r.metrics.passes).toBeLessThan(MAX_PASSES);
  });

  it('cancel: stops at a batch with status cancelled and the partial plan', async () => {
    const ac = new AbortController();
    let batches = 0;
    const r = await plan(
      { quarterlyOneTimeCap: 10, maxLaunchesPerQuarter: 5 },
      {
        signal: ac.signal,
        yield: () => {
          batches += 1;
          if (batches === 4) ac.abort();
          return Promise.resolve();
        },
      },
    );
    expect(r.status).toBe('cancelled');
    expect(r.changes.length).toBeGreaterThan(0);
    expect(r.detail!.quarters).toHaveLength(QUARTERS);
    expect(r.detail!.netAfter).toBeCloseTo(evalOf(r).get('res.net'), 9);
  });

  it('cancelled before the first batch: no plan', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await plan({}, { signal: ac.signal, yield: noYield });
    expect(r.status).toBe('cancelled');
    expect(r.changes).toEqual([]);
  });
});

describe('Seed preset C with the seed defaults (report)', () => {
  it('cap 10 $M per quarter (IT-charged one-time), 5 launches per quarter: a feasible plan', async () => {
    const t0 = performance.now();
    const r = await plan({ quarterlyOneTimeCap: 10, maxLaunchesPerQuarter: 5, window: { from: 1, to: 12 } });
    const ms = performance.now() - t0;
    console.info(
      JSON.stringify(
        {
          ms: Math.round(ms),
          status: r.status,
          netBefore: r.detail!.netBefore,
          netAfter: r.detail!.netAfter,
          moves: r.ranked.map((m) => `${m.cell} ${m.from}→${m.to} (${m.impact.toFixed(2)})`),
          quarters: r.detail!.quarters.map((q) => `Q${q.quarter} ot ${q.oneTime.toFixed(2)} n ${q.launches}`),
          binding: r.binding,
          passes: r.metrics.passes,
        },
        null,
        1,
      ),
    );
    expect(r.status).not.toBe('infeasible');
    // The quarters add up to the CY27 one-time charged to IT.
    expect(r.detail!.quarters.reduce((s, q) => s + q.oneTime, 0)).toBeCloseTo(model.base.get('res.tot_ot_it'), 9);
    expect(ms).toBeLessThan(10_000);
  });
});
