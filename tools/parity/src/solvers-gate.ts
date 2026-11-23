/**
 * `pnpm test:solvers` (G5, SOL-11): the acceptance cases of SOL-03 .. SOL-07 on the seed tenant (`aa`),
 * compared with `docs/spec/reference/solver_demo_results.json`. Writes `out/solver-report.json` (one row
 * per compared value: actual, expected, tolerance, diff) and exits 1 on any miss.
 *
 * The solvers are pure; this package loads the files. Tolerances are the acceptance tolerances of the
 * items (08 §1 G5: min-risk $143.0M / risk $42.0M, all-VP $148.1M, MC P(clear) ± 1.5 pp seeded), never
 * widened here to get green: a case that diverges from the reference is reported as a miss.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cellKey, compile, type CompiledModel, type Evaluation } from '@glidepath/engine';
import {
  blend,
  decisionSet,
  minRiskMix,
  riskExposure,
  runSolver,
  tornado,
  vpFeasible,
  type SolverModel,
  type SolverResult,
} from '@glidepath/solvers';
import { seedToTenantData, type ModelBundle, type TenantSeed } from '@glidepath/spec';
import { loadModelBundleFromDir, readTenantSeed } from '@glidepath/spec/node';
import { EXIT_MISS, EXIT_OK } from './gate';
import { paths, readJson, repoRoot } from './load';

/** Solver demo reference (docs/spec/reference/solver_demo_results.json). */
export const solverDemoPath = join(paths.spec, 'reference', 'solver_demo_results.json');
/** DEC/lo/hi of solvers_demo.py: the reference greedy's intensity bounds (SOL-04 test fixture). */
export const decFixturePath = join(repoRoot, 'tier2-logic', 'solvers', 'test', 'fixtures', 'dec.json');

/** Acceptance tolerances, as asserted by the item tests of SOL-03 .. SOL-07. */
export const TOLERANCES = {
  /** SOL-03: λ. */
  lambda: 0.001,
  /** SOL-03: VP gaps in $M. */
  vpGap: 0.01,
  /** Values the reference rounds to 2 decimals (half a unit in the last place). */
  cents: 0.005,
  /** SOL-03: EPS27 rounded to 4 digits. */
  eps: 0.00005,
  /** SOL-04/05: net, risk exposure and one-time IT in $M. */
  money: 0.5,
  /** SOL-04: FTE rounded half to even by the reference. */
  fte: 0.5,
  /** SOL-05: VP slack rounded to 2 decimals. */
  vpSlack: 0.005,
  /** SOL-05: a held constraint may be this far negative (FEASIBILITY_TOL of the solvers). */
  feasibility: 1e-6,
  /** SOL-06: P(clear) in probability points (± 1.5 pp). */
  pClear: 0.015,
  /** SOL-06: percentiles, relative (median over the seeded runs). */
  percentile: 0.05,
  /** SOL-07: swing in $M and net delta at min/max in $M. */
  swing: 0.1,
  netDelta: 0.01,
} as const;

/** SOL-06 G5: fixed seeds, 2,000 draws each (the TS RNG is not numpy's, so several samples). */
export const MC_SEEDS = [1, 2, 3, 4, 5] as const;
export const SOLVER_ITEMS = ['SOL-03', 'SOL-04', 'SOL-05', 'SOL-06', 'SOL-07'] as const;
export type SolverItem = (typeof SOLVER_ITEMS)[number];

export interface SolverRow {
  readonly item: SolverItem;
  readonly case: string;
  readonly metric: string;
  readonly actual: number | string | boolean | null;
  readonly expected: number | string | boolean | null;
  /** Tolerance (numbers); absent for exact checks. */
  readonly tolerance?: number;
  /** `abs` (|actual - expected| <= tol), `rel` (|actual / expected - 1| <= tol), `exact`, `gte` (actual >= bound - tol). */
  readonly mode: 'abs' | 'rel' | 'exact' | 'gte';
  readonly diff: number | null;
  readonly pass: boolean;
}

