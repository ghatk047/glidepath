/**
 * SOL-04: `min_risk_mix`, the minimum-risk lever mix that clears the bar (`solvers.json` `problems`;
 * 04 §2–3; 03 §3).
 *
 * Method `explainable` (default): greedy marginal analysis, as `optimise` in
 * docs/spec/reference/solvers_demo.py. From the start point, repeatedly take the one-step move with the
 * best constraint gain per unit of added objective (`gain / max(Δobjective, COST_FLOOR)`; only a strictly
 * better score replaces the best, so a tie keeps the first candidate in decision order) until every
 * constraint holds, no move gains, or MAX_STEPS. Each round prices every candidate step in one engine
 * batch. A step adds ± step to the current value (accumulated, as the reference does), which keeps the
 * plan equal to the reference's: several levers score equal up to rounding, and inside such a group the
 * order of single steps can still differ from the reference (its rounding is Python's), not the moved
 * set or end values. The result's values are rounded back onto the step grid. Output: the moves, ranked
 * in the order the optimiser first took each cell (impacts on res.net along that path).
 *
 * Method `production`: the explainable plan, then a seeded refinement that steps moved cells back toward
 * the start while every constraint still holds and the objective falls (largest fall first).
 *
 * Moves: lever-intensity inputs step up only (from the plan toward the stretch cap, as the reference);
 * inputs of the other sets step either way. Step = registry step (else range / STEP_DIVISIONS); a move
 * never leaves `[lo, hi]` of SOL-01 (a start value already outside them only moves back inside).
 *
 * SOL-05 constraints: `total` and `per_vp` violations are summed (as the reference); the optional caps and
 * floors are guards, which no step may worsen (see `Constraint.guard`). Binding constraints and shadow
 * prices come from a re-solve with each active constraint relaxed (see `bindingConstraints`). The search
 * (`solveMix`, `Search`) is shared with `vp_feasible` (src/problems/vp-feasible.ts).
 *
 * Pure: the model and the engine only.
 */
import { cellKey, type BatchInput, type CellKey, type Evaluation } from '@glidepath/engine';
import type { TenantMembers } from '@glidepath/spec';
import { decisionSets, type DecisionVariable } from '../decision-sets';
import { SolverError } from '../errors';
import type { SolverModel } from '../model';
import type { RankOptions } from '../ranked';
import type { ProblemSolver } from '../run';
import type {
  BindingConstraint,
  Change,
  DecisionSetId,
  MinRiskMixParams,
  OptimiserMethod,
  RankedMove,
  SolverConstraint,
  SolverObjective,
  SolverOutcome,
} from '../types';

// ---------------------------------------------------------------------------------------------------
// Method constants (numerical tolerances of the search, not business numbers)
// ---------------------------------------------------------------------------------------------------

/** A plan is feasible when the summed constraint violation is at most this. */
export const FEASIBILITY_TOL = 1e-6;
/** A step must cut the violation (or the objective, when refining) by more than this. */
export const GAIN_TOL = 1e-9;
/** Floor of the objective increase in the score `gain / max(Δobjective, COST_FLOOR)`. */
export const COST_FLOOR = 1e-3;
/** Most greedy steps (and refinement steps) per run. */
export const MAX_STEPS = 400;
/** Slack on the bound check of a step. */
const BOUND_TOL = 1e-12;
/** A decision variable without a registry step moves by (hi − lo) / STEP_DIVISIONS. */
export const STEP_DIVISIONS = 20;
/** Significant digits a result value is rounded to (puts `x0 + n·step` back on the step grid). */
const VALUE_DIGITS = 12;
/** A binding check relaxes by δ, then δ·RELAX_FACTOR … (δ = one step's worth of slack). */
export const RELAX_FACTOR = 2;
/** Relaxations a binding check tries before it calls an active constraint non-binding. */
export const RELAX_TRIES = 3;
/** Seed of `production` when the caller gives none. */
export const DEFAULT_SEED = 1;
/** Default weight `w` of `min_people_impact` (one onshore exit counts as one US exit). */
export const DEFAULT_PEOPLE_WEIGHT = 1;

/** `min_risk_mix` defaults (`solvers.json`): objective, decision sets, method. */
export const MIN_RISK_DEFAULTS = {
  objective: 'min_risk_exposure',
  decisionSets: ['lever_intensity'],
  method: 'explainable',
} as const satisfies { objective: SolverObjective; decisionSets: readonly DecisionSetId[]; method: OptimiserMethod };

