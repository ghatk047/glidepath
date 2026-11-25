/**
 * `runSolver(model, params, { signal, progress })` (03 §3): one entry for every problem of
 * `solvers.json`, used alike by the `logic` process (short solvers) and the `worker` (jobs).
 *
 * The framework owns what every solver shares: abort (the signal is checked at each batch; a fired
 * signal stops the run at the next batch with status `cancelled` and the best partial result), progress
 * (throttled to one call per 250 ms), timing and iteration counts, and the rule that a result moves only
 * what its problem may move (04 §1: estimates never move).
 */
import type { BatchInput, BatchResult, CellKey, Change as EngineChange, Evaluation } from '@glidepath/engine';
import { ProblemIds } from '@glidepath/spec/generated';
import { DECISION_SETS, decisionSet, decisionSets, isHeld, type DecisionVariable } from './decision-sets';
import { SolverCancelled, SolverError } from './errors';
import type { SolverModel } from './model';
import { PROBLEMS } from './problems';
import { ProgressThrottle, systemClock, type Clock, type ProgressFn } from './progress';
import { rankMoves, type RankOptions } from './ranked';
import type {
  Change,
  DecisionSetId,
  ProblemId,
  RankedMove,
  SolverOutcome,
  SolverParamsMap,
  SolverResult,
  SolverSpec,
} from './types';

/** A problem implementation: runs on `run` (its model, abort, progress) and returns its outcome. */
export type ProblemSolver<P extends ProblemId> = (
  run: SolverRun<P>,
  params: SolverParamsMap[P],
) => SolverOutcome<P> | Promise<SolverOutcome<P>>;

export type ProblemTable = { readonly [P in ProblemId]: ProblemSolver<P> };

export interface RunOptions {
  /** Fires to cancel: the run stops at its next batch with status `cancelled`. */
  readonly signal?: AbortSignal;
  /** `progress(fraction, note)`, called at most once per `progressIntervalMs`. */
  readonly progress?: ProgressFn;
  /** Defaults to 250 ms (03 §4). */
  readonly progressIntervalMs?: number;
  /** Clock for `diagnostics.ms` and the progress throttle. */
  readonly clock?: Clock;
  /**
   * Hands control back to the host between batches so an abort raised by the host (a cancel poll, a
   * socket message) can land. Defaults to a macrotask (`setImmediate`, else `setTimeout(0)`).
   */
  readonly yield?: () => Promise<void>;
  /** Problem implementations replacing the package's own (tests, experiments). */
  readonly problems?: Partial<ProblemTable>;
}

const macrotask = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });

/** What a problem sees while it runs. */
export class SolverRun<P extends ProblemId = ProblemId> {
  private count = 0;
  private best: SolverOutcome<P> | undefined;
  private readonly throttle: ProgressThrottle;
  private readonly yieldFn: () => Promise<void>;

  constructor(
    readonly problem: P,
    readonly model: SolverModel,
    private readonly options: RunOptions = {},
  ) {
    this.throttle = new ProgressThrottle(options.progress, options.clock ?? systemClock, options.progressIntervalMs);
    this.yieldFn = options.yield ?? macrotask;
  }

  /** Batches (checkpoints) passed so far: `diagnostics.iterations`. */
  get iterations(): number {
    return this.count;
  }

  get aborted(): boolean {
    return this.options.signal?.aborted ?? false;
  }

  /** Throws `SolverCancelled` if the signal has fired. */
  throwIfAborted(): void {
    if (this.aborted) throw new SolverCancelled();
  }

  /**
   * The boundary before each batch of work: yields to the host, stops the run if the signal has fired,
   * counts one iteration and lets a pending progress report through.
   */
  async batch(): Promise<void> {
    await this.yieldFn();
    this.throwIfAborted();
    this.count += 1;
    this.throttle.tick();
  }

  /** Reports progress (0..1) with an optional short note; throttled. */
  progress(fraction: number, note?: string): void {
    this.throttle.report(fraction, note);
  }

  /** Best result so far: returned (as `cancelled`) if the run is aborted later. */
  partial(outcome: SolverOutcome<P>): void {
    this.best = outcome;
  }

  /** @internal */
  get partialOutcome(): SolverOutcome<P> | undefined {
    return this.best;
  }

  /** One batch on the engine: checkpoint, then `evaluateBatch` from the start point. */
  async evaluateBatch(input: BatchInput): Promise<BatchResult> {
    await this.batch();
    return this.model.compiled.evaluateBatch(this.model.base, input);
  }

  /** Scalar incremental evaluation of moves from the start point (no checkpoint). */
  rerun(changes: readonly Change[]): Evaluation {
    return this.model.compiled.rerun(this.model.base, changes as readonly EngineChange[]);
  }

