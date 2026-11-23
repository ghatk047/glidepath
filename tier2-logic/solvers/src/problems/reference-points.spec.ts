/**
 * SOL-13: a `min_risk_mix` run on a model with `references` also reports the Path scatter's reference points,
 * `net[K]` and `risk_exposure[K]` for C, D and allvps (G5 vs solver_demo_results.json), so one run draws all
 * four dots. Without `references` the metrics are what they always were.
 */
import { REFERENCE_DECISION_BOUNDS, seedToTenantData } from '@glidepath/spec';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSeed, readRepoJson, seedModel } from '../../test/helpers';
import { withDecisionBounds } from '../decision-sets';
import { minRiskMix } from '../min-risk';
import type { ReferenceScenario, SolverModel } from '../model';
import type { SolverResult } from '../types';
import { ALL_VPS_KEY, referenceMetricKeys } from './reference-points';

interface Demo {
  readonly min_risk_total_bar: { readonly net: number; readonly risk_exposure: number };
  readonly min_risk_total_and_vp_bars: { readonly net: number; readonly risk_exposure: number };
  readonly min_risk_reference: { readonly C_risk_exposure: number; readonly D_risk_exposure: number };
}
const demo = readRepoJson<Demo>('docs/spec/reference/solver_demo_results.json');
const noYield = () => Promise.resolve();

/** Acceptance tolerance on net and risk ($M), as SOL-04. */
const TOL = 0.5;

let plain: SolverModel;
let withRefs: SolverModel;
let result: SolverResult<'min_risk_mix'>;
let bare: SolverResult<'min_risk_mix'>;

beforeAll(async () => {
  const base = withDecisionBounds(await seedModel('C'), REFERENCE_DECISION_BOUNDS);
  const { bundle, seed } = await loadSeed();
  const preset = (id: string): ReferenceScenario => {
    const data = seedToTenantData(seed, id, bundle);
    return { values: data.values, overrides: data.overrides };
  };
  plain = base;
  withRefs = {
    ...base,
    references: new Map([
      ['C', preset('C')],
      ['D', preset('D')],
    ]),
  };
  bare = await minRiskMix(plain, {}, { yield: noYield });
  result = await minRiskMix(withRefs, {}, { yield: noYield });
}, 120_000);

const metric = (k: string): number => result.metrics[k]!;

describe('SOL-13 min_risk_mix reference points', () => {
  it('reports net[K] and risk_exposure[K] for C, D and allvps from one run', () => {
    for (const key of ['C', 'D', ALL_VPS_KEY]) {
      const k = referenceMetricKeys(key);
      expect(Number.isFinite(metric(k.net)), k.net).toBe(true);
      expect(Number.isFinite(metric(k.risk)), k.risk).toBe(true);
    }
    expect(referenceMetricKeys('C')).toEqual({ net: 'net[C]', risk: 'risk_exposure[C]' });
  });

  it('C and D are the presets as they stand; their risk matches min_risk_reference', () => {
    expect(metric('risk_exposure[C]')).toBeCloseTo(demo.min_risk_reference.C_risk_exposure, 2);
    expect(metric('risk_exposure[D]')).toBeCloseTo(demo.min_risk_reference.D_risk_exposure, 2);
    const c = withRefs.references!.get('C')!;
    expect(metric('net[C]')).toBeCloseTo(withRefs.compiled.evaluate(c.values, c.overrides).get('res.net'), 6);
    expect(metric('net[D]')).toBeGreaterThan(metric('net[C]'));
  });

  it('allvps is the all-VP plan (G5: net $148.1M, risk $43.6M)', () => {
    const want = demo.min_risk_total_and_vp_bars;
    expect(Math.abs(metric('net[allvps]') - want.net)).toBeLessThan(TOL);
    expect(Math.abs(metric('risk_exposure[allvps]') - want.risk_exposure)).toBeLessThan(TOL);
  });

  it('the run itself is unchanged (G5: net, risk) and keeps its own metrics', () => {
    const want = demo.min_risk_total_bar;
    expect(Math.abs(metric('res.net') - want.net)).toBeLessThan(TOL);
    expect(Math.abs(metric('risk_exposure') - want.risk_exposure)).toBeLessThan(TOL);
    expect(result.changes).toEqual(bare.changes);
  });

  it('without references the metrics are exactly the old ones', () => {
    expect(Object.keys(bare.metrics).some((k) => k.includes('['))).toBe(false);
    for (const [k, v] of Object.entries(bare.metrics)) expect(result.metrics[k], k).toBe(v);
  });

  it('a run that already asks every VP to clear reports itself as allvps', async () => {
    const r = await minRiskMix(withRefs, { constraints: [{ id: 'total' }, { id: 'per_vp' }] }, { yield: noYield });
    expect(r.metrics['net[allvps]']).toBe(r.metrics['res.net']);
    expect(r.metrics['risk_exposure[allvps]']).toBe(r.metrics.risk_exposure);
  }, 60_000);
});
