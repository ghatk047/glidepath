/**
 * SOL-07 acceptance: tornado sensitivity (04 §5, `solvers.json` `problems.sensitivity`).
 *  1. one-at-a-time to registry min/max on res.net, sorted by swing; top entry g.ot_out_share, swing 39.1
 *     ± 0.1; top-15 ids equal `tornado_net_top15` (order may differ only between swings within 0.1) (G5)
 *  2. each item carries a category (policy, timing, lever) from the registry group (test)
 *  3. elasticity option (test); < 2 s (bench)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readRepoJson, seedModel } from '../test/helpers';
import type { SolverModel } from './model';
import { runSolver } from './run';
import { TORNADO_CATEGORIES, defaultTornadoCategory, tornado, type TornadoItem } from './tornado';

interface GoldenRow {
  id: string;
  min: number;
  max: number;
  net_at_min: number;
  net_at_max: number;
  swing: number;
}

/** Tolerance of acceptance 1 (swing in $M). */
const SWING_TOL = 0.1;

let model: SolverModel;
let golden: GoldenRow[];
beforeAll(async () => {
  model = await seedModel('C');
  golden = readRepoJson<{ tornado_net_top15: GoldenRow[] }>('docs/spec/reference/solver_demo_results.json').tornado_net_top15;
});

const varOf = (id: string) => model.bundle.variables.find((v) => v.id === id)!;

describe('SOL-07 tornado: one-at-a-time to registry min/max on res.net, sorted by swing (G5)', () => {
  it('top entry g.ot_out_share swing 39.1 ± 0.1; top-15 ids equal tornado_net_top15 (reorder only within 0.1)', () => {
    const t = tornado(model, 'res.net');
    const y0 = model.base.get('res.net');
    expect(t.output).toBe('res.net');
    expect(t.base).toBe(y0);

    // Sorted by swing, descending.
    for (let i = 1; i < t.items.length; i++) expect(t.items[i - 1]!.swing).toBeGreaterThanOrEqual(t.items[i]!.swing);

    const top = t.items[0]!;
    expect(top.cell).toBe(golden[0]!.id);
    expect(top.cell).toBe('g.ot_out_share');
    expect(Math.abs(top.swing - golden[0]!.swing)).toBeLessThanOrEqual(SWING_TOL);

    const ours = t.items.slice(0, golden.length);
    expect(new Set(ours.map((r) => r.cell))).toEqual(new Set(golden.map((g) => g.id)));

    const byId = new Map(ours.map((r) => [r.cell, r] as const));
    for (const g of golden) {
      const r = byId.get(g.id)!;
      // Same one-at-a-time points as the reference (registry min / max) and the same output deltas.
      expect(r.low!.input).toBe(g.min);
      expect(r.high!.input).toBe(g.max);
      expect(Math.abs(r.low!.output - y0 - g.net_at_min)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(r.high!.output - y0 - g.net_at_max)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(r.swing - g.swing)).toBeLessThanOrEqual(SWING_TOL);
    }
    // Any pair ordered differently from the reference must have swings within 0.1.
    const rank = new Map(golden.map((g, i) => [g.id, i] as const));
    for (let i = 0; i < ours.length; i++) {
      for (let j = i + 1; j < ours.length; j++) {
        if (rank.get(ours[i]!.cell)! > rank.get(ours[j]!.cell)!) {
          expect(Math.abs(ours[i]!.swing - ours[j]!.swing)).toBeLessThanOrEqual(SWING_TOL);
        }
      }
    }
  });

  it('default inputs are the scalar, ranged, non-enum drivers that feed the output, each varied alone', () => {
    const t = tornado(model, 'res.net');
    const upstream = new Set(model.compiled.upstream('res.net'));
    for (const r of t.items) {
      const v = varOf(r.id);
      expect(r.cell).toBe(v.id);
      expect(v.dims).toEqual([]);
      expect(v.role).toBe('driver');
      expect(v.type).not.toBe('enum');
      expect(upstream.has(r.cell)).toBe(true);
      expect(r.value).toBe(model.base.get(r.cell));
      expect(r.elasticity).toBeNull();
      // One at a time: the low point equals a scalar rerun of that one move.
      const lo = model.compiled.rerun(model.base, [{ target: 'variable', cell: r.cell, value: v.min! }]).get('res.net');
      expect(r.low!.output).toBeCloseTo(lo, 9);
    }
    expect(t.items.length).toBeGreaterThan(golden.length);
  });

  it('range option: ± a fraction of the current value; inputs option; top option', () => {
    const cells = ['lev.L10.ren', 'hc.ctr'];
    const t = tornado(model, 'res.net', { inputs: cells, range: { mode: 'relative', fraction: 0.1 } });
    expect(t.items.map((r) => r.cell).sort()).toEqual([...cells].sort());
    for (const r of t.items) {
      expect(r.low!.input).toBeCloseTo(r.value * 0.9, 12);
      expect(r.high!.input).toBeCloseTo(r.value * 1.1, 12);
      expect(r.swing).toBeCloseTo(Math.abs(r.high!.output - r.low!.output), 12);
    }
    expect(tornado(model, 'res.net', { top: 5 }).items).toHaveLength(5);
  });

  it('works on other outputs and dimensioned input cells (registry range of the variable)', () => {
    const t = tornado(model, 'br.eps27', { inputs: ['lev.start[L05]', 'g.ot_in_year'] });
    const start = t.items.find((r) => r.cell === 'lev.start[L05]')!;
    expect(start.id).toBe('lev.start');
    expect(start.low!.input).toBe(varOf('lev.start').min);
    expect(start.high!.input).toBe(varOf('lev.start').max);
    expect(start.category).toBe('timing');
  });

  it('rejects an unknown output, an unknown input and an input without a registry range', () => {
    expect(() => tornado(model, 'res.nope')).toThrow(expect.objectContaining({ code: 'BAD_PARAMS' }));
    expect(() => tornado(model, 'res.net', { inputs: ['nope.x'] })).toThrow(expect.objectContaining({ code: 'BAD_PARAMS' }));
    const unranged = model.bundle.variables.find((v) => v.dims.length === 0 && (v.min === null || v.max === null));
    if (unranged) {
      expect(() => tornado(model, 'res.net', { inputs: [unranged.id] })).toThrow(expect.objectContaining({ code: 'BAD_PARAMS' }));
    }
    expect(() => tornado(model, 'res.net', { range: { mode: 'relative', fraction: -1 } })).toThrow(
      expect.objectContaining({ code: 'BAD_PARAMS' }),
    );
  });
});

