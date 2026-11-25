/**
 * The reference points of the Path screen's savings-vs-risk scatter (SOL-13), reported by a `min_risk_mix`
 * run so one run draws all four dots (C, Path, All VPs, D). When the model carries `references` (the tenant's
 * C and D presets), the result's metrics gain, for each key K in C, D and `allvps`:
 *
 * - `net[K]`: `res.net` at that plan;
 * - `risk_exposure[K]`: Σ lev.iy · (1 − lev.conf) at that plan (the metric of the run itself).
 *
 * C and D are the presets evaluated as they are; `allvps` is the minimum-risk plan with every VP clearing its
 * bar (`vp_feasible`, 04 §2) under the same parameters, so the scatter compares like with like. A model without
 * `references` reports exactly what `min_risk_mix` always did.
 * Pure: the model and the engine only.
 */
import type { ProblemSolver, SolverRun } from '../run';
import type { VpFeasibleParams } from '../types';
import { minRiskMixProblem, riskExposure } from './min-risk';
import { vpFeasibleProblem } from './vp-feasible';

/** Key of the all-VP plan among the reference points. */
export const ALL_VPS_KEY = 'allvps';

const NET = 'res.net';
const RISK = 'risk_exposure';

/** The metric keys of one reference point: `net[K]` and `risk_exposure[K]`. */
export const referenceMetricKeys = (key: string): { readonly net: string; readonly risk: string } => ({
  net: `net[${key}]`,
  risk: `${RISK}[${key}]`,
});

/** Share of a run's progress the main search takes; the references finish the bar. */
const MAIN_SHARE = 0.6;

export const minRiskMixWithReferences: ProblemSolver<'min_risk_mix'> = async (run, params) => {
  const references = run.model.references;
  if (references === undefined) return minRiskMixProblem(run, params);

  // A derived run (same model, abort and iteration count) that reports its progress in the main share.
  const scaled = Object.create(run) as SolverRun<'min_risk_mix'>;
  scaled.progress = (fraction, note) => run.progress(fraction * MAIN_SHARE, note);
  scaled.batch = () => run.batch();
  scaled.partial = (outcome) => run.partial(outcome);
  const out = await minRiskMixProblem(scaled, params);

  const { model } = run;
  const own = out.metrics ?? {};
  const hasRisk = own[RISK] !== undefined;
  const metrics: Record<string, number> = { ...own };
  const put = (key: string, net: number | undefined, risk: number | undefined): void => {
    const k = referenceMetricKeys(key);
    if (net !== undefined) metrics[k.net] = net;
    if (risk !== undefined) metrics[k.risk] = risk;
  };

  for (const [key, ref] of references) {
    const e = model.compiled.evaluate(ref.values, ref.overrides);
    put(key, e.has(NET) ? e.get(NET) : undefined, hasRisk ? riskExposure(e, model.members) : undefined);
  }

  // All VPs: this run when it already asks every VP to clear, else the vp_feasible plan on the same params.
  const perVp = params.constraints?.find((c) => c.id === 'per_vp');
  if (perVp !== undefined && perVp.vps === undefined) {
    put(ALL_VPS_KEY, own[NET], own[RISK]);
  } else {
    // Its partials stay out of the main run's (a cancelled run keeps the main search's best).
    const all = Object.create(run) as SolverRun<'vp_feasible'>;
    all.partial = () => undefined;
    all.batch = () => run.batch();
    all.progress = (fraction, note) => run.progress(MAIN_SHARE + (1 - MAIN_SHARE) * fraction, note);
    const vp = await vpFeasibleProblem(all, params as VpFeasibleParams);
    put(ALL_VPS_KEY, vp.metrics?.[NET], vp.metrics?.[RISK]);
  }
  run.progress(1);
  return { ...out, metrics };
};
