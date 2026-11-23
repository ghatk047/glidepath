/**
 * Monte Carlo input draws (04 §4 Distributions, Correlation): for every sampled input cell, `size` values
 * by inverse transform of a seeded uniform, the uniforms of one lever family coupled by a one-factor
 * Gaussian copula. Pure: the same model, params and seed give the same draws, bit for bit.
 */
import type { CellKey, Evaluation } from '@glidepath/engine';
import type { VariableDef } from '@glidepath/spec';
import { SolverError } from '../../errors';
import type { SolverModel } from '../../model';
import type { MonteCarloDist, MonteCarloParams } from '../../types';
import { MONTE_CARLO_DEFAULTS as DEFAULTS } from './defaults';
import { Stream } from './rng';
import { betaInv, normCdf, normInv } from './stats';

export interface MonteCarloDraws {
  readonly seed: number;
  readonly size: number;
  /** Sampled input cells → `size` draws each, in cell-key order. */
  readonly cells: ReadonlyMap<CellKey, Float64Array>;
  /** The distribution each sampled cell was drawn from. */
  readonly dists: ReadonlyMap<CellKey, MonteCarloDist>;
  /** Correlation groups applied: `correlatedVar` cells per group and their ρ. */
  readonly groups: readonly { readonly cells: readonly CellKey[]; readonly rho: number }[];
}

const bad = (message: string): SolverError => new SolverError('BAD_PARAMS', `monte_carlo: ${message}`);

