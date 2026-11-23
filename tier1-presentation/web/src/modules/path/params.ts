import type {
  QuickSolverSpec,
  ScenarioId,
  SolverConstraint,
  SolverObjective,
  SolverSpec,
} from '@glidepath/api-contract';
import { METRIC, METHOD } from './copy';

/**
 * What the Goal panel holds (the user's choices), before it becomes a solver spec.
 * `usFloor` / `oneTimeCap`: the value to hold to, or `null` when the toggle is off.
 */
export interface PathChoice {
  objective: SolverObjective;
  perVp: boolean;
  usFloor: number | null;
  oneTimeCap: number | null;
}

/**
 * The Goal panel as a `min_risk_mix` spec (contract `MinRiskMixParams`). Tier 1 sends only what
 * the user chose; decision sets and seed stay tier 2's defaults.
 *
 * - Goal: `total` (`res.net ≥ res.bar`); the bar follows the net target the user edits.
 * - Every VP clears → `per_vp` (no `vps`: every VP). US headcount floor → `us_floor`.
 *   One-time cap → `one_time_cap`.
 * - Stretch cap and estimates fixed have no parameter: tier 2 always applies them (`bounds` come
 *   from the decision sets, capped at full stretch; `estimate` variables never move), so their
 *   toggles are shown on and locked.
 */
export function pathSpec(choice: PathChoice): SolverSpec {
  const constraints: SolverConstraint[] = [{ id: 'total' }];
  if (choice.perVp) constraints.push({ id: 'per_vp' });
  if (choice.usFloor !== null) constraints.push({ id: 'us_floor', value: choice.usFloor });
  if (choice.oneTimeCap !== null)
    constraints.push({ id: 'one_time_cap', value: choice.oneTimeCap });
  return {
    problem: 'min_risk_mix',
    params: { objective: choice.objective, method: METHOD, constraints },
  };
}

/** Quick `scenario_blend` from one scenario to another; output and target are tier 2's (`res.gap` = 0). */
export const blendSpec = (from: ScenarioId, to: ScenarioId): QuickSolverSpec => ({
  problem: 'scenario_blend',
  params: { from, to },
});

/**
 * Path II analysis specs. Tier 1 names the problem and (for the tornado) the output cell; every
 * other parameter is tier 2's default. All three run `save: false` (an analysis panel never writes
 * a scenario), so they are safe to look up and re-run.
 *
 * - `oddsSpec`: `monte_carlo` with tier 2's seeded defaults (the key the demo cache warmer files C
 *   and D under); P(clear) and the net histogram come from the result's `detail`.
 * - `tornadoSpec`: quick `sensitivity` as a tornado on net (`res.net[]`); the rows come back sorted
 *   by swing, policy and timing inputs tier 2's to classify.
 * - `frontierSpec`: `pareto`; its `detail.points` draw the savings-vs-risk frontier when a run
 *   exists (post-demo), hidden otherwise.
 */
export const oddsSpec: SolverSpec = { problem: 'monte_carlo', params: {} };
export const tornadoSpec: QuickSolverSpec = {
  problem: 'sensitivity',
  params: { method: 'tornado', outputs: [METRIC.net] },
};
export const frontierSpec: SolverSpec = { problem: 'pareto', params: {} };

/** The look-up key for the tornado: the same parameters, as the API-13 query's JSON `params`. */
export const tornadoLookupParams = JSON.stringify(tornadoSpec.params);
