/**
 * SRC-14: `wave_plan`, the wave planner (SRC.md F10). Chooses each lever's start month (`lev.start[lever]`,
 * decision set `lever_timing`) to maximise CY27 net (`res.net`) or risk-adjusted net (`res.risk`), subject to,
 * per quarter of 2027:
 *
 * - one-time: Σ one-time cost of the levers launching in that quarter ≤ `quarterlyOneTimeCap`;
 * - launches: number of levers launching in that quarter ≤ `maxLaunchesPerQuarter`.
 *
 * Definitions.
 * - A lever *launches* in the quarter of its start month: quarter = ⌈lev.start / 3⌉ (months 1..12, 1 = Jan 2027).
 * - Its one-time cost is the CY27 one-time charged to IT, `lev.ot[l] × g.ot_in_year × (1 − g.ot_out_share)` (so the
 *   four quarters add up to `res.tot_ot_it`): the cap is IT's own one-time budget, and the share funded outside IT is
 *   not IT's to cap. `lev.ot` does not depend on
 *   start months, so each lever's one-time is fixed for the run ({@link leverOneTime} is the one place that says so).
 * - Only levers that are on (`lev.on[l]` = 1) count. Levers named in `params.levers` (absent: every lever) move;
 *   the other levers that are on keep their start month and still fill their quarter. Off levers never count.
 * - Each moving lever's months are its `lever_timing` bounds (registry) intersected with `params.window`; a start
 *   month outside them is moved inside (a forced move).
 * - An absent cap is no constraint (tier 2 fills the tenant's defaults from the `sourcing_param` members).
 *
 * Method (deterministic). One engine batch prices every (moving lever, month) on the objective from the start
 * point: `gain[l][m]`. Start months only reach the net through each lever's own ramp factor, so the objective of
 * a plan is the start objective plus Σ gain (the final plan is re-evaluated on the engine, and a test checks the
 * sum). Then:
 * 1. repair: while some quarter breaches a cap, apply the single move (else the pair move) that most reduces the
 *    violation per unit of objective given up (in practice: delay the launches that lose least);
 * 2. improve: apply the best objective gain among single moves that keep every cap (violation never rises), else
 *    the best pair move (one lever into a quarter, another out of it); repeat until nothing improves.
 * Every pass is a checkpoint (cancel lands there, progress and the partial plan are reported). A plan that cannot
 * meet a cap (a lever whose one-time alone exceeds it, fixed levers that overfill a quarter) ends `infeasible` with
 * the least-violation plan found; `optimal` when every moving lever sits at its own best month and every cap holds,
 * else `feasible` (a local optimum).
 *
 * Binding constraints: a breached quarter, and a quarter whose cap blocks an improving single move (a move that
 * would be allowed with that cap alone lifted). Shadow price: objective gain of the best blocked move per unit of
 * cap it needs ($M of objective per $M of one-time, or per extra launch); 0 for a breach with nothing blocked.
 *
 * Pure: the model and the engine only.
 */
import { cellKey, type CellKey, type Evaluation } from '@glidepath/engine';
import { SolverError } from '../errors';
import type { ProblemSolver, SolverRun } from '../run';
import type { BindingConstraint, Change, SolverDetailMap, SolverOutcome, WavePlanParams } from '../types';

// ---------------------------------------------------------------------------------------------------
// Method constants (not business numbers)
// ---------------------------------------------------------------------------------------------------

/** Quarters of the plan year and months per quarter. */
export const QUARTERS = 4;
const MONTHS_PER_QUARTER = 3;
/** Months of the plan year (`lev.start` is 1..12). */
const FIRST_MONTH = 1;
const LAST_MONTH = QUARTERS * MONTHS_PER_QUARTER;
/** `lev.on` above this is on (it is 0 or 1). */
const ON_THRESHOLD = 0.5;
/** Passes after which the progress curve 1 − 1/(1 + passes/k) is half way. */
const PROGRESS_HALF_PASSES = 8;
/** Smallest objective gain that counts as an improvement ($M). */
const GAIN_TOL = 1e-9;
/** A cap is breached when exceeded by more than this, relative to max(1, cap). */
const CAP_TOL = 1e-9;
/** Floor of the objective given up per repair move (keeps free moves from dividing by zero). */
const LOSS_FLOOR = 1e-9;
/** Most repair plus improvement passes one run makes. */
export const MAX_PASSES = 500;
/** Share of the run's progress the pricing batch takes. */
const PRICE_SHARE = 0.1;

