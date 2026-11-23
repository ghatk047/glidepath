/**
 * The fuzz oracle (fuzz_ref.py) and the CLI: the float cast of PORTING.md D4, input errors raised in
 * both engines (and a TS-only raise caught), and the exit codes of `pnpm parity:fuzz`.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileModel, type ModelBundle } from '@glidepath/engine';
import { afterAll, describe, expect, it } from 'vitest';
import { compareVector, decode } from './fuzz-compare';
import { evaluateVector, runOracle, type OracleVector } from './fuzz';
import { EXIT_ERROR, EXIT_MISS, EXIT_OK } from './gate';
import { loadParityInputs, paths, repoRoot } from './load';

const dir = mkdtempSync(join(tmpdir(), 'parity-oracle-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PYTHON = 'python3';
const CLI = join(repoRoot, 'tools', 'parity', 'src', 'fuzz-cli.ts');
/** One CLI run on a few vectors of the small tenant: seconds, not the full gate. */
const CLI_TIMEOUT_MS = 60_000;
/** One python process on a handful of vectors (under a second idle; more on a busy runner). */
const ORACLE_TIMEOUT_MS = 30_000;

/** Writes `files` (name → JSON text, verbatim so integers stay integers) into a new folder. */
function folder(name: string, files: Record<string, string>): string {
  const d = join(dir, name);
  mkdirSync(d, { recursive: true });
  for (const [f, text] of Object.entries(files)) writeFileSync(join(d, f), text);
  return d;
}

/**
 * A toy model where JSON integers matter: `v` and `w` sum a float followed by integers (CPython sum()
 * compensates only float terms), and `-x`, `-y`, `-z` negate an integer 0 (Python int 0, TS -0). `v` and
 * `x` come from the tenant values, `w` and `z` from the preset, `y` from the drawn vector.
 */
const TOY_VARIABLES = ['v', 'w', 'x', 'y', 'z'].map((id) => ({
  id,
  dims: 'vw'.includes(id) ? ['d'] : [],
}));
const TOY_NODES = [
  { id: 'sv', dims: [], expr: 'SUM(i in d, v)' },
  { id: 'sw', dims: [], expr: 'SUM(i in d, w)' },
  { id: 'nx', dims: [], expr: '-x' },
  { id: 'ny', dims: [], expr: '-y' },
  { id: 'nz', dims: [], expr: '-z' },
];
const MIXED = '{"a": 0.5, "b": 10000000000000000, "c": 1}';
const toySpec = folder('toy-spec', {
  'variables.json': JSON.stringify({ variables: TOY_VARIABLES }),
  'formula_graph.json': JSON.stringify({ nodes: TOY_NODES }),
});
const toyValues = `{"v": ${MIXED}, "w": {"a": 1.5, "b": 2, "c": 3}, "x": 0, "y": 1, "z": 1}`;
const toyScenarios = `{"scenarios": [{"id": "S", "values": {"w": ${MIXED}, "z": 0}, "overrides": {}}]}`;
const toySeed = folder('toy-seed', {
  'dimension_members.json': '{"d": [{"id": "a"}, {"id": "b"}, {"id": "c"}]}',
  'variable_values.json': toyValues,
  'scenarios.json': toyScenarios,
});
const toyVector: OracleVector = { preset: 'S', values: { y: 0 } };

