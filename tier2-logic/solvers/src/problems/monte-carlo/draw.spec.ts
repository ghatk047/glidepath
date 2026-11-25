/**
 * SOL-06 acceptance 1 (distributions): realisation 1.2·Beta(K·c/1.2, K·(1 − c/1.2)) with K = 4; start
 * slip U{0,1,2}; pool growth Triangular(0.7g, g, 1.4g); variable_def.dist overrides; Gaussian copula
 * ρ = 0.5 for L01–L08 and L09–L16. Checked on sample moments and rank correlation.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { seedModel } from '../../../test/helpers';
import type { SolverModel } from '../../model';
import type { MonteCarloDist } from '../../types';
import { MONTE_CARLO_DEFAULTS } from './defaults';
import { drawMonteCarlo, resolveDists, validateDist } from './draw';
import { betaCdf, betaInv, histogram, normCdf, normInv, percentile, ranks, spearman } from './stats';

let model: SolverModel;
beforeAll(async () => {
  model = await seedModel('C');
});

const N = 10000;
const SEED = 7;
const mean = (x: ArrayLike<number>) => Array.from(x).reduce((a, b) => a + b, 0) / x.length;
const variance = (x: ArrayLike<number>) => {
  const m = mean(x);
  return Array.from(x).reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1);
};
const levers = () => model.members.lever!.map((m) => m.id);
/** Spearman correlation of a Gaussian copula with correlation r. */
const copulaSpearman = (r: number) => (6 / Math.PI) * Math.asin(r / 2);