export interface Tally {
  total: number;
  passed: number;
  failed: number;
}

export interface SolverReport {
  readonly summary: Tally;
  readonly items: Record<SolverItem, Tally>;
  readonly seed: { tenant: 'aa'; mcSeeds: readonly number[] };
  readonly rows: readonly SolverRow[];
}

export interface SolverGateOptions {
  /** solver_demo_results.json to compare against (default: docs/spec/reference). */
  readonly reference?: string;
  /** Report folder (default: tools/parity/out). */
  readonly out?: string;
  readonly log?: (line: string) => void;
}

export interface SolverGateResult {
  readonly exitCode: number;
  readonly report: SolverReport;
}

// ---------------------------------------------------------------------------------------------------
// Reference file shape
// ---------------------------------------------------------------------------------------------------

interface BlendRef {
  lambda: number;
  net: number;
  bar: number;
  risk_adj_net: number;
  one_time_it: number;
  eps27: number;
  vp_gaps: Record<string, number>;
}
interface MixRef {
  steps: number;
  net: number;
  bar: number;
  risk_adj_net: number;
  risk_exposure: number;
  one_time_it: number;
  fte_us: number;
  fte_gcc: number;
  eps27: number;
  vp_gaps: Record<string, number>;
  inputs_moved_from_C: Record<string, { from: number; to: number }>;
}
interface TornadoRef {
  id: string;
  min: number;
  max: number;
  net_at_min: number;
  net_at_max: number;
  swing: number;
}
interface McRef {
  iterations: number;
  net_p10_p50_p90: number[];
  bar_p10_p50_p90: number[];
  prob_clear_bar: number;
  prob_clear_target_ignoring_growth: number;
  eps27_p10_p50_p90: number[];
  prob_vp_clears_bar: Record<string, number>;
}
export interface SolverDemoFile {
  goal_seek_blend_C_to_D: BlendRef;
  min_risk_total_bar: MixRef;
  min_risk_total_and_vp_bars: MixRef;
  min_risk_reference: { C_risk_exposure: number; D_risk_exposure: number };
  tornado_net_top15: TornadoRef[];
  monte_carlo_C: McRef;
  monte_carlo_D: McRef;
}

// ---------------------------------------------------------------------------------------------------
// Row collection
// ---------------------------------------------------------------------------------------------------

class Rows {
  constructor(
    private readonly item: SolverItem,
    private readonly caseId: string,
    private readonly sink: SolverRow[],
  ) {}

  private push(
    metric: string,
    actual: SolverRow['actual'],
    expected: SolverRow['expected'],
    mode: SolverRow['mode'],
    pass: boolean,
    diff: number | null,
    tolerance?: number,
  ): void {
    this.sink.push({
      item: this.item,
      case: this.caseId,
      metric,
      actual,
      expected,
      ...(tolerance !== undefined && { tolerance }),
      mode,
      diff,
      pass,
    });
  }

  abs(metric: string, actual: number, expected: number, tol: number): void {
    const diff = actual - expected;
    this.push(metric, actual, expected, 'abs', Number.isFinite(diff) && Math.abs(diff) <= tol, diff, tol);
  }

  rel(metric: string, actual: number, expected: number, tol: number): void {
    const diff = actual / expected - 1;
    this.push(metric, actual, expected, 'rel', Number.isFinite(diff) && Math.abs(diff) <= tol, diff, tol);
  }

  gte(metric: string, actual: number, bound: number, tol = 0): void {
    const diff = actual - bound;
    this.push(metric, actual, bound, 'gte', Number.isFinite(diff) && diff >= -tol, diff, tol);
  }

  exact(
    metric: string,
    actual: string | number | boolean | null,
    expected: string | number | boolean | null,
  ): void {
    this.push(metric, actual, expected, 'exact', actual === expected, null);
  }
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[(s.length - 1) / 2]!;
};

// ---------------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------------

