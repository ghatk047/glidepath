import type {
  QuickSolverSpec,
  ScenarioId,
  SolverConstraint,
  SolverObjective,
  SolverSpec,
} from '@glidepath/api-contract';
import { METHOD } from './copy';

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