/** Variable id and member key of a cell (`lev.start[L03]` → `lev.start`, `L03`). */
export function splitCell(cell: CellKey): { id: string; member: string | undefined } {
  const i = cell.indexOf('[');
  return i < 0 ? { id: cell, member: undefined } : { id: cell.slice(0, i), member: cell.slice(i + 1, -1) };
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;
const finite = (...xs: unknown[]): boolean => xs.every((x) => typeof x === 'number' && Number.isFinite(x));

/** Checks a distribution's shape and parameters; `where` names it in the error. */
export function validateDist(d: unknown, where: string): MonteCarloDist {
  const fail = (why: string) => bad(`${where}: ${why}`);
  if (typeof d !== 'object' || d === null) throw fail('a distribution is an object with a type');
  const x = d as MonteCarloDist;
  if ('basis' in x && x.basis !== undefined && !['absolute', 'relative', 'shift'].includes(x.basis)) {
    throw fail(`unknown basis ${String(x.basis)}`);
  }
  switch (x.type) {
    case 'triangular':
    case 'pert':
      if (!finite(x.min, x.mode, x.max) || !(x.min <= x.mode && x.mode <= x.max)) throw fail('needs min ≤ mode ≤ max');
      if (x.type === 'pert' && x.lambda !== undefined && !(finite(x.lambda) && x.lambda > 0)) throw fail('lambda > 0');
      return x;
    case 'normal':
      if (!finite(x.mean, x.sd) || x.sd < 0) throw fail('needs a mean and sd ≥ 0');
      return x;
    case 'lognormal':
      if (!finite(x.mu, x.sigma) || x.sigma < 0) throw fail('needs mu and sigma ≥ 0');
      return x;
    case 'uniform':
      if (!finite(x.min, x.max) || x.min > x.max) throw fail('needs min ≤ max');
      return x;
    case 'discrete': {
      const w = x.weights;
      if (!Array.isArray(x.values) || x.values.length === 0 || !finite(...x.values)) throw fail('needs values');
      if (w !== undefined && (w.length !== x.values.length || !finite(...w) || w.some((v) => v < 0) || !w.some((v) => v > 0))) {
        throw fail('weights: one ≥ 0 per value, not all 0');
      }
      return x;
    }
    case 'confidence_beta':
      if (!finite(x.concentration, x.scale) || !(x.concentration > 0 && x.scale > 0) || typeof x.confidence !== 'string') {
        throw fail('needs concentration > 0, scale > 0 and a confidence variable');
      }
      return x;
    default:
      throw fail(`unknown type ${String((x as { type?: unknown }).type)}`);
  }
}

/** The draw `d` of `dist` at uniform `u` (before basis, rounding and clipping). */
function inverse(dist: Exclude<MonteCarloDist, { type: 'confidence_beta' }>, u: number, cum: Float64Array | undefined): number {
  switch (dist.type) {
    case 'triangular': {
      const { min, mode, max } = dist;
      const w = max - min;
      if (w === 0) return min;
      return u < (mode - min) / w ? min + Math.sqrt(u * w * (mode - min)) : max - Math.sqrt((1 - u) * w * (max - mode));
    }
    case 'pert': {
      const { min, mode, max } = dist;
      const w = max - min;
      if (w === 0) return min;
      const lambda = dist.lambda ?? DEFAULTS.pertLambda;
      return min + w * betaInv(u, 1 + (lambda * (mode - min)) / w, 1 + (lambda * (max - mode)) / w);
    }
    case 'normal':
      return dist.mean + dist.sd * normInv(u);
    case 'lognormal':
      return Math.exp(dist.mu + dist.sigma * normInv(u));
    case 'uniform':
      return dist.min + (dist.max - dist.min) * u;
    case 'discrete': {
      const total = cum![cum!.length - 1]!;
      const t = u * total;
      let k = 0;
      while (k < cum!.length - 1 && t >= cum![k]!) k++;
      return dist.values[k]!;
    }
  }
}

/** Distribution overrides on a variable definition (`variable_def.dist`), when the registry carries one. */
const defDist = (v: VariableDef): unknown => (v as VariableDef & { readonly dist?: unknown }).dist;

/** Every input cell of variable `id` in the start evaluation, in key order. */
function cellsOf(base: Evaluation, id: string): CellKey[] {
  const out: CellKey[] = [];
  for (const key of base.values.keys()) if (splitCell(key).id === id) out.push(key);
  return out.sort();
}

/**
 * Which input cells are sampled, from which distribution: `params.dist` by cell, then by variable, then
 * `variable_def.dist`, then the 04 §4 defaults; `null` at any level holds the cell at its start value.
 */
export function resolveDists(model: SolverModel, params: MonteCarloParams): Map<CellKey, MonteCarloDist> {
  const vars = new Map(model.bundle.variables.map((v) => [v.id, v]));
  const overrides = params.dist ?? {};
  const varIds = new Set<string>(Object.keys(DEFAULTS.dists));
  for (const v of model.bundle.variables) if (defDist(v) !== undefined && defDist(v) !== null) varIds.add(v.id);
  for (const key of Object.keys(overrides)) {
    const { id } = splitCell(key);
    if (!vars.has(id) || (key !== id && !model.base.values.has(key))) throw bad(`dist: ${key} is not an input cell or variable`);
    varIds.add(id);
  }

  const out = new Map<CellKey, MonteCarloDist>();
  for (const id of [...varIds].sort()) {
    const v = vars.get(id);
    if (v === undefined) continue; // a default for a variable this model does not have
    const fromDef = defDist(v);
    for (const cell of cellsOf(model.base, id)) {
      let d: unknown;
      if (Object.hasOwn(overrides, cell)) d = overrides[cell];
      else if (Object.hasOwn(overrides, id)) d = overrides[id];
      else if (fromDef !== undefined) d = fromDef;
      else d = DEFAULTS.dists[id];
      if (d === null || d === undefined) continue;
      out.set(cell, validateDist(d, cell));
    }
  }
  return out;
}

/** Correlation groups as cells of `correlatedVar`; checks members, ρ and that groups are disjoint. */
function resolveGroups(
  model: SolverModel,
  params: MonteCarloParams,
  sampled: ReadonlyMap<CellKey, MonteCarloDist>,
): { cells: CellKey[]; rho: number }[] {
  const given = params.correlation;
  const members = new Set((model.members[DEFAULTS.correlatedDim] ?? []).map((m) => m.id));
  const seen = new Set<string>();
  const out: { cells: CellKey[]; rho: number }[] = [];
  for (const g of given ?? DEFAULTS.correlation) {
    if (!finite(g.rho) || g.rho < 0 || g.rho > 1) throw bad(`correlation: rho ${g.rho} outside [0, 1] (one-factor copula)`);
    const cells: CellKey[] = [];
    for (const lever of g.levers) {
      if (!members.has(lever)) {
        if (given === undefined) continue; // a default family member this tenant does not have
        throw bad(`correlation: ${lever} is not a ${DEFAULTS.correlatedDim} member`);
      }
      if (seen.has(lever)) throw bad(`correlation: ${lever} is in more than one group`);
      seen.add(lever);
      const cell = `${DEFAULTS.correlatedVar}[${lever}]`;
      if (sampled.has(cell)) cells.push(cell);
    }
    if (cells.length > 0) out.push({ cells, rho: g.rho });
  }
  return out;
}

/** Draws every sampled input cell `size` times with `seed` (04 §4). */
export function drawMonteCarlo(model: SolverModel, params: MonteCarloParams, seed: number): MonteCarloDraws {
  const size = params.iterations ?? DEFAULTS.iterations;
  if (!isCount(size)) throw bad(`iterations ${String(size)} is not a positive integer`);
  if (!Number.isSafeInteger(seed) || seed < 0) throw bad(`seed ${seed} is not a non-negative integer`);

  const { base } = model;
  const dists = resolveDists(model, params);
  const groups = resolveGroups(model, params, dists);
  const vars = new Map(model.bundle.variables.map((v) => [v.id, v]));

  // Correlated cell → (group factor draws, ρ).
  const coupled = new Map<CellKey, { factor: Float64Array; rho: number }>();
  for (const g of groups) {
    const s = new Stream(seed, `group:${[...g.cells].sort().join(',')}`);
    const factor = new Float64Array(size);
    for (let i = 0; i < size; i++) factor[i] = normInv(s.uniform());
    for (const cell of g.cells) coupled.set(cell, { factor, rho: g.rho });
  }

  const cells = new Map<CellKey, Float64Array>();
  for (const [cell, dist] of dists) {
    const u = new Stream(seed, `cell:${cell}`).uniforms(size);
    const c = coupled.get(cell);
    if (c !== undefined) {
      const a = Math.sqrt(c.rho);
      const b = Math.sqrt(1 - c.rho);
      for (let i = 0; i < size; i++) u[i] = normCdf(a * c.factor[i]! + b * normInv(u[i]!));
    }

    const start = base.get(cell);
    const { id, member } = splitCell(cell);
    const v = vars.get(id)!;
    const out = new Float64Array(size);
    if (dist.type === 'confidence_beta') {
      const confCell = member === undefined ? dist.confidence : `${dist.confidence}[${member}]`;
      if (!base.has(confCell)) throw new SolverError('BAD_MODEL', `monte_carlo: ${cell} needs ${confCell}`);
      const conf = Math.min(Math.max(base.get(confCell) / dist.scale, 0), 1);
      const a = dist.concentration * conf;
      const b = dist.concentration * (1 - conf);
      for (let i = 0; i < size; i++) out[i] = dist.scale * betaInv(u[i]!, a, b);
    } else {
      let cum: Float64Array | undefined;
      if (dist.type === 'discrete') {
        cum = new Float64Array(dist.values.length);
        let t = 0;
        dist.values.forEach((_, k) => {
          t += dist.weights?.[k] ?? 1;
          cum![k] = t;
        });
      }
      const basis = dist.basis ?? 'absolute';
      for (let i = 0; i < size; i++) {
        const d = inverse(dist, u[i]!, cum);
        out[i] = basis === 'relative' ? start * d : basis === 'shift' ? start + d : d;
      }
    }
    for (let i = 0; i < size; i++) {
      let x = out[i]!;
      if (v.type === 'int') x = Math.round(x);
      if (v.min !== null && x < v.min) x = v.min;
      if (v.max !== null && x > v.max) x = v.max;
      out[i] = x;
    }
    cells.set(cell, out);
  }
  return { seed, size, cells, dists, groups };
}
