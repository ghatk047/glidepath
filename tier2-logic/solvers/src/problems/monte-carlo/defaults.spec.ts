/**
 * The Monte Carlo defaults are spec data: every number in `MONTE_CARLO_DEFAULTS` is checked against the
 * text of `solvers.json` `problems.monte_carlo` and 04 §4, and the families against `solvers_demo.py`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRepoJson, repo } from '../../../test/helpers';
import { MONTE_CARLO_DEFAULTS as D } from './defaults';

interface McSpec {
  id: string;
  default_distributions: Record<string, string>;
  correlation: string;
  iterations: string;
  outputs: string[];
}
const mc = readRepoJson<{ problems: McSpec[] }>('docs/spec/solvers.json').problems.find((p) => p.id === 'monte_carlo')!;
const doc = readFileSync(resolve(repo, 'docs/spec/04_solvers_simulation.md'), 'utf8');
const section = doc.slice(doc.indexOf('## 4. Monte Carlo specification'), doc.indexOf('## 5.'));

describe('SOL-06 defaults: the 04 §4 / solvers.json monte_carlo values', () => {
  it('realisation: scale × Beta(K·c/scale, K·(1 − c/scale)), K = 4, scale 1.2, c = lev.conf', () => {
    const r = D.dists['lev.realize']!;
    expect(r).toEqual({ type: 'confidence_beta', concentration: 4, scale: 1.2, confidence: 'lev.conf' });
    expect(mc.default_distributions['lev.realize[l]']).toContain('1.2 x Beta(a = K conf_l / 1.2, b = K (1 - conf_l / 1.2)), K = 4');
    expect(section).toContain('`1.2 × Beta(K·c/1.2, K·(1 − c/1.2))` with K = 4');
  });

  it('start slip U{0,1,2} added to the start month; pool growth Triangular(0.7 g, g, 1.4 g)', () => {
    expect(D.dists['lev.start']).toEqual({ type: 'discrete', values: [0, 1, 2], basis: 'shift' });
    expect(mc.default_distributions['lev.start[l]']).toBe('start + U{0,1,2} months slip');
    expect(D.dists['pool.growth']).toEqual({ type: 'triangular', min: 0.7, mode: 1, max: 1.4, basis: 'relative' });
    expect(mc.default_distributions['pool.growth[p]']).toBe('Triangular(0.7 g, g, 1.4 g)');
  });

  it('copula: lever families labour L01–L08, tech L09–L16 at ρ = 0.5 (L17 with tech, as in the reference run)', () => {
    expect(mc.correlation).toContain('labour L01-L08, tech L09-L16) rho = 0.5');
    expect(D.correlation.map((g) => g.rho)).toEqual([0.5, 0.5]);
    expect(D.correlation[0]!.levers).toEqual(['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08']);
    expect(D.correlation[1]!.levers.slice(0, 8)).toEqual(['L09', 'L10', 'L11', 'L12', 'L13', 'L14', 'L15', 'L16']);
    // solvers_demo.py: fam = labour if int(l[1:]) <= 8 else tech, over every lever (L17 included).
    const demo = readFileSync(resolve(repo, 'docs/spec/reference/solvers_demo.py'), 'utf8');
    expect(demo).toContain('fam = {l: ("labour" if int(l[1:]) <= 8 else "tech") for l in LEV}');
    expect(D.correlation[1]!.levers).toContain('L17');
    expect(D.correlatedVar).toBe('lev.realize');
  });

  it('iterations 2,000 by default, seeded; outputs net, bar, gap, EPS and price', () => {
    expect(D.iterations).toBe(2000);
    expect(mc.iterations).toBe('2,000 default (seeded, reproducible)');
    expect(readFileSync(resolve(repo, 'docs/spec/reference/solvers_demo.py'), 'utf8')).toContain(`default_rng(${D.seed})`);
    expect(mc.outputs[0]).toBe('P10/P50/P90 of res.net, res.bar, res.gap, br.eps27, val.px');
    expect(D.outputs).toEqual(['res.net', 'res.bar', 'res.gap', 'br.eps27', 'val.px[fy27it]']);
    expect(mc.outputs).toContain('P(res.net >= res.bar)');
    expect(mc.outputs).toContain('P(vp.net >= vp.bar) per VP');
    expect(D.probabilities[0]).toMatchObject({ cell: 'res.net', against: 'res.bar' });
    expect(D.perMember).toMatchObject({ dim: 'vp', cell: 'vp.net', against: 'vp.bar' });
  });
});