interface Seeded {
  readonly bundle: ModelBundle;
  readonly seed: TenantSeed;
  readonly compiled: CompiledModel;
}

/** A solver model of the seed tenant started from preset `start`, stretch caps from C and D (04 §1). */
function modelAt(s: Seeded, start: string, scenarios = false): SolverModel {
  const data = seedToTenantData(s.seed, start, s.bundle);
  const resolved = (id: string) => seedToTenantData(s.seed, id, s.bundle).values;
  return {
    compiled: s.compiled,
    base: s.compiled.evaluate(data.values, data.overrides),
    bundle: s.bundle,
    members: data.members,
    stretch: [resolved('C'), resolved('D')],
    ...(scenarios && {
      scenarios: new Map([
        ['C', resolved('C')],
        ['D', resolved('D')],
      ]),
    }),
  };
}

/** Widens the intensity caps to the reference greedy's DEC bounds (SOL-04: "the user can widen it"). */
function withReferenceCaps(model: SolverModel, hi: Readonly<Record<string, number>>): SolverModel {
  const caps = new Map<string, number>();
  for (const d of decisionSet(model, 'lever_intensity')) {
    const cap = hi[d.cell];
    if (cap !== undefined && cap !== d.hi) caps.set(d.cell, cap);
  }
  return { ...model, caps };
}

const noYield = () => Promise.resolve();
const opts = { yield: noYield };

// ---------------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------------

/** SOL-03: blend C -> D solved for res.gap = 0 (goal_seek_blend_C_to_D). */
async function blendCase(s: Seeded, ref: SolverDemoFile, sink: SolverRow[]): Promise<void> {
  const r = new Rows('SOL-03', 'goal_seek_blend_C_to_D', sink);
  const want = ref.goal_seek_blend_C_to_D;
  const model = modelAt(s, 'C', true);
  const res = await blend(model, 'C', 'D', 0, opts);
  r.exact('status', res.status, 'optimal');
  r.abs('lambda', res.detail?.lambda ?? Number.NaN, want.lambda, TOLERANCES.lambda);
  const e = model.compiled.rerun(model.base, res.changes);
  r.abs('res.net', e.get('res.net'), want.net, TOLERANCES.cents);
  r.abs('res.bar', e.get('res.bar'), want.bar, TOLERANCES.cents);
  r.abs('res.risk', e.get('res.risk'), want.risk_adj_net, TOLERANCES.cents);
  r.abs('res.tot_ot_it', e.get('res.tot_ot_it'), want.one_time_it, TOLERANCES.cents);
  r.abs('br.eps27', e.get('br.eps27'), want.eps27, TOLERANCES.eps);
  for (const [vp, gap] of Object.entries(want.vp_gaps)) {
    r.abs(`vp.gap[${vp}]`, e.get(cellKey('vp.gap', [vp])), gap, TOLERANCES.vpGap);
  }
}

/** Moved set and from/to values against `inputs_moved_from_C`. */
function movedInputs(r: Rows, res: SolverResult, model: SolverModel, want: MixRef): void {
  const moved = new Map(res.changes.map((c) => [c.cell, c.value] as const));
  r.exact(
    'moved inputs equal reference set',
    sameSet([...moved.keys()], Object.keys(want.inputs_moved_from_C)),
    true,
  );
  let worst = 0;
  for (const [cell, { from, to }] of Object.entries(want.inputs_moved_from_C)) {
    worst = Math.max(
      worst,
      Math.abs(model.base.get(cell) - from),
      Math.abs((moved.get(cell) ?? Number.POSITIVE_INFINITY) - to),
    );
  }
  r.abs('moved inputs from/to, worst diff', worst, 0, 1e-9);
}

