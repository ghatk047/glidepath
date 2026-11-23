/**
 * `pnpm parity:fuzz` (G4, ENG-10; PORTING.md §6 Fuzz): per tenant (`aa`, the reference seed, and `zz`,
 * the synthetic one), draws seeded vectors within the registry bounds, runs them through the unchanged
 * docs/spec/reference/engine.py (`fuzz_ref.py`, stdlib only) and through the TS engine, and compares every
 * node cell (1e-6 relative / 1e-9 absolute) and every raise (raises in TS ⇔ raises in Python, same code
 * class and cell). Writes `out/fuzz-report.json` (seed, per-vector status, worst diffs); exit code 1 on any
 * miss, 2 when the harness itself fails (no python3, oracle crash).
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileModel, findScenario, resolveInputs, type EngineModel } from '@glidepath/engine';
import type { ModelBundle, TenantSeed } from '@glidepath/spec';
import { loadModelBundleFromDir, readTenantSeed } from '@glidepath/spec/node';
import {
  compareVector,
  outcome,
  worse,
  type CellDiff,
  type OracleFile,
  type TsOutcome,
  type VectorComparison,
} from './fuzz-compare';
import {
  DEFAULT_FUZZ_SEED,
  drawVectors,
  EDGE_VECTORS,
  UNIFORM_VECTORS,
  type FuzzVector,
  type VectorSet,
} from './fuzz-vectors';
import { EXIT_MISS, EXIT_OK } from './gate';
import { paths } from './load';
import { GOLDEN_ABS, GOLDEN_REL } from './round';

/** Tenants of the fuzz gate: id → seed directory. */
export const FUZZ_TENANTS: Readonly<Record<string, string>> = {
  aa: paths.seed,
  zz: paths.zzSeed,
};
/** Rows printed to the console per kind of miss (all of them are in the report). */
const SHOWN_MISSES = 20;
/** Worst cell diffs kept in the report per tenant. */
const WORST_KEPT = 20;
/** The edge set draws from its own stream: seed + this. */
const EDGE_SEED_OFFSET = 1;
const DEFAULT_PYTHON = 'python3';

export interface FuzzOptions {
  /** Tenant ids of FUZZ_TENANTS (default: all). */
  readonly tenants?: readonly string[];
  readonly seed?: number;
  /** Uniform vectors per tenant (default 200, G4). */
  readonly vectors?: number;
  /** Edge vectors per tenant (default 100). */
  readonly edge?: number;
  /** Report folder (default tools/parity/out). */
  readonly out?: string;
  /** Python interpreter (default `python3`; CPython >= 3.12). */
  readonly python?: string;
  /** Oracle script (default tools/parity/fuzz_ref.py). */
  readonly oracle?: string;
  readonly log?: (line: string) => void;
}

export interface SetSummary {
  readonly total: number;
  readonly ok: number;
  readonly raised: number;
  readonly miss: number;
  readonly raiseMismatch: number;
  /** Raising vectors by `<python class> -> <TS code>`. */
  readonly raisedBy: Readonly<Record<string, number>>;
}

export interface VectorRow extends Omit<VectorComparison, 'misses' | 'worst'> {
  readonly set: VectorSet;
  readonly index: number;
  readonly kind: FuzzVector['kind'];
  readonly preset: string;
  /** Variables re-drawn. */
  readonly drawn: number;
  readonly misses: readonly CellDiff[];
  readonly worst: CellDiff | null;
}

export interface TenantFuzzReport {
  readonly tenant: string;
  readonly seedDir: string;
  /** Node cells per vector (Model.order). */
  readonly cells: number;
  /** Node cells only one engine has (must both be empty). */
  readonly onlyPython: readonly string[];
  readonly onlyTs: readonly string[];
  /** Model.order equals the TS topological order. */
  readonly orderEqual: boolean;
  readonly expected: Readonly<Record<VectorSet, number>>;
  readonly sets: Readonly<Record<VectorSet, SetSummary>>;
  /** Values compared and how many are bitwise equal. */
  readonly compared: number;
  readonly bitEqual: number;
  readonly worst: readonly (CellDiff & { readonly set: VectorSet; readonly index: number })[];
  readonly vectors: readonly VectorRow[];
  readonly pass: boolean;
}

export interface FuzzReport {
  readonly seed: number;
  readonly edgeSeed: number;
  readonly python: string;
  readonly tolerance: { readonly rel: number; readonly abs: number };
  readonly elapsedMs: number;
  readonly tenants: readonly TenantFuzzReport[];
  readonly pass: boolean;
}

export interface FuzzResult {
  readonly exitCode: number;
  readonly report: FuzzReport;
  readonly reportFile: string;
}

/** Runs `python -I <args>`; rejects with its stderr on a non-zero exit or a spawn failure. */
function spawnPython(python: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (s: string) => (stderr += s));
    child.on('error', (e) => reject(new Error(`fuzz: cannot run ${python}: ${e.message}`)));
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`fuzz: oracle exited with ${code}: ${stderr.trim()}`)),
    );
  });
}

/** What the oracle needs of a vector. */
export type OracleVector = Pick<FuzzVector, 'preset' | 'values'>;

