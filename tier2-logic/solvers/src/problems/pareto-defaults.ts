/**
 * `pareto` defaults of `solvers.json` `problems[pareto]` ("epsilon-constraint sweep of min_risk_mix over
 * bar levels 100..200 step 5") and 04 §2 ("bar = 100…200"). The spec states them as prose, so they live
 * here as data; `pareto-defaults.spec.ts` checks every number against the spec text. `ParetoParams.sweep`
 * overrides them per run.
 */
export interface ParetoDefaults {
  /** Bar levels (`res.bar`, $M) the sweep visits: `from`, `from + step`, … up to `to`. */
  readonly sweep: { readonly from: number; readonly to: number; readonly step: number };
}

export const PARETO_DEFAULTS: ParetoDefaults = {
  sweep: { from: 100, to: 200, step: 5 },
};