const NET: CellKey = 'res.net';
const RISK: CellKey = 'res.risk';
const ONE_TIME_ALL: CellKey = 'res.tot_ot_all';
const OT_IN_YEAR: CellKey = 'g.ot_in_year';
const OT_OUT_SHARE: CellKey = 'g.ot_out_share';
const LEVER_DIM = 'lever';
const START = 'lev.start';
const ON = 'lev.on';
const LEVER_OT = 'lev.ot';

/** Objective cell of each `objective` option. */
export const WAVE_OBJECTIVES = { net: NET, risk_adjusted: RISK } as const;

/** Constraint ids of the binding list, with the quarter as member: `quarterly_one_time[Q2]`, `launches[Q2]`. */
export const WAVE_CONSTRAINTS = { oneTime: 'quarterly_one_time', launches: 'launches' } as const;

/** Quarter (1..4) of a start month (1..12). */
export const quarterOf = (month: number): number =>
  Math.min(QUARTERS, Math.max(1, Math.ceil(month / MONTHS_PER_QUARTER)));

/** CY27 one-time of a lever charged to IT: `lev.ot[l] × g.ot_in_year × (1 − g.ot_out_share)` (as `res.tot_ot_it`). */
export function leverOneTime(e: Pick<Evaluation, 'get'>, lever: string): number {
  return e.get(cellKey(LEVER_OT, [lever])) * e.get(OT_IN_YEAR) * (1 - e.get(OT_OUT_SHARE));
}

// ---------------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------------

/** One lever that is on: its start, its months (moving levers) and its one-time. */
interface PlanLever {
  readonly lever: string;
  readonly cell: CellKey;
  /** Start month at the start point (rounded). */
  readonly start: number;
  readonly oneTime: number;
  /** Months it may start in, ascending; empty for a lever held at its start. */
  readonly months: readonly number[];
}

interface Caps {
  readonly oneTime: number | null;
  readonly launches: number | null;
}

interface Setup {
  readonly objective: CellKey;
  readonly levers: readonly PlanLever[];
  /** Indexes of `levers` that move. */
  readonly movers: readonly number[];
  readonly caps: Caps;
}

const isInt = (x: number): boolean => Number.isInteger(x);

function setupOf(run: SolverRun<'wave_plan'>, params: WavePlanParams): Setup {
  const { base, members } = run.model;
  const objective = WAVE_OBJECTIVES[params.objective ?? 'net'];
  if (objective === undefined) throw new SolverError('BAD_PARAMS', `wave_plan: unknown objective ${String(params.objective)}`);
  for (const c of [NET, RISK, ONE_TIME_ALL, OT_IN_YEAR, OT_OUT_SHARE]) {
    if (!base.has(c)) throw new SolverError('BAD_MODEL', `wave_plan: the model has no cell ${c}`);
  }

  const window = params.window;
  if (window !== undefined) {
    const ok = [window.from, window.to].every((m) => isInt(m) && m >= FIRST_MONTH && m <= LAST_MONTH) && window.from <= window.to;
    if (!ok) throw new SolverError('BAD_PARAMS', 'wave_plan: window must be months 1..12 with from ≤ to');
  }
  const cap = params.quarterlyOneTimeCap;
  if (cap !== undefined && !(Number.isFinite(cap) && cap >= 0)) {
    throw new SolverError('BAD_PARAMS', 'wave_plan: quarterlyOneTimeCap must be a number ≥ 0');
  }
  const launchCap = params.maxLaunchesPerQuarter;
  if (launchCap !== undefined && !(isInt(launchCap) && launchCap >= 0)) {
    throw new SolverError('BAD_PARAMS', 'wave_plan: maxLaunchesPerQuarter must be a whole number ≥ 0');
  }

  const all = (members[LEVER_DIM] ?? []).map((m) => m.id);
  const named = params.levers === undefined ? null : new Set(params.levers);
  if (named !== null) {
    const unknown = [...named].filter((l) => !all.includes(l));
    if (unknown.length > 0) throw new SolverError('BAD_PARAMS', `wave_plan: unknown levers ${unknown.join(', ')}`);
  }
  const timing = new Map(
    run
      .decisionSet('lever_timing')
      .filter((d) => d.id === START)
      .map((d) => [d.members[0]!, d]),
  );

  const levers: PlanLever[] = [];
  const movers: number[] = [];
  for (const lever of all) {
    const cell = cellKey(START, [lever]);
    if (!base.has(cell)) continue;
    const onCell = cellKey(ON, [lever]);
    if (base.has(onCell) && !(base.get(onCell) > ON_THRESHOLD)) continue;
    const start = Math.round(base.get(cell));
    const d = timing.get(lever);
    let months: number[] = [];
    if (d !== undefined && (named === null || named.has(lever))) {
      const lo = Math.max(Math.ceil(d.lo), window?.from ?? FIRST_MONTH);
      const hi = Math.min(Math.floor(d.hi), window?.to ?? LAST_MONTH);
      if (lo > hi) throw new SolverError('BAD_PARAMS', `wave_plan: no start month of ${lever} lies in the window`);
      months = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    }
    if (months.length > 0) movers.push(levers.length);
    levers.push({ lever, cell, start, oneTime: leverOneTime(base, lever), months });
  }
  return { objective, levers, movers, caps: { oneTime: cap ?? null, launches: launchCap ?? null } };
}