const OBJECTIVES: readonly SolverObjective[] = [
  'min_risk_exposure',
  'max_risk_adjusted_net',
  'min_one_time',
  'min_people_impact',
  'min_change',
];
const METHODS: readonly OptimiserMethod[] = ['explainable', 'production'];

// ---------------------------------------------------------------------------------------------------
// Spec cells (solvers.json min_risk_mix, verbatim)
// ---------------------------------------------------------------------------------------------------

const NET = 'res.net';
const BAR = 'res.bar';
const LEVER_DIM = 'lever';
const VP_DIM = 'vp';

/** Cells the result reports as metrics, when the model has them. */
const METRIC_CELLS: readonly CellKey[] = [
  'res.net',
  'res.bar',
  'res.gap',
  'res.risk',
  'res.tot_ot_it',
  'res.tot_ot_all',
  'res.fte_us',
  'res.fte_gcc',
  'br.eps27',
];

/** Reads a cell of one evaluated point. */
export type Read = (cell: CellKey) => number;

/** An outcome of the mix search (no problem-specific `detail`), for `min_risk_mix` and `vp_feasible`. */
export type MixOutcome = Omit<SolverOutcome<'min_risk_mix'>, 'detail'>;

/**
 * What the mix search needs of its run: the `SolverRun` of `min_risk_mix` or of `vp_feasible` (SOL-05),
 * which share the search.
 */
export interface MixHost {
  readonly model: SolverModel;
  batch(): Promise<void>;
  progress(fraction: number, note?: string): void;
  partial(outcome: MixOutcome): void;
  rerun(changes: readonly Change[]): Evaluation;
  rank(changes: readonly Change[], output: CellKey, options?: RankOptions): RankedMove[];
}

/** `min_risk_exposure`: Σ_l lev.iy[l] · (1 − lev.conf[l]), expected non-delivery. */
export function riskExposure(e: Pick<Evaluation, 'get'>, members: TenantMembers): number {
  return riskOf((c) => e.get(c), members);
}

function riskOf(read: Read, members: TenantMembers): number {
  let s = 0;
  for (const l of members[LEVER_DIM] ?? []) s += read(cellKey('lev.iy', [l.id])) * (1 - read(cellKey('lev.conf', [l.id])));
  return s;
}

// ---------------------------------------------------------------------------------------------------
// Constraints: slack = lhs − rhs, held when slack >= 0
// ---------------------------------------------------------------------------------------------------

export interface Constraint {
  /** `total`, `one_time_cap` …, or `per_vp[v]`. */
  readonly id: string;
  readonly cells: readonly CellKey[];
  readonly slack: (read: Read) => number;
  /** The VP of a `per_vp[v]` row. */
  readonly vp?: string;
  /**
   * An optional cap or floor (`one_time_cap`, `rate_share`, `us_floor`, `gcc_hiring`, `eps`): the search
   * never takes a step that worsens its violation. Lever intensities only step up, so a cap the greedy
   * crossed for a gain on the bar could never be undone (summing its violation with the bar's leaves the
   * greedy stuck past the cap). `total` and `per_vp` are summed as in the reference.
   */
  readonly guard?: boolean;
}

