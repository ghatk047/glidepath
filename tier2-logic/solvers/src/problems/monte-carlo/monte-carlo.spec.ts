/**
 * SOL-06 acceptance 2–4: G5 against `solver_demo_results.json` (`monte_carlo_C`, `monte_carlo_D`), the
 * outputs of a run (percentiles, histograms, probabilities, Spearman contributions, stored seed), and the
 * 2,000-draw budget (< 10 s).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readRepoJson, seedModel } from '../../../test/helpers';
import type { SolverModel } from '../../model';
import { runSolver } from '../../run';
import type { SolverResult } from '../../types';
import { MONTE_CARLO_DEFAULTS } from './defaults';

interface McRef {
  iterations: number;
  net_p10_p50_p90: [number, number, number];
  bar_p10_p50_p90: [number, number, number];
  prob_clear_bar: number;
  prob_clear_target_ignoring_growth: number;
  eps27_p10_p50_p90: [number, number, number];
  prob_vp_clears_bar: Record<string, number>;
}
const ref = readRepoJson<Record<string, McRef>>('docs/spec/reference/solver_demo_results.json');

const models: Record<string, SolverModel> = {};
beforeAll(async () => {
  models.C = await seedModel('C');
  models.D = await seedModel('D');
});

const noYield = () => Promise.resolve();
const mc = (preset: 'C' | 'D', params: Parameters<typeof runSolver<'monte_carlo'>>[1]['params'] = {}) =>
  runSolver(models[preset]!, { problem: 'monte_carlo', params }, { yield: noYield });

/** Runs of the G5 check: fixed seeds, 2,000 draws each (a different RNG than numpy, so several samples). */
const G5_SEEDS = [1, 2, 3, 4, 5];
/** P(clear) tolerance (03 §3): ±1.5 pp; percentile tolerance (this backlog): ±5%. */
const P_TOL = 0.015;
const PCT_TOL = 0.05;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[(s.length - 1) / 2]!;
};

describe('SOL-06 G5: seeded 2,000 draws match monte_carlo_C / monte_carlo_D', () => {
  for (const preset of ['C', 'D'] as const) {
    it(`${preset}: P(clear bar) ${ref[`monte_carlo_${preset}`]!.prob_clear_bar * 100}% within ±1.5 pp; net P10/P50/P90 within ±5%`, async () => {
      const r = ref[`monte_carlo_${preset}`]!;
      const runs: SolverResult<'monte_carlo'>[] = [];
      for (const seed of G5_SEEDS) runs.push(await mc(preset, { seed }));
      for (const run of runs) {
        expect(run.detail!.iterations).toBe(r.iterations);
        expect(run.metrics.failed).toBe(0);
        expect(Math.abs(run.metrics.p_clear_bar! - r.prob_clear_bar), `seed ${run.diagnostics.seed}`).toBeLessThanOrEqual(P_TOL);
        expect(Math.abs(run.metrics.p_clear_target! - r.prob_clear_target_ignoring_growth)).toBeLessThanOrEqual(2 * P_TOL);
        for (const [vp, p] of Object.entries(r.prob_vp_clears_bar)) {
          expect(Math.abs(run.metrics[`p_clear_vp[${vp}]`]! - p), vp).toBeLessThanOrEqual(P_TOL + 0.02);
        }
      }
      // Percentiles: the median over the seeded runs (one run's P10 has ~1.7% sampling noise).
      const keys = ['p10', 'p50', 'p90'] as const;
      keys.forEach((k, i) => {
        const net = median(runs.map((x) => x.metrics[`res.net.${k}`]!));
        expect(Math.abs(net / r.net_p10_p50_p90[i]! - 1), `net ${k} ${net}`).toBeLessThanOrEqual(PCT_TOL);
        const bar = median(runs.map((x) => x.metrics[`res.bar.${k}`]!));
        expect(Math.abs(bar / r.bar_p10_p50_p90[i]! - 1), `bar ${k}`).toBeLessThanOrEqual(PCT_TOL);
      });
      const eps = median(runs.map((x) => x.metrics['br.eps27.p50']!));
      expect(Math.abs(eps / r.eps27_p10_p50_p90[1] - 1)).toBeLessThanOrEqual(PCT_TOL);
    }, 60_000);
  }
});

