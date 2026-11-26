/**
 * SOL-09 / SRC-12: `pareto`, the savings-vs-risk (or vs one-time cost) frontier (`solvers.json`
 * `problems[pareto]`: "epsilon-constraint sweep of min_risk_mix over bar levels 100..200 step 5"; 04 §2).
 *
 * ε-constraint: at each bar level b the `total` constraint of `min_risk_mix` becomes
 * `res.net − res.bar − (b − bar₀) ≥ 0`, bar₀ = the start point's `res.bar` (so `res.net ≥ b`, the bar moved
 * to b); every other constraint, the objective, the decision sets and the method stay as given. The sweep
 * visits `from, from + step … to` (default PARETO_DEFAULTS) plus bar₀ itself when it lies in that range. The
 * point at bar₀ is `min_risk_mix`'s own answer (`solveMix` on the same params, binding constraints
 * included); the result's top-level changes, ranked moves, binding constraints and metrics are that plan's.
 *
 * Exact warm start. The greedy (min-risk.ts) sums constraint violations; the `total` term at bar b is
 * `max(0, −slack_b)`. Two bars b < b′ give the same greedy path (every score equal) for as long as the
 * current point and every priced candidate have slack_b ≤ 0, since the term is then linear in both and the
 * violations differ by a constant. So a point is solved by restarting from the first recorded round of a
 * solved neighbour where some candidate clears the lower of the two bars (or from the neighbour's end), and
 * finishing the greedy there: the same plan as a cold solve, at a few steps per point. Bars above bar₀ chain
 * upward from bar₀; bars below restart from bar₀'s rounds (a lower bar's path is a prefix of bar₀'s).
 *
 * Monotone frontier. A plan that clears a bar also clears every lower bar, so the minimum objective can only
 * rise with the bar. The greedy is a heuristic and can break that near a bar (its last capped step), so a
 * backward pass gives each point the plan of a higher feasible point whenever that plan's objective is lower
 * (`repaired_points` counts them). The point at bar₀ is never replaced (it must stay `min_risk_mix`'s
 * answer); a violation there is counted in `monotone_conflicts` (0 on the AA presets).
 *
 * Axis: `risk` (default) keeps the objective of the params (default `min_risk_exposure`); `one_time` with no
 * objective given minimises `res.tot_ot_all` (`min_one_time`). Every point reports both: `risk` = risk
 * exposure Σ lev.iy·(1 − lev.conf) (the `risk_exposure` metric), `oneTime` = `res.tot_ot_all`.
 *
 * The greedy and the `production` refinement mirror the private `greedy` / `refine` of min-risk.ts (with
 * per-round slack recording for the warm start); binding constraints are computed for the bar₀ point only.
 * Pure: the model and the engine only.
 */
import type { Evaluation } from '@glidepath/engine';
import { SolverError } from '../errors';
import type { ProblemSolver, SolverRun } from '../run';
import type { Change, MinRiskMixParams, ParetoParams, SolverDetailMap, SolverOutcome } from '../types';
import {
  COST_FLOOR,
  FEASIBILITY_TOL,
  GAIN_TOL,
  MAX_STEPS,
  Search,
  guarded,
  mixSetup,
  riskExposure,
  solveMix,
  stepCandidates,
  violation,
  type Candidate,
  type Constraint,
  type Cost,
  type MixHost,
  type MixOutcome,
  type MixSetup,
  type Priced,
  type Read,
  type Snapshot,
} from './min-risk';
import { PARETO_DEFAULTS } from './pareto-defaults';

// ---------------------------------------------------------------------------------------------------
// Method constants (not business numbers)
// ---------------------------------------------------------------------------------------------------

/** Most bar levels one run may visit. */
export const MAX_PARETO_POINTS = 401;
/** Two bar levels closer than this (relative to max(1, |bar|)) are one point. */
const BAR_TOL = 1e-9;
/** Share of the run's progress that the bar₀ solve takes (it also finds binding constraints). */
const ANCHOR_SHARE = 0.4;

const NET = 'res.net';
const BAR = 'res.bar';
const ONE_TIME = 'res.tot_ot_all';

export type ParetoPoint = SolverDetailMap['pareto']['points'][number];

