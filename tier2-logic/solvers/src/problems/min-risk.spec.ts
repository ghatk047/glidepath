/**
 * SOL-04 acceptance on the seed tenant from preset C (G5 vs docs/spec/reference/solver_demo_results.json
 * `min_risk_total_bar`):
 * 1. objective Σ lev.iy·(1 − lev.conf), constraint res.net ≥ res.bar: risk exposure, one-time IT,
 *    res.fte_us and the people levers;
 * 2. the set of moved inputs equals `inputs_moved_from_C`; moves ranked in optimizer order;
 * 3. the alternative objectives each return feasible from C;
 * 4. deterministic for a seed; < 10 s single process.
 *
 * The reference greedy bounds intensity inputs by max(C, D) alone; SOL-01 also caps them at the registry
 * max (they differ for lev.L01.cut, lev.L01.rel, lev.L03.pct and lev.L15.pct). `withDecisionBounds` sets the
 * reference bounds (`REFERENCE_DECISION_BOUNDS`) as `model.caps`, as the worker and server do (SOL-12).
 */
import { REFERENCE_DECISION_BOUNDS } from '@glidepath/spec';
import { beforeAll, describe, expect, it } from 'vitest';
import { readRepoJson, seedModel } from '../../test/helpers';
import { decisionSet, withDecisionBounds } from '../decision-sets';
import { minRiskMix } from '../min-risk';
import type { SolverModel } from '../model';
import type { SolverObjective, SolverResult } from '../types';
import { riskExposure } from './min-risk';

interface DemoResult {
  readonly feasible: boolean;
  readonly steps: number;
  readonly evaluations: number;
  readonly net: number;
  readonly bar: number;
  readonly risk_adj_net: number;
  readonly risk_exposure: number;
  readonly one_time_it: number;
  readonly fte_us: number;
  readonly fte_gcc: number;
  readonly eps27: number;
  readonly inputs_moved_from_C: Record<string, { from: number; to: number }>;
}
interface DemoResults {
  readonly min_risk_total_bar: DemoResult;
  readonly min_risk_reference: { readonly C_risk_exposure: number; readonly D_risk_exposure: number };
}
/** test/fixtures/dump_min_risk.py: the reference greedy's steps and each cell's first step. */
interface DemoPath {
  readonly path: readonly string[];
  readonly order: readonly string[];
}

const demo = readRepoJson<DemoResults>('docs/spec/reference/solver_demo_results.json');
const want = demo.min_risk_total_bar;
const demoPath = readRepoJson<DemoPath>('tier2-logic/solvers/test/fixtures/min_risk_path.json');

/** Acceptance tolerance on risk exposure and one-time IT ($M). */
const TOL = 0.5;
/** 04 §6: minimum-risk mix < 10 s. */
const BUDGET_MS = 10_000;
const noYield = () => Promise.resolve();

let model: SolverModel;
let result: SolverResult<'min_risk_mix'>;
beforeAll(async () => {
  const base = await seedModel('C');
  // The reference bounds, as production builds the model (SOL-12).
  model = withDecisionBounds(base, REFERENCE_DECISION_BOUNDS);
  result = await minRiskMix(model, {}, { yield: noYield });
}, 60_000);

const at = (r: SolverResult<'min_risk_mix'>) => model.compiled.rerun(model.base, r.changes);

/** The people levers of the demo storyline (docs/ux/05_demo_storyline.md: "the people levers (L03–L05)"). */
const PEOPLE_LEVERS = ['L03', 'L04', 'L05'];

/** Lever-intensity inputs of the people levers (`lev.L03.pct` …). */
function peopleLevers(): string[] {
  return decisionSet(model, 'lever_intensity')
    .filter((d) => PEOPLE_LEVERS.some((l) => d.id.startsWith(`lev.${l}.`)))
    .map((d) => d.cell);
}

