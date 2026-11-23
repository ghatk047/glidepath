/**
 * ENG-11 (G8): the engine benches, their budgets (03 §5) and the +30% guard against the committed
 * baseline, exercised with synthetic bench reports.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bestOf,
  checkBench,
  formatResult,
  parseBaseline,
  readReport,
  rebaseline,
  type Baseline,
  type BenchReport,
} from './guard';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, '..');
const committed = parseBaseline(JSON.parse(readFileSync(resolve(here, 'baseline.json'), 'utf8')));

/** 03 §5: compile < 150 ms, full eval < 50 ms, one lever slider < 10 ms, batch 2,000 < 10 s. */
const BUDGETS_03_5: Record<string, number> = {
  'engine.compile': 150,
  'engine.evaluate': 50,
  'engine.rerun.lever': 10,
  'engine.batch.2000': 10_000,
};

/** A vitest `--outputJson` report with the given medians. */
function reportOf(medians: Record<string, number>): BenchReport {
  return {
    files: [
      {
        groups: [
          {
            benchmarks: Object.entries(medians).map(([name, median]) => ({
              name,
              median,
              mean: median * 1.1,
            })),
          },
        ],
      },
    ],
  };
}

/** Every committed bench at `factor` × its baseline, `name` (if given) at `slow` × instead. */
function scaled(factor: number, name?: string, slow?: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(committed.benches).map(([n, e]) => [
      n,
      e.baselineMs * (n === name ? slow! : factor),
    ]),
  );
}

