/**
 * SOL-03 acceptance on the seed tenant: blend C → D solved for res.gap = 0 matches
 * `solver_demo_results.json#goal_seek_blend_C_to_D` (G5); per-member inputs blend per member; < 1 s.
 * Plus parameter checks, an unreachable target, abort.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { cellKey } from '@glidepath/engine';
import { presetValues, readRepoJson, seedModel } from '../../test/helpers';
import { blend } from '../blend';
import type { SolverModel } from '../model';
import { runSolver } from '../run';
import { BLEND_OUTPUT, BLEND_TARGET, blendCells } from './blend';

interface BlendReference {
  readonly lambda: number;
  readonly net: number;
  readonly bar: number;
  readonly risk_adj_net: number;
  readonly one_time_it: number;
  readonly eps27: number;
  readonly vp_gaps: Readonly<Record<string, number>>;
}
const REF = readRepoJson<Record<string, BlendReference>>('docs/spec/reference/solver_demo_results.json')
  .goal_seek_blend_C_to_D!;

/** Acceptance tolerances (SOL-03): λ ± 0.001; VP gaps within 0.01; the rest at the reference's rounding. */
const LAMBDA_TOL = 0.001;
const VP_GAP_TOL = 0.01;
const CENTS = 2;
const EPS_DIGITS = 4;
/** 03 §3 / solvers.json performance target for scenario_blend. */
const BLEND_BUDGET_MS = 1000;
/** Dimensioned scenario-varying inputs the per-member test spreads across members. */
const PER_MEMBER = ['lev.ramp', 'lev.conf'];

let model: SolverModel;
let C: Map<string, number>;
let D: Map<string, number>;
beforeAll(async () => {
  C = await presetValues('C');
  D = await presetValues('D');
  model = { ...(await seedModel('C')), scenarios: new Map([['C', C], ['D', D]]) };
});

const noYield = () => Promise.resolve();

describe('SOL-03 G5: blend C → D solved for res.gap = 0 matches goal_seek_blend_C_to_D', () => {
  it('λ 0.4936 ± 0.001, net 142.98, risk-adjusted 96.91, one-time IT 26.97, eps27 0.104, VP gaps within 0.01', async () => {
    expect(BLEND_OUTPUT).toBe('res.gap');
    expect(BLEND_TARGET).toBe(0);
    const r = await blend(model, 'C', 'D', 0, { yield: noYield });
    expect(r.problem).toBe('scenario_blend');
    expect(r.status).toBe('optimal');
    const lambda = r.detail!.lambda!;
    expect(Math.abs(lambda - REF.lambda)).toBeLessThanOrEqual(LAMBDA_TOL);
    expect(r.metrics.lambda).toBe(lambda);
    expect(Math.abs(r.metrics['res.gap']!)).toBeLessThan(1e-6);

    // Independent check: apply the result's changes and read the outputs.
    const e = model.compiled.rerun(model.base, r.changes);
    expect(e.get('res.net')).toBeCloseTo(REF.net, CENTS);
    expect(e.get('res.bar')).toBeCloseTo(REF.bar, CENTS);
    expect(e.get('res.risk')).toBeCloseTo(REF.risk_adj_net, CENTS);
    expect(e.get('res.tot_ot_it')).toBeCloseTo(REF.one_time_it, CENTS);
    expect(e.get('br.eps27')).toBeCloseTo(REF.eps27, EPS_DIGITS);
    for (const [vp, gap] of Object.entries(REF.vp_gaps)) {
      expect(Math.abs(e.get(cellKey('vp.gap', [vp])) - gap), vp).toBeLessThanOrEqual(VP_GAP_TOL);
    }
    // The headline metrics are the same numbers.
    expect(r.metrics['res.net']).toBeCloseTo(e.get('res.net'), 9);
    expect(r.metrics['res.risk']).toBeCloseTo(e.get('res.risk'), 9);
    expect(r.metrics['res.tot_ot_it']).toBeCloseTo(e.get('res.tot_ot_it'), 9);
    expect(r.metrics['br.eps27']).toBeCloseTo(e.get('br.eps27'), 9);
    for (const vp of Object.keys(REF.vp_gaps)) {
      expect(r.metrics[cellKey('vp.gap', [vp])]).toBeCloseTo(e.get(cellKey('vp.gap', [vp])), 9);
    }
    // Ranked: one row per move, priced against the blend's output.
    expect(r.ranked).toHaveLength(r.changes.length);
  });

  it('accepts resolved input maps for A and B as well as scenario ids', async () => {
    const byId = await blend(model, 'C', 'D', 0, { yield: noYield });
    const byMap = await blend({ ...model, scenarios: undefined }, C, D, 0, { yield: noYield });
    expect(byMap.detail!.lambda).toBe(byId.detail!.lambda);
    expect(byMap.changes).toEqual(byId.changes);
  });
});