describe('SOL-07 category: each item carries policy, timing or lever from the registry group', () => {
  it('every item has a category; governance target inputs are policy, timing inputs timing, the rest lever', () => {
    const t = tornado(model, 'res.net');
    const cat = new Map(t.items.map((r) => [r.cell, r.category] as const));
    for (const r of t.items) {
      expect(TORNADO_CATEGORIES).toContain(r.category);
      expect(r.category).toBe(defaultTornadoCategory(varOf(r.id)));
    }
    // 04 §3: "The top three are policy and timing choices, not savings levers".
    expect(cat.get('g.ot_out_share')).toBe('policy');
    expect(cat.get('g.ot_in_year')).toBe('timing');
    expect(cat.get('g.head_start')).toBe('timing');
    expect(t.items.slice(0, 3).every((r) => r.category !== 'lever')).toBe(true);
    for (const r of t.items.slice(3, golden.length)) expect(r.category).toBe('lever');
    expect(defaultTornadoCategory(varOf('g.target_net'))).toBe('policy');
    expect(defaultTornadoCategory(varOf('lev.start'))).toBe('timing');
    expect(defaultTornadoCategory(varOf('lev.ramp'))).toBe('timing');
  });

  it('a tenant can supply its own group → category rule', () => {
    const t = tornado(model, 'res.net', { top: 4, category: (v) => (v.group === 'Levers' ? 'lever' : 'policy') });
    for (const r of t.items) expect(r.category).toBe(varOf(r.id).group === 'Levers' ? 'lever' : 'policy');
  });
});

