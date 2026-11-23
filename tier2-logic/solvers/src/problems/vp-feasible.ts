/**
 * SOL-05: `vp_feasible`, the plan where every VP clears its own bar (`solvers.json` `problems`: "min_risk_mix
 * with per_vp constraints; if infeasible, maximise min_v vp.coverage[v]"; 04 §2).
 *
 * 1. `min_risk_mix` (src/problems/min-risk.ts) with `per_vp` added to the given constraints (all VPs,
 *    unless the caller's `per_vp` names some). Feasible: that plan, its binding constraints and shadow
 *    prices.
 * 2. Infeasible: maximin on `vp.coverage[v]` over the same decision inputs and moves. Each round prices
 *    every one-step move in one batch and takes the one whose coverages, capped at 1 (a VP that clears
 *    its bar asks nothing more) and sorted ascending, are lexicographically largest: the lowest coverage
 *    first, then the next (leximin, so a tie at the minimum still moves). Equal vectors keep the cheaper
 *    move on the objective, then the first in decision order. The guards (optional caps and floors) hold
 *    as in the mix: no step worsens one. It ends when no move raises the vector. It runs from the start
 *    point and from where the mix stopped, and keeps the better plan (guards held first, then the
 *    vector, then the objective). Status `infeasible`, no binding constraints.
 *
 * `detail.coverage`: `vp.coverage[v]` of every constrained VP at the result.
 * Pure: the model and the engine only.
 */
import { cellKey, type CellKey } from '@glidepath/engine';
import { SolverError } from '../errors';
import type { ProblemSolver } from '../run';
import type { SolverConstraint, SolverOutcome } from '../types';
import {
  FEASIBILITY_TOL,
  GAIN_TOL,
  MAX_STEPS,
  Search,
  buildConstraints,
  finishMix,
  guarded,
  mixOutcome,
  solveMix,
  stepCandidates,
  violation,
  type MixHost,
  type MixOutcome,
  type MixSetup,
  type Priced,
  type Read,
} from './min-risk';

/** `vp.coverage` (03b: `SAFEDIV(vp.net, vp.bar, 0)`), the measure the fallback maximises. */
export const VP_COVERAGE = 'vp.coverage';
/** A coverage at or above this clears the VP's bar: the maximin asks nothing more of it. */
const CLEARS = 1;

/** The caller's constraints with `per_vp` (every VP) added unless they already have it. */
export function withPerVp(given: readonly SolverConstraint[] | undefined): SolverConstraint[] {
  const list = [...(given ?? [])];
  if (!list.some((c) => c.id === 'per_vp')) list.push({ id: 'per_vp' });
  return list;
}

/** Ascending order of numbers. */
const ascending = (a: number, b: number): number => a - b;

/** Compares two sorted coverage vectors lexicographically (leximin): > 0 when `a` is better. */
export function leximin(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    if (d > GAIN_TOL) return 1;
    if (d < -GAIN_TOL) return -1;
  }
  return 0;
}

interface Maximin {
  readonly s: Search;
  readonly key: readonly number[];
  readonly guardViolation: number;
  readonly cost: number;
}

/** Leximin ascent on capped VP coverage from the search's current point. */
async function maximin(host: MixHost, setup: MixSetup, s: Search, cells: readonly CellKey[]): Promise<Maximin> {
  const guards = setup.constraints.filter((c) => c.guard === true);
  const key = (read: Read): number[] => cells.map((c) => Math.min(read(c), CLEARS)).sort(ascending);
  for (let k = 0; k < MAX_STEPS; k++) {
    const priced = await s.price(stepCandidates(s));
    const k0 = key(s.readCur);
    const c0 = setup.cost(s.readCur, s.x);
    let best: { key: number[]; dc: number; p: Priced } | undefined;
    for (const p of priced) {
      if (!guarded(guards, s.readCur, p.read)) continue;
      const kp = key(p.read);
      if (leximin(kp, k0) <= 0) continue;
      const dc = setup.cost(p.read, s.xWith(p.cand)) - c0;
      const vs = best === undefined ? 1 : leximin(kp, best.key);
      if (vs > 0 || (vs === 0 && dc < best!.dc)) best = { key: kp, dc, p };
    }
    if (best === undefined) break;
    s.apply(best.p.cand);
    host.progress(Math.min(CLEARS, Math.max(0, best.key[0]!)), `maximin ${k + 1}`);
    host.partial(mixOutcome(host, setup, s, 'infeasible'));
  }
  return {
    s,
    key: key(s.readCur),
    guardViolation: violation(guards, s.readCur),
    cost: setup.cost(s.readCur, s.x),
  };
}

/** > 0 when plan `a` is better than `b`: guards held, then the coverage vector, then the objective. */
function better(a: Maximin, b: Maximin): number {
  const ha = a.guardViolation <= FEASIBILITY_TOL;
  const hb = b.guardViolation <= FEASIBILITY_TOL;
  if (ha !== hb) return ha ? 1 : -1;
  if (!ha && Math.abs(a.guardViolation - b.guardViolation) > GAIN_TOL) return b.guardViolation - a.guardViolation;
  const vs = leximin(a.key, b.key);
  if (vs !== 0) return vs;
  return b.cost - a.cost;
}

export const vpFeasibleProblem: ProblemSolver<'vp_feasible'> = async (run, params) => {
  const constraints = withPerVp(params.constraints);
  const vps = buildConstraints(run, constraints).flatMap((c) => (c.vp === undefined ? [] : [c.vp]));
  const cells = vps.map((v) => cellKey(VP_COVERAGE, [v]));
  if (vps.length === 0) throw new SolverError('BAD_MODEL', 'vp_feasible: no members for dimension vp');
  for (const c of cells) {
    if (!run.model.base.has(c)) throw new SolverError('BAD_MODEL', `vp_feasible: the model has no cell ${c}`);
  }
  const mix = await solveMix(run, { ...params, constraints });
  /** `out` with `detail.coverage` and the `min_coverage` metric read at its changes. */
  const withCoverage = (out: MixOutcome, metrics: Record<string, number> = {}): SolverOutcome<'vp_feasible'> => {
    const e = run.rerun(out.changes);
    const coverage = vps.map((vp, i) => ({ vp, coverage: e.get(cells[i]!) }));
    const min_coverage = Math.min(...coverage.map((c) => c.coverage));
    return { ...out, metrics: { ...out.metrics, ...metrics, min_coverage }, detail: { coverage } };
  };
  if (mix.feasible) return withCoverage(mix.result);

  // Infeasible: maximise the minimum VP coverage, from the start and from where the mix stopped.
  const fromStart = await maximin(run, mix.setup, new Search(run, mix.setup.movers), cells);
  const fromMix = await maximin(run, mix.setup, new Search(run, mix.setup.movers, mix.s.snapshot()), cells);
  const best = better(fromMix, fromStart) > 0 ? fromMix : fromStart;
  const out = finishMix(run, mix.setup, best.s, 'infeasible');
  run.progress(1);
  // Evaluations of the whole run: the mix and both ascents.
  const evaluations = mix.s.evaluations + fromStart.s.evaluations + fromMix.s.evaluations;
  return withCoverage({ ...out, binding: [] }, { evaluations });
};