describe('SOL-06 outputs: P10/P50/P90 + histograms, P(clear target), P(clear) per VP, Spearman by lever, seed stored', { timeout: 60_000 }, () => {
  let r: SolverResult<'monte_carlo'>;
  beforeAll(async () => {
    r = await mc('D', { seed: 11, iterations: 1000 });
  });

  it('P10 ≤ P50 ≤ P90 and a histogram over every draw for net, bar, gap, EPS and share price', () => {
    const d = r.detail!;
    expect(d.percentiles.map((p) => p.cell)).toEqual(MONTE_CARLO_DEFAULTS.outputs);
    for (const p of d.percentiles) {
      expect(p.p10).toBeLessThanOrEqual(p.p50);
      expect(p.p50).toBeLessThanOrEqual(p.p90);
      expect(r.metrics[`${p.cell}.p50`]).toBe(p.p50);
    }
    // Share price and EPS move with the draws.
    const px = d.percentiles.find((p) => p.cell === 'val.px[fy27it]')!;
    expect(px.p90).toBeGreaterThan(px.p10);
    // D falls short of the bar in most draws: the gap (net − bar) is mostly negative.
    expect(d.percentiles.find((p) => p.cell === 'res.gap')!.p50).toBeLessThan(0);
    expect(d.histograms.map((h) => h.cell)).toEqual(MONTE_CARLO_DEFAULTS.outputs);
    for (const h of d.histograms) {
      expect(h.bins).toHaveLength(MONTE_CARLO_DEFAULTS.bins);
      expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(1000);
      for (let i = 1; i < h.bins.length; i++) expect(h.bins[i]!.lo).toBeCloseTo(h.bins[i - 1]!.hi, 9);
    }
  });

  it('P(clear bar), P(clear target ignoring growth) and P(clear) per VP, as probabilities and metrics', () => {
    const d = r.detail!;
    const vps = models.D!.members.vp!.map((m) => m.id);
    expect(d.probabilities.map((p) => [p.cell, p.against])).toEqual([
      ['res.net', 'res.bar'],
      ['res.net', 'res.target'],
      ...vps.map((v) => [`vp.net[${v}]`, `vp.bar[${v}]`]),
    ]);
    for (const p of d.probabilities) {
      expect(p.p).toBeGreaterThanOrEqual(0);
      expect(p.p).toBeLessThanOrEqual(1);
    }
    expect(r.metrics.p_clear_bar).toBe(d.probabilities[0]!.p);
    expect(r.metrics.p_clear_target).toBe(d.probabilities[1]!.p);
    // The target ignores growth: it is easier to clear than the bar.
    expect(r.metrics.p_clear_target!).toBeGreaterThan(r.metrics.p_clear_bar!);
    for (const v of vps) expect(r.metrics[`p_clear_vp[${v}]`]).toBeDefined();
  });

  it('variance contribution by lever: Spearman rank correlation of realisation with net; shares sum to 1', () => {
    const c = r.detail!.contributions;
    expect(c.map((x) => x.lever).sort()).toEqual(models.D!.members.lever!.map((m) => m.id).sort());
    expect(c.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 12);
    for (const x of c) expect(x.share).toBeCloseTo((x.rho * x.rho) / c.reduce((s, y) => s + y.rho * y.rho, 0), 12);
    for (let i = 1; i < c.length; i++) expect(c[i]!.share).toBeLessThanOrEqual(c[i - 1]!.share);
    // More delivery never lowers the net: the big levers correlate positively.
    expect(c[0]!.rho).toBeGreaterThan(0.3);
  });

  it('stores the seed and is reproducible: the same seed gives the same result; moves nothing', async () => {
    expect(r.diagnostics.seed).toBe(11);
    expect(r.detail!.seed).toBe(11);
    expect(r.changes).toEqual([]);
    expect(r.status).toBe('feasible');
    const again = await mc('D', { seed: 11, iterations: 1000, batchSize: 300 });
    expect(again.detail).toEqual(r.detail);
    expect(again.metrics).toEqual(r.metrics);
    expect(again.diagnostics.iterations).toBe(4); // 1,000 draws in batches of 300
    const other = await mc('D', { seed: 12, iterations: 1000 });
    expect(other.metrics['res.net.p50']).not.toBe(r.metrics['res.net.p50']);
    // No seed: the default seed, stored.
    const dflt = await mc('C', { iterations: 50 });
    expect(dflt.diagnostics.seed).toBe(MONTE_CARLO_DEFAULTS.seed);
  });

  it('honours outputs and bins; rejects bad ones', async () => {
    const x = await mc('C', { iterations: 40, outputs: ['res.net', 'lev.realize[L01]'], bins: 4 });
    expect(x.detail!.percentiles.map((p) => p.cell)).toEqual(['res.net', 'lev.realize[L01]']);
    expect(x.detail!.histograms[1]!.bins).toHaveLength(4);
    // An output outside the varied closure is constant.
    const fixed = await mc('C', { iterations: 10, outputs: ['g.target_net'] });
    expect(fixed.detail!.histograms[0]!.bins).toEqual([{ lo: 100, hi: 100, count: 10 }]);
    await expect(mc('C', { outputs: ['no.such'] })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(mc('C', { bins: 0 })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
    await expect(mc('C', { batchSize: 0 })).rejects.toMatchObject({ code: 'BAD_PARAMS' });
  });

  it('a cancel lands between batches and returns the draws so far; progress is reported', async () => {
    const ac = new AbortController();
    const notes: string[] = [];
    let batches = 0;
    const res = await runSolver(
      models.C!,
      { problem: 'monte_carlo', params: { seed: 3, iterations: 1000, batchSize: 200 } },
      {
        signal: ac.signal,
        progressIntervalMs: 0,
        progress: (_f, note) => notes.push(note ?? ''),
        yield: () => {
          if (++batches === 3) ac.abort();
          return Promise.resolve();
        },
      },
    );
    expect(res.status).toBe('cancelled');
    expect(res.detail!.iterations).toBe(400);
    expect(res.metrics.draws).toBe(400);
    expect(res.diagnostics.seed).toBe(3);
    expect(notes).toContain('400/1000');
  });

  it('lanes the engine fails are left out and counted; when every lane fails the engine error is raised', async () => {
    // An input with a value inside its registry range that makes evaluation raise.
    const divisor = findDivisorInput(models.C!);
    const half = await mc('C', { iterations: 20, dist: { [divisor.cell]: { type: 'discrete', values: [divisor.ok, divisor.bad] } } });
    expect(half.metrics.failed).toBeGreaterThan(0);
    expect(half.metrics.draws! + half.metrics.failed!).toBe(20);
    await expect(mc('C', { iterations: 5, dist: { [divisor.cell]: { type: 'discrete', values: [divisor.bad] } } })).rejects.toMatchObject({
      name: 'EngineError',
    });
  });
});

/** An input with a registry-range value that makes evaluation raise, with its start value. */
function findDivisorInput(model: SolverModel): { cell: string; ok: number; bad: number } {
  const vars = new Map(model.bundle.variables.map((v) => [v.id, v]));
  for (const [cell, ok] of model.base.values) {
    const v = vars.get(cell.split('[')[0]!);
    if (v === undefined) continue;
    for (const bad of [0, v.min, v.max]) {
      if (bad === null || bad === ok || (v.min !== null && bad < v.min) || (v.max !== null && bad > v.max)) continue;
      const b = model.compiled.evaluateBatch(model.base, { size: 1, values: new Map([[cell, Float64Array.of(bad)]]) });
      if (b.failed[0] === 1) return { cell, ok, bad };
    }
  }
  throw new Error('no input fails inside its range');
}

describe('SOL-06 performance: 2,000 draws < 10 s (bench solvers.mc.2000)', () => {
  it('runs 2,000 draws of the default distributions on the seed model in under 10 s', async () => {
    const t = performance.now();
    const res = await mc('C', { iterations: 2000 });
    const ms = performance.now() - t;
    expect(res.detail!.iterations).toBe(2000);
    expect(ms).toBeLessThan(10_000);
  }, 30_000);
});