const tmp = mkdtempSync(join(tmpdir(), 'eng-11-guard-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Runs the guard CLI (`check`) on a synthetic report, as CI would after `vitest bench`. */
function guardCli(medians: Record<string, number>, baseline?: Baseline) {
  const file = join(tmp, `report-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(reportOf(medians)));
  const args = ['--import', 'tsx', resolve(here, 'guard-cli.ts'), 'check', file];
  if (baseline !== undefined) {
    const b = join(tmp, `baseline-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(b, JSON.stringify(baseline));
    args.push('--baseline', b);
  }
  const r = spawnSync(process.execPath, args, { cwd: pkgDir, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('G8 engine benches [ENG-11]', () => {
  it('benches engine.compile, engine.evaluate, engine.rerun.lever, engine.batch.2000 with budgets 150 ms / 50 ms / 10 ms / 10 s (G8)', () => {
    const source = readFileSync(resolve(here, 'engine.bench.ts'), 'utf8');
    const benched = [...source.matchAll(/\bbench\(\s*'([^']+)'/g)].map((m) => m[1]);
    for (const [name, budgetMs] of Object.entries(BUDGETS_03_5)) {
      expect(benched, name).toContain(name);
      expect(committed.benches[name]?.budgetMs, name).toBe(budgetMs);
      expect(committed.benches[name]!.baselineMs, name).toBeLessThan(budgetMs);
    }
    // The baseline covers every bench, and nothing else.
    expect(Object.keys(committed.benches).sort()).toEqual([...benched].sort());
    expect(committed.statistic).toBe('median');
    expect(committed.tolerance).toBe(0.3);
    // `pnpm bench --filter=./tier2-logic/engine` (turbo `bench`) runs the benches through the guard.
    const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));
    expect(pkg.scripts.bench).toBe('tsx bench/guard-cli.ts run');
  });

  it('CI fails at +30% vs baseline (guard script with a synthetic slow result)', () => {
    const slow = guardCli(scaled(1, 'engine.rerun.lever', 1.31));
    expect(slow.status).toBe(1);
    expect(slow.out).toMatch(/FAIL engine\.rerun\.lever: .* more than \+30% over its baseline/);
    expect(slow.out).toContain('G8 perf budget: FAILED');

    const within = guardCli(scaled(1, 'engine.rerun.lever', 1.29));
    expect(within.status, within.out).toBe(0);
    expect(within.out).toContain('G8 perf budget: ok');

    // Every bench slower by more than 30% fails each of them.
    const allSlow = guardCli(scaled(1.35));
    expect(allSlow.status).toBe(1);
    for (const name of Object.keys(committed.benches))
      expect(allSlow.out).toContain(`FAIL ${name}:`);
  });

  it('fails a bench over its absolute budget even within tolerance of its baseline', () => {
    const near: Baseline = {
      ...committed,
      benches: { ...committed.benches, 'engine.compile': { budgetMs: 150, baselineMs: 140 } },
    };
    const r = guardCli({ ...scaled(1), 'engine.compile': 151 }, near);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/FAIL engine\.compile: 151\.000 ms is over its budget 150\.000 ms/);
  });

  it('fails a bench missing from the report and a bench without a baseline', () => {
    const rest = scaled(1);
    delete rest['engine.batch.2000'];
    const result = checkBench(
      readReport(reportOf({ ...rest, 'engine.new': 1 }), 'median'),
      committed,
    );
    expect(result.ok).toBe(false);
    expect(result.rows.find((r) => r.name === 'engine.batch.2000')?.verdict).toBe('missing');
    expect(result.rows.find((r) => r.name === 'engine.new')?.verdict).toBe('no-baseline');
    expect(formatResult(result, committed)).toContain('bench:baseline');
  });

  it('exits 2 on bad input', () => {
    const r = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve(here, 'guard-cli.ts'), 'check'],
      {
        cwd: pkgDir,
        encoding: 'utf8',
      },
    );
    expect(r.status).toBe(2);
    const bad = join(tmp, 'bad.json');
    writeFileSync(
      bad,
      JSON.stringify({ files: [{ groups: [{ benchmarks: [{ name: 'engine.compile' }] }] }] }),
    );
    const r2 = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve(here, 'guard-cli.ts'), 'check', bad],
      {
        cwd: pkgDir,
        encoding: 'utf8',
      },
    );
    expect(r2.status).toBe(2);
    expect(r2.stderr).toContain('engine.compile has no finite median');
  });

  it('takes the best run per bench, so one noisy run does not fail', () => {
    const noisy = reportOf(scaled(1, 'engine.evaluate', 1.6));
    const clean = reportOf(scaled(1.05));
    const best = bestOf([noisy, clean], 'median');
    expect(best.get('engine.evaluate')).toBeCloseTo(
      committed.benches['engine.evaluate']!.baselineMs * 1.05,
    );
    expect(checkBench(best, committed).ok).toBe(true);
    expect(checkBench(bestOf([noisy], 'median'), committed).ok).toBe(false);
    // A bench must be in every run to count.
    const partial = bestOf([reportOf({ a: 1, b: 2 }), reportOf({ a: 3 })], 'median');
    expect([...partial]).toEqual([['a', 1]]);
  });

  it('rebaseline keeps budgets, records new medians and refuses a run over budget', () => {
    const next = rebaseline(readReport(reportOf(scaled(0.5)), 'median'), committed, {
      node: 'v22',
    });
    expect(next.tolerance).toBe(committed.tolerance);
    expect(next.recorded).toEqual({ node: 'v22' });
    for (const [name, e] of Object.entries(committed.benches)) {
      expect(next.benches[name]?.budgetMs).toBe(e.budgetMs);
      expect(next.benches[name]?.baselineMs).toBeCloseTo(e.baselineMs * 0.5, 2);
    }
    expect(() => rebaseline(new Map([['engine.evaluate', 51]]), committed, {})).toThrow(
      /over budget/,
    );
    expect(
      rebaseline(new Map([['engine.other', 2]]), committed, {}).benches['engine.other'],
    ).toEqual({
      budgetMs: null,
      baselineMs: 2,
    });
  });

  it('rejects malformed baselines and reports', () => {
    expect(() => parseBaseline(null)).toThrow(/not an object/);
    expect(() => parseBaseline({ ...committed, statistic: 'p50' })).toThrow(/statistic/);
    expect(() => parseBaseline({ ...committed, tolerance: 0 })).toThrow(/tolerance/);
    expect(() => parseBaseline({ ...committed, runs: 0 })).toThrow(/runs/);
    expect(() =>
      parseBaseline({ ...committed, benches: { x: { budgetMs: 1, baselineMs: 0 } } }),
    ).toThrow(/baselineMs/);
    expect(() =>
      parseBaseline({ ...committed, benches: { x: { budgetMs: -1, baselineMs: 1 } } }),
    ).toThrow(/budgetMs/);
    expect(() => readReport({} as BenchReport, 'median')).toThrow(/files/);
    const twice = { files: [...reportOf({ a: 1 }).files, ...reportOf({ a: 2 }).files] };
    expect(() => readReport(twice, 'median')).toThrow(/duplicate/);
  });
});
