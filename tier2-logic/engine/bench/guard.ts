/**
 * G8 budget guard (docs/architecture/03 §5, 08 §1): compares `vitest bench --outputJson` reports with
 * the committed `baseline.json`. A bench fails when its statistic (the median, robust to GC pauses;
 * best of up to `runs` bench runs, so one run slowed by a noisy neighbour does not fail CI) exceeds its
 * absolute budget, or exceeds the baseline by more than the tolerance (+30%). Pure: the CLI
 * (`guard-cli.ts`) does the IO.
 */

/** One bench in the committed baseline. `budgetMs` null: guarded against the baseline only. */
export interface BaselineBench {
  readonly budgetMs: number | null;
  readonly baselineMs: number;
}

export interface Baseline {
  readonly $comment?: string;
  /** The per-bench statistic compared, from the vitest report (`median`). */
  readonly statistic: BenchStatistic;
  /** Allowed slowdown vs `baselineMs` as a fraction: 0.3 fails at more than +30%. */
  readonly tolerance: number;
  /** Bench runs at most per check (and exactly per re-record); the guard keeps the best per bench. */
  readonly runs: number;
  /** Where the baseline was recorded (informational). */
  readonly recorded?: Readonly<Record<string, string | number>>;
  readonly benches: Readonly<Record<string, BaselineBench>>;
}

export const BENCH_STATISTICS = ['median', 'mean', 'p75', 'p99', 'min'] as const;
export type BenchStatistic = (typeof BENCH_STATISTICS)[number];

/** The slice of vitest's `--outputJson` report the guard reads. */
export interface BenchReport {
  readonly files: ReadonlyArray<{
    readonly groups: ReadonlyArray<{
      readonly benchmarks: ReadonlyArray<
        { readonly name: string } & Partial<Record<BenchStatistic, number>>
      >;
    }>;
  }>;
}

export type Verdict = 'ok' | 'over-budget' | 'regression' | 'missing' | 'no-baseline';

export interface GuardRow {
  readonly name: string;
  readonly ms: number | null;
  readonly budgetMs: number | null;
  readonly baselineMs: number | null;
  /** `ms / baselineMs - 1`, null without both. */
  readonly delta: number | null;
  readonly verdict: Verdict;
}

export interface GuardResult {
  readonly ok: boolean;
  readonly rows: readonly GuardRow[];
}

/** Bench name → statistic in ms, over one or more runs. */
export type Measured = ReadonlyMap<string, number>;

/** Bench name → the chosen statistic, in ms. Throws on a malformed report or a duplicate name. */
export function readReport(report: BenchReport, statistic: BenchStatistic): Map<string, number> {
  if (!Array.isArray(report?.files))
    throw new Error('bench report: no `files` array (vitest --outputJson)');
  const out = new Map<string, number>();
  for (const file of report.files) {
    for (const group of file.groups ?? []) {
      for (const b of group.benchmarks ?? []) {
        const v = b[statistic];
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new Error(`bench report: ${b.name} has no finite ${statistic}`);
        }
        if (out.has(b.name)) throw new Error(`bench report: duplicate bench ${b.name}`);
        out.set(b.name, v);
      }
    }
  }
  return out;
}

/**
 * Best of several runs: per bench, the lowest statistic over the reports. A real regression is slow in
 * every run; a run slowed by a noisy neighbour is not. A bench missing from any run is left out.
 */
export function bestOf(
  reports: readonly BenchReport[],
  statistic: BenchStatistic,
): Map<string, number> {
  const runs = reports.map((r) => readReport(r, statistic));
  const out = new Map<string, number>();
  for (const [name] of runs[0] ?? []) {
    const all = runs.map((m) => m.get(name));
    if (all.every((v): v is number => v !== undefined)) out.set(name, Math.min(...all));
  }
  return out;
}

/** Validates a parsed baseline file; throws with the first problem. */
export function parseBaseline(raw: unknown): Baseline {
  const b = raw as Baseline;
  if (b === null || typeof b !== 'object') throw new Error('baseline: not an object');
  if (!BENCH_STATISTICS.includes(b.statistic))
    throw new Error(`baseline: unknown statistic ${String(b.statistic)}`);
  if (typeof b.tolerance !== 'number' || !(b.tolerance > 0))
    throw new Error('baseline: tolerance must be > 0');
  if (!(Number.isInteger(b.runs) && b.runs >= 1))
    throw new Error('baseline: runs must be an integer >= 1');
  if (b.benches === null || typeof b.benches !== 'object') throw new Error('baseline: no benches');
  for (const [name, e] of Object.entries(b.benches)) {
    if (!(typeof e.baselineMs === 'number' && e.baselineMs > 0)) {
      throw new Error(`baseline: ${name}.baselineMs must be > 0`);
    }
    if (e.budgetMs !== null && !(typeof e.budgetMs === 'number' && e.budgetMs > 0)) {
      throw new Error(`baseline: ${name}.budgetMs must be > 0 or null`);
    }
  }
  return b;
}