/** SOL-04: minimum-risk mix clears the total bar from C (min_risk_total_bar). */
async function minRiskCase(
  s: Seeded,
  ref: SolverDemoFile,
  hi: Readonly<Record<string, number>>,
  sink: SolverRow[],
): Promise<void> {
  const r = new Rows('SOL-04', 'min_risk_total_bar', sink);
  const want = ref.min_risk_total_bar;
  const model = withReferenceCaps(modelAt(s, 'C'), hi);
  r.abs(
    'risk_exposure[C]',
    riskExposure(model.base, model.members),
    ref.min_risk_reference.C_risk_exposure,
    TOLERANCES.cents,
  );
  const d = modelAt(s, 'D');
  r.abs(
    'risk_exposure[D]',
    riskExposure(d.base, d.members),
    ref.min_risk_reference.D_risk_exposure,
    TOLERANCES.cents,
  );

  const res = await minRiskMix(model, {}, opts);
  const e = model.compiled.rerun(model.base, res.changes);
  r.exact('status', res.status, 'feasible');
  r.gte('res.net - res.bar', e.get('res.net') - e.get('res.bar'), 0);
  r.abs('risk_exposure', riskExposure(e, model.members), want.risk_exposure, TOLERANCES.money);
  r.abs('res.tot_ot_it', e.get('res.tot_ot_it'), want.one_time_it, TOLERANCES.money);
  r.abs('res.fte_us', e.get('res.fte_us'), want.fte_us, TOLERANCES.fte);
  r.abs('res.fte_us - base', e.get('res.fte_us') - model.base.get('res.fte_us'), 0, 1e-9);
  r.abs('res.fte_gcc', e.get('res.fte_gcc'), want.fte_gcc, TOLERANCES.fte);
  r.abs('res.net', e.get('res.net'), want.net, TOLERANCES.cents);
  r.exact('steps', res.metrics.steps ?? null, want.steps);
  const people = decisionSet(model, 'lever_intensity')
    .filter((x) => ['L03', 'L04', 'L05'].some((l) => x.id.startsWith(`lev.${l}.`)))
    .map((x) => x.cell);
  r.exact('people levers moved', res.changes.filter((c) => people.includes(c.cell)).length, 0);
  movedInputs(r, res, model, want);
  r.gte(
    'binding total shadow price',
    res.binding?.find((b) => b.constraint === 'total')?.shadowPrice ?? Number.NaN,
    0,
  );
}

/** SOL-05: every VP bar from C (min_risk_total_and_vp_bars), through minRiskMix(per_vp) and vpFeasible. */
async function vpCase(
  s: Seeded,
  ref: SolverDemoFile,
  hi: Readonly<Record<string, number>>,
  sink: SolverRow[],
): Promise<void> {
  const want = ref.min_risk_total_and_vp_bars;
  const model = withReferenceCaps(modelAt(s, 'C'), hi);
  const slack = (e: Evaluation, v: string) =>
    e.get(cellKey('vp.net', [v])) - e.get(cellKey('vp.bar', [v]));
  const tightest = Object.entries(want.vp_gaps).sort((a, b) => a[1] - b[1])[0]![0];
  const runs: [string, SolverResult][] = [
    ['min_risk_mix per_vp', await minRiskMix(model, { constraints: [{ id: 'per_vp' }] }, opts)],
    ['vp_feasible', await vpFeasible(model, {}, opts)],
  ];
  for (const [name, res] of runs) {
    const r = new Rows('SOL-05', `min_risk_total_and_vp_bars/${name}`, sink);
    const e = model.compiled.rerun(model.base, res.changes);
    r.exact('status', res.status, 'feasible');
    r.abs('res.net', e.get('res.net'), want.net, TOLERANCES.money);
    r.gte('res.net - res.bar', e.get('res.net') - e.get('res.bar'), 0);
    r.abs('risk_exposure', riskExposure(e, model.members), want.risk_exposure, TOLERANCES.money);
    for (const [vp, gap] of Object.entries(want.vp_gaps)) {
      r.gte(`vp.net - vp.bar [${vp}]`, slack(e, vp), 0, TOLERANCES.feasibility);
      r.abs(`vp gap [${vp}]`, slack(e, vp), gap, TOLERANCES.vpSlack);
    }
    const vps = (model.members.vp ?? []).map((m) => m.id);
    const smallest = [...vps].sort((a, b) => slack(e, a) - slack(e, b))[0] ?? null;
    r.exact('smallest VP slack', smallest, tightest);
    const b = res.binding?.find((x) => x.constraint === `per_vp[${tightest}]`);
    r.gte(`binding per_vp[${tightest}] shadow price`, b?.shadowPrice ?? Number.NaN, 0);
    if (name === 'min_risk_mix per_vp') {
      movedInputs(r, res, model, want);
      r.exact('steps', res.metrics.steps ?? null, want.steps);
      r.abs('res.tot_ot_it', e.get('res.tot_ot_it'), want.one_time_it, TOLERANCES.cents);
      r.abs('br.eps27', e.get('br.eps27'), want.eps27, TOLERANCES.eps);
    }
  }
}