// ---------------------------------------------------------------------------------------------------
// Plan state: months, quarter loads, violation
// ---------------------------------------------------------------------------------------------------

/** Per quarter (index 0..3): one-time and launches. */
interface Load {
  readonly ot: number[];
  readonly n: number[];
}

function loadOf(levers: readonly PlanLever[], x: readonly number[]): Load {
  const ot = new Array<number>(QUARTERS).fill(0);
  const n = new Array<number>(QUARTERS).fill(0);
  levers.forEach((l, i) => {
    const q = quarterOf(x[i]!) - 1;
    ot[q] = ot[q]! + l.oneTime;
    n[q] = n[q]! + 1;
  });
  return { ot, n };
}

const otExcess = (caps: Caps, ot: number): number =>
  caps.oneTime === null || ot - caps.oneTime <= CAP_TOL * Math.max(1, caps.oneTime) ? 0 : ot - caps.oneTime;
const nExcess = (caps: Caps, n: number): number => (caps.launches === null ? 0 : Math.max(0, n - caps.launches));

/** Violation of one quarter: one-time excess relative to max(1, cap), plus launches over the cap. */
function quarterViolation(caps: Caps, ot: number, n: number, skip?: 'oneTime' | 'launches'): number {
  const o = skip === 'oneTime' ? 0 : otExcess(caps, ot) / Math.max(1, caps.oneTime ?? 1);
  return o + (skip === 'launches' ? 0 : nExcess(caps, n));
}

function violationOf(caps: Caps, load: Load): number {
  let v = 0;
  for (let q = 0; q < QUARTERS; q++) v += quarterViolation(caps, load.ot[q]!, load.n[q]!);
  return v;
}

/** A move: levers `i` (and `j`) to months `m` (and `mj`). */
interface Move {
  readonly i: number;
  readonly m: number;
  readonly j?: number;
  readonly mj?: number;
}

/** Violation after `move`, from the current load (only the touched quarters change); `skip` lifts one cap. */
function violationAfter(s: Setup, x: readonly number[], load: Load, move: Move, skip?: { q: number; c: 'oneTime' | 'launches' }): number {
  const ot = [...load.ot];
  const n = [...load.n];
  const shift = (i: number, m: number) => {
    const from = quarterOf(x[i]!) - 1;
    const to = quarterOf(m) - 1;
    if (from === to) return;
    const o = s.levers[i]!.oneTime;
    ot[from] = ot[from]! - o;
    n[from] = n[from]! - 1;
    ot[to] = ot[to]! + o;
    n[to] = n[to]! + 1;
  };
  shift(move.i, move.m);
  if (move.j !== undefined) shift(move.j, move.mj!);
  let after = 0;
  for (let q = 0; q < QUARTERS; q++) after += quarterViolation(s.caps, ot[q]!, n[q]!, q === skip?.q ? skip.c : undefined);
  return after;
}

// ---------------------------------------------------------------------------------------------------
// Pricing: gain[l][m] on the objective, one engine batch
// ---------------------------------------------------------------------------------------------------

/** gain of lever index → month → objective change against the start point. */
type Gains = ReadonlyMap<number, ReadonlyMap<number, number>>;

async function price(run: SolverRun<'wave_plan'>, s: Setup): Promise<Gains> {
  const { base } = run.model;
  const lanes: { i: number; m: number }[] = [];
  for (const i of s.movers) for (const m of s.levers[i]!.months) lanes.push({ i, m });
  const gains = new Map<number, Map<number, number>>(s.movers.map((i) => [i, new Map()]));
  if (lanes.length === 0) return gains;
  const values = new Map<CellKey, Float64Array>();
  for (const i of s.movers) values.set(s.levers[i]!.cell, new Float64Array(lanes.length).fill(base.get(s.levers[i]!.cell)));
  lanes.forEach(({ i, m }, k) => {
    values.get(s.levers[i]!.cell)![k] = m;
  });
  const result = await run.evaluateBatch({ size: lanes.length, values });
  const y0 = base.get(s.objective);
  const ys = result.values.get(s.objective);
  lanes.forEach(({ i, m }, k) => {
    const err = result.errors.get(k);
    if (err !== undefined) throw err;
    gains.get(i)!.set(m, (ys === undefined ? y0 : ys[k]!) - y0);
  });
  return gains;
}

