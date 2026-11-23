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
 * set or end values. The result's values are rounded back onto the step grid. Output: the moves, ranked in the order the optimiser first took
 * each cell (impacts on res.net along that path).
 *
 * Method `production`: the explainable plan, then a seeded refinement that steps moved cells back toward
 * the start while every constraint still holds and the objective falls (largest fall first).
 *
 * Moves: lever-intensity inputs step up only (from the plan toward the stretch cap, as the reference);
 * inputs of the other sets step either way. Step = registry step (else range / STEP_DIVISIONS); a move
 * never leaves `[lo, hi]` of SOL-01 (a start value already outside them only moves back inside).
 *
 * Pure: the model and the engine only.
 */
import { cellKey, type BatchInput, type CellKey, type Evaluation } from '@glidepath/engine';
import type { TenantMembers } from '@glidepath/spec';
import { decisionSets, type DecisionVariable } from '../decision-sets';
import { SolverError } from '../errors';
import type { ProblemSolver, SolverRun } from '../run';
import type {
  BindingConstraint,
  Change,
  DecisionSetId,
  MinRiskMixParams,
  OptimiserMethod,
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
type Read = (cell: CellKey) => number;

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

interface Constraint {
  /** `total`, `one_time_cap` …, or `per_vp[v]`. */
  readonly id: string;
  readonly cells: readonly CellKey[];
  readonly slack: (read: Read) => number;
}

function buildConstraints(run: SolverRun<'min_risk_mix'>, given: readonly SolverConstraint[] | undefined): Constraint[] {
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
          out.push({ id: `per_vp[${v}]`, cells: [net, bar], slack: (r) => r(net) - r(bar) });
        }
        break;
      }
      case 'one_time_cap':
        out.push({ id: c.id, cells: ['res.tot_ot_it'], slack: (r) => c.value - r('res.tot_ot_it') });
        break;
      case 'rate_share':
        out.push({ id: c.id, cells: ['res.rate_share'], slack: (r) => c.value - r('res.rate_share') });
        break;
      case 'us_floor':
        out.push({ id: c.id, cells: ['res.fte_us'], slack: (r) => r('res.fte_us') - c.value });
        break;
      case 'gcc_hiring':
        out.push({ id: c.id, cells: ['res.fte_gcc', 'hc.gcc'], slack: (r) => c.value - (r('res.fte_gcc') - r('hc.gcc')) });
        break;
      case 'eps':
        out.push({ id: c.id, cells: ['br.eps27'], slack: (r) => r('br.eps27') - c.value });
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

const violation = (constraints: readonly Constraint[], read: Read): number =>
  constraints.reduce((s, c) => s + Math.max(0, -c.slack(read)), 0);

// ---------------------------------------------------------------------------------------------------
// Objectives: a cost to minimise at a point (read) with decision values x
// ---------------------------------------------------------------------------------------------------

type Cost = (read: Read, x: ReadonlyMap<CellKey, number>) => number;