export function buildConstraints(run: MixHost, given: readonly SolverConstraint[] | undefined): Constraint[] {
  const { base, members } = run.model;
  const out: Constraint[] = [
    // "res.net >= res.bar (or >= res.target when g.absorb_growth = 0)": res.bar is res.target then.
    { id: 'total', cells: [NET, BAR], slack: (r) => r(NET) - r(BAR) },
  ];
  for (const c of given ?? []) {
    switch (c.id) {
      case 'total':
        break;
      case 'per_vp': {
        const all = (members[VP_DIM] ?? []).map((m) => m.id);
        for (const v of c.vps ?? all) {
          if (!all.includes(v)) throw new SolverError('BAD_PARAMS', `per_vp: unknown vp ${v}`);
          const net = cellKey('vp.net', [v]);
          const bar = cellKey('vp.bar', [v]);
          out.push({ id: `per_vp[${v}]`, vp: v, cells: [net, bar], slack: (r) => r(net) - r(bar) });
        }
        break;
      }
      case 'one_time_cap':
        out.push({ id: c.id, guard: true, cells: ['res.tot_ot_it'], slack: (r) => c.value - r('res.tot_ot_it') });
        break;
      case 'rate_share':
        out.push({ id: c.id, guard: true, cells: ['res.rate_share'], slack: (r) => c.value - r('res.rate_share') });
        break;
      case 'us_floor':
        out.push({ id: c.id, guard: true, cells: ['res.fte_us'], slack: (r) => r('res.fte_us') - c.value });
        break;
      case 'gcc_hiring':
        out.push({ id: c.id, guard: true, cells: ['res.fte_gcc', 'hc.gcc'], slack: (r) => c.value - (r('res.fte_gcc') - r('hc.gcc')) });
        break;
      case 'eps':
        out.push({ id: c.id, guard: true, cells: ['br.eps27'], slack: (r) => r('br.eps27') - c.value });
        break;
      default:
        throw new SolverError('BAD_PARAMS', `unknown constraint ${String((c as { id: unknown }).id)}`);
    }
  }
  for (const c of out) {
    for (const cell of c.cells) {
      if (!base.has(cell)) throw new SolverError('BAD_MODEL', `constraint ${c.id}: the model has no cell ${cell}`);
    }
  }
  return out;
}

/** True when the step to `read` worsens no guard's violation from the current point `cur`. */
export function guarded(guards: readonly Constraint[], cur: Read, read: Read): boolean {
  return guards.every((g) => Math.max(0, -g.slack(read)) <= Math.max(0, -g.slack(cur)) + GAIN_TOL);
}

export const violation = (constraints: readonly Constraint[], read: Read): number =>
  constraints.reduce((s, c) => s + Math.max(0, -c.slack(read)), 0);

// ---------------------------------------------------------------------------------------------------
// Objectives: a cost to minimise at a point (read) with decision values x
// ---------------------------------------------------------------------------------------------------

export type Cost = (read: Read, x: ReadonlyMap<CellKey, number>) => number;

function buildObjective(
  run: MixHost,
  objective: SolverObjective,
  vars: readonly DecisionVariable[],
  params: MinRiskMixParams,
): Cost {
  const { base, members } = run.model;
  const need = (...cells: CellKey[]) => {
    for (const c of cells) if (!base.has(c)) throw new SolverError('BAD_MODEL', `${objective}: the model has no cell ${c}`);
  };
  switch (objective) {
    case 'min_risk_exposure': {
      const levers = members[LEVER_DIM] ?? [];
      if (levers.length === 0) throw new SolverError('BAD_MODEL', `${objective}: no members for dimension ${LEVER_DIM}`);
      for (const l of levers) need(cellKey('lev.iy', [l.id]), cellKey('lev.conf', [l.id]));
      return (read) => riskOf(read, members);
    }
    case 'max_risk_adjusted_net':
      need('res.risk');
      return (read) => -read('res.risk');
    case 'min_one_time':
      need('res.tot_ot_all');
      return (read) => read('res.tot_ot_all');
    case 'min_people_impact': {
      // (hc.us − res.fte_us) + w · onshore exits, onshore exits = lv.on0 − res.fte_on.
      need('hc.us', 'res.fte_us', 'lv.on0', 'res.fte_on');
      const w = params.peopleWeight ?? DEFAULT_PEOPLE_WEIGHT;
      return (read) => read('hc.us') - read('res.fte_us') + w * (read('lv.on0') - read('res.fte_on'));
    }
    case 'min_change': {
      // Σ ((x − x0) / range)², range = registry max − min (else the solver bounds).
      const ranges = vars.map((d) => {
        const r = d.min !== null && d.max !== null ? d.max - d.min : d.hi - d.lo;
        return r > 0 ? r : 1;
      });
      return (_read, x) =>
        vars.reduce((s, d, i) => {
          const z = ((x.get(d.cell) ?? d.value) - d.value) / ranges[i]!;
          return s + z * z;
        }, 0);
    }
    default:
      throw new SolverError('BAD_PARAMS', `unknown objective ${String(objective)}`);
  }
}

// ---------------------------------------------------------------------------------------------------
// Search state and one round of priced candidate steps
// ---------------------------------------------------------------------------------------------------