// ---------------------------------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------------------------------

/** Gain of lever `i` at month `m` (the start month of a held lever, or one outside its months, is priced 0). */
const gainAt = (gains: Gains, i: number, m: number): number => gains.get(i)?.get(m) ?? 0;

function* singles(s: Setup, x: readonly number[]): Generator<Move> {
  for (const i of s.movers) for (const m of s.levers[i]!.months) if (m !== x[i]) yield { i, m };
}

/** Pair moves that change two quarters' membership: lever i to month m, lever j to month mj (both in other quarters). */
function* pairs(s: Setup, x: readonly number[]): Generator<Move> {
  const ms = s.movers;
  for (let a = 0; a < ms.length; a++) {
    const i = ms[a]!;
    for (let b = a + 1; b < ms.length; b++) {
      const j = ms[b]!;
      for (const m of s.levers[i]!.months) {
        if (quarterOf(m) === quarterOf(x[i]!)) continue;
        for (const mj of s.levers[j]!.months) {
          if (quarterOf(mj) === quarterOf(x[j]!)) continue;
          yield { i, m, j, mj };
        }
      }
    }
  }
}

function moveGain(gains: Gains, x: readonly number[], mv: Move): number {
  let g = gainAt(gains, mv.i, mv.m) - gainAt(gains, mv.i, x[mv.i]!);
  if (mv.j !== undefined) g += gainAt(gains, mv.j, mv.mj!) - gainAt(gains, mv.j, x[mv.j]!);
  return g;
}

/** Best repair move: largest violation drop per objective given up; ties keep generation order. */
function bestRepair(s: Setup, gains: Gains, x: readonly number[], load: Load, v: number, moves: Iterable<Move>): Move | undefined {
  let best: { score: number; mv: Move } | undefined;
  for (const mv of moves) {
    const dv = v - violationAfter(s, x, load, mv);
    if (dv <= CAP_TOL) continue;
    const score = dv / Math.max(-moveGain(gains, x, mv), LOSS_FLOOR);
    if (best === undefined || score > best.score) best = { score, mv };
  }
  return best?.mv;
}

/** Best improving move that does not raise the violation. */
function bestImprove(s: Setup, gains: Gains, x: readonly number[], load: Load, v: number, moves: Iterable<Move>): Move | undefined {
  let best: { g: number; mv: Move } | undefined;
  for (const mv of moves) {
    const g = moveGain(gains, x, mv);
    if (g <= GAIN_TOL || (best !== undefined && g <= best.g)) continue;
    if (violationAfter(s, x, load, mv) > v + CAP_TOL) continue;
    best = { g, mv };
  }
  return best?.mv;
}

function apply(x: number[], mv: Move): void {
  x[mv.i] = mv.m;
  if (mv.j !== undefined) x[mv.j] = mv.mj!;
}

/** Binding caps of the plan `x`: breached quarters, and quarters whose cap alone blocks an improving single move. */
function bindingOf(s: Setup, gains: Gains, x: readonly number[], load: Load, v: number): BindingConstraint[] {
  const price = new Map<string, number>();
  const id = (c: 'oneTime' | 'launches', q: number) => `${WAVE_CONSTRAINTS[c]}[Q${q + 1}]`;
  for (let q = 0; q < QUARTERS; q++) {
    if (otExcess(s.caps, load.ot[q]!) > 0) price.set(id('oneTime', q), 0);
    if (nExcess(s.caps, load.n[q]!) > 0) price.set(id('launches', q), 0);
  }
  for (const mv of singles(s, x)) {
    const g = moveGain(gains, x, mv);
    if (g <= GAIN_TOL || violationAfter(s, x, load, mv) <= v + CAP_TOL) continue;
    const q = quarterOf(mv.m) - 1;
    for (const c of ['oneTime', 'launches'] as const) {
      if (s.caps[c] === null || violationAfter(s, x, load, mv, { q, c }) > v + CAP_TOL) continue;
      const need = c === 'oneTime' ? load.ot[q]! + s.levers[mv.i]!.oneTime - s.caps.oneTime! : 1;
      const p = g / Math.max(need, LOSS_FLOOR);
      const key = id(c, q);
      price.set(key, Math.max(price.get(key) ?? 0, p));
    }
  }
  return [...price.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([constraint, shadowPrice]) => ({ constraint, shadowPrice }));
}