/**
 * Every baseline bench must be measured, within its budget and within `tolerance` of its baseline;
 * a measured bench the baseline does not know fails too (record it with `bench:baseline`).
 */
export function checkBench(measured: Measured, baseline: Baseline): GuardResult {
  const rows: GuardRow[] = [];
  for (const [name, e] of Object.entries(baseline.benches)) {
    const ms = measured.get(name);
    if (ms === undefined) {
      rows.push({
        name,
        ms: null,
        budgetMs: e.budgetMs,
        baselineMs: e.baselineMs,
        delta: null,
        verdict: 'missing',
      });
      continue;
    }
    const delta = ms / e.baselineMs - 1;
    const verdict: Verdict =
      e.budgetMs !== null && ms > e.budgetMs
        ? 'over-budget'
        : delta > baseline.tolerance
          ? 'regression'
          : 'ok';
    rows.push({ name, ms, budgetMs: e.budgetMs, baselineMs: e.baselineMs, delta, verdict });
  }
  for (const [name, ms] of measured) {
    if (name in baseline.benches) continue;
    rows.push({ name, ms, budgetMs: null, baselineMs: null, delta: null, verdict: 'no-baseline' });
  }
  return { ok: rows.every((r) => r.verdict === 'ok'), rows };
}

/**
 * A new baseline from measurements: budgets, statistic and tolerance kept, `baselineMs` replaced, benches
 * not measured dropped, new benches added without a budget. Refuses measurements over any budget.
 */
export function rebaseline(
  measured: Measured,
  baseline: Baseline,
  recorded: Readonly<Record<string, string | number>>,
): Baseline {
  const benches: Record<string, BaselineBench> = {};
  for (const [name, ms] of measured) {
    const budgetMs = baseline.benches[name]?.budgetMs ?? null;
    if (budgetMs !== null && ms > budgetMs) {
      throw new Error(
        `cannot record a baseline over budget: ${name} ${fmtMs(ms)} > ${fmtMs(budgetMs)}`,
      );
    }
    benches[name] = { budgetMs, baselineMs: roundMs(ms) };
  }
  return { ...baseline, recorded, benches };
}

/** A fixed-width table of the rows, then one line per failure. */
export function formatResult(result: GuardResult, baseline: Baseline): string {
  const head = ['bench', baseline.statistic, 'budget', 'baseline', 'delta', 'verdict'];
  const body = result.rows.map((r) => [
    r.name,
    r.ms === null ? '-' : fmtMs(r.ms),
    r.budgetMs === null ? '-' : fmtMs(r.budgetMs),
    r.baselineMs === null ? '-' : fmtMs(r.baselineMs),
    r.delta === null ? '-' : pct(r.delta),
    r.verdict,
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i]!.length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]!))
      .join('  ')
      .trimEnd();
  const tol = `+${Math.round(baseline.tolerance * PERCENT)}%`;
  const why: Record<Exclude<Verdict, 'ok'>, (r: GuardRow) => string> = {
    'over-budget': (r) => `${r.name}: ${fmtMs(r.ms!)} is over its budget ${fmtMs(r.budgetMs!)}`,
    regression: (r) =>
      `${r.name}: ${fmtMs(r.ms!)} is more than ${tol} over its baseline ${fmtMs(r.baselineMs!)}`,
    missing: (r) => `${r.name}: in the baseline but not in the bench report`,
    'no-baseline': (r) =>
      `${r.name}: no baseline; record one with \`pnpm --filter ./tier2-logic/engine bench:baseline\``,
  };
  const failures = result.rows.flatMap((r) =>
    r.verdict === 'ok' ? [] : [`FAIL ${why[r.verdict](r)}`],
  );
  const verdict = result.ok
    ? `G8 perf budget: ok (${baseline.statistic}, tolerance ${tol})`
    : 'G8 perf budget: FAILED';
  return [line(head), ...body.map(line), '', ...failures, verdict].join('\n');
}

const MS_PER_S = 1000;
const US_PER_MS = 1000;
const PERCENT = 100;
const S_DIGITS = 2;
const MS_DIGITS = 3;

function fmtMs(ms: number): string {
  return ms >= MS_PER_S ? `${(ms / MS_PER_S).toFixed(S_DIGITS)} s` : `${ms.toFixed(MS_DIGITS)} ms`;
}

function pct(fraction: number): string {
  return `${fraction >= 0 ? '+' : ''}${(fraction * PERCENT).toFixed(1)}%`;
}

/** Baseline values keep microsecond precision. */
function roundMs(ms: number): number {
  return Math.round(ms * US_PER_MS) / US_PER_MS;
}