export interface Mover {
  readonly d: DecisionVariable;
  readonly step: number;
  /** Directions the greedy may step: +1 only for lever intensity, else both. */
  readonly dirs: readonly (1 | -1)[];
}

export interface Candidate {
  readonly mover: Mover;
  /** Signed steps from the start after the move. */
  readonly n: number;
  /** The value after the move: the current value ± one step (accumulated, as the reference). */
  readonly value: number;
}

export interface Priced {
  readonly cand: Candidate;
  readonly read: Read;
}

/** The value `n` steps from the start, rounded onto the step grid (for the result's changes). */
const valueAt = (m: Mover, n: number): number => Number((m.d.value + n * m.step).toPrecision(VALUE_DIGITS));

/** True when `x` lies within the mover's bounds (or, for a start outside them, no further out). */
export function inBounds(m: Mover, x: number): boolean {
  const lo = Math.min(m.d.lo, m.d.value);
  const hi = Math.max(m.d.hi, m.d.value);
  if (x < lo - BOUND_TOL || x > hi + BOUND_TOL) return false;
  // A start outside [lo, hi] may only move back toward the bounds.
  if (x > m.d.hi + BOUND_TOL && x > m.d.value) return false;
  if (x < m.d.lo - BOUND_TOL && x < m.d.value) return false;
  return true;
}

/** A search state to restart from (SOL-05: a relaxed re-solve resumes where its path leaves this one). */
export interface Snapshot {
  readonly cur: Evaluation;
  readonly n: ReadonlyMap<CellKey, number>;
  readonly x: ReadonlyMap<CellKey, number>;
  readonly order: readonly CellKey[];
  readonly steps: number;
}

export class Search {
  /** Current point. */
  cur: Evaluation;
  /** Steps taken per cell (signed), the current decision values, and the order of first moves. */
  readonly n = new Map<CellKey, number>();
  readonly x = new Map<CellKey, number>();
  readonly order: CellKey[] = [];
  evaluations = 1;
  steps = 0;

  constructor(
    private readonly run: MixHost,
    readonly movers: readonly Mover[],
    from?: Snapshot,
  ) {
    this.cur = from?.cur ?? run.model.base;
    for (const m of movers) {
      this.n.set(m.d.cell, from?.n.get(m.d.cell) ?? 0);
      this.x.set(m.d.cell, from?.x.get(m.d.cell) ?? m.d.value);
    }
    if (from !== undefined) {
      this.order.push(...from.order);
      this.steps = from.steps;
    }
  }

  snapshot(): Snapshot {
    return { cur: this.cur, n: new Map(this.n), x: new Map(this.x), order: [...this.order], steps: this.steps };
  }

  readCur: Read = (cell) => this.cur.get(cell);

  /** Prices `cands` from the current point in one engine batch; failed lanes are dropped. */
  async price(cands: readonly Candidate[]): Promise<Priced[]> {
    if (cands.length === 0) return [];
    const size = cands.length;
    const values = new Map<CellKey, Float64Array>();
    cands.forEach((c, i) => {
      const cell = c.mover.d.cell;
      let lane = values.get(cell);
      if (lane === undefined) {
        lane = new Float64Array(size).fill(this.cur.get(cell));
        values.set(cell, lane);
      }
      lane[i] = c.value;
    });
    const input: BatchInput = { size, values };
    await this.run.batch();
    const res = this.run.model.compiled.evaluateBatch(this.cur, input);
    this.evaluations += size;
    const cur = this.cur;
    const out: Priced[] = [];
    cands.forEach((cand, i) => {
      if (res.failed[i] === 1) return;
      const read: Read = (cell) => {
        const a = res.values.get(cell) ?? values.get(cell);
        return a === undefined ? cur.get(cell) : a[i]!;
      };
      out.push({ cand, read });
    });
    return out;
  }

  /** Decision values with one candidate applied. */
  xWith(c: Candidate): Map<CellKey, number> {
    const x = new Map(this.x);
    x.set(c.mover.d.cell, c.value);
    return x;
  }

  apply(c: Candidate): void {
    const cell = c.mover.d.cell;
    this.n.set(cell, c.n);
    this.x.set(cell, c.value);
    if (!this.order.includes(cell)) this.order.push(cell);
    this.cur = this.run.model.compiled.rerun(this.cur, [{ target: 'variable', cell, value: c.value }]);
    this.steps += 1;
  }

