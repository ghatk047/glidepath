import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT_MISS, EXIT_OK, runGate } from './gate';
import { paths, readJson } from './load';
import type { GoldenFile } from './golden';

const dir = mkdtempSync(join(tmpdir(), 'parity-gate-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface ReportJson {
  summary: { total: number; passed: number; failed: number };
  rows: Record<string, unknown>[];
}
const readReport = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as ReportJson;

/** golden_results.json with `res.net` of preset C moved by 0.01. */
async function tamperedGolden(): Promise<string> {
  const golden = await readJson<GoldenFile & { scenarios: Record<string, Record<string, number>> }>(
    paths.golden,
  );
  golden.scenarios.C!['res.net']! += 0.01;
  const file = join(dir, 'golden_results.json');
  writeFileSync(file, JSON.stringify(golden));
  return file;
}

describe('pnpm parity:golden', () => {
  it('writes out/golden-report.json with per-value diffs; non-zero exit on any miss', async () => {
    const lines: string[] = [];
    const ok = await runGate({ out: join(dir, 'ok'), log: (l) => lines.push(l) });
    expect(ok.exitCode).toBe(EXIT_OK);
    expect(lines).toContain('golden 760/760, replay 245/245');
    const report = readReport(join(dir, 'ok', 'golden-report.json'));
    expect(report.summary).toEqual({ total: 760, passed: 760, failed: 0 });
    expect(Object.keys(report.rows[0]!)).toEqual(
      expect.arrayContaining(['scenario', 'key', 'ts', 'rounded', 'golden', 'diff', 'pass']),
    );
    expect(readReport(join(dir, 'ok', 'replay-report.json')).summary.passed).toBe(245);

    const miss = await runGate({
      golden: await tamperedGolden(),
      out: join(dir, 'miss'),
      log: () => {},
    });
    expect(miss.exitCode).toBe(EXIT_MISS);
    const bad = readReport(join(dir, 'miss', 'golden-report.json'));
    expect(bad.summary).toEqual({ total: 760, passed: 759, failed: 1 });
    const row = bad.rows.find((r) => r.pass === false)!;
    expect([row.scenario, row.key]).toEqual(['C', 'res.net']);
    expect(Math.abs(row.diff as number)).toBeCloseTo(0.01, 9);
  });

  it('the CLI process exits non-zero on a miss', async () => {
    const cli = join(paths.out, '..', 'src', 'cli.ts');
    const golden = await tamperedGolden();
    const res = spawnSync(
      process.execPath,
      ['--import', 'tsx', cli, '--golden', golden, '--out', join(dir, 'cli')],
      { encoding: 'utf8' },
    );
    expect(res.status, res.stderr).toBe(EXIT_MISS);
    expect(res.stdout).toContain('MISS golden C res.net');
    expect(res.stdout).toContain('golden 759/760, replay 245/245');
  });
});