  decisionSet(set: DecisionSetId): DecisionVariable[] {
    return decisionSet(this.model, set);
  }

  rank(changes: readonly Change[], output: CellKey, options?: RankOptions): RankedMove[] {
    return rankMoves(this.model, changes, output, options);
  }
}

// ---------------------------------------------------------------------------------------------------
// Which cells a problem's result may move
// ---------------------------------------------------------------------------------------------------

type MovePolicy<P extends ProblemId> = (
  cell: CellKey,
  params: SolverParamsMap[P],
  ctx: { movable(): ReadonlySet<CellKey>; input(cell: CellKey): boolean },
) => boolean;

/**
 * Per problem: optimisers move decision-set cells only; goal seek moves the input it was given; breakeven
 * a decision cell or an input it was given; a blend or a stress preset sets inputs from another
 * scenario or a named shock (any input); Monte Carlo and sensitivity move nothing.
 */
const MOVES: { readonly [P in ProblemId]: MovePolicy<P> } = {
  goal_seek: (cell, p) => cell === p.var,
  breakeven: (cell, p, ctx) => (p.inputs?.includes(cell) ?? false) || ctx.movable().has(cell),
  scenario_blend: (cell, _p, ctx) => ctx.input(cell),
  min_risk_mix: (cell, _p, ctx) => ctx.movable().has(cell),
  pareto: (cell, _p, ctx) => ctx.movable().has(cell),
  vp_feasible: (cell, _p, ctx) => ctx.movable().has(cell),
  monte_carlo: () => false,
  sensitivity: () => false,
  stress_presets: (cell, _p, ctx) => ctx.input(cell),
};

/** Variable id of a cell key (`lev.start[L03]` → `lev.start`). */
const varIdOf = (cell: CellKey): string => {
  const i = cell.indexOf('[');
  return i < 0 ? cell : cell.slice(0, i);
};

function assertMoves<P extends ProblemId>(
  model: SolverModel,
  problem: P,
  params: SolverParamsMap[P],
  changes: readonly Change[],
): void {
  let movable: Set<CellKey> | undefined;
  const vars = new Map(model.bundle.variables.map((v) => [v.id, v]));
  const ctx = {
    movable: () => (movable ??= new Set(decisionSets(model, DECISION_SETS).map((d) => d.cell))),
    input: (cell: CellKey) => vars.has(varIdOf(cell)) && model.base.has(cell),
  };
  const policy = MOVES[problem] as MovePolicy<P>;
  for (const c of changes) {
    if (c.target !== 'variable' || !policy(c.cell, params, ctx)) {
      const v = vars.get(varIdOf(c.cell));
      const why = v !== undefined && isHeld(v) ? ` (${v.kind}: held fixed)` : '';
      throw new SolverError('ILLEGAL_MOVE', `${problem} may not move ${c.cell}${why}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// runSolver
// ---------------------------------------------------------------------------------------------------

/**
 * Runs one problem on `model` and returns its `SolverResult`. Rejects with `SolverError` for bad
 * parameters, an unimplemented problem or an illegal move, and with the engine's error if evaluation
 * fails; resolves with status `cancelled` (and the last partial result, if any) when the signal fires.
 */
export async function runSolver<P extends ProblemId>(
  model: SolverModel,
  spec: Extract<SolverSpec, { problem: P }>,
  options: RunOptions = {},
): Promise<SolverResult<P>> {
  const problem = spec.problem;
  if (!(ProblemIds as readonly string[]).includes(problem)) {
    throw new SolverError('BAD_PARAMS', `unknown problem ${String(problem)}`);
  }
  const solve = (options.problems?.[problem] ?? PROBLEMS[problem]) as ProblemSolver<P>;
  const params = spec.params as SolverParamsMap[P];
  const clock = options.clock ?? systemClock;
  const run = new SolverRun(problem, model, options);
  const start = clock.now();

  let outcome: SolverOutcome<P> | undefined;
  let cancelled = false;
  try {
    run.throwIfAborted();
    outcome = await solve(run, params);
  } catch (e) {
    if (!(e instanceof SolverCancelled)) throw e;
    cancelled = true;
    outcome = run.partialOutcome;
  }
  const changes = outcome?.changes ?? [];
  assertMoves(model, problem, params, changes);

  const seed = outcome?.seed;
  return {
    problem,
    status: cancelled ? 'cancelled' : outcome!.status,
    changes,
    ranked: outcome?.ranked ?? [],
    ...(outcome?.binding === undefined ? {} : { binding: outcome.binding }),
    metrics: outcome?.metrics ?? {},
    diagnostics: { iterations: run.iterations, ms: clock.now() - start, ...(seed === undefined ? {} : { seed }) },
    ...(outcome?.detail === undefined ? {} : { detail: outcome.detail }),
  };
}
