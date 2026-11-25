/**
 * SOL-03: `scenario_blend` (`solvers.json` `problems[scenario_blend]`: "x = A + lambda (B - A) over all
 * scenario-varying inputs; solve lambda for res.gap = 0"; 03 §3: "1-D blend C→D, goal seek on α").
 *
 * The blended inputs are every cell of a `scenario_varies` registry variable, member by member for a
 * dimensioned one; every other input keeps the start point's value. λ is searched on [0, 1] with the goal
 * seek of SOL-02 (11-point monotonicity scan in one engine batch, then Brent, one point per batch). A
 * target outside the blend's outputs (or a scan that turns) ends `unreachable` with the closest scan λ.
 *
 * The scenarios' resolved inputs are tenant data the caller supplies on `model.scenarios`; pure: the
 * model and the engine only.
 */
import { cellKey, type CellKey } from '@glidepath/engine';
import { SolverError } from '../errors';
import type { SolverModel } from '../model';
import type { ProblemSolver } from '../run';
import type { Change, SolverOutcome } from '../types';
import { seek } from './seek';

/** `solvers.json` `scenario_blend.do`: "solve lambda for res.gap = 0". */
export const BLEND_OUTPUT: CellKey = 'res.gap';
export const BLEND_TARGET = 0;
/** λ = 0 is A, λ = 1 is B. */
const LAMBDA_RANGE = [0, 1] as const;

/**
 * Headline outputs a blend reports besides its own output (the figures of
 * `solver_demo_results.json#goal_seek_blend_C_to_D`): net, bar, risk-adjusted net, one-time IT, the IT
 * effect on CY27 EPS, and the gap of each VP.
 */
export const BLEND_METRICS: readonly CellKey[] = ['res.net', 'res.bar', 'res.risk', 'res.tot_ot_it', 'br.eps27'];
const VP_DIM = 'vp';
const VP_GAP = 'vp.gap';

/** One blended input cell: its value in A and in B. */
export interface BlendCell {
  readonly cell: CellKey;
  readonly a: number;
  readonly b: number;
}

/** Variable id of a cell key (`lev.start[L03]` → `lev.start`). */
const varIdOf = (cell: CellKey): string => {
  const i = cell.indexOf('[');
  return i < 0 ? cell : cell.slice(0, i);
};

/**
 * The input cells a blend of `a` and `b` sets: every model input of a scenario-varying variable (per
 * member) whose value in A or B differs from the start point or between A and B. A cell missing from a
 * map keeps the start value there.
 */
export function blendCells(
  model: SolverModel,
  a: ReadonlyMap<CellKey, number>,
  b: ReadonlyMap<CellKey, number>,
): BlendCell[] {
  const varies = new Set(model.bundle.variables.filter((v) => v.scenario_varies).map((v) => v.id));
  const cells: BlendCell[] = [];
  for (const [cell, start] of model.base.values) {
    if (!varies.has(varIdOf(cell))) continue;
    const x = a.get(cell) ?? start;
    const y = b.get(cell) ?? start;
    if (x !== y || x !== start) cells.push({ cell, a: x, b: y });
  }
  return cells;
}

/** `A + λ (B − A)`, exactly A at λ = 0 and exactly B at λ = 1. */
export const lerp = (c: BlendCell, lambda: number): number => (lambda === 1 ? c.b : c.a + lambda * (c.b - c.a));

/** The input changes of the blend at `lambda`, from the start point (cells already there are left out). */
export function blendChanges(model: SolverModel, cells: readonly BlendCell[], lambda: number): Change[] {
  const changes: Change[] = [];
  for (const c of cells) {
    const value = lerp(c, lambda);
    if (value !== model.base.get(c.cell)) changes.push({ target: 'variable', cell: c.cell, value });
  }
  return changes;
}

function scenario(model: SolverModel, id: unknown, name: string): ReadonlyMap<CellKey, number> {
  if (typeof id !== 'string') throw new SolverError('BAD_PARAMS', `scenario_blend needs ${name} (a scenario id)`);
  const values = model.scenarios?.get(id);
  if (values === undefined) throw new SolverError('BAD_PARAMS', `scenario_blend: no resolved inputs for scenario ${id}`);
  return values;
}

/** Headline cells of `model` that exist: `BLEND_METRICS`, then `vp.gap` per VP member. */
function metricCells(model: SolverModel): CellKey[] {
  const vps = (model.members[VP_DIM] ?? []).map((m) => cellKey(VP_GAP, [m.id]));
  return [...BLEND_METRICS, ...vps].filter((c) => model.base.has(c));
}

/** The `scenario_blend` problem (registered in `PROBLEMS`). */
export const scenarioBlendProblem: ProblemSolver<'scenario_blend'> = async (run, params) => {
  const { model } = run;
  if (params === undefined || params === null) throw new SolverError('BAD_PARAMS', 'scenario_blend needs from and to');
  const a = scenario(model, params.from, 'from');
  const b = scenario(model, params.to, 'to');
  const output = params.output ?? BLEND_OUTPUT;
  const target = params.target ?? BLEND_TARGET;
  if (!model.base.has(output)) throw new SolverError('BAD_PARAMS', `unknown output cell ${output}`);
  if (typeof target !== 'number' || !Number.isFinite(target)) {
    throw new SolverError('BAD_PARAMS', 'target must be a finite number');
  }
  const cells = blendCells(model, a, b);
  const y0 = model.base.get(output);

  // Drive the 1-D search: each request of λs is one engine batch, one lane per λ.
  const search = seek(LAMBDA_RANGE[0], LAMBDA_RANGE[1], target);
  let step = search.next([]);
  while (!step.done) {
    const lambdas = step.value;
    const size = lambdas.length;
    const lanes = new Map<CellKey, Float64Array>();
    for (const c of cells) lanes.set(c.cell, Float64Array.from(lambdas, (l) => lerp(c, l)));
    const batch = await run.evaluateBatch({ size, values: lanes });
    const ys = batch.values.get(output) ?? lanes.get(output);
    // A lane that does not evaluate reads as NaN: the search ends not reachable rather than failing the run.
    const out = lambdas.map((_, i) => (batch.failed[i] ? Number.NaN : (ys?.[i] ?? y0)));
    step = search.next(out);
  }
  const found = step.value;

  const lambda = found.value;
  const changes = blendChanges(model, cells, lambda);
  const at = run.rerun(changes);
  const metrics: Record<string, number> = {};
  for (const c of metricCells(model)) metrics[c] = at.get(c);
  metrics[output] = at.get(output);
  metrics.target = target;
  metrics.residual = at.get(output) - target;
  metrics.lambda = lambda;
  run.progress(1);
  return {
    status: found.reachable ? 'optimal' : 'unreachable',
    changes,
    ranked: run.rank(changes, output),
    metrics,
    detail: { lambda: found.reachable ? lambda : null },
  } satisfies SolverOutcome<'scenario_blend'>;
};