  /** A candidate one step from the current value of `m` in direction `dir`. */
  step(m: Mover, dir: number): Candidate {
    return { mover: m, n: this.n.get(m.d.cell)! + dir, value: this.x.get(m.d.cell)! + dir * m.step };
  }

  /**
   * Moves from the start, in order of first move, dropping cells back at their start value; `grid`
   * rounds each value onto the step grid, else the search's accumulated value.
   */
  changes(grid: boolean): Change[] {
    const byCell = new Map(this.movers.map((m) => [m.d.cell, m]));
    return this.order
      .filter((cell) => this.n.get(cell) !== 0)
      .map((cell) => ({
        target: 'variable',
        cell,
        value: grid ? valueAt(byCell.get(cell)!, this.n.get(cell)!) : this.x.get(cell)!,
      }));
  }
}

/** mulberry32 constants (Tommy Ettinger's public-domain PRNG). */
const M32 = { inc: 0x6d2b79f5, s1: 15, s2: 7, s3: 14, or: 61, span: 0x100000000 } as const;

/** Deterministic PRNG (mulberry32) for the seeded refinement order: uniform in [0, 1). */
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


// ---------------------------------------------------------------------------------------------------
// The search: greedy marginal analysis, production refinement, binding constraints
// ---------------------------------------------------------------------------------------------------

/** What a mix search runs with, built once from the params. */
export interface MixSetup {
  readonly movers: readonly Mover[];
  readonly constraints: readonly Constraint[];
  readonly cost: Cost;
  /** Seed of the `production` refinement; undefined for `explainable`. */
  readonly seed: number | undefined;
  /** The model has `lev.iy` and `lev.conf` for every lever (the `risk_exposure` metric). */
  readonly hasRisk: boolean;
}

/** Validates `params` and builds the decision movers, constraints and objective. */
export function mixSetup(host: MixHost, params: MinRiskMixParams): MixSetup {
  const objective = params.objective ?? MIN_RISK_DEFAULTS.objective;
  const method = params.method ?? MIN_RISK_DEFAULTS.method;
  const sets = params.decisionSets ?? MIN_RISK_DEFAULTS.decisionSets;
  if (!OBJECTIVES.includes(objective)) throw new SolverError('BAD_PARAMS', `unknown objective ${String(objective)}`);
  if (!METHODS.includes(method)) throw new SolverError('BAD_PARAMS', `unknown method ${String(method)}`);
  if (sets.length === 0) throw new SolverError('BAD_PARAMS', 'min_risk_mix needs at least one decision set');

  const vars = decisionSets(host.model, sets);
  const movers: Mover[] = vars
    .map((d) => ({
      d,
      step: d.step ?? (d.hi - d.lo) / STEP_DIVISIONS,
      dirs: d.set === 'lever_intensity' ? ([1] as const) : ([1, -1] as const),
    }))
    .filter((m) => m.step > 0);
  const constraints = buildConstraints(host, params.constraints);
  const cost = buildObjective(host, objective, vars, params);
  const { base, members } = host.model;
  const hasRisk = (members[LEVER_DIM] ?? []).every(
    (l) => base.has(cellKey('lev.iy', [l.id])) && base.has(cellKey('lev.conf', [l.id])),
  );
  const seed = method === 'production' ? (params.seed ?? DEFAULT_SEED) : undefined;
  return { movers, constraints, cost, seed, hasRisk };
}

/** The outcome for `changes` (default: the search's current moves), with metrics read at evaluation `e`. */
export function mixOutcome(
  host: MixHost,
  setup: MixSetup,
  s: Search,
  status: 'feasible' | 'infeasible',
  changes: readonly Change[] = s.changes(false),
  e: Evaluation = s.cur,
): MixOutcome {
  const read: Read = (cell) => e.get(cell);
  const x = new Map(s.x);
  for (const c of changes) x.set(c.cell, c.value);
  const metrics: Record<string, number> = {};
  for (const c of METRIC_CELLS) if (e.has(c)) metrics[c] = e.get(c);
  if (setup.hasRisk) metrics.risk_exposure = riskOf(read, host.model.members);
  metrics.objective = setup.cost(read, x);
  metrics.violation = violation(setup.constraints, read);
  metrics.steps = s.steps;
  metrics.evaluations = s.evaluations;
  return { status, changes, metrics, ...(setup.seed === undefined ? {} : { seed: setup.seed }) };
}