describe('SOL-04 acceptance 1: min risk exposure clears the total bar from C (G5 vs min_risk_total_bar)', () => {
  it('risk exposure at C and D matches min_risk_reference', async () => {
    expect(riskExposure(model.base, model.members)).toBeCloseTo(demo.min_risk_reference.C_risk_exposure, 2);
    const d = await seedModel('D');
    expect(riskExposure(d.base, d.members)).toBeCloseTo(demo.min_risk_reference.D_risk_exposure, 2);
  });

  it('reaches res.net >= res.bar with risk exposure 42.01, one-time IT 20.0, res.fte_us 2692, people levers unchanged', () => {
    expect(result.status).toBe('feasible');
    const e = at(result);
    expect(e.get('res.net')).toBeGreaterThanOrEqual(e.get('res.bar'));
    expect(Math.abs(riskExposure(e, model.members) - want.risk_exposure)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(e.get('res.tot_ot_it') - want.one_time_it)).toBeLessThanOrEqual(TOL);
    // The reference rounds half to even (Python round): within half an FTE of 2692.
    expect(Math.abs(e.get('res.fte_us') - want.fte_us)).toBeLessThanOrEqual(0.5);
    expect(e.get('res.fte_us')).toBeCloseTo(model.base.get('res.fte_us'), 9);
    const people = peopleLevers();
    expect(people.length).toBeGreaterThan(0);
    for (const c of result.changes) expect(people).not.toContain(c.cell);
    // The headline numbers the reference reports, at its rounding.
    expect(result.metrics['res.net']).toBeCloseTo(want.net, 2);
    expect(result.metrics['res.bar']).toBeCloseTo(want.bar, 2);
    expect(result.metrics['res.risk']).toBeCloseTo(want.risk_adj_net, 2);
    expect(result.metrics.risk_exposure).toBeCloseTo(want.risk_exposure, 2);
    expect(result.metrics['res.fte_gcc']).toBeCloseTo(want.fte_gcc, 0);
    expect(result.metrics['br.eps27']).toBeCloseTo(want.eps27, 3);
    expect(result.metrics.steps).toBe(want.steps);
    // Steps inside a group of tied levers may interleave differently (rounding), which can change how
    // many candidates hit a bound early: at most one evaluation per step.
    expect(Math.abs(result.metrics.evaluations! - want.evaluations)).toBeLessThanOrEqual(want.steps);
    expect(result.metrics.objective).toBe(result.metrics.risk_exposure);
  });

  it('reports the total bar as the binding constraint with a positive shadow price', () => {
    const total = result.binding?.find((b) => b.constraint === 'total');
    expect(total).toBeDefined();
    expect(total!.shadowPrice).toBeGreaterThan(0);
  });
});

describe('SOL-04 acceptance 2: moved inputs and their order', () => {
  it('the set of moved inputs equals min_risk_total_bar.inputs_moved_from_C, with the same from/to', () => {
    const moved = Object.fromEntries(result.changes.map((c) => [c.cell, c.value]));
    expect(Object.keys(moved).sort()).toEqual(Object.keys(want.inputs_moved_from_C).sort());
    for (const [cell, { from, to }] of Object.entries(want.inputs_moved_from_C)) {
      expect(model.base.get(cell)).toBeCloseTo(from, 9);
      expect(moved[cell]).toBeCloseTo(to, 9);
    }
  });

  it('moves are ranked in optimizer order (each cell at its first greedy step), impacts add up to the net change', () => {
    expect(result.ranked.map((r) => r.cell)).toEqual(demoPath.order);
    expect(result.changes.map((c) => c.cell)).toEqual(demoPath.order);
    expect(demoPath.path).toHaveLength(want.steps);
    const total = result.ranked.reduce((s, r) => s + r.impact, 0);
    expect(total).toBeCloseTo(at(result).get('res.net') - model.base.get('res.net'), 9);
    for (const r of result.ranked) expect(r.from).toBe(model.base.get(r.cell));
  });
});

describe('SOL-04 acceptance 3: alternative objectives each return feasible from C', () => {
  const objectives: SolverObjective[] = ['max_risk_adjusted_net', 'min_one_time', 'min_people_impact', 'min_change'];
  for (const objective of objectives) {
    it(objective, async () => {
      const r = await minRiskMix(model, { objective }, { yield: noYield });
      expect(r.status).toBe('feasible');
      expect(r.changes.length).toBeGreaterThan(0);
      const e = at(r);
      expect(e.get('res.net')).toBeGreaterThanOrEqual(e.get('res.bar'));
      expect(r.metrics.objective).toBeTypeOf('number');
    });
  }

  it('each objective is no worse on its own measure than the min-risk mix', async () => {
    const base = at(result);
    const oneTime = await minRiskMix(model, { objective: 'min_one_time' }, { yield: noYield });
    expect(at(oneTime).get('res.tot_ot_all')).toBeLessThanOrEqual(base.get('res.tot_ot_all') + 1e-9);
    const change = await minRiskMix(model, { objective: 'min_change' }, { yield: noYield });
    expect(change.metrics.objective).toBeGreaterThan(0);
  });
});

