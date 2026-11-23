/**
 * SOL-11 acceptance (G5):
 *  1. `pnpm test:solvers` runs the G5 cases of SOL-03..07 against the AA seed and writes
 *     out/solver-report.json.
 *  2. The CI job `solvers` is enabled for solver PRs and nightly (its probe finds a real script).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT_MISS, EXIT_OK } from './gate';
import { paths, readJson, repoRoot } from './load';
import {
  MC_SEEDS,
  runSolverGate,
  solverDemoPath,
  SOLVER_ITEMS,
  type SolverDemoFile,
  type SolverGateResult,
  type SolverReport,
} from './solvers-gate';

const dir = mkdtempSync(join(tmpdir(), 'parity-solvers-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const readReport = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as SolverReport;

let ok: SolverGateResult;
const lines: string[] = [];
beforeAll(async () => {
  ok = await runSolverGate({ out: join(dir, 'ok'), log: (l) => lines.push(l) });
}, 300_000);

describe('SOL-11 acceptance 1: pnpm test:solvers writes tools/parity/out/solver-report.json', () => {
  it('runs the G5 cases of SOL-03..07 on the seed tenant, writes solver-report.json and exits 0', () => {
    expect(ok.exitCode, lines.join('\n')).toBe(EXIT_OK);
    const report = readReport(join(dir, 'ok', 'solver-report.json'));
    expect(report.summary.failed).toBe(0);
    expect(report.summary.total).toBe(report.rows.length);
    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.seed).toEqual({ tenant: 'aa', mcSeeds: [...MC_SEEDS] });
    // Every item contributes cases, and each row says what it compared.
    for (const item of SOLVER_ITEMS) {
      expect(report.items[item].total, item).toBeGreaterThan(0);
      expect(report.items[item].failed, item).toBe(0);
    }
    expect(Object.keys(report.rows[0]!)).toEqual(
      expect.arrayContaining(['item', 'case', 'metric', 'actual', 'expected', 'mode', 'pass']),
    );
    // The G5 headlines of 08 §1 are among the compared values.
    const has = (c: string, m: string) => report.rows.some((r) => r.case === c && r.metric === m && r.pass);
    expect(has('min_risk_total_bar', 'risk_exposure')).toBe(true);
    expect(has('min_risk_total_and_vp_bars/vp_feasible', 'res.net')).toBe(true);
    expect(has('monte_carlo_C', 'P(clear bar) (seed 1)')).toBe(true);
    expect(has('monte_carlo_D', 'P(clear bar) (seed 1)')).toBe(true);
  });

  it('exits 1 with the miss in the report when a reference value moves (tolerances are not loosened)', async () => {
    const ref = await readJson<SolverDemoFile>(solverDemoPath);
    ref.min_risk_total_and_vp_bars.net += 1; // 1 $M off the all-VP plan: outside the 0.5 tolerance
    const file = join(dir, 'solver_demo_results.json');
    writeFileSync(file, JSON.stringify(ref));
    const miss = await runSolverGate({ reference: file, out: join(dir, 'miss'), log: () => {} });
    expect(miss.exitCode).toBe(EXIT_MISS);
    const bad = readReport(join(dir, 'miss', 'solver-report.json'));
    expect(bad.summary.failed).toBeGreaterThan(0);
    const failed = bad.rows.filter((r) => !r.pass);
    expect(failed.every((r) => r.item === 'SOL-05'), JSON.stringify(failed[0])).toBe(true);
    expect(failed.some((r) => r.metric === 'res.net')).toBe(true);
  }, 300_000);

  it('the root script test:solvers is the runner', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['test:solvers']).toBe('tsx tools/parity/src/solvers-cli.ts');
    expect(paths.out).toBe(join(repoRoot, 'tools', 'parity', 'out'));
  });
});

describe('SOL-11 acceptance 2: CI job solvers is enabled for solver PRs and nightly', () => {
  interface Step {
    id?: string;
    name?: string;
    run?: string;
    if?: string;
  }
  interface Job {
    name: string;
    if?: string;
    steps: Step[];
  }
  const { parse } = createRequire(join(repoRoot, 'ops', 'package.json'))('yaml') as {
    parse: (s: string) => { jobs: Record<string, Job> };
  };
  const wf = parse(readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8'));
  const job = wf.jobs.solvers!;

  it('runs `pnpm test:solvers`, and the probe finds the script, so the job is no longer skipped', () => {
    expect(job.name).toMatch(/^G5 /);
    const probe = job.steps.find((s: Step) => s.id === 'probe')!;
    expect(probe.run).toContain("scripts['test:solvers']");
    const run = job.steps.find((s: Step) => s.name === 'Run G5 Solver acceptance')!;
    expect(run.run).toBe('pnpm test:solvers');
    expect(run.if).toBe("steps.probe.outputs.ready == 'true'");

    // Execute the probe's node check against this repository's package.json.
    const check = /node -e "([^"]+)"/.exec(probe.run!)![1]!;
    const r = spawnSync('node', ['-e', check], { cwd: repoRoot });
    expect(r.status, 'probe exits 0 (ready=true)').toBe(0);
  });

  it('is selected for nightly and manual runs and for solver, engine and parity-tool changes', () => {
    expect(job.if).toContain("'schedule'");
    expect(job.if).toContain("'workflow_dispatch'");
    expect(job.if).toContain("needs.changes.outputs.solvers == 'true'");
    const run = wf.jobs.changes!.steps.find((s: Step) => s.id === 'paths')!.run!;
    const line = run.split('\n').find((l) => l.includes('out solvers'))!;
    const re = new RegExp(/'(\^\(.*\))'/.exec(line)![1]!);
    for (const f of [
      'tier2-logic/solvers/src/min-risk.ts',
      'tier2-logic/engine/src/index.ts',
      'tools/parity/src/solvers-gate.ts',
      'docs/spec/reference/solver_demo_results.json',
    ]) {
      expect(re.test(f), f).toBe(true);
    }
    expect(re.test('tier2-logic/excel/src/index.ts')).toBe(false);
  });
});
