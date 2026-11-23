/**
 * G8 guard CLI (ENG-11). `pnpm bench --filter=./tier2-logic/engine` runs `guard-cli.ts run`.
 *
 *   guard-cli run [--update] [--baseline <file>]   run `vitest bench` up to `runs` times and check
 *   guard-cli check <report.json>... [--baseline <file>]   check existing vitest --outputJson reports
 *
 * `run` stops at the first run that passes; otherwise it keeps the best statistic per bench over the
 * runs. `--update` runs exactly `runs` times and rewrites the baseline (budgets kept).
 * Exit 0: every bench within budget and within tolerance of the baseline. 1: a bench failed. 2: bad input.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bestOf,
  checkBench,
  formatResult,
  parseBaseline,
  rebaseline,
  type Baseline,
  type BenchReport,
} from './guard';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, '..');
const resultsDir = resolve(here, '.results');
const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_BAD_INPUT = 2;
const JSON_INDENT = 2;
/** argv[0] is node, argv[1] the script. */
const ARGV_USER_START = 2;
/** An option and its value. */
const OPTION_WITH_VALUE = 2;
const ISO_DATE = 'yyyy-mm-dd'.length;

function main(argv: readonly string[]): number {
  const args = [...argv];
  const command = args.shift();
  const update = takeFlag(args, '--update');
  const baselinePath = resolve(takeOption(args, '--baseline') ?? resolve(here, 'baseline.json'));
  const baseline = parseBaseline(readJson(baselinePath));

  if (command === 'check' && args.length > 0 && !update) {
    return report(
      checkBench(
        bestOf(
          args.map((f) => readJson(resolve(f)) as BenchReport),
          baseline.statistic,
        ),
        baseline,
      ),
      baseline,
    );
  }
  if (command !== 'run' || args.length > 0) {
    console.error(
      'usage: guard-cli run [--update] [--baseline <file>] | guard-cli check <report.json>... [--baseline <file>]',
    );
    return EXIT_BAD_INPUT;
  }

  mkdirSync(resultsDir, { recursive: true });
  const reports: BenchReport[] = [];
  for (let i = 1; i <= baseline.runs; i++) {
    reports.push(runVitestBench(i));
    if (update) continue;
    const result = checkBench(bestOf(reports, baseline.statistic), baseline);
    if (result.ok || i === baseline.runs) return report(result, baseline, i);
    console.log(
      `G8 run ${i}/${baseline.runs} not within budget/baseline; running again (best of runs counts)`,
    );
  }

  const next = rebaseline(bestOf(reports, baseline.statistic), baseline, {
    date: new Date().toISOString().slice(0, ISO_DATE),
    node: process.version,
    platform: `${platform()}-${arch()}`,
    cpus: cpus().length,
  });
  writeFileSync(baselinePath, `${JSON.stringify(next, null, JSON_INDENT)}\n`);
  console.log(`baseline written (best of ${baseline.runs} runs): ${baselinePath}`);
  return report(checkBench(bestOf(reports, next.statistic), next), next);
}

function runVitestBench(i: number): BenchReport {
  const out = resolve(resultsDir, `run-${i}.json`);
  const r = spawnSync('vitest', ['bench', '--run', '--outputJson', out], {
    cwd: pkgDir,
    stdio: 'inherit',
  });
  if (r.error !== undefined) throw r.error;
  if (r.status !== 0) throw new Error(`vitest bench exited with ${r.status ?? r.signal}`);
  return readJson(out) as BenchReport;
}

function report(result: ReturnType<typeof checkBench>, baseline: Baseline, runs?: number): number {
  const text = formatResult(result, baseline) + (runs === undefined ? '' : ` [${runs} run(s)]`);
  (result.ok ? console.log : console.error)(text);
  return result.ok ? EXIT_OK : EXIT_FAILED;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function takeFlag(args: string[], flag: string): boolean {
  const i = args.indexOf(flag);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
}

function takeOption(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const [, value] = args.splice(i, OPTION_WITH_VALUE);
  if (value === undefined) throw new Error(`${name} needs a value`);
  return value;
}

try {
  process.exitCode = main(process.argv.slice(ARGV_USER_START));
} catch (e) {
  console.error(`G8 guard: ${(e as Error).message}`);
  process.exitCode = EXIT_BAD_INPUT;
}