describe('SOL-06 distributions: defaults, overrides and copula (sample moments, rank correlation)', { timeout: 60_000 }, () => {
  it('realisation per lever: 1.2 × Beta(K·c/1.2, K·(1 − c/1.2)), K = 4: mean c, variance 1.2²·(c/1.2)(1 − c/1.2)/(K + 1)', () => {
    const d = drawMonteCarlo(model, { iterations: N }, SEED);
    const K = 4;
    const s = 1.2;
    for (const l of levers()) {
      const x = d.cells.get(`lev.realize[${l}]`)!;
      const c = model.base.get(`lev.conf[${l}]`);
      const m = c / s;
      const v = (s * s * m * (1 - m)) / (K + 1);
      expect(Math.min(...x)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...x)).toBeLessThanOrEqual(s);
      expect(Math.abs(mean(x) - c), `${l} mean`).toBeLessThan(4 * Math.sqrt(v / N));
      expect(variance(x) / v, `${l} variance`).toBeGreaterThan(0.95);
      expect(variance(x) / v, `${l} variance`).toBeLessThan(1.05);
    }
  });

  it('start slip: start + U{0,1,2} months, each slip ~1/3, capped at the registry max', () => {
    const d = drawMonteCarlo(model, { iterations: N }, SEED);
    const max = model.bundle.variables.find((v) => v.id === 'lev.start')!.max!;
    for (const l of levers()) {
      const start = model.base.get(`lev.start[${l}]`);
      const x = d.cells.get(`lev.start[${l}]`)!;
      const counts = [0, 1, 2].map((k) => Array.from(x).filter((v) => v === Math.min(max, start + k)).length / N);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
      if (start + 2 <= max) for (const f of counts) expect(Math.abs(f - 1 / 3)).toBeLessThan(0.015);
    }
    // A late start hits the cap: start 11 slips to 11, 12, 12.
    const late = drawMonteCarlo(model, { iterations: N, dist: { 'lev.start[L01]': { type: 'discrete', values: [10, 11, 12, 13] } } }, SEED);
    expect(Math.max(...late.cells.get('lev.start[L01]')!)).toBe(max);
  });

  it('pool growth: Triangular(0.7g, g, 1.4g): support, mean (0.7 + 1 + 1.4)g/3, mode at g', () => {
    const d = drawMonteCarlo(model, { iterations: N }, SEED);
    for (const p of model.members.pool!.map((m) => m.id)) {
      const g = model.base.get(`pool.growth[${p}]`);
      const x = d.cells.get(`pool.growth[${p}]`)!;
      const sd = Math.sqrt(((0.7 * g) ** 2 + g ** 2 + (1.4 * g) ** 2 - 0.7 * g * g - 0.7 * g * 1.4 * g - g * 1.4 * g) / 18);
      expect(Math.min(...x)).toBeGreaterThanOrEqual(0.7 * g - 1e-12);
      expect(Math.max(...x)).toBeLessThanOrEqual(1.4 * g + 1e-12);
      expect(Math.abs(mean(x) - (3.1 * g) / 3)).toBeLessThan(4 * (sd / Math.sqrt(N)) + 1e-15);
      // CDF at the mode: (g − 0.7g) / (1.4g − 0.7g) = 3/7.
      if (g > 0) expect(Math.abs(Array.from(x).filter((v) => v <= g).length / N - 3 / 7)).toBeLessThan(0.015);
    }
  });

  it('samples exactly the default inputs: lev.realize, lev.start and pool.growth cells', () => {
    const d = resolveDists(model, {});
    const ids = new Set([...d.keys()].map((k) => k.slice(0, k.indexOf('['))));
    expect([...ids].sort()).toEqual(['lev.realize', 'lev.start', 'pool.growth']);
    expect(d.size).toBe(2 * levers().length + model.members.pool!.length);
  });

  it('variable_def.dist overrides the default; params.dist by variable and by cell override that; null holds', () => {
    const bundle = {
      variables: model.bundle.variables.map((v) =>
        v.id === 'pool.growth' ? { ...v, dist: { type: 'uniform', min: 0.01, max: 0.03 } } : v,
      ),
    };
    const m2: SolverModel = { ...model, bundle };
    const a = drawMonteCarlo(m2, { iterations: N }, SEED);
    const sw = a.cells.get('pool.growth[software]')!;
    expect(Math.min(...sw)).toBeGreaterThanOrEqual(0.01);
    expect(Math.abs(mean(sw) - 0.02)).toBeLessThan(0.0005);

    const tri: MonteCarloDist = { type: 'triangular', min: 0.5, mode: 0.8, max: 1 };
    const b = drawMonteCarlo(
      m2,
      { iterations: N, dist: { 'pool.growth': { type: 'normal', mean: 0.05, sd: 0.01 }, 'pool.growth[cloud]': null, 'lev.realize[L03]': tri } },
      SEED,
    );
    expect(Math.abs(mean(b.cells.get('pool.growth[software]')!) - 0.05)).toBeLessThan(0.0005);
    expect(Math.abs(Math.sqrt(variance(b.cells.get('pool.growth[software]')!)) - 0.01)).toBeLessThan(0.0005);
    expect(b.cells.has('pool.growth[cloud]')).toBe(false);
    expect(Math.abs(mean(b.cells.get('lev.realize[L03]')!) - 2.3 / 3)).toBeLessThan(0.005);
    expect(b.dists.get('lev.realize[L03]')).toEqual(tri);
  });

  it('PERT, lognormal, uniform and weighted discrete on any input: sample moments', () => {
    const d = drawMonteCarlo(
      model,
      {
        iterations: N,
        dist: {
          'lev.realize[L01]': { type: 'pert', min: 0, mode: 0.6, max: 1 },
          'lev.realize[L02]': { type: 'lognormal', mu: -0.2, sigma: 0.1 },
          'lev.realize[L03]': { type: 'uniform', min: 0.2, max: 0.6 },
          'lev.realize[L04]': { type: 'discrete', values: [0, 1], weights: [1, 3] },
          'lev.realize[L05]': { type: 'pert', min: 0.2, mode: 0.2, max: 1, lambda: 2 },
          'pool.growth[software]': { type: 'uniform', min: 0.9, max: 1.1, basis: 'relative' },
        },
      },
      SEED,
    );
    const pert = (min: number, mode: number, max: number, lambda = 4) => (min + lambda * mode + max) / (lambda + 2);
    expect(Math.abs(mean(d.cells.get('lev.realize[L01]')!) - pert(0, 0.6, 1))).toBeLessThan(0.005);
    expect(Math.abs(mean(d.cells.get('lev.realize[L02]')!) - Math.exp(-0.2 + 0.005))).toBeLessThan(0.003);
    expect(Math.abs(mean(d.cells.get('lev.realize[L03]')!) - 0.4)).toBeLessThan(0.003);
    expect(Math.abs(mean(d.cells.get('lev.realize[L04]')!) - 0.75)).toBeLessThan(0.015);
    expect(Math.abs(mean(d.cells.get('lev.realize[L05]')!) - pert(0.2, 0.2, 1, 2))).toBeLessThan(0.005);
    const g = model.base.get('pool.growth[software]');
    expect(Math.abs(mean(d.cells.get('pool.growth[software]')!) - g)).toBeLessThan(0.002 * g);
  });

  it('Gaussian copula ρ = 0.5 inside L01–L08 and L09–L16: rank correlation (6/π)·asin(ρ/2); none across families', () => {
    const d = drawMonteCarlo(model, { iterations: N }, SEED);
    const x = (l: string) => d.cells.get(`lev.realize[${l}]`)!;
    const within = copulaSpearman(0.5);
    const tol = 0.03;
    for (const [a, b] of [
      ['L01', 'L02'],
      ['L03', 'L08'],
      ['L09', 'L16'],
      ['L10', 'L14'],
    ] as const) {
      expect(Math.abs(spearman(x(a), x(b)) - within), `${a}~${b}`).toBeLessThan(tol);
    }
    for (const [a, b] of [
      ['L01', 'L09'],
      ['L08', 'L16'],
    ] as const) {
      expect(Math.abs(spearman(x(a), x(b))), `${a}~${b}`).toBeLessThan(tol);
    }
    // Slips and growth are independent of the realisations.
    expect(Math.abs(spearman(x('L01'), d.cells.get('lev.start[L02]')!))).toBeLessThan(tol);
    // Groups and ρ are editable.
    const e = drawMonteCarlo(model, { iterations: N, correlation: [{ levers: ['L01', 'L09'], rho: 0.8 }] }, SEED);
    const y = (l: string) => e.cells.get(`lev.realize[${l}]`)!;
    expect(Math.abs(spearman(y('L01'), y('L09')) - copulaSpearman(0.8))).toBeLessThan(tol);
    expect(Math.abs(spearman(y('L01'), y('L02')))).toBeLessThan(tol);
    expect(e.groups).toEqual([{ cells: ['lev.realize[L01]', 'lev.realize[L09]'], rho: 0.8 }]);
  });

  it('is reproducible: the same seed gives the same draws bit for bit; another seed does not', () => {
    const a = drawMonteCarlo(model, { iterations: 500 }, 42);
    const b = drawMonteCarlo(model, { iterations: 500 }, 42);
    const c = drawMonteCarlo(model, { iterations: 500 }, 43);
    for (const [cell, x] of a.cells) {
      expect(b.cells.get(cell)).toEqual(x);
      if (cell.startsWith('lev.realize')) expect(c.cells.get(cell)).not.toEqual(x);
    }
    // A draw depends on its cell and the seed only, not on which other inputs are sampled.
    const held = drawMonteCarlo(model, { iterations: 500, dist: { 'pool.growth': null } }, 42);
    expect(held.cells.get('lev.start[L04]')).toEqual(a.cells.get('lev.start[L04]'));
  });

  it('rejects bad parameters with BAD_PARAMS', () => {
    const run = (p: Parameters<typeof drawMonteCarlo>[1], seed = 1) => () => drawMonteCarlo(model, p, seed);
    const code = { code: 'BAD_PARAMS' };
    expect(run({ iterations: 0 })).toThrow(expect.objectContaining(code));
    expect(run({ iterations: 1.5 })).toThrow(expect.objectContaining(code));
    expect(run({}, -1)).toThrow(expect.objectContaining(code));
    expect(run({ dist: { 'no.such': { type: 'uniform', min: 0, max: 1 } } })).toThrow(expect.objectContaining(code));
    expect(run({ dist: { 'lev.realize[L99]': { type: 'uniform', min: 0, max: 1 } } })).toThrow(expect.objectContaining(code));
    expect(run({ correlation: [{ levers: ['L01', 'L99'], rho: 0.5 }] })).toThrow(expect.objectContaining(code));
    expect(run({ correlation: [{ levers: ['L01', 'L02'], rho: -0.2 }] })).toThrow(expect.objectContaining(code));
    expect(
      run({
        correlation: [
          { levers: ['L01', 'L02'], rho: 0.2 },
          { levers: ['L02', 'L03'], rho: 0.2 },
        ],
      }),
    ).toThrow(expect.objectContaining(code));
    const invalid: unknown[] = [
      null,
      { type: 'gamma' },
      { type: 'triangular', min: 1, mode: 0, max: 2 },
      { type: 'pert', min: 0, mode: 0.5, max: 1, lambda: 0 },
      { type: 'normal', mean: 0, sd: -1 },
      { type: 'lognormal', mu: 0, sigma: -1 },
      { type: 'uniform', min: 2, max: 1 },
      { type: 'discrete', values: [] },
      { type: 'discrete', values: [1, 2], weights: [1] },
      { type: 'discrete', values: [1, 2], weights: [0, 0] },
      { type: 'confidence_beta', concentration: 0, scale: 1, confidence: 'lev.conf' },
      { type: 'uniform', min: 0, max: 1, basis: 'log' },
    ];
    for (const d of invalid) expect(() => validateDist(d, 'x'), JSON.stringify(d)).toThrow(expect.objectContaining(code));
    expect(() => drawMonteCarlo(model, { dist: { 'lev.realize[L01]': { type: 'confidence_beta', concentration: 4, scale: 1.2, confidence: 'no.conf' } } }, 1)).toThrow(
      expect.objectContaining({ code: 'BAD_MODEL' }),
    );
  });

  it('a default family member the tenant lacks is skipped; degenerate confidences sit at 0 and the scale', () => {
    const members = { ...model.members, lever: model.members.lever!.filter((m) => m.id !== 'L02') };
    const d = drawMonteCarlo({ ...model, members }, { iterations: 10 }, 1);
    expect(d.groups[0]!.cells).not.toContain('lev.realize[L02]');
    const conf = (c: number): MonteCarloDist => ({ type: 'confidence_beta', concentration: 4, scale: c, confidence: 'lev.conf' });
    const e = drawMonteCarlo(model, { iterations: 10, dist: { 'lev.realize[L01]': conf(0.5), 'lev.realize[L02]': conf(10) } }, 1);
    expect([...e.cells.get('lev.realize[L01]')!].every((v) => v === 0.5)).toBe(true); // c = 0.8 ≥ scale
    expect([...e.cells.get('lev.realize[L02]')!].every((v) => v > 0 && v <= 1.5)).toBe(true); // clipped to the registry max
  });
});