// ---------------------------------------------------------------------------------------------------
// Bar levels
// ---------------------------------------------------------------------------------------------------

/** The bar levels of a sweep, ascending: the grid `from..to` by `step`, plus `bar0` when inside it. */
export function paretoBars(sweep: { from: number; to: number; step: number }, bar0: number): number[] {
  const { from, to, step } = sweep;
  if (![from, to, step].every(Number.isFinite)) throw new SolverError('BAD_PARAMS', 'pareto: sweep values must be finite');
  if (!(step > 0)) throw new SolverError('BAD_PARAMS', 'pareto: sweep.step must be > 0');
  if (from > to) throw new SolverError('BAD_PARAMS', 'pareto: sweep.from must be ≤ sweep.to');
  const count = Math.floor((to - from) / step + BAR_TOL) + 1;
  if (count > MAX_PARETO_POINTS) {
    throw new SolverError('BAD_PARAMS', `pareto: ${count} bar levels; at most ${MAX_PARETO_POINTS}`);
  }
  const bars = Array.from({ length: count }, (_, i) => from + i * step);
  const near = (a: number, b: number) => Math.abs(a - b) <= BAR_TOL * Math.max(1, Math.abs(a));
  if (bar0 >= from - BAR_TOL && bar0 <= to + BAR_TOL) {
    const i = bars.findIndex((b) => near(b, bar0));
    if (i >= 0) bars[i] = bar0;
    else bars.push(bar0);
  }
  return bars.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------------
// The greedy at one bar, recording each round for the warm start
// ---------------------------------------------------------------------------------------------------

/** One greedy round: the state before it and the largest `total` slack over the current point and every candidate. */
interface Round {
  readonly from: Snapshot;
  readonly maxSlack: number;
}

/** A solved bar: its shift from bar₀, its rounds (from its restart on) and the greedy's end state. */
interface Solved {
  readonly shift: number;
  readonly rounds: readonly Round[];
  readonly end: Snapshot;
}

/** The setup's constraints with `total` moved to bar₀ + `shift` (shift 0 keeps the original, bit for bit). */
function shifted(setup: MixSetup, shift: number): Constraint[] {
  return setup.constraints.map((c) =>
    c.id === 'total' && shift !== 0 ? { ...c, slack: (r: Read) => c.slack(r) - shift } : c,
  );
}

/** Greedy marginal analysis (min-risk.ts `greedy`), recording the `total` slack of each round. */
async function greedy(s: Search, cost: Cost, constraints: readonly Constraint[], rounds: Round[]): Promise<boolean> {
  const guards = constraints.filter((c) => c.guard === true);
  const total = constraints.find((c) => c.id === 'total')!;
  let v = violation(constraints, s.readCur);
  while (v > FEASIBILITY_TOL && s.steps < MAX_STEPS) {
    const from = s.snapshot();
    const priced = await s.price(stepCandidates(s));
    rounds.push({ from, maxSlack: priced.reduce((m, p) => Math.max(m, total.slack(p.read)), total.slack(s.readCur)) });
    const c0 = cost(s.readCur, s.x);
    let best: { score: number; p: Priced } | undefined;
    for (const p of priced) {
      const dv = v - violation(constraints, p.read);
      if (dv <= GAIN_TOL || !guarded(guards, s.readCur, p.read)) continue;
      const dc = cost(p.read, s.xWith(p.cand)) - c0;
      const score = dv / Math.max(dc, COST_FLOOR);
      if (best === undefined || score > best.score) best = { score, p };
    }
    if (best === undefined) break;
    s.apply(best.p.cand);
    v = violation(constraints, s.readCur);
  }
  return v <= FEASIBILITY_TOL;
}

/** mulberry32 (as min-risk.ts): the seeded order of the `production` refinement. */
const M32 = { inc: 0x6d2b79f5, s1: 15, s2: 7, s3: 14, or: 61, span: 0x100000000 } as const;
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + M32.inc) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> M32.s1), t | 1);
    t ^= t + Math.imul(t ^ (t >>> M32.s2), t | M32.or);
    return ((t ^ (t >>> M32.s3)) >>> 0) / M32.span;
  };
}
function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** `production` (min-risk.ts `refine`): step moved cells back toward the start while feasible and the objective falls. */
async function refine(s: Search, cost: Cost, constraints: readonly Constraint[], seed: number): Promise<void> {
  const rand = mulberry32(seed);
  for (let refined = 0; refined < MAX_STEPS; refined++) {
    const cands: Candidate[] = [];
    for (const m of shuffled(s.movers, rand)) {
      const n = s.n.get(m.d.cell)!;
      if (n !== 0) cands.push(s.step(m, -Math.sign(n)));
    }
    const priced = await s.price(cands);
    const c0 = cost(s.readCur, s.x);
    let best: { dc: number; p: Priced } | undefined;
    for (const p of priced) {
      if (violation(constraints, p.read) > FEASIBILITY_TOL) continue;
      const dc = cost(p.read, s.xWith(p.cand)) - c0;
      if (dc < -GAIN_TOL && (best === undefined || dc < best.dc)) best = { dc, p };
    }
    if (best === undefined) break;
    s.apply(best.p.cand);
  }
}

