/**
 * SOL-03 contract entry point `blend(A, B, target)`: `runSolver` on the `scenario_blend` problem
 * (src/problems/blend.ts), with abort and progress like any solver.
 */
import type { CellKey } from '@glidepath/engine';
import type { SolverModel } from './model';
import { BLEND_TARGET } from './problems/blend';
import { runSolver, type RunOptions } from './run';
import type { SolverResult } from './types';

/** A blend end: a scenario id of `model.scenarios`, or that scenario's resolved inputs. */
export type BlendEnd = string | ReadonlyMap<CellKey, number>;

export interface BlendOptions extends RunOptions {
  /** Output to solve on; default `res.gap`. */
  readonly output?: CellKey;
}

/** Ids under which `blend` registers ends given as input maps (never a tenant scenario id: not a uuid). */
const FROM_ID = '#blend.from';
const TO_ID = '#blend.to';

/**
 * Solves λ in `x = A + λ (B − A)` over the scenario-varying inputs so that the output (default `res.gap`)
 * hits `target` (default 0). A and B are scenario ids of `model.scenarios` or resolved input maps.
 */
export function blend(
  model: SolverModel,
  A: BlendEnd,
  B: BlendEnd,
  target: number = BLEND_TARGET,
  options: BlendOptions = {},
): Promise<SolverResult<'scenario_blend'>> {
  const scenarios = new Map(model.scenarios ?? []);
  const id = (end: BlendEnd, as: string): string => {
    if (typeof end === 'string') return end;
    scenarios.set(as, end);
    return as;
  };
  const from = id(A, FROM_ID);
  const to = id(B, TO_ID);
  const { output, ...run } = options;
  return runSolver(
    { ...model, scenarios },
    { problem: 'scenario_blend', params: { from, to, target, ...(output === undefined ? {} : { output }) } },
    run,
  );
}