/**
 * The result of a finished search: changes on the step grid (unless rounding, at most ~1e-12 relative,
 * would lose feasibility) and the moves ranked in the order the search first took them.
 */
export function finishMix(host: MixHost, setup: MixSetup, s: Search, status: 'feasible' | 'infeasible'): MixOutcome {
  const grid = s.changes(true);
  const atGrid = host.rerun(grid);
  const out =
    status === 'feasible' && violation(setup.constraints, (c) => atGrid.get(c)) > FEASIBILITY_TOL
      ? mixOutcome(host, setup, s, status)
      : mixOutcome(host, setup, s, status, grid, atGrid);
  return { ...out, ranked: host.rank(out.changes, NET, { mode: 'path' }) };
}

/** Single steps from the current point in each mover's directions, within bounds. */
export function stepCandidates(s: Search): Candidate[] {
  const out: Candidate[] = [];
  for (const m of s.movers) {
    for (const dir of m.dirs) {
      const c = s.step(m, dir);
      if (inBounds(m, c.value)) out.push(c);
    }
  }
  return out;
}

/** One greedy round: the state before it and, per constraint, the largest slack over the current point and every priced candidate. */
interface Round {
  readonly from: Snapshot;
  readonly maxSlack: readonly number[];
}

/**
 * Greedy marginal analysis from the search's current point until `constraints` hold, no move gains, or
 * MAX_STEPS; true when feasible. `rounds` (when given) records each round for `bindingConstraints`.
 */
async function greedy(
  s: Search,
  cost: Cost,
  constraints: readonly Constraint[],
  rounds?: Round[],
  onStep?: (v: number) => void,
): Promise<boolean> {
  const guards = constraints.filter((c) => c.guard === true);
  let v = violation(constraints, s.readCur);
  while (v > FEASIBILITY_TOL && s.steps < MAX_STEPS) {
    const priced = await s.price(stepCandidates(s));
    rounds?.push({
      from: s.snapshot(),
      maxSlack: constraints.map((c) => priced.reduce((m, p) => Math.max(m, c.slack(p.read)), c.slack(s.readCur))),
    });
    const c0 = cost(s.readCur, s.x);
    let best: { score: number; p: Priced } | undefined;
    for (const p of priced) {
      const dv = v - violation(constraints, p.read);
      if (dv <= GAIN_TOL || !guarded(guards, s.readCur, p.read)) continue;
      const dc = cost(p.read, s.xWith(p.cand)) - c0;
      const score = dv / Math.max(dc, COST_FLOOR);
      // Strictly better only: a tie keeps the first candidate in decision order (as the reference).
      if (best === undefined || score > best.score) best = { score, p };
    }
    if (best === undefined) break;
    s.apply(best.p.cand);
    v = violation(constraints, s.readCur);
    onStep?.(v);
  }
  return v <= FEASIBILITY_TOL;
}