/**
 * Where a bar with `shift` may restart from `solved`: the first round where some candidate clears the lower
 * of the two bars (slack > 0 there), else the end of `solved`.
 */
function restartFrom(solved: Solved, shift: number): Snapshot {
  const lower = Math.max(0, solved.shift - shift);
  return solved.rounds.find((r) => r.maxSlack + lower > 0)?.from ?? solved.end;
}

// ---------------------------------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------------------------------

/** A point with what the monotone pass compares (the objective). */
interface Scored {
  point: ParetoPoint;
  objective: number;
  anchor: boolean;
}

/** The point of a finished search (changes on the step grid unless rounding loses feasibility, as `finishMix`). */
function pointOf(host: MixHost, setup: MixSetup, constraints: readonly Constraint[], s: Search, bar: number, feasible: boolean): Scored {
  const grid = s.changes(true);
  const atGrid = host.rerun(grid);
  const keepGrid = !feasible || violation(constraints, (c) => atGrid.get(c)) <= FEASIBILITY_TOL;
  const changes = keepGrid ? grid : s.changes(false);
  const e = keepGrid ? atGrid : s.cur;
  const x = new Map(s.x);
  for (const c of changes) x.set(c.cell, c.value);
  return { point: measure(host, e, bar, feasible, changes), objective: setup.cost((c) => e.get(c), x), anchor: false };
}

function measure(host: MixHost, e: Evaluation, bar: number, feasible: boolean, changes: readonly Change[]): ParetoPoint {
  return {
    bar,
    net: e.get(NET),
    risk: riskExposure(e, host.model.members),
    oneTime: e.get(ONE_TIME),
    feasible,
    changes,
  };
}

/**
 * The backward pass: a point takes the plan of a higher feasible point whose objective is lower (it clears
 * this bar too). The bar₀ point is never replaced. Returns the repairs and the conflicts at bar₀.
 */
export function monotone(points: Scored[]): { repaired: number; conflicts: number } {
  let repaired = 0;
  let conflicts = 0;
  let best: Scored | undefined;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    const better = best !== undefined && (!p.point.feasible || best.objective < p.objective - GAIN_TOL);
    if (better && p.anchor) conflicts += 1;
    else if (better) {
      points[i] = { point: { ...best!.point, bar: p.point.bar }, objective: best!.objective, anchor: false };
      repaired += 1;
    }
    const q = points[i]!;
    if (q.point.feasible && (best === undefined || q.objective <= best.objective)) best = q;
  }
  return { repaired, conflicts };
}

// ---------------------------------------------------------------------------------------------------
// The problem
// ---------------------------------------------------------------------------------------------------

/** The `min_risk_mix` params of a pareto run (the axis picks the objective when none is given). */
export function mixParamsOf(params: ParetoParams): MinRiskMixParams {
  const { axis, sweep, ...rest } = params;
  void sweep;
  if (axis !== undefined && axis !== 'risk' && axis !== 'one_time') {
    throw new SolverError('BAD_PARAMS', `pareto: unknown axis ${String(axis)}`);
  }
  return axis === 'one_time' && rest.objective === undefined ? { ...rest, objective: 'min_one_time' } : rest;
}