describe('SOL-06 numerics', () => {
  it('normal CDF and inverse agree; beta CDF and inverse agree', () => {
    for (const p of [1e-10, 0.001, 0.02, 0.3, 0.5, 0.9, 0.99, 1 - 1e-9]) expect(normCdf(normInv(p))).toBeCloseTo(p, 12);
    expect(normCdf(0)).toBe(0.5);
    expect(normCdf(-40)).toBe(0);
    expect(normCdf(40)).toBe(1);
    expect(normInv(0)).toBe(-Infinity);
    expect(normInv(1)).toBe(Infinity);
    expect(Number.isNaN(normCdf(Number.NaN))).toBe(true);
    expect(normInv(0.975)).toBeCloseTo(1.959963984540054, 12);
    for (const [a, b] of [
      [2, 3],
      [0.5, 0.5],
      [3.3, 0.7],
      [0.2, 5],
    ] as const) {
      for (const p of [0.001, 0.1, 0.5, 0.9, 0.999]) expect(betaCdf(betaInv(p, a, b), a, b)).toBeCloseTo(p, 10);
    }
    expect(betaCdf(0.5, 2, 2)).toBeCloseTo(0.5, 14);
    expect(betaCdf(0.3, 1, 1)).toBeCloseTo(0.3, 14);
    expect(betaInv(0.3, 0, 1)).toBe(0);
    expect(betaInv(0.3, 1, 0)).toBe(1);
    expect(betaInv(0, 2, 2)).toBe(0);
    expect(betaInv(1, 2, 2)).toBe(1);
  });

  it('percentile is numpy linear; ranks average ties; histogram counts every value', () => {
    const s = Float64Array.from([1, 2, 3, 4, 5]);
    expect(percentile(s, 10)).toBeCloseTo(1.4, 14);
    expect(percentile(s, 50)).toBe(3);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
    expect([...ranks([3, 1, 3, 2])]).toEqual([3.5, 1, 3.5, 2]);
    expect(spearman([1, 2, 3], [1, 1, 1])).toBe(0);
    expect(spearman([1], [2])).toBe(0);
    const h = histogram(s, 2);
    expect(h).toEqual([
      { lo: 1, hi: 3, count: 2 },
      { lo: 3, hi: 5, count: 3 },
    ]);
    expect(histogram([2, 2], 4)).toEqual([{ lo: 2, hi: 2, count: 2 }]);
    expect(histogram([], 4)).toEqual([]);
    expect(MONTE_CARLO_DEFAULTS.bins).toBeGreaterThan(1);
  });
});