describe('SOL-04 acceptance 4: deterministic for a seed; < 10 s single process (bench solvers.min_risk)', () => {
  it('the same seed gives the same result (explainable and production)', async () => {
    const a = await minRiskMix(model, { seed: 7 }, { yield: noYield });
    expect(a.changes).toEqual(result.changes);
    expect(a.ranked).toEqual(result.ranked);
    const p1 = await minRiskMix(model, { method: 'production', seed: 7 }, { yield: noYield });
    const p2 = await minRiskMix(model, { method: 'production', seed: 7 }, { yield: noYield });
    expect(p1.changes).toEqual(p2.changes);
    expect(p1.diagnostics.seed).toBe(7);
    expect(p1.status).toBe('feasible');
    // The production refinement keeps feasibility and never raises the objective.
    expect(p1.metrics.objective).toBeLessThanOrEqual(result.metrics.objective! + 1e-9);
    const e = at(p1);
    expect(e.get('res.net')).toBeGreaterThanOrEqual(e.get('res.bar'));
  });

  it(`runs in < ${BUDGET_MS} ms`, async () => {
    const t = performance.now();
    await minRiskMix(model, {}, { yield: noYield });
    expect(performance.now() - t).toBeLessThan(BUDGET_MS);
  });
});

describe('SOL-04 options, constraints and errors', () => {
  it('optional constraints are honoured (one-time cap, US floor, per-VP bars)', async () => {
    const cap = want.one_time_it + 1;
    const r = await minRiskMix(
      model,
      {
        constraints: [
          { id: 'total' },
          { id: 'one_time_cap', value: cap },
          { id: 'us_floor', value: model.base.get('res.fte_us') },
          { id: 'rate_share', value: 1 },
          { id: 'gcc_hiring', value: 1e6 },
          { id: 'eps', value: -1e6 },
        ],
      },
      { yield: noYield },
    );
    expect(r.status).toBe('feasible');
    const e = at(r);
    expect(e.get('res.tot_ot_it')).toBeLessThanOrEqual(cap + 1e-6);
    expect(e.get('res.fte_us')).toBeGreaterThanOrEqual(model.base.get('res.fte_us') - 1e-6);

    const vp = await minRiskMix(model, { constraints: [{ id: 'per_vp' }] }, { yield: noYield });
    const ev = at(vp);
    expect(ev.get('res.net')).toBeGreaterThanOrEqual(ev.get('res.bar'));
    if (vp.status === 'feasible') {
      for (const v of model.members.vp ?? []) {
        expect(ev.get(`vp.net[${v.id}]`)).toBeGreaterThanOrEqual(ev.get(`vp.bar[${v.id}]`) - 1e-6);
      }
    }
  });

  it('an unreachable bar ends infeasible with the closest plan', async () => {
    const r = await minRiskMix(model, { constraints: [{ id: 'eps', value: 1e6 }] }, { yield: noYield });
    expect(r.status).toBe('infeasible');
  });

  it('a start that already clears the bar moves nothing', async () => {
    const d = await seedModel('D');
    const r = await minRiskMix(d, {}, { yield: noYield });
    expect(r.status).toBe('feasible');
    expect(r.changes).toEqual([]);
    expect(r.ranked).toEqual([]);
  });

  it('other decision sets move in both directions within bounds', async () => {
    const r = await minRiskMix(model, { decisionSets: ['lever_intensity', 'lever_timing'] }, { yield: noYield });
    expect(r.status).toBe('feasible');
    const bounds = new Map(
      [...decisionSet(model, 'lever_intensity'), ...decisionSet(model, 'lever_timing')].map((d) => [d.cell, d]),
    );
    for (const c of r.changes) {
      const d = bounds.get(c.cell)!;
      expect(c.value).toBeGreaterThanOrEqual(d.lo - 1e-9);
      expect(c.value).toBeLessThanOrEqual(Math.max(d.hi, d.value) + 1e-9);
    }
  });

  it('rejects bad parameters', async () => {
    await expect(minRiskMix(model, { objective: 'nope' as SolverObjective })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(minRiskMix(model, { constraints: [{ id: 'nope' } as never] })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(minRiskMix(model, { constraints: [{ id: 'per_vp', vps: ['nope'] }] })).rejects.toMatchObject({
      code: 'BAD_PARAMS',
    });
    await expect(minRiskMix(model, { method: 'nope' as never })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(minRiskMix(model, { decisionSets: [] })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
  });

  it('cancels at the next batch with the partial plan, and reports progress', async () => {
    const ac = new AbortController();
    const notes: number[] = [];
    let batches = 0;
    const r = await minRiskMix(
      model,
      {},
      {
        signal: ac.signal,
        progressIntervalMs: 0,
        progress: (f) => notes.push(f),
        yield: () => {
          batches += 1;
          if (batches === 6) ac.abort();
          return Promise.resolve();
        },
      },
    );
    expect(r.status).toBe('cancelled');
    expect(r.changes.length).toBeGreaterThan(0);
    expect(notes.length).toBeGreaterThan(0);
    for (const f of notes) expect(f).toBeGreaterThanOrEqual(0);
  });
});