export const paretoProblem: ProblemSolver<'pareto'> = async (run, params) => {
  const mix = mixParamsOf(params);
  const setup = mixSetup(run, mix);
  const { base } = run.model;
  if (!base.has(ONE_TIME)) throw new SolverError('BAD_MODEL', `pareto: the model has no cell ${ONE_TIME}`);
  const bar0 = base.get(BAR);
  const bars = paretoBars(params.sweep ?? PARETO_DEFAULTS.sweep, bar0);

  // 1. bar₀: min_risk_mix's own answer (the run's top-level result). Cancelled here, the run has no plan.
  const anchorHost = Object.create(run) as SolverRun<'pareto'>;
  anchorHost.progress = (fraction, note) => run.progress(ANCHOR_SHARE * fraction, note);
  anchorHost.batch = () => run.batch();
  anchorHost.partial = () => undefined;
  const sol = await solveMix(anchorHost as MixHost, mix);
  const anchorOutcome: MixOutcome = sol.result;

  const done = new Map<number, Scored>();
  const outcome = (points: readonly ParetoPoint[], extra: Record<string, number> = {}): SolverOutcome<'pareto'> => ({
    ...anchorOutcome,
    metrics: { ...anchorOutcome.metrics, points: points.length, feasible_points: points.filter((p) => p.feasible).length, ...extra },
    detail: { points },
  });
  const sorted = () => [...done.values()].sort((a, b) => a.point.bar - b.point.bar);
  const report = (note: string) => {
    run.progress(ANCHOR_SHARE + (1 - ANCHOR_SHARE) * (done.size / bars.length), note);
    run.partial(outcome(sorted().map((s) => s.point)));
  };

  // Net, risk and objective as min_risk_mix reports them (its metrics), one-time read at its plan.
  const anchorEval = run.rerun(sol.result.changes);
  const m = sol.result.metrics ?? {};
  const anchorPoint = measure(run, anchorEval, bar0, sol.feasible, sol.result.changes);
  const anchorScored: Scored = {
    point: { ...anchorPoint, net: m[NET] ?? anchorPoint.net, risk: m.risk_exposure ?? anchorPoint.risk },
    objective: m.objective ?? setup.cost((c) => anchorEval.get(c), new Map(sol.result.changes.map((c) => [c.cell, c.value]))),
    anchor: true,
  };
  run.partial(outcome([]));

  // 2. bar₀'s greedy path, recorded (the warm start of every other bar).
  const anchorRounds: Round[] = [];
  const s0 = new Search(run, setup.movers);
  await greedy(s0, setup.cost, setup.constraints, anchorRounds);
  const anchor: Solved = { shift: 0, rounds: anchorRounds, end: s0.snapshot() };
  run.progress(ANCHOR_SHARE, `bar ${bar0}`);
  if (bars.includes(bar0)) {
    done.set(bar0, anchorScored);
    report(`bar ${bar0} (${done.size}/${bars.length})`);
  }

  const solveAt = async (bar: number, from: Solved): Promise<Solved> => {
    const shift = bar - bar0;
    const constraints = shifted(setup, shift);
    const s = new Search(run, setup.movers, restartFrom(from, shift));
    const rounds: Round[] = [];
    const feasible = await greedy(s, setup.cost, constraints, rounds);
    const end = s.snapshot();
    if (feasible && setup.seed !== undefined) await refine(s, setup.cost, constraints, setup.seed);
    done.set(bar, pointOf(run, setup, constraints, s, bar, feasible));
    report(`bar ${bar} (${done.size}/${bars.length})`);
    return { shift, rounds, end };
  };

  // 3. Up from bar₀, each bar warm from the one below; 4. down from bar₀, each from bar₀'s path.
  let prev = anchor;
  for (const bar of bars.filter((b) => b > bar0)) prev = await solveAt(bar, prev);
  for (const bar of bars.filter((b) => b < bar0).reverse()) await solveAt(bar, anchor);

  // 5. Monotone frontier.
  const points = sorted();
  const { repaired, conflicts } = monotone(points);
  run.progress(1, `${points.length} points`);
  return outcome(
    points.map((p) => p.point),
    { repaired_points: repaired, monotone_conflicts: conflicts },
  );
};