/** `production`: seeded refinement stepping moved cells back toward the start while feasible and the objective falls. */
async function refine(
  s: Search,
  cost: Cost,
  constraints: readonly Constraint[],
  seed: number,
  onStep?: () => void,
): Promise<void> {
  const rand = mulberry32(seed);
  let refined = 0;
  while (refined < MAX_STEPS) {
    const cands: Candidate[] = [];
    for (const m of shuffled(s.movers, rand)) {
      const n = s.n.get(m.d.cell)!;
      if (n === 0) continue;
      // One step back toward the start.
      cands.push(s.step(m, -Math.sign(n)));
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
    refined += 1;
    onStep?.();
  }
}

/**
 * Binding constraints and shadow prices (SOL-05) of a feasible plan. A held constraint is active when its
 * slack is within δ, the largest change of its slack that one step from the plan makes (forward, or back
 * toward the start). An active constraint is relaxed by δ (slack + δ) and the problem re-solved with the
 * same method; it is binding when the relaxed plan's objective is lower, with shadow price = objective
 * saved per unit of relaxation, (objective − relaxed objective) / δ, in objective units per unit of the
 * constraint's own measure ($M of net, FTE, EPS …).
 *
 * The re-solve is exact but warm: the relaxed greedy takes the same steps as the original for as long as
 * the constraint is violated by at least δ at the current point and at every priced candidate (its
 * violation is then the original's minus δ everywhere, so every score is unchanged). It starts at the
 * first round where that fails (`rounds`), or at the greedy's end (`end`).
 */
async function bindingConstraints(
  host: MixHost,
  setup: MixSetup,
  s: Search,
  rounds: readonly Round[],
  end: Snapshot,
): Promise<BindingConstraint[]> {
  const { constraints, cost, movers } = setup;
  const c0 = cost(s.readCur, s.x);
  const cands = stepCandidates(s);
  for (const m of movers) {
    const n = s.n.get(m.d.cell)!;
    const back = -Math.sign(n);
    // A step back toward the start that the mover's directions do not already cover.
    if (n !== 0 && !(m.dirs as readonly number[]).includes(back)) cands.push(s.step(m, back));
  }
  const priced = await s.price(cands);
  const out: BindingConstraint[] = [];
  for (const [i, c] of constraints.entries()) {
    const slack = c.slack(s.readCur);
    if (slack < -FEASIBILITY_TOL) continue;
    const step = priced.reduce((m, p) => Math.max(m, Math.abs(c.slack(p.read) - slack)), 0);
    if (step <= GAIN_TOL || slack > step) continue;
    // One step's worth of slack, doubled up to RELAX_TRIES times while it changes nothing (a step's
    // effect at the plan can fall just short of what the same step needs earlier on the path).
    for (let k = 0, delta = step; k < RELAX_TRIES; k++, delta *= RELAX_FACTOR) {
      const saving = await relaxedSaving(host, setup, c0, i, delta, rounds, end);
      if (saving > GAIN_TOL) {
        out.push({ constraint: c.id, shadowPrice: saving / delta });
        break;
      }
    }
  }
  return out;
}

/** Objective saved by re-solving with constraint `i` relaxed by `delta` (−∞ when that is infeasible). */
async function relaxedSaving(
  host: MixHost,
  { constraints, cost, movers, seed }: MixSetup,
  c0: number,
  i: number,
  delta: number,
  rounds: readonly Round[],
  end: Snapshot,
): Promise<number> {
  const relaxed = constraints.map((k, j) => (j === i ? { ...k, slack: (r: Read) => k.slack(r) + delta } : k));
  const restart = rounds.find((r) => r.maxSlack[i]! + delta > 0)?.from ?? end;
  const rs = new Search(host, movers, restart);
  if (!(await greedy(rs, cost, relaxed))) return -Infinity;
  if (seed !== undefined) await refine(rs, cost, relaxed, seed);
  return c0 - cost(rs.readCur, rs.x);
}

/** A finished mix search: its state, setup and result. */
export interface MixSolution {
  readonly s: Search;
  readonly setup: MixSetup;
  readonly feasible: boolean;
  readonly result: MixOutcome;
}

/** Runs the mix search of `params` (03 §3 `min_risk_mix`) on `host`. */
export async function solveMix(host: MixHost, params: MinRiskMixParams): Promise<MixSolution> {
  const setup = mixSetup(host, params);
  const s = new Search(host, setup.movers);
  const rounds: Round[] = [];
  const v0 = violation(setup.constraints, s.readCur);
  const feasible = await greedy(s, setup.cost, setup.constraints, rounds, (v) => {
    host.progress(v0 > 0 ? Math.min(1, Math.max(0, 1 - v / v0)) : 1, `step ${s.steps}`);
    host.partial(mixOutcome(host, setup, s, v <= FEASIBILITY_TOL ? 'feasible' : 'infeasible'));
  });
  const end = s.snapshot();
  if (feasible && setup.seed !== undefined) {
    await refine(s, setup.cost, setup.constraints, setup.seed, () => host.partial(mixOutcome(host, setup, s, 'feasible')));
  }
  const result = finishMix(host, setup, s, feasible ? 'feasible' : 'infeasible');
  const binding = feasible ? await bindingConstraints(host, setup, s, rounds, end) : [];
  host.progress(1);
  return { s, setup, feasible, result: { ...result, binding } };
}

// ---------------------------------------------------------------------------------------------------
// The problem
// ---------------------------------------------------------------------------------------------------

export const minRiskMixProblem: ProblemSolver<'min_risk_mix'> = async (run, params) => (await solveMix(run, params)).result;
