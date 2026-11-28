// SRC-09 · F7 should-cost benchmarks: unit cost against P25 / median / P75, gap, opportunity, headroom.
import type { Member, TenantMembers } from '@glidepath/spec';
import { engineCell } from '../views/read';
import type { ViewEvaluation } from '../views/types';
import { SOURCING_CELLS, counted } from './lines';
import { SOURCING_PARAM_KEYS as K, SourcingDataError, requiredNum, str, strings } from './params';
import type { SourcingParamsLookup } from './params';
import { fraction } from './vendor-spend';
import type { BenchmarkGapView, BenchmarkPercentile, BenchmarkRow, SourcingLine } from './types';

/** US dollars in the model's money unit ($M). A unit conversion: benchmarks are $ per unit. */
export const USD_PER_MUSD = 1_000_000;

/** `target_percentile` value -> the benchmark attribute it reads (the parameter steps 25 / 50 / 75). */
export const PERCENTILES: ReadonlyMap<number, { key: BenchmarkPercentile; attr: string }> = new Map([
  [25, { key: 'p25', attr: 'p25_usd' }],
  [50, { key: 'median', attr: 'median_usd' }],
  [75, { key: 'p75', attr: 'p75_usd' }],
]);

/**
 * Run-rate savings the scenario's levers take on each pool: the sum over `lever` members of
 * `lev.eff[lever, pool]` (signed: a lever that adds cost to a pool, such as L06's tooling on software,
 * counts against it). Run-rate, the same annual basis as a benchmark opportunity.
 */
export function poolLeverSavings(ev: ViewEvaluation, members: TenantMembers): Map<string, number> {
  const out = new Map<string, number>();
  for (const pool of members['pool'] ?? []) {
    let s = 0;
    for (const lever of members['lever'] ?? []) {
      const cell = engineCell(SOURCING_CELLS.leverPoolSaving, `${lever.id},${pool.id}`);
      if (ev.has(cell)) s += ev.get(cell);
    }
    out.set(pool.id, s);
  }
  return out;
}

/**
 * The should-cost gap of every benchmarked line (each `benchmark` member's `lines`, in scope and not memo,
 * with a positive quantity): unit cost = `line.amount` / qty in $ per unit (the line's own rate, on the
 * basis of `line.unit_cost_usd`), against the percentile the `target_percentile` parameter picks.
 *
 * - gapPerUnit = max(0, unitCost - benchmark): a line at or below the benchmark contributes nothing.
 * - opportunity = gapPerUnit x qty, $M; capturable = opportunity x `capture_pct`.
 * - leverSavings = the part of the scenario's lever savings that falls on the benchmarked lines: each pool's
 *   run-rate lever saving (`poolLeverSavings`, the sum of `lev.eff[lever, pool]`) is spread over the pool's
 *   counted lines in proportion to their outlay, and the shares of the benchmarked lines (each line once) are
 *   added up. headroom = capturable - leverSavings (negative when the levers already go further than the
 *   benchmark on those lines).
 *
 * Rows are sorted by opportunity, descending (then benchmark, line).
 */
export function benchmarkGap(args: {
  scenarioId: string;
  benchmarks: readonly Member[];
  lines: readonly SourcingLine[];
  params: SourcingParamsLookup;
  /** Run-rate lever savings by pool, $M (`poolLeverSavings`). */
  leverSavingsByPool: ReadonlyMap<string, number>;
}): BenchmarkGapView {
  const pct = args.params.value(K.targetPercentile);
  const chosen = PERCENTILES.get(pct);
  if (!chosen) {
    throw new SourcingDataError(`sourcing_param ${K.targetPercentile} must be one of ${[...PERCENTILES.keys()].join(', ')}, got ${pct}`);
  }
  const capture = fraction(args.params.value(K.capturePct));
  const lines = new Map(args.lines.map((l) => [l.id, l]));

  const rows: BenchmarkRow[] = [];
  for (const b of args.benchmarks) {
    const p25 = requiredNum(b, 'p25_usd', 'benchmark');
    const median = requiredNum(b, 'median_usd', 'benchmark');
    const p75 = requiredNum(b, 'p75_usd', 'benchmark');
    const target = { p25, median, p75 }[chosen.key];
    for (const id of strings(b['lines'])) {
      const l = lines.get(id);
      if (!l || !counted(l) || !(l.qty > 0)) continue;
      const unitCost = (l.amount * USD_PER_MUSD) / l.qty;
      const gapPerUnit = Math.max(0, unitCost - target);
      const opportunity = (gapPerUnit * l.qty) / USD_PER_MUSD;
      rows.push({
        benchmark: b.id,
        line: l.id,
        label: l.label,
        pool: l.pool,
        unit: str(b, 'unit') || l.unit,
        qty: l.qty,
        unitCost,
        p25,
        median,
        p75,
        percentile: chosen.key,
        gapPerUnit,
        opportunity,
        capturable: opportunity * capture,
      });
    }
  }
  rows.sort((a, b) => b.opportunity - a.opportunity || cmp(a.benchmark, b.benchmark) || cmp(a.line, b.line));

  const opportunity = rows.reduce((s, r) => s + r.opportunity, 0);
  const capturable = rows.reduce((s, r) => s + r.capturable, 0);
  const poolOutlay = new Map<string, number>();
  for (const l of args.lines) if (counted(l)) poolOutlay.set(l.pool, (poolOutlay.get(l.pool) ?? 0) + l.outlay);
  let leverSavings = 0;
  for (const id of new Set(rows.map((r) => r.line))) {
    const l = lines.get(id)!;
    const total = poolOutlay.get(l.pool) ?? 0;
    if (total > 0) leverSavings += ((args.leverSavingsByPool.get(l.pool) ?? 0) * l.outlay) / total;
  }
  return {
    scenarioId: args.scenarioId,
    rows,
    totals: { opportunity, capturable, leverSavings, headroom: capturable - leverSavings },
  };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