// ---------------------------------------------------------------------------------------------------
// The problem
// ---------------------------------------------------------------------------------------------------

type Detail = SolverDetailMap['wave_plan'];

function detailOf(s: Setup, x: readonly number[], load: Load, netBefore: number, netAfter: number): Detail {
  return {
    levers: s.levers.map((l, i) => ({ lever: l.lever, from: l.start, to: x[i]!, quarter: quarterOf(x[i]!) })),
    quarters: load.ot.map((ot, q) => ({
      quarter: q + 1,
      oneTime: ot,
      launches: load.n[q]!,
      cap: s.caps.oneTime,
      launchCap: s.caps.launches,
    })),
    netBefore,
    netAfter,
  };
}

const changesOf = (s: Setup, x: readonly number[]): Change[] =>
  s.levers.flatMap((l, i) => (x[i] === l.start ? [] : [{ target: 'variable' as const, cell: l.cell, value: x[i]! }]));

export const wavePlanProblem: ProblemSolver<'wave_plan'> = async (run, params) => {
  const s = setupOf(run, params);
  const { base } = run.model;
  const y0 = base.get(s.objective);
  const netBefore = base.get(NET);

  // Start: every lever at its start month, moving levers clamped into their months.
  const x0 = s.levers.map((l) => (l.months.length === 0 ? l.start : Math.min(l.months.at(-1)!, Math.max(l.months[0]!, l.start))));
  const startLoad = loadOf(s.levers, x0);
  const startFeasible = x0.every((m, i) => m === s.levers[i]!.start) && violationOf(s.caps, startLoad) === 0;

  const gains = await price(run, s);
  run.progress(PRICE_SHARE, 'start months priced');

  const x = [...x0];
  let load = startLoad;
  let v = violationOf(s.caps, load);
  const partial = (): SolverOutcome<'wave_plan'> => {
    const changes = changesOf(s, x);
    return {
      status: v > 0 ? 'infeasible' : 'feasible',
      changes,
      detail: detailOf(s, x, load, netBefore, run.rerun(changes).get(NET)),
    };
  };
  run.partial(partial());

  // Each pass lowers the violation, or keeps it and raises the objective: (violation, −objective) falls strictly.
  let passes = 0;
  while (passes < MAX_PASSES) {
    await run.batch();
    passes += 1;
    const repairing = v > 0;
    const mv =
      (repairing ? (bestRepair(s, gains, x, load, v, singles(s, x)) ?? bestRepair(s, gains, x, load, v, pairs(s, x))) : undefined) ??
      bestImprove(s, gains, x, load, v, singles(s, x)) ??
      bestImprove(s, gains, x, load, v, pairs(s, x));
    if (mv === undefined) break;
    apply(x, mv);
    load = loadOf(s.levers, x);
    v = violationOf(s.caps, load);
    run.partial(partial());
    run.progress(PRICE_SHARE + (1 - PRICE_SHARE) * (1 - 1 / (1 + passes / PROGRESS_HALF_PASSES)), `${repairing ? 'repair' : 'improve'}: pass ${passes}`);
  }

  // The plan on the engine; a feasible start is never made worse.
  let changes = changesOf(s, x);
  let e = run.rerun(changes);
  if (startFeasible && e.get(s.objective) < y0 - GAIN_TOL) {
    x.splice(0, x.length, ...x0);
    load = startLoad;
    v = 0;
    changes = [];
    e = base;
  }
  const feasible = v <= 0;
  const atBest = s.movers.every((i) => {
    const g = gains.get(i)!;
    const top = Math.max(...g.values());
    return gainAt(gains, i, x[i]!) >= top - GAIN_TOL;
  });
  const objective = e.get(s.objective);
  run.progress(1, `${changes.length} moves`);
  return {
    status: !feasible ? 'infeasible' : atBest ? 'optimal' : 'feasible',
    changes,
    ranked: run.rank(changes, s.objective),
    binding: bindingOf(s, gains, x, load, v),
    metrics: {
      [NET]: e.get(NET),
      [RISK]: e.get(RISK),
      [ONE_TIME_ALL]: e.get(ONE_TIME_ALL),
      objective,
      objective_before: y0,
      objective_gain: objective - y0,
      violation: v,
      moves: changes.length,
      passes,
    },
    detail: detailOf(s, x, load, netBefore, e.get(NET)),
  };
};