/** SOL-06: seeded Monte Carlo, preset C and D (monte_carlo_C / monte_carlo_D). */
async function monteCarloCase(s: Seeded, ref: SolverDemoFile, sink: SolverRow[]): Promise<void> {
  for (const preset of ['C', 'D'] as const) {
    const r = new Rows('SOL-06', `monte_carlo_${preset}`, sink);
    const want = ref[`monte_carlo_${preset}`];
    const model = modelAt(s, preset);
    const runs: SolverResult<'monte_carlo'>[] = [];
    for (const seed of MC_SEEDS) {
      runs.push(await runSolver(model, { problem: 'monte_carlo', params: { seed } }, opts));
    }
    for (const run of runs) {
      const tag = `seed ${run.diagnostics.seed}`;
      r.exact(`iterations (${tag})`, run.detail?.iterations ?? null, want.iterations);
      r.exact(`failed lanes (${tag})`, run.metrics.failed ?? null, 0);
      r.abs(
        `P(clear bar) (${tag})`,
        run.metrics.p_clear_bar ?? Number.NaN,
        want.prob_clear_bar,
        TOLERANCES.pClear,
      );
      r.abs(
        `P(clear target) (${tag})`,
        run.metrics.p_clear_target ?? Number.NaN,
        want.prob_clear_target_ignoring_growth,
        2 * TOLERANCES.pClear,
      );
      for (const [vp, p] of Object.entries(want.prob_vp_clears_bar)) {
        r.abs(
          `P(clear) ${vp} (${tag})`,
          run.metrics[`p_clear_vp[${vp}]`] ?? Number.NaN,
          p,
          TOLERANCES.pClear + 0.02,
        );
      }
    }
    (['p10', 'p50', 'p90'] as const).forEach((k, i) => {
      r.rel(
        `res.net ${k} (median of seeds)`,
        median(runs.map((x) => x.metrics[`res.net.${k}`]!)),
        want.net_p10_p50_p90[i]!,
        TOLERANCES.percentile,
      );
      r.rel(
        `res.bar ${k} (median of seeds)`,
        median(runs.map((x) => x.metrics[`res.bar.${k}`]!)),
        want.bar_p10_p50_p90[i]!,
        TOLERANCES.percentile,
      );
    });
    r.rel(
      'br.eps27 p50 (median of seeds)',
      median(runs.map((x) => x.metrics['br.eps27.p50']!)),
      want.eps27_p10_p50_p90[1]!,
      TOLERANCES.percentile,
    );
  }
}

