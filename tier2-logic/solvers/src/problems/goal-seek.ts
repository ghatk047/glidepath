/**
 * SOL-02: `goal_seek` and `breakeven` (`solvers.json` `problems`; 04 §2; 03 §3).
 *
 * - `goal_seek`: solve one input cell so that an output hits a target, within bounds (default: the
 *   variable's registry min/max). 11-point monotonicity scan in one batch, then Brent; a non-monotone
 *   scan or a target outside the scanned outputs ends `unreachable` with the closest value.
 * - `breakeven`: goal seek every lever-intensity input alone on `res.gap = 0`. All searches advance in
 *   lockstep, one engine batch per round. Each row searches the decision bounds first (feasible) and,
 *   failing that, the registry range (needed, not feasible); `needed` is null when neither range holds it.
 *
 * Pure: the model and the engine only.
 */
import type { BatchInput, CellKey, VariableDef } from '@glidepath/engine';
import { decisionSet, type DecisionVariable } from '../decision-sets';
import { SolverError } from '../errors';
import type { SolverModel } from '../model';
import type { ProblemSolver, SolverRun } from '../run';
import type {
  BreakevenParams,
  Change,
  GoalSeekParams,
  ProblemId,
  SolverDetailMap,
  SolverOutcome,
} from '../types';
import { seek, type SeekResult } from './seek';

/** `solvers.json` `breakeven.do`: "goal_seek each lever-intensity input alone until res.gap = 0". */
export const BREAKEVEN_OUTPUT: CellKey = 'res.gap';
export const BREAKEVEN_TARGET = 0;

/** Variable id of a cell key (`lev.start[L03]` → `lev.start`). */
const varIdOf = (cell: CellKey): string => {
  const i = cell.indexOf('[');
  return i < 0 ? cell : cell.slice(0, i);
};

// ---------------------------------------------------------------------------------------------------
// Batch driver: many searches on (possibly different) input cells, one engine batch per round
// ---------------------------------------------------------------------------------------------------

interface Search<R> {
  readonly cell: CellKey;
  readonly gen: Generator<readonly number[], R, readonly number[]>;
}

/**
 * Advances every search to completion. Each round packs the points every live search asks for into one
 * batch (each lane moves its search's cell only, from the start point) and hands each search its outputs
 * of `output`. A lane that fails to evaluate throws its engine error. `onRound(done, total)` runs after
 * each round.
 */
async function drive<R>(
  run: SolverRun<ProblemId>,
  output: CellKey,
  searches: readonly Search<R>[],
  onRound?: (results: readonly (R | undefined)[]) => void,
): Promise<R[]> {
  const base = run.model.base;
  const results: (R | undefined)[] = searches.map(() => undefined);
  const asks: (readonly number[] | undefined)[] = searches.map((s, i) => {
    const step = s.gen.next([]);
    if (step.done) {
      results[i] = step.value;
      return undefined;
    }
    return step.value;
  });

  while (asks.some((a) => a !== undefined)) {
    let size = 0;
    for (const a of asks) size += a?.length ?? 0;
    const lanes = new Map<CellKey, Float64Array>();
    const offsets: number[] = [];
    let at = 0;
    searches.forEach((s, i) => {
      offsets.push(at);
      const a = asks[i];
      if (a === undefined) return;
      let lane = lanes.get(s.cell);
      if (lane === undefined) {
        lane = new Float64Array(size).fill(base.get(s.cell));
        lanes.set(s.cell, lane);
      }
      lane.set(a, at);
      at += a.length;
    });

    const input: BatchInput = { size, values: lanes };
    const batch = await run.evaluateBatch(input);
    for (const err of batch.errors.values()) throw err;
    const ys = batch.values.get(output) ?? lanes.get(output);
    const y0 = base.get(output);

    searches.forEach((s, i) => {
      const a = asks[i];
      if (a === undefined) return;
      const off = offsets[i]!;
      const out = a.map((_, j) => (ys === undefined ? y0 : ys[off + j]!));
      const step = s.gen.next(out);
      if (step.done) {
        results[i] = step.value;
        asks[i] = undefined;
      } else {
        asks[i] = step.value;
      }
    });
    onRound?.(results);
  }
  return results as R[];
}

// ---------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------

function registryVariable(model: SolverModel, cell: CellKey): VariableDef {
  const v = model.bundle.variables.find((d) => d.id === varIdOf(cell));
  if (v === undefined || !model.base.values.has(cell)) {
    throw new SolverError('BAD_PARAMS', `${cell} is not an input cell of the model`);
  }
  return v;
}

function assertOutput(model: SolverModel, output: CellKey): void {
  if (!model.base.has(output)) throw new SolverError('BAD_PARAMS', `unknown output cell ${output}`);
}

function assertFinite(name: string, x: unknown): asserts x is number {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new SolverError('BAD_PARAMS', `${name} must be a finite number`);
}

/** Search range of a goal seek: the given bounds, else the registry min/max. */
function goalSeekBounds(model: SolverModel, params: GoalSeekParams): readonly [number, number] {
  const v = registryVariable(model, params.var);
  const [lo, hi] = params.bounds ?? [v.min, v.max];
  if (lo === null || hi === null) {
    throw new SolverError('BAD_PARAMS', `${params.var} has no registry range: pass bounds`);
  }
  assertFinite('bounds[0]', lo);
  assertFinite('bounds[1]', hi);
  if (lo > hi) throw new SolverError('BAD_PARAMS', `bounds [${lo}, ${hi}] are empty`);
  return [lo, hi];
}

