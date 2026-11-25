/**
 * `monte_carlo` (SOL-06, 04 §4): seeded draws of the uncertain inputs evaluated on the batch engine, in
 * batches of lanes so a cancel lands between them. Returns P10/P50/P90 and histograms of the outputs,
 * P(clear bar), P(clear target ignoring growth), P(clear) per VP and the variance contribution of each
 * lever (Spearman rank correlation of its realisation with the net). Moves nothing; the seed is returned.
 */
import type { CellKey } from '@glidepath/engine';
import { SolverError } from '../../errors';
import type { ProblemSolver, SolverRun } from '../../run';
import type { MonteCarloParams, SolverDetailMap, SolverOutcome } from '../../types';
import { MONTE_CARLO_DEFAULTS as DEFAULTS } from './defaults';
import { drawMonteCarlo, splitCell, type MonteCarloDraws } from './draw';
import { histogram, percentile, spearman } from './stats';

export { MONTE_CARLO_DEFAULTS } from './defaults';
export type { MonteCarloDefaults, ProbabilityDef } from './defaults';
export { drawMonteCarlo, resolveDists, validateDist } from './draw';
export type { MonteCarloDraws } from './draw';

type Detail = SolverDetailMap['monte_carlo'];

const P10 = 10;
const P50 = 50;
const P90 = 90;

const bad = (message: string): SolverError => new SolverError('BAD_PARAMS', `monte_carlo: ${message}`);

interface Plan {
  readonly outputs: readonly CellKey[];
  readonly probabilities: readonly { readonly metric: string; readonly cell: CellKey; readonly against: CellKey }[];
  readonly contributionTo: CellKey | undefined;
  readonly tracked: readonly CellKey[];
  readonly bins: number;
}

function plan(run: SolverRun<'monte_carlo'>, params: MonteCarloParams): Plan {
  const { base, members } = run.model;
  const outputs = params.outputs ?? DEFAULTS.outputs.filter((c) => base.has(c));
  for (const c of outputs) if (!base.has(c)) throw bad(`output ${c} is not a cell of the model`);
  const bins = params.bins ?? DEFAULTS.bins;
  if (!Number.isSafeInteger(bins) || bins < 1) throw bad(`bins ${bins} is not a positive integer`);

  const pm = DEFAULTS.perMember;
  const probabilities = [
    ...DEFAULTS.probabilities,
    ...(members[pm.dim] ?? []).map((m) => ({
      metric: `${pm.metric}[${m.id}]`,
      cell: `${pm.cell}[${m.id}]`,
      against: `${pm.against}[${m.id}]`,
    })),
  ].filter((p) => base.has(p.cell) && base.has(p.against));
  const contributionTo = base.has(DEFAULTS.contributionTo) ? DEFAULTS.contributionTo : undefined;
  const tracked = [
    ...new Set([...outputs, ...probabilities.flatMap((p) => [p.cell, p.against]), ...(contributionTo ? [contributionTo] : [])]),
  ];
  return { outputs, probabilities, contributionTo, tracked, bins };
}

/** Statistics over the first `done` lanes, skipping failed ones. */
function summarise(
  draws: MonteCarloDraws,
  p: Plan,
  lanes: ReadonlyMap<CellKey, Float64Array>,
  failed: Uint8Array,
  done: number,
): SolverOutcome<'monte_carlo'> {
  const valid: number[] = [];
  for (let i = 0; i < done; i++) if (failed[i] === 0) valid.push(i);
  const n = valid.length;
  const pick = (cell: CellKey): Float64Array => {
    const all = lanes.get(cell)!;
    const out = new Float64Array(n);
    for (let k = 0; k < n; k++) out[k] = all[valid[k]!]!;
    return out;
  };

  const metrics: Record<string, number> = { draws: n, failed: done - n };
  const percentiles: Detail['percentiles'][number][] = [];
  const histograms: Detail['histograms'][number][] = [];
  for (const cell of p.outputs) {
    const sorted = pick(cell).sort();
    const row = { cell, p10: percentile(sorted, P10), p50: percentile(sorted, P50), p90: percentile(sorted, P90) };
    percentiles.push(row);
    metrics[`${cell}.p10`] = row.p10;
    metrics[`${cell}.p50`] = row.p50;
    metrics[`${cell}.p90`] = row.p90;
    histograms.push({ cell, bins: histogram(sorted, p.bins) });
  }

  const probabilities: Detail['probabilities'][number][] = [];
  for (const pr of p.probabilities) {
    const x = pick(pr.cell);
    const y = pick(pr.against);
    let hits = 0;
    for (let k = 0; k < n; k++) if (x[k]! >= y[k]!) hits++;
    const prob = n === 0 ? 0 : hits / n;
    probabilities.push({ cell: pr.cell, against: pr.against, p: prob });
    metrics[pr.metric] = prob;
  }

  const contributions: { lever: string; share: number; rho: number }[] = [];
  if (p.contributionTo !== undefined) {
    const y = pick(p.contributionTo);
    for (const [cell, all] of draws.cells) {
      const { id, member } = splitCell(cell);
      if (id !== DEFAULTS.correlatedVar || member === undefined) continue;
      const x = new Float64Array(n);
      for (let k = 0; k < n; k++) x[k] = all[valid[k]!]!;
      contributions.push({ lever: member, share: 0, rho: spearman(x, y) });
    }
    const total = contributions.reduce((s, c) => s + c.rho * c.rho, 0);
    for (const c of contributions) c.share = total > 0 ? (c.rho * c.rho) / total : 0;
    contributions.sort((a, b) => b.share - a.share || a.lever.localeCompare(b.lever));
  }

  return {
    status: 'feasible',
    changes: [],
    metrics,
    seed: draws.seed,
    detail: { iterations: done, seed: draws.seed, percentiles, probabilities, histograms, contributions },
  };
}

/** The `monte_carlo` problem: `monteCarlo(params, seed)` with the seed in `params.seed` (default: seeded). */
export const monteCarlo: ProblemSolver<'monte_carlo'> = async (run, params) => {
  const seed = params.seed ?? DEFAULTS.seed;
  const draws = drawMonteCarlo(run.model, params, seed);
  const p = plan(run, params);
  const batchSize = params.batchSize ?? DEFAULTS.batchSize;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw bad(`batchSize ${batchSize} is not a positive integer`);

  const { base } = run.model;
  const N = draws.size;
  const lanes = new Map<CellKey, Float64Array>(p.tracked.map((c) => [c, new Float64Array(N)]));
  const failed = new Uint8Array(N);
  let firstError: unknown;

  for (let start = 0; start < N; start += batchSize) {
    const end = Math.min(N, start + batchSize);
    const values = new Map<CellKey, Float64Array>();
    for (const [cell, all] of draws.cells) values.set(cell, all.subarray(start, end));
    const res = await run.evaluateBatch({ size: end - start, values });
    for (const cell of p.tracked) {
      const out = lanes.get(cell)!;
      const got = res.values.get(cell) ?? draws.cells.get(cell)?.subarray(start, end);
      if (got !== undefined) out.set(got, start);
      else out.fill(base.get(cell), start, end);
    }
    failed.set(res.failed, start);
    firstError ??= res.errors.values().next().value;
    run.progress(end / N, `${end}/${N}`);
    run.partial(summarise(draws, p, lanes, failed, end));
  }

  if (failed.every((f) => f === 1) && firstError !== undefined) throw firstError;
  return summarise(draws, p, lanes, failed, N);
};