export interface OracleRun {
  /** Spec folder (`variables.json`, `formula_graph.json`). */
  readonly specDir: string;
  /** Tenant seed folder. */
  readonly seedDir: string;
  /** Folder for `<name>-vectors.json` and `<name>-oracle.json`. */
  readonly dir: string;
  readonly name: string;
  readonly python?: string;
  readonly oracle?: string;
}

/** Writes the vectors, runs fuzz_ref.py on them and reads its output (one result per vector). */
export async function runOracle(
  run: OracleRun,
  vectors: readonly OracleVector[],
): Promise<OracleFile> {
  await mkdir(run.dir, { recursive: true });
  const vectorsFile = join(run.dir, `${run.name}-vectors.json`);
  const oracleFile = join(run.dir, `${run.name}-oracle.json`);
  await writeFile(vectorsFile, JSON.stringify({ vectors }));
  await spawnPython(run.python ?? DEFAULT_PYTHON, [
    run.oracle ?? paths.fuzzOracle,
    run.specDir,
    run.seedDir,
    vectorsFile,
    oracleFile,
  ]);
  const oracle = JSON.parse(await readFile(oracleFile, 'utf8')) as OracleFile;
  if (oracle.results.length !== vectors.length) {
    throw new Error(
      `fuzz: oracle returned ${oracle.results.length} results for ${vectors.length} vectors`,
    );
  }
  return oracle;
}

/** The TS side of one vector: `evaluate(resolveInputs(tenant, preset, {values}))`. */
export function evaluateVector(
  model: Pick<EngineModel, 'evaluate'>,
  bundle: Pick<ModelBundle, 'variables'>,
  tenant: Pick<TenantSeed, 'variableValues' | 'scenarios'>,
  vector: OracleVector,
): TsOutcome {
  return outcome(() => {
    const scenario = findScenario(tenant.scenarios, vector.preset);
    const inputs = resolveInputs(bundle, tenant.variableValues, scenario, {
      values: vector.values,
    });
    return model.evaluate(inputs.values, inputs.overrides);
  });
}

function summarise(rows: readonly VectorRow[]): SetSummary {
  const raisedBy: Record<string, number> = {};
  for (const r of rows.filter((x) => x.status === 'raised')) {
    const key = `${r.python!.type} -> ${r.ts!.code}`;
    raisedBy[key] = (raisedBy[key] ?? 0) + 1;
  }
  const count = (s: VectorRow['status']) => rows.filter((r) => r.status === s).length;
  return {
    total: rows.length,
    ok: count('ok'),
    raised: count('raised'),
    miss: count('miss'),
    raiseMismatch: count('raise-mismatch'),
    raisedBy,
  };
}

interface TenantRun {
  readonly report: TenantFuzzReport;
  readonly python: string;
}

async function fuzzTenant(
  tenant: string,
  bundle: ModelBundle,
  options: Required<Omit<FuzzOptions, 'tenants' | 'log'>>,
): Promise<TenantRun> {
  const seedDir = FUZZ_TENANTS[tenant];
  if (seedDir === undefined) throw new Error(`fuzz: unknown tenant ${tenant}`);
  const seed: TenantSeed = await readTenantSeed(seedDir);
  const model: EngineModel = compileModel(bundle, seed.dimensionMembers);
  const vectors = [
    ...drawVectors(bundle, seed, { seed: options.seed, count: options.vectors, set: 'uniform' }),
    ...drawVectors(bundle, seed, {
      seed: options.seed + EDGE_SEED_OFFSET,
      count: options.edge,
      set: 'edge',
    }),
  ];
  const oracle = await runOracle(
    {
      specDir: paths.spec,
      seedDir,
      dir: join(options.out, 'fuzz'),
      name: tenant,
      python: options.python,
      oracle: options.oracle,
    },
    vectors,
  );

  const tsCells = model.program.cellKeys;
  const pyCells = new Set(oracle.order);
  const tsSet = new Set(tsCells);
  const onlyPython = oracle.order.filter((k) => !tsSet.has(k));
  const onlyTs = tsCells.filter((k) => !pyCells.has(k));
  const orderEqual =
    tsCells.length === oracle.order.length && tsCells.every((k, i) => k === oracle.order[i]);

  const rows: VectorRow[] = vectors.map((v, i) => {
    const c = compareVector(
      oracle.order,
      oracle.results[i]!,
      evaluateVector(model, bundle, seed, v),
    );
    return {
      ...c,
      set: v.set,
      index: v.index,
      kind: v.kind,
      preset: v.preset,
      drawn: Object.keys(v.values).length,
    };
  });

  const worst = rows
    .flatMap((r) => (r.worst ? [{ ...r.worst, set: r.set, index: r.index }] : []))
    .sort((a, b) => (worse(a, b) ? -1 : worse(b, a) ? 1 : 0))
    .slice(0, WORST_KEPT);
  const bySet = (s: VectorSet) => summarise(rows.filter((r) => r.set === s));
  const sets = { uniform: bySet('uniform'), edge: bySet('edge') };
  const expected = { uniform: options.vectors, edge: options.edge };
  const compared = rows.reduce((n, r) => n + r.cells, 0);
  const evaluated = rows.filter((r) => r.status === 'ok' || r.status === 'miss').length;
  const pass =
    onlyPython.length === 0 &&
    onlyTs.length === 0 &&
    oracle.order.length > 0 &&
    sets.uniform.total === expected.uniform &&
    sets.edge.total === expected.edge &&
    compared === evaluated * oracle.order.length &&
    rows.every((r) => r.status === 'ok' || r.status === 'raised');
  return {
    python: oracle.python,
    report: {
      tenant,
      seedDir,
      cells: oracle.order.length,
      onlyPython,
      onlyTs,
      orderEqual,
      expected,
      sets,
      compared,
      bitEqual: rows.reduce((n, r) => n + r.bitEqual, 0),
      worst,
      vectors: rows,
      pass,
    },
  };
}