/** SOL-07: tornado on res.net from C (tornado_net_top15). */
function tornadoCase(s: Seeded, ref: SolverDemoFile, sink: SolverRow[]): void {
  const r = new Rows('SOL-07', 'tornado_net_top15', sink);
  const model = modelAt(s, 'C');
  const want = ref.tornado_net_top15;
  const t = tornado(model, 'res.net');
  const y0 = model.base.get('res.net');
  const top = t.items[0]!;
  r.exact('top entry', top.cell, want[0]!.id);
  r.abs('top swing', top.swing, want[0]!.swing, TOLERANCES.swing);
  const ours = t.items.slice(0, want.length);
  r.exact(
    'top-15 ids equal reference set',
    sameSet(
      ours.map((x) => x.cell),
      want.map((x) => x.id),
    ),
    true,
  );
  const byId = new Map(ours.map((x) => [x.cell, x] as const));
  for (const g of want) {
    const x = byId.get(g.id);
    r.abs(`${g.id} swing`, x?.swing ?? Number.NaN, g.swing, TOLERANCES.swing);
    r.abs(`${g.id} net at min`, (x?.low?.output ?? Number.NaN) - y0, g.net_at_min, TOLERANCES.netDelta);
    r.abs(`${g.id} net at max`, (x?.high?.output ?? Number.NaN) - y0, g.net_at_max, TOLERANCES.netDelta);
  }
  // Pairs ordered differently from the reference must have swings within the tolerance.
  const rank = new Map(want.map((g, i) => [g.id, i] as const));
  let worst = 0;
  for (let i = 0; i < ours.length; i++) {
    for (let j = i + 1; j < ours.length; j++) {
      if (rank.get(ours[i]!.cell)! > rank.get(ours[j]!.cell)!) {
        worst = Math.max(worst, Math.abs(ours[i]!.swing - ours[j]!.swing));
      }
    }
  }
  r.abs('order differences, worst swing gap', worst, 0, TOLERANCES.swing);
}

// ---------------------------------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------------------------------

/** Failing rows printed to the console (all of them are in the report). */
const SHOWN_MISSES = 25;

export function summarise(rows: readonly SolverRow[]): Tally {
  const passed = rows.filter((x) => x.pass).length;
  return { total: rows.length, passed, failed: rows.length - passed };
}

export async function runSolverGate(options: SolverGateOptions = {}): Promise<SolverGateResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const [bundle, seed, ref, dec] = await Promise.all([
    loadModelBundleFromDir(paths.spec),
    readTenantSeed(paths.seed),
    readJson<SolverDemoFile>(options.reference ?? solverDemoPath),
    readJson<{ hi: Record<string, number> }>(decFixturePath),
  ]);
  const compiled = compile(bundle, seedToTenantData(seed, undefined, bundle).members);
  const seeded: Seeded = { bundle, seed, compiled };

  const rows: SolverRow[] = [];
  await blendCase(seeded, ref, rows);
  await minRiskCase(seeded, ref, dec.hi, rows);
  await vpCase(seeded, ref, dec.hi, rows);
  await monteCarloCase(seeded, ref, rows);
  tornadoCase(seeded, ref, rows);

  const items = Object.fromEntries(
    SOLVER_ITEMS.map((i) => [i, summarise(rows.filter((x) => x.item === i))]),
  ) as Record<SolverItem, Tally>;
  const report: SolverReport = {
    summary: summarise(rows),
    items,
    seed: { tenant: 'aa', mcSeeds: MC_SEEDS },
    rows,
  };

  const out = options.out ?? paths.out;
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'solver-report.json'), `${JSON.stringify(report, null, 1)}\n`);

  for (const x of rows.filter((y) => !y.pass).slice(0, SHOWN_MISSES)) {
    const tol = x.tolerance !== undefined ? ` tol ${x.tolerance}` : '';
    log(`MISS ${x.item} ${x.case} ${x.metric}: actual ${String(x.actual)} expected ${String(x.expected)} (${x.mode}${tol})`);
  }
  for (const i of SOLVER_ITEMS) log(`${i}: ${items[i].passed}/${items[i].total}`);
  log(`solvers ${report.summary.passed}/${report.summary.total}`);
  log(`report: ${join(out, 'solver-report.json')}`);

  const ok = report.summary.failed === 0 && SOLVER_ITEMS.every((i) => items[i].total > 0);
  return { exitCode: ok ? EXIT_OK : EXIT_MISS, report };
}