function buildObjective(
  run: SolverRun<'min_risk_mix'>,
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

interface Mover {
  readonly d: DecisionVariable;
  readonly step: number;
  /** Directions the greedy may step: +1 only for lever intensity, else both. */
  readonly dirs: readonly (1 | -1)[];
}

interface Candidate {
  readonly mover: Mover;
  /** Signed steps from the start after the move. */
  readonly n: number;
  /** The value after the move: the current value ± one step (accumulated, as the reference). */
  readonly value: number;
}

interface Priced {
  readonly cand: Candidate;
  readonly read: Read;
}

/** The value `n` steps from the start, rounded onto the step grid (for the result's changes). */
const valueAt = (m: Mover, n: number): number => Number((m.d.value + n * m.step).toPrecision(VALUE_DIGITS));

/** True when `x` lies within the mover's bounds (or, for a start outside them, no further out). */
function inBounds(m: Mover, x: number): boolean {
  const lo = Math.min(m.d.lo, m.d.value);
  const hi = Math.max(m.d.hi, m.d.value);
  if (x < lo - BOUND_TOL || x > hi + BOUND_TOL) return false;
  // A start outside [lo, hi] may only move back toward the bounds.
  if (x > m.d.hi + BOUND_TOL && x > m.d.value) return false;
  if (x < m.d.lo - BOUND_TOL && x < m.d.value) return false;
  return true;
}

class Search {
  /** Current point. */
  cur: Evaluation;
  /** Steps taken per cell (signed), the current decision values, and the order of first moves. */
  readonly n = new Map<CellKey, number>();
  readonly x = new Map<CellKey, number>();
  readonly order: CellKey[] = [];
  evaluations = 1;
  steps = 0;

  constructor(
    private readonly run: SolverRun<'min_risk_mix'>,
    readonly movers: readonly Mover[],
  ) {
    this.cur = run.model.base;
    for (const m of movers) {
      this.n.set(m.d.cell, 0);
      this.x.set(m.d.cell, m.d.value);
    }
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
// The problem
// ---------------------------------------------------------------------------------------------------

/** What the last step that raised a constraint's slack gained and cost (for binding and shadow price). */
interface Gain {
  readonly slack: number;
  readonly cost: number;
}

export const minRiskMixProblem: ProblemSolver<'min_risk_mix'> = async (run, params) => {
  const objective = params.objective ?? MIN_RISK_DEFAULTS.objective;
  const method = params.method ?? MIN_RISK_DEFAULTS.method;
  const sets = params.decisionSets ?? MIN_RISK_DEFAULTS.decisionSets;
  if (!OBJECTIVES.includes(objective)) throw new SolverError('BAD_PARAMS', `unknown objective ${String(objective)}`);
  if (!METHODS.includes(method)) throw new SolverError('BAD_PARAMS', `unknown method ${String(method)}`);
  if (sets.length === 0) throw new SolverError('BAD_PARAMS', 'min_risk_mix needs at least one decision set');

  const vars = decisionSets(run.model, sets);
  const movers: Mover[] = vars
    .map((d) => ({
      d,
      step: d.step ?? (d.hi - d.lo) / STEP_DIVISIONS,
      dirs: d.set === 'lever_intensity' ? ([1] as const) : ([1, -1] as const),
    }))
    .filter((m) => m.step > 0);
  const constraints = buildConstraints(run, params.constraints);
  const cost = buildObjective(run, objective, vars, params);
  const s = new Search(run, movers);
  const gains = new Map<string, Gain>();
  const seed = method === 'production' ? (params.seed ?? DEFAULT_SEED) : undefined;

  const hasRisk = (run.model.members[LEVER_DIM] ?? []).every(
    (l) => run.model.base.has(cellKey('lev.iy', [l.id])) && run.model.base.has(cellKey('lev.conf', [l.id])),
  );
  /** The outcome for `changes`, with metrics read at evaluation `e`. */
  const outcome = (
    status: 'feasible' | 'infeasible',
    changes: readonly Change[] = s.changes(false),
    e: Evaluation = s.cur,
  ): SolverOutcome<'min_risk_mix'> => {
    const read: Read = (cell) => e.get(cell);
    const x = new Map(s.x);
    for (const c of changes) x.set(c.cell, c.value);
    const metrics: Record<string, number> = {};
    for (const c of METRIC_CELLS) if (e.has(c)) metrics[c] = e.get(c);
    if (hasRisk) metrics.risk_exposure = riskOf(read, run.model.members);
    metrics.objective = cost(read, x);
    metrics.violation = violation(constraints, read);
    metrics.steps = s.steps;
    metrics.evaluations = s.evaluations;
    return { status, changes, metrics, ...(seed === undefined ? {} : { seed }) };
  };

  // ---- greedy marginal analysis -------------------------------------------------------------------
  const v0 = violation(constraints, s.readCur);
  let v = v0;
  while (v > FEASIBILITY_TOL && s.steps < MAX_STEPS) {
    const cands: Candidate[] = [];
    for (const m of movers) {
      for (const dir of m.dirs) {
        const c = s.step(m, dir);
        if (inBounds(m, c.value)) cands.push(c);
      }
    }
    const priced = await s.price(cands);
    const c0 = cost(s.readCur, s.x);
    let best: { score: number; p: Priced; dc: number } | undefined;
    for (const p of priced) {
      const dv = v - violation(constraints, p.read);
      if (dv <= GAIN_TOL) continue;
      const dc = cost(p.read, s.xWith(p.cand)) - c0;
      const score = dv / Math.max(dc, COST_FLOOR);
      // Strictly better only: a tie keeps the first candidate in decision order (as the reference).
      if (best === undefined || score > best.score) best = { score, p, dc };
    }
    if (best === undefined) break;
    for (const c of constraints) {
      const gain = c.slack(best.p.read) - c.slack(s.readCur);
      if (gain > GAIN_TOL) gains.set(c.id, { slack: gain, cost: best.dc });
    }
    s.apply(best.p.cand);
    v = violation(constraints, s.readCur);
    run.progress(v0 > 0 ? Math.min(1, Math.max(0, 1 - v / v0)) : 1, `step ${s.steps}`);
    run.partial(outcome(v <= FEASIBILITY_TOL ? 'feasible' : 'infeasible'));
  }
  const feasible = v <= FEASIBILITY_TOL;

  // ---- production: seeded refinement back toward the start ---------------------------------------
  if (feasible && seed !== undefined) {
    const rand = mulberry32(seed);
    let refined = 0;
    while (refined < MAX_STEPS) {
      const cands: Candidate[] = [];
      for (const m of shuffled(movers, rand)) {
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
      run.partial(outcome('feasible'));
    }
  }

  // ---- result ------------------------------------------------------------------------------------
  // Changes on the step grid, unless rounding (at most ~1e-12 relative) would lose feasibility.
  const status = feasible ? 'feasible' : 'infeasible';
  const grid = s.changes(true);
  const atGrid = run.rerun(grid);
  const result =
    feasible && violation(constraints, (c) => atGrid.get(c)) > FEASIBILITY_TOL
      ? outcome(status)
      : outcome(status, grid, atGrid);
  // Binding: a held constraint whose slack is smaller than what its last improving step gained (undo that
  // step and it fails). Shadow price: objective cost per unit of slack on that step.
  const binding: BindingConstraint[] = [];
  if (feasible) {
    for (const c of constraints) {
      const g = gains.get(c.id);
      const slack = c.slack(s.readCur);
      if (g !== undefined && slack >= -FEASIBILITY_TOL && slack < g.slack) {
        binding.push({ constraint: c.id, shadowPrice: Math.max(g.cost, 0) / g.slack });
      }
    }
  }
  const ranked = run.rank(result.changes, NET, { mode: 'path' });
  run.progress(1);
  return { ...result, ranked, binding };
};