/** JSON with non-finite numbers as the strings `nan`, `inf`, `-inf` (as fuzz_ref.py writes them). */
function toJson(value: unknown): string {
  return `${JSON.stringify(
    value,
    (_k, v: unknown) =>
      typeof v === 'number' && !Number.isFinite(v)
        ? Number.isNaN(v)
          ? 'nan'
          : v > 0
            ? 'inf'
            : '-inf'
        : v,
    1,
  )}\n`;
}

function describeSet(s: SetSummary): string {
  const raised = Object.entries(s.raisedBy)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
  return `${s.ok + s.raised}/${s.total} (raised ${s.raised}${raised ? `: ${raised}` : ''})`;
}

function logTenant(r: TenantFuzzReport, log: (line: string) => void): void {
  for (const row of r.vectors.filter((x) => x.status === 'raise-mismatch').slice(0, SHOWN_MISSES)) {
    log(`MISS fuzz ${r.tenant} ${row.set} #${row.index} (${row.preset}): ${row.reason}`);
  }
  const cellMisses = r.vectors.flatMap((row) =>
    row.misses.map((d) => ({ ...d, set: row.set, index: row.index })),
  );
  for (const d of cellMisses.slice(0, SHOWN_MISSES)) {
    log(
      `MISS fuzz ${r.tenant} ${d.set} #${d.index} ${d.cell}: ts ${d.ts} python ${d.ref} rel ${d.rel}`,
    );
  }
  for (const k of r.onlyPython.slice(0, SHOWN_MISSES))
    log(`MISS fuzz ${r.tenant} cell only in engine.py: ${k}`);
  for (const k of r.onlyTs.slice(0, SHOWN_MISSES))
    log(`MISS fuzz ${r.tenant} cell only in TS: ${k}`);
  for (const s of ['uniform', 'edge'] as const) {
    if (r.sets[s].total !== r.expected[s]) {
      log(`MISS fuzz ${r.tenant} ${s}: ${r.sets[s].total} vectors, expected ${r.expected[s]}`);
    }
  }
  const worst = r.worst[0];
  log(
    `fuzz ${r.tenant}: uniform ${describeSet(r.sets.uniform)}, edge ${describeSet(r.sets.edge)}; ` +
      `${r.cells} node cells per vector, ${r.bitEqual}/${r.compared} values bitwise equal` +
      (worst ? `, worst rel ${worst.rel} (${worst.cell})` : ''),
  );
}

export async function runFuzz(options: FuzzOptions = {}): Promise<FuzzResult> {
  const started = performance.now();
  const log = options.log ?? ((line: string) => console.log(line));
  const resolved = {
    seed: options.seed ?? DEFAULT_FUZZ_SEED,
    vectors: options.vectors ?? UNIFORM_VECTORS,
    edge: options.edge ?? EDGE_VECTORS,
    out: options.out ?? paths.out,
    python: options.python ?? DEFAULT_PYTHON,
    oracle: options.oracle ?? paths.fuzzOracle,
  };
  const tenants = options.tenants ?? Object.keys(FUZZ_TENANTS);
  if (tenants.length === 0) throw new Error('fuzz: no tenant');
  const bundle = await loadModelBundleFromDir(paths.spec);
  // The oracles run in parallel, one python process per tenant.
  const runs = await Promise.all(tenants.map((t) => fuzzTenant(t, bundle, resolved)));
  const report: FuzzReport = {
    seed: resolved.seed,
    edgeSeed: resolved.seed + EDGE_SEED_OFFSET,
    python: runs[0]!.python,
    tolerance: { rel: GOLDEN_REL, abs: GOLDEN_ABS },
    elapsedMs: Math.round(performance.now() - started),
    tenants: runs.map((r) => r.report),
    pass: runs.every((r) => r.report.pass),
  };
  const reportFile = join(resolved.out, 'fuzz-report.json');
  await mkdir(resolved.out, { recursive: true });
  await writeFile(reportFile, toJson(report));
  for (const t of report.tenants) logTenant(t, log);
  log(
    `fuzz seed ${report.seed} (edge ${report.edgeSeed}), python ${report.python}, ${report.elapsedMs} ms`,
  );
  log(`report: ${reportFile}`);
  return { exitCode: report.pass ? EXIT_OK : EXIT_MISS, report, reportFile };
}
