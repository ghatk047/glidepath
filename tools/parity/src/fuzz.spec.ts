/**
 * ENG-10 acceptance (G4): `pnpm parity:fuzz` as CI runs it, on both tenants (`aa`, `zz`), one run shared
 * by the tests below.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileModel } from '@glidepath/engine';
import { readTenantSeed } from '@glidepath/spec/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PY_ERROR_CODES } from './fuzz-compare';
import { FUZZ_TENANTS, runFuzz, type FuzzResult, type TenantFuzzReport } from './fuzz';
import { EDGE_VECTORS, UNIFORM_VECTORS } from './fuzz-vectors';
import { EXIT_OK } from './gate';
import { loadParityInputs, paths, repoRoot } from './load';

/** G4 budget: the whole job in under 5 minutes. */
const BUDGET_MS = 5 * 60 * 1000;

const dir = mkdtempSync(join(tmpdir(), 'parity-fuzz-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let result: FuzzResult;
let elapsedMs = 0;
const lines: string[] = [];
beforeAll(async () => {
  const started = performance.now();
  result = await runFuzz({ out: dir, log: (l) => lines.push(l) });
  elapsedMs = performance.now() - started;
}, BUDGET_MS);

const tenant = (id: string): TenantFuzzReport =>
  result.report.tenants.find((t) => t.tenant === id)!;

describe('G4 fuzz parity against docs/spec/reference/engine.py', () => {
  it('200 seeded vectors per tenant (aa, zz) within registry min/max, stepped for integers, match engine.py on every node cell within 1e-6 rel / 1e-9 abs', async () => {
    expect(result.exitCode, lines.join('\n')).toBe(EXIT_OK);
    expect(result.report.tenants.map((t) => t.tenant)).toEqual(['aa', 'zz']);
    expect(result.report.tolerance).toEqual({ rel: 1e-6, abs: 1e-9 });
    const { bundle } = await loadParityInputs();
    for (const id of Object.keys(FUZZ_TENANTS)) {
      const t = tenant(id);
      const model = compileModel(
        bundle,
        (await readTenantSeed(FUZZ_TENANTS[id]!)).dimensionMembers,
      );
      // Every node cell of the tenant's graph, in both engines, in the same topological order.
      expect([t.cells, t.onlyPython, t.onlyTs, t.orderEqual]).toEqual([
        model.program.nCells,
        [],
        [],
        true,
      ]);
      expect(t.sets.uniform).toMatchObject({ total: UNIFORM_VECTORS, miss: 0, raiseMismatch: 0 });
      const uniform = t.vectors.filter((v) => v.set === 'uniform');
      expect(uniform.filter((v) => v.status !== 'ok').map((v) => `${v.index} ${v.status}`)).toEqual(
        [],
      );
      expect(uniform.every((v) => v.cells === t.cells)).toBe(true);
      expect(t.compared).toBe(t.vectors.filter((v) => v.status === 'ok').length * t.cells);
      // Measured at ENG-10: bitwise equal on every value (the tolerance is slack, not budget).
      expect(t.bitEqual).toBe(t.compared);
      expect(t.pass).toBe(true);
    }
    // The vectors are those of PORTING.md §6 (bounds and grid: fuzz-vectors.spec.ts); the seed is recorded.
    const report = JSON.parse(readFileSync(result.reportFile, 'utf8'));
    expect(report.seed).toBe(result.report.seed);
    expect(report.tenants[0].vectors).toHaveLength(UNIFORM_VECTORS + EDGE_VECTORS);
    expect(Object.keys(report.tenants[0].vectors[0])).toEqual(
      expect.arrayContaining([
        'set',
        'index',
        'kind',
        'preset',
        'status',
        'cells',
        'bitEqual',
        'worst',
      ]),
    );
  });

  it('vectors that make engine.py raise raise in TS too, with the matching code and cell, and vice versa', () => {
    for (const id of Object.keys(FUZZ_TENANTS)) {
      const t = tenant(id);
      expect(t.sets.edge).toMatchObject({ total: EDGE_VECTORS, miss: 0, raiseMismatch: 0 });
      // The edge vectors do make the reference raise (a divisor at 0), on both tenants.
      expect(t.sets.edge.raised, id).toBeGreaterThan(0);
      const raisedRows = t.vectors.filter((v) => v.status === 'raised');
      for (const v of raisedRows) {
        expect(v.python!.cell, `${id} ${v.set} #${v.index}`).toBe(v.ts!.cell);
        expect(PY_ERROR_CODES.run[v.python!.type]).toContain(v.ts!.code);
      }
      // No vector raised in only one engine (both directions are checked per vector by compareVector;
      // fuzz-oracle.spec.ts shows a TS-only raise being caught).
      expect(t.vectors.filter((v) => v.status === 'raise-mismatch')).toEqual([]);
    }
  });

  it('runs in under 5 minutes and is enabled in CI nightly and on engine PRs', () => {
    expect(elapsedMs).toBeLessThan(BUDGET_MS);
    expect(result.report.elapsedMs).toBeLessThan(BUDGET_MS);

    // The root script is real, so the job's placeholder probe lets it run.
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    const script: string = pkg.scripts['parity:fuzz'];
    expect(script).toBe('tsx tools/parity/src/fuzz-cli.ts');
    expect(script).not.toMatch(/not implemented yet/);

    const ci = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toMatch(/^ {2}schedule:\n {4}- cron: /m);
    const job = /^ {2}parity-fuzz:\n((?: {4}.*\n|\n)+)/m.exec(ci)?.[1] ?? '';
    expect(job).toContain('name: G4 Fuzz parity');
    expect(job).toMatch(
      /if: github\.event_name == 'schedule' \|\| .*needs\.changes\.outputs\.engine == 'true'/,
    );
    expect(job).toContain('run: pnpm parity:fuzz');
    expect(job).toMatch(/timeout-minutes: \d+/);
    // "engine PRs": the engine filter covers the engine, the spec it evaluates and this harness.
    const engine = /out engine '([^']+)'/.exec(ci)?.[1] ?? '';
    for (const path of ['tier2-logic/engine/', 'docs/spec/', 'tools/parity/']) {
      expect(new RegExp(engine).test(path), path).toBe(true);
    }
    expect(paths.fuzzOracle).toBe(join(repoRoot, 'tools', 'parity', 'fuzz_ref.py'));
  });
});