describe('SOL-03 per-member inputs blend per member', () => {
  it('each member of a dimensioned scenario-varying input moves to A + λ (B − A) of its own A and B', async () => {
    // The seed's C and D agree on every member of lev.start / lev.ramp / lev.conf, so B is D with each
    // member of lev.ramp and lev.conf spread across its registry range (a distinct value per member). lev.start
    // is left alone: spread to month 12 it delays enough savings that no λ closes the gap.
    const B = new Map(D);
    const dimensioned = model.bundle.variables.filter((v) => PER_MEMBER.includes(v.id));
    expect(dimensioned.every((v) => v.scenario_varies && v.dims.length > 0 && v.min !== null && v.max !== null)).toBe(true);
    expect(dimensioned).toHaveLength(PER_MEMBER.length);
    for (const v of dimensioned) {
      const cells = [...C.keys()].filter((k) => k.startsWith(`${v.id}[`));
      cells.forEach((cell, i) => B.set(cell, v.min! + ((v.max! - v.min!) * (i + 1)) / (cells.length + 1)));
    }
    const r = await blend(model, C, B, 0, { yield: noYield });
    expect(r.status).toBe('optimal');
    const lambda = r.detail!.lambda!;
    expect(lambda).toBeGreaterThan(0);
    expect(lambda).toBeLessThan(1);

    const perMember = blendCells(model, C, B).filter((c) => c.cell.includes('['));
    expect(perMember.length).toBeGreaterThan(1);
    expect(new Set(perMember.map((c) => c.b - c.a)).size).toBeGreaterThan(1);
    const moved = new Map(r.changes.map((c) => [c.cell, c.value]));
    for (const c of perMember) {
      const got = moved.get(c.cell) ?? model.base.get(c.cell);
      expect(got, c.cell).toBeCloseTo(c.a + lambda * (c.b - c.a), 12);
    }
    // Only scenario-varying inputs move.
    const varies = new Set(model.bundle.variables.filter((v) => v.scenario_varies).map((v) => v.id));
    for (const c of r.changes) expect(varies.has(c.cell.split('[')[0]!), c.cell).toBe(true);
  });

  it('at λ = 0 and λ = 1 the blend is A and B exactly (start = C: solving net = D net gives λ = 1)', async () => {
    const dNet = model.compiled.evaluate(D, model.base.overrides).get('res.net');
    const r = await runSolver(model, { problem: 'scenario_blend', params: { from: 'C', to: 'D', output: 'res.net', target: dNet } }, { yield: noYield });
    expect(r.status).toBe('optimal');
    expect(r.detail!.lambda!).toBeCloseTo(1, 9);
    for (const c of r.changes) expect(c.value, c.cell).toBeCloseTo(D.get(c.cell)!, 9);
    const same = await blend(model, 'C', 'D', model.base.get('res.gap'), { yield: noYield });
    expect(same.detail!.lambda).toBe(0);
    expect(same.changes).toEqual([]);
  });
});

describe('SOL-03 not reachable, bad parameters, abort', () => {
  it('a target outside [A, B] is unreachable: λ null, changes and metrics at the closest end', async () => {
    const r = await blend(model, 'C', 'D', -1e6, { yield: noYield });
    expect(r.status).toBe('unreachable');
    expect(r.detail!.lambda).toBeNull();
    expect([0, 1]).toContain(r.metrics.lambda);
  });

  it('rejects bad parameters with BAD_PARAMS', async () => {
    const bad = (params: unknown) => runSolver(model, { problem: 'scenario_blend', params } as never);
    await expect(bad(undefined)).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(bad({ from: 'C' })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(bad({ from: 'C', to: 'nope' })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(bad({ from: 'C', to: 'D', output: 'res.nope' })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(bad({ from: 'C', to: 'D', target: Number.NaN })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(blend({ ...model, scenarios: undefined }, 'C', 'D')).rejects.toMatchObject({ code: 'BAD_PARAMS' });
  });

  it('an aborted run ends cancelled', async () => {
    const ac = new AbortController();
    let n = 0;
    const r = await blend(model, 'C', 'D', 0, {
      signal: ac.signal,
      yield: () => {
        if (++n === 2) ac.abort();
        return Promise.resolve();
      },
    });
    expect(r.status).toBe('cancelled');
  });
});

describe('SOL-03 perf', () => {
  it(`blend C → D on res.gap = 0 runs in < ${BLEND_BUDGET_MS} ms`, async () => {
    await blend(model, 'C', 'D', 0, { yield: noYield });
    const t = performance.now();
    await blend(model, 'C', 'D', 0, { yield: noYield });
    expect(performance.now() - t).toBeLessThan(BLEND_BUDGET_MS);
  });
});