describe('SOL-07 elasticity option and speed', () => {
  it('elasticity = d output / d input × input / output at the current point (finite differences)', () => {
    const t = tornado(model, 'res.net', { elasticity: true });
    const y0 = t.base;
    const by = new Map(t.items.map((r) => [r.cell, r] as const));
    // res.net is linear in g.ot_out_share over its range: slope = (high − low) / (max − min).
    const share = by.get('g.ot_out_share')!;
    const slope = (share.high!.output - share.low!.output) / (share.high!.input - share.low!.input);
    expect(share.elasticity).toBeCloseTo((slope * share.value) / y0, 6);
    // Every elasticity matches a wider scalar central difference.
    for (const r of t.items.slice(0, 30)) {
      const h = Math.max(Math.abs(r.value), 1) * 1e-4;
      const at = (x: number) => model.compiled.rerun(model.base, [{ target: 'variable', cell: r.cell, value: x }]).get('res.net');
      const d = (at(r.value + h) - at(r.value - h)) / (2 * h);
      expect(r.elasticity).not.toBeNull();
      expect(Math.abs(r.elasticity! - (d * r.value) / y0)).toBeLessThanOrEqual(1e-4 * Math.max(1, Math.abs(r.elasticity!)));
    }
  });

  it('elasticity is null where the output is zero at the current point', () => {
    const zero = model.bundle.variables.find((v) => v.dims.length === 0 && model.base.get(v.id) === 0 && v.min !== null && v.max !== null)!;
    const t = tornado(model, zero.id, { inputs: [zero.id], elasticity: true });
    expect(t.base).toBe(0);
    expect(t.items[0]!.elasticity).toBeNull();
    // The output is the varied input itself: low/high outputs are the inputs.
    expect(t.items[0]!.low).toEqual({ input: zero.min, output: zero.min });
  });

  it('full tornado with elasticities on res.net runs in < 2 s (bench)', () => {
    tornado(model, 'res.net'); // warm-up
    const t0 = performance.now();
    const t = tornado(model, 'res.net', { elasticity: true });
    const ms = performance.now() - t0;
    expect(t.items.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  });
});

describe('SOL-07 runSolver(sensitivity)', () => {
  const rowOf = (r: TornadoItem) => r.cell;

  it('method tornado: detail rows sorted by swing with category, ranked moves low → high, nothing moved', async () => {
    const res = await runSolver(model, { problem: 'sensitivity', params: { method: 'tornado', outputs: ['res.net'] } });
    expect(res.status).toBe('feasible');
    expect(res.changes).toEqual([]);
    const d = res.detail!;
    expect(d.method).toBe('tornado');
    expect(d.output).toBe('res.net');
    expect(d.rows[0]!.cell).toBe('g.ot_out_share');
    expect(d.rows[0]!.category).toBe('policy');
    expect(d.rows[0]!.elasticity).toBeNull();
    expect(d.rows.map((r) => r.cell)).toEqual(tornado(model, 'res.net').items.map(rowOf));
    expect(res.ranked[0]).toMatchObject({ cell: 'g.ot_out_share', from: 0, to: 1 });
    expect(Math.abs(res.ranked[0]!.impact)).toBeCloseTo(d.rows[0]!.swing!, 9);
    expect(res.metrics['res.net']).toBe(model.base.get('res.net'));
    expect(res.diagnostics.iterations).toBe(1);
  });

  it('method elasticity: rows sorted by |elasticity|; relative range and inputs pass through', async () => {
    const res = await runSolver(model, {
      problem: 'sensitivity',
      params: { method: 'elasticity', outputs: ['res.net', 'br.eps27'], inputs: ['lev.L10.ren', 'hc.ctr', 'g.ot_out_share'], range: { mode: 'relative', fraction: 0.2 } },
    });
    const rows = res.detail!.rows;
    expect(rows).toHaveLength(3);
    for (let i = 1; i < rows.length; i++) expect(Math.abs(rows[i - 1]!.elasticity!)).toBeGreaterThanOrEqual(Math.abs(rows[i]!.elasticity!));
    expect(res.metrics['br.eps27']).toBe(model.base.get('br.eps27'));
  });

  it('sobol and spider are not this item; no output is BAD_PARAMS; abort ends cancelled', async () => {
    await expect(runSolver(model, { problem: 'sensitivity', params: { method: 'sobol', outputs: ['res.net'] } })).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
      message: expect.stringContaining('SOL-10'),
    });
    await expect(runSolver(model, { problem: 'sensitivity', params: { method: 'spider', outputs: ['res.net'] } })).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    });
    await expect(runSolver(model, { problem: 'sensitivity', params: { method: 'tornado', outputs: [] } })).rejects.toMatchObject({
      code: 'BAD_PARAMS',
    });
    const ac = new AbortController();
    ac.abort();
    const res = await runSolver(model, { problem: 'sensitivity', params: { method: 'tornado', outputs: ['res.net'] } }, { signal: ac.signal });
    expect(res.status).toBe('cancelled');
  });
});
