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
  log(`golden ${golden.passed}/${golden.total}, replay ${replay.passed}/${replay.total}`);
  log(`reports: ${join(out, 'golden-report.json')}, ${join(out, 'replay-report.json')}`);

  const ok = golden.total > 0 && golden.failed === 0 && replay.total > 0 && replay.failed === 0;
  return { exitCode: ok ? EXIT_OK : EXIT_MISS, golden, replay };
}
