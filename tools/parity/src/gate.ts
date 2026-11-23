/**
 * `pnpm parity:golden` (G3): golden 760/760 and the parity replay 245/245 on the seed tenant. Writes
 * `out/golden-report.json` and `out/replay-report.json` (per-value diffs); exit code 1 on any miss.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runGolden, type GoldenReport } from './golden';
import { loadParityInputs, paths } from './load';
import { runReplay, type ReplayReport } from './replay';
import { Runner } from './runs';

export const EXIT_OK = 0;
export const EXIT_MISS = 1;
export const EXIT_ERROR = 2;
/** Failing rows printed to the console (all of them are in the reports). */
const SHOWN_MISSES = 20;
/**
 * Values the gate must compare (PORTING.md §6 headings, checked against the reference files by the
 * engine's porting-harness.spec.ts): a golden or report file that lost entries must fail, not pass with
 * fewer comparisons.
 */
export const EXPECTED_TOTALS = { golden: 760, replay: 245 } as const;

export interface GateOptions {
  /** golden_results.json to compare against (default: docs/spec/reference). */
  readonly golden?: string;
  /** parity_report.json to replay (default: docs/spec/reference). */
  readonly parityReport?: string;
  /** Report folder (default: tools/parity/out). */
  readonly out?: string;
  readonly log?: (line: string) => void;
}

export interface GateResult {
  readonly exitCode: number;
  readonly golden: GoldenReport;
  readonly replay: ReplayReport;
}

const summary = (r: { total: number; passed: number; failed: number }) => ({
  total: r.total,
  passed: r.passed,
  failed: r.failed,
});

export async function runGate(options: GateOptions = {}): Promise<GateResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const inputs = await loadParityInputs(options);
  const runner = new Runner(inputs.bundle, inputs.seed);
  const golden = runGolden(runner, inputs.golden);
  const replay = runReplay(runner, inputs.report);

  const out = options.out ?? paths.out;
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, 'golden-report.json'),
    `${JSON.stringify({ summary: summary(golden), rows: golden.rows }, null, 1)}\n`,
  );
  await writeFile(
    join(out, 'replay-report.json'),
    `${JSON.stringify({ summary: summary(replay), rows: replay.rows }, null, 1)}\n`,
  );

  for (const r of golden.rows.filter((x) => !x.pass).slice(0, SHOWN_MISSES)) {
    log(
      `MISS golden ${r.scenario} ${r.key} (${r.cell}): ts ${r.ts} rounded ${r.rounded} golden ${r.golden}`,
    );
  }
  for (const r of replay.rows.filter((x) => !x.pass).slice(0, SHOWN_MISSES)) {
    log(
      `MISS replay ${r.rule} ${r.check} [${r.run}]: ts ${r.ts} rounded ${r.rounded} engine ${r.engine}`,
    );
  }
  const totals = { golden: golden.total, replay: replay.total };
  for (const kind of ['golden', 'replay'] as const) {
    if (totals[kind] !== EXPECTED_TOTALS[kind]) {
      log(`MISS ${kind} total: ${totals[kind]} values compared, expected ${EXPECTED_TOTALS[kind]}`);
    }
  }
  log(`golden ${golden.passed}/${golden.total}, replay ${replay.passed}/${replay.total}`);
  log(`reports: ${join(out, 'golden-report.json')}, ${join(out, 'replay-report.json')}`);

  const ok =
    golden.total === EXPECTED_TOTALS.golden &&
    golden.failed === 0 &&
    replay.total === EXPECTED_TOTALS.replay &&
    replay.failed === 0;
  return { exitCode: ok ? EXIT_OK : EXIT_MISS, golden, replay };
}