describe('fuzz oracle', () => {
  it(
    'casts tenant, preset and drawn values to float (D4): engine.py then equals TS bitwise; uncast it does not',
    { timeout: ORACLE_TIMEOUT_MS },
    async () => {
      const oracle = await runOracle({ specDir: toySpec, seedDir: toySeed, dir, name: 'toy' }, [
        toyVector,
      ]);
      expect(oracle.order).toEqual(['sv', 'sw', 'nx', 'ny', 'nz']);
      const py = oracle.results[0]!.values!.map(decode);
      // Neumaier over floats: 0.5 + 1e16 + 1 = 1e16 + 2 (the nearest double); -0.0 for every negated 0.
      expect(py).toEqual([1e16 + 2, 1e16 + 2, -0, -0, -0]);

      const bundle = {
        variables: TOY_VARIABLES,
        nodes: TOY_NODES,
        dimensions: [],
      } as unknown as ModelBundle;
      const tenant = {
        variableValues: JSON.parse(toyValues),
        scenarios: JSON.parse(toyScenarios),
      };
      const model = compileModel(bundle, { d: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
      const c = compareVector(
        oracle.order,
        oracle.results[0]!,
        evaluateVector(model, bundle, tenant, toyVector),
      );
      expect(c).toMatchObject({ status: 'ok', cells: 5, bitEqual: 5 });

      // The residual the cast removes, from the unchanged engine.py run on the same JSON.
      const raw = spawnSync(
        PYTHON,
        [
          '-I',
          '-c',
          [
            'import importlib.util, json, sys',
            `s = importlib.util.spec_from_file_location("engine", ${JSON.stringify(join(paths.spec, 'reference', 'engine.py'))})`,
            'e = importlib.util.module_from_spec(s); s.loader.exec_module(e)',
            `r = e.Model(${JSON.stringify(toySpec)}, ${JSON.stringify(toySeed)}).run("S", {"values": {"y": 0}})`,
            'print(json.dumps([repr(r[k]) for k in ["sv", "sw", "nx", "ny", "nz"]]))',
          ].join('\n'),
        ],
        { encoding: 'utf8' },
      );
      expect(raw.status, raw.stderr).toBe(0);
      expect(JSON.parse(raw.stdout)).toEqual(['1e+16', '1e+16', '0', '0', '0']);
    },
  );

  it(
    'input errors raise in both engines (KeyError, ValueError, StopIteration -> BAD_INPUT); a TS-only raise is a mismatch',
    { timeout: ORACLE_TIMEOUT_MS },
    async () => {
      const { bundle, seed } = await loadParityInputs();
      const model = compileModel(bundle, seed.dimensionMembers);
      const vectors: OracleVector[] = [
        { preset: 'C', values: { 'no.such_variable': 1 } },
        { preset: 'C', values: { 'lev.on': 1 } },
        { preset: 'no_such_preset', values: {} },
        // D7: a dict for a scalar variable. engine.py keeps the last entry, TS rejects it.
        { preset: 'C', values: { 'hc.us': { x: 3000 } } },
      ];
      const oracle = await runOracle(
        { specDir: paths.spec, seedDir: paths.seed, dir, name: 'inputs' },
        vectors,
      );
      const rows = vectors.map((v, i) =>
        compareVector(oracle.order, oracle.results[i]!, evaluateVector(model, bundle, seed, v)),
      );
      expect(rows.map((r) => [r.status, r.python?.type, r.python?.cell, r.ts?.code])).toEqual([
        ['raised', 'KeyError', null, 'BAD_INPUT'],
        ['raised', 'ValueError', null, 'BAD_INPUT'],
        ['raised', 'StopIteration', null, 'BAD_INPUT'],
        ['raise-mismatch', undefined, undefined, 'BAD_INPUT'],
      ]);
      expect(rows[3]!.reason).toBe('TS raised BAD_INPUT, engine.py did not');
    },
  );

  it(
    'the CLI exits 0 when every value matches, 1 on a miss, 2 when the oracle cannot run',
    { timeout: CLI_TIMEOUT_MS },
    () => {
      const cli = (...args: string[]) =>
        spawnSync(
          process.execPath,
          ['--import', 'tsx', CLI, '--tenant', 'zz', '--vectors', '4', '--edge', '2', ...args],
          {
            encoding: 'utf8',
          },
        );

      const ok = cli('--out', join(dir, 'cli-ok'));
      expect(ok.status, ok.stderr).toBe(EXIT_OK);
      expect(ok.stdout).toMatch(/^fuzz zz: uniform 4\/4 .* edge 2\/2 /m);
      const report = JSON.parse(readFileSync(join(dir, 'cli-ok', 'fuzz-report.json'), 'utf8'));
      expect(report.tenants.map((t: { tenant: string }) => t.tenant)).toEqual(['zz']);

      // An oracle that moves one value of vector 0 by 1e-5 relative.
      const tamper = folder('tamper', {
        'tamper.py': [
          'import json, runpy, sys',
          `ORACLE = ${JSON.stringify(paths.fuzzOracle)}`,
          'out = sys.argv[4]',
          'sys.argv = [ORACLE] + sys.argv[1:]',
          'try:',
          '    runpy.run_path(ORACLE, run_name="__main__")',
          'except SystemExit as e:',
          '    if e.code: raise',
          'd = json.load(open(out))',
          'v = d["results"][0]["values"]',
          'i = next(i for i, x in enumerate(v) if isinstance(x, float) and x != 0)',
          'v[i] *= 1 + 1e-5',
          'json.dump(d, open(out, "w"))',
        ].join('\n'),
      });
      const miss = cli('--out', join(dir, 'cli-miss'), '--oracle', join(tamper, 'tamper.py'));
      expect(miss.status, miss.stderr).toBe(EXIT_MISS);
      expect(miss.stdout).toMatch(/^MISS fuzz zz uniform #0 \S+: ts .* python .* rel /m);
      expect(miss.stdout).toMatch(/^fuzz zz: uniform 3\/4 /m);

      const broken = cli('--out', join(dir, 'cli-broken'), '--python', join(dir, 'no-such-python'));
      expect(broken.status).toBe(EXIT_ERROR);
      expect(broken.stderr).toContain('cannot run');
      expect(cli('--vectors', 'many').status).toBe(EXIT_ERROR);
    },
  );
});