// ---------------------------------------------------------------------------------------------------
// goal_seek
// ---------------------------------------------------------------------------------------------------

/** The `goal_seek` problem (registered in `PROBLEMS`). */
export const goalSeekProblem: ProblemSolver<'goal_seek'> = async (run, params) => {
  const { model } = run;
  if (params === undefined || typeof params.var !== 'string' || typeof params.output !== 'string') {
    throw new SolverError('BAD_PARAMS', 'goal_seek needs var, output and target');
  }
  assertOutput(model, params.output);
  assertFinite('target', params.target);
  const [lo, hi] = goalSeekBounds(model, params);

  const [r] = await drive<SeekResult>(run, params.output, [{ cell: params.var, gen: seek(lo, hi, params.target) }]);
  const result = r!;
  const current = model.base.get(params.var);
  const changes: Change[] = result.value === current ? [] : [{ target: 'variable', cell: params.var, value: result.value }];
  return {
    status: result.reachable ? 'optimal' : 'unreachable',
    changes,
    ranked: run.rank(changes, params.output),
    metrics: { [params.output]: result.output, target: params.target, residual: result.output - params.target },
    detail: { value: result.value, output: result.output, reachable: result.reachable },
  } satisfies SolverOutcome<'goal_seek'>;
};

// ---------------------------------------------------------------------------------------------------
// breakeven
// ---------------------------------------------------------------------------------------------------

type BreakevenRow = SolverDetailMap['breakeven']['rows'][number];

interface RowPlan {
  readonly cell: CellKey;
  readonly current: number;
  /** Feasibility range (decision bounds; registry range for an input outside the set). */
  readonly range: readonly [number, number] | null;
  /** Wider range searched when the first does not hold the value (registry min/max). */
  readonly wider: readonly [number, number] | null;
}

interface RowFound {
  readonly needed: number | null;
  readonly feasible: boolean;
}

const sameRange = (a: readonly [number, number] | null, b: readonly [number, number] | null): boolean =>
  a !== null && b !== null && a[0] === b[0] && a[1] === b[1];

/** Searches the row's range, then the wider range when the first does not reach the target. */
function* rowSearch(plan: RowPlan, target: number): Generator<readonly number[], RowFound, readonly number[]> {
  if (plan.range !== null) {
    const r = yield* seek(plan.range[0], plan.range[1], target);
    if (r.reachable) return { needed: r.value, feasible: true };
  }
  if (plan.wider !== null && !sameRange(plan.range, plan.wider)) {
    const r = yield* seek(plan.wider[0], plan.wider[1], target);
    if (r.reachable) return { needed: r.value, feasible: false };
  }
  return { needed: null, feasible: false };
}

function registryRange(v: Pick<VariableDef, 'min' | 'max'>): readonly [number, number] | null {
  return v.min === null || v.max === null ? null : [v.min, v.max];
}

function rowPlans(model: SolverModel, params: BreakevenParams): RowPlan[] {
  const set = decisionSet(model, 'lever_intensity');
  const plan = (d: DecisionVariable): RowPlan => ({
    cell: d.cell,
    current: d.value,
    range: [d.lo, d.hi],
    wider: registryRange(d),
  });
  if (params.inputs === undefined) return set.map(plan);
  if (!Array.isArray(params.inputs) || params.inputs.length === 0) {
    throw new SolverError('BAD_PARAMS', 'breakeven inputs must be a non-empty list');
  }
  const bySet = new Map(set.map((d) => [d.cell, d]));
  return params.inputs.map((cell) => {
    const d = bySet.get(cell);
    if (d !== undefined) return plan(d);
    const v = registryVariable(model, cell);
    const range = registryRange(v);
    return { cell, current: model.base.get(cell), range, wider: range };
  });
}

/** The `breakeven` problem (registered in `PROBLEMS`). */
export const breakevenProblem: ProblemSolver<'breakeven'> = async (run, params) => {
  const { model } = run;
  const p = params ?? {};
  const output = p.output ?? BREAKEVEN_OUTPUT;
  const target = p.target ?? BREAKEVEN_TARGET;
  assertOutput(model, output);
  assertFinite('target', target);
  const plans = rowPlans(model, p);

  const toRow = (plan: RowPlan, found: RowFound | undefined): BreakevenRow => ({
    cell: plan.cell,
    current: plan.current,
    needed: found?.needed ?? null,
    min: plan.range?.[0] ?? null,
    max: plan.range?.[1] ?? null,
    feasible: found?.feasible ?? false,
  });
  const outcome = (rows: readonly BreakevenRow[]): SolverOutcome<'breakeven'> => {
    const feasible = rows.filter((r) => r.feasible).length;
    return {
      status: feasible > 0 ? 'optimal' : 'unreachable',
      // A table of alternatives (each lever alone), not one plan: nothing to apply.
      changes: [],
      metrics: { [output]: model.base.get(output), target, rows: rows.length, feasible },
      detail: { rows },
    };
  };

  const searches: Search<RowFound>[] = plans.map((plan) => ({ cell: plan.cell, gen: rowSearch(plan, target) }));
  const found = await drive(run, output, searches, (partial) => {
    const done = partial.filter((f) => f !== undefined).length;
    run.progress(plans.length === 0 ? 1 : done / plans.length, `${done}/${plans.length}`);
    run.partial(outcome(plans.map((plan, i) => toRow(plan, partial[i]))));
  });
  return outcome(plans.map((plan, i) => toRow(plan, found[i])));
};
