import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contract from './index';
import {
  ChangesetOrigin,
  DecisionSet,
  DeltaChange,
  DeltaImpact,
  DeltaMode,
  DeltaReport,
  DeltaSummary,
  ExcelSheet,
  ExportRequest,
  ExportResult,
  FileRef,
  ImportStatus,
  Job,
  JobState,
  MarketRefreshRequest,
  MarketRefreshResult,
  OptimiserMethod,
  ProblemId,
  QuickSolverRunRequest,
  ReconfigApplyRequest,
  ReconfigJob,
  ReconfigList,
  ReconfigRequest,
  TenantParity,
  SensitivityMethod,
  TornadoCategory,
  SolverConstraintId,
  SolverLookup,
  SolverLookupQuery,
  SolverObjective,
  SolverOutcome,
  SolverResult,
  SolverRun,
  SolverRunRequest,
  SolverSpec,
  apiRoutes,
  clientMessageTypes,
  jobRoutes,
  quickProblems,
  type JobRouteId,
  type RouteDef,
} from './index';
import {
  deltaReportFixture,
  jobRouteFixtures,
  solverProblemFixtures,
  solverRunFixtures,
} from './fixtures/jobs';
import { coreRouteFixtures } from './fixtures/core';
import { clientMessageFixtures, serverMessageFixtures } from './fixtures/ws';

const repo = new URL('../../../', import.meta.url);
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, repo)), 'utf8');
const readSpec = <T>(file: string): T => JSON.parse(read(`docs/spec/${file}`)) as T;

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const keys = (o: object): string[] => Object.keys(o).sort();
const shapeKeys = (schema: z.ZodObject): string[] => Object.keys(schema.shape).sort();
const ok = (schema: z.ZodType, value: unknown): boolean => schema.safeParse(value).success;
const expectParses = (schema: z.ZodType, value: unknown, label: string): void => {
  const r = schema.safeParse(value);
  expect(r.success, `${label}: ${JSON.stringify(r.error?.issues.slice(0, 3))}`).toBe(true);
  // JSON → parse → JSON is lossless: no field is stripped, renamed or coerced.
  expect(roundTrip(r.data), label).toEqual(roundTrip(value));
};

interface SpecProblem {
  id: string;
  objective_options?: Record<string, string>;
  constraints?: Record<string, string>;
  methods?: Record<string, string>;
}
const solvers = readSpec<{
  decision_variable_sets: Record<string, string>;
  problems: SpecProblem[];
}>('solvers.json');
const problem = (id: string): SpecProblem => solvers.problems.find((p) => p.id === id)!;
const specKey = (k: string): string => k.replace(/\s*\(.*\)\s*$/, '');

const schemaJson = readSpec<{
  tables: Record<string, { columns: { name: string; type: string }[] }>;
}>('schema.json');
const specEnum = (table: string, column: string): string[] => {
  const col = schemaJson.tables[table]?.columns.find((c) => c.name === column);
  const m = col?.type.match(/^enum\((.*)\)$/);
  if (!m?.[1]) throw new Error(`no enum ${table}.${column}`);
  return m[1].split(',');
};

const excelTemplate = readSpec<{
  sheets: { name: string }[];
  delta_report_schema: Record<string, unknown> & {
    summary: Record<string, string>;
    changes: Record<string, unknown>[];
    impact: Record<string, unknown>;
  };
}>('excel_template.json');

describe('jobs.spec: CON-03 routes (04 §3, 04 §5)', () => {
  it('covers exactly the solver, export, import, file, AI and market routes', () => {
    const table = Object.values(jobRoutes)
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(table).toEqual(
      [
        'POST /api/t/:tenant/solver-runs',
        'POST /api/t/:tenant/solver-runs/quick',
        'GET /api/t/:tenant/solver-runs/lookup',
        'GET /api/t/:tenant/solver-runs/:id',
        'DELETE /api/t/:tenant/solver-runs/:id',
        'POST /api/t/:tenant/exports',
        'GET /api/t/:tenant/files/:id',
        'POST /api/t/:tenant/imports',
        'GET /api/t/:tenant/imports/:id',
        'POST /api/t/:tenant/imports/:id/apply',
        'POST /api/ai/reconfig',
        'GET /api/ai/reconfig',
        'GET /api/ai/reconfig/:id',
        'POST /api/ai/reconfig/:id/apply',
        'POST /api/t/:tenant/market/refresh',
      ].sort(),
    );
    for (const id of Object.keys(jobRoutes)) expect(apiRoutes).toHaveProperty(id);
    expect(keys(jobRouteFixtures)).toEqual(keys(jobRoutes));
  });

  it('declares path params for every :param in the path', () => {
    for (const route of Object.values(jobRoutes) as RouteDef[]) {
      const names = [...route.path.matchAll(/:(\w+)/g)].map((m) => m[1]).sort();
      const declared = route.params ? Object.keys(route.params.shape).sort() : [];
      expect(declared, route.path).toEqual(names);
    }
  });

  const parts = ['params', 'query', 'body', 'response'] as const;
  for (const id of Object.keys(jobRoutes) as JobRouteId[]) {
    it(`round-trips the ${id} fixture`, () => {
      const route = jobRoutes[id] as RouteDef;
      const fixture = jobRouteFixtures[id] as Partial<Record<(typeof parts)[number], unknown>>;
      for (const part of parts) {
        const schema = route[part] as z.ZodType | undefined;
        if (!schema) {
          expect(fixture[part], `${id}.${part} has a fixture but no schema`).toBeUndefined();
          continue;
        }
        expect(fixture[part], `${id}.${part} has a schema but no fixture`).toBeDefined();
        const bytes =
          (part === 'body' && route.requestType === 'bytes') ||
          (part === 'response' && route.responseType === 'bytes');
        if (bytes) expect(schema.safeParse(fixture[part]).success, `${id}.${part}`).toBe(true);
        else expectParses(schema, fixture[part], `${id}.${part}`);
      }
    });
  }
});

describe('jobs.spec: solver-runs (POST, POST quick, GET, DELETE) for every solvers.json problem', () => {
  const ids = solvers.problems.map((p) => p.id);

  it('solver-runs params for every problem id in solvers.json and SolverResult as in 03 §3 (one fixture per problem id)', () => {
    expect([...ProblemId.options]).toEqual(ids);
    expect(keys(solverProblemFixtures)).toEqual([...ids].sort());
    const { solverRunStart, solverRunQuick, solverRunGet, solverRunCancel } = jobRoutes;
    expect([solverRunStart.method, solverRunStart.body, solverRunStart.response]).toEqual([
      'POST',
      SolverRunRequest,
      SolverRun,
    ]);
    expect([solverRunQuick.method, solverRunQuick.body, solverRunQuick.response]).toEqual([
      'POST',
      QuickSolverRunRequest,
      SolverRun,
    ]);
    expect([solverRunGet.method, solverRunGet.response]).toEqual(['GET', SolverRun]);
    expect([solverRunCancel.method, solverRunCancel.response]).toEqual(['DELETE', SolverRun]);

    for (const id of ProblemId.options) {
      const fx = solverProblemFixtures[id];
      expect(fx.spec.problem, id).toBe(id);
      expect(fx.result.problem, id).toBe(id);
      expectParses(SolverSpec, fx.spec, `${id}.spec`);
      expectParses(SolverRunRequest, { scenarioId: 'sc-1', spec: fx.spec }, `${id}.request`);
      expectParses(SolverResult, fx.result, `${id}.result`);
      expectParses(SolverRun, solverRunFixtures[id], `${id}.run`);
      const quick = (quickProblems as readonly string[]).includes(id);
      expect(ok(QuickSolverRunRequest, { scenarioId: 'sc-1', spec: fx.spec }), `${id} quick`).toBe(
        quick,
      );
    }
  });

  it('SolverResult has the 03 §3 fields (plus optional display detail)', () => {
    expect(shapeKeys(SolverResult)).toEqual(
      [
        'problem',
        'status',
        'changes',
        'ranked',
        'binding',
        'metrics',
        'diagnostics',
        'detail',
      ].sort(),
    );
    expect([...SolverOutcome.options]).toEqual([
      'optimal',
      'feasible',
      'infeasible',
      'unreachable',
      'cancelled',
    ]);
    expect(SolverResult.shape.binding.safeParse(undefined).success).toBe(true);
    expect(SolverResult.shape.detail.safeParse(undefined).success).toBe(true);
    expect(shapeKeys(SolverResult.shape.diagnostics)).toEqual(['iterations', 'ms', 'seed']);
    const { detail: _d, ...bare } = solverProblemFixtures.min_risk_mix.result;
    void _d;
    expectParses(SolverResult, bare, 'result without detail');
    // Solver moves are decision-input changes only.
    const pin = { target: 'override', key: 'res.net', member: '', value: 1 };
    expect(ok(SolverResult, { ...bare, changes: [pin] })).toBe(false);
    // detail and run must agree with the problem.
    const mixed = { ...solverProblemFixtures.pareto.result, problem: 'goal_seek' };
    expect(ok(SolverResult, mixed)).toBe(false);
    expect(
      ok(SolverRun, {
        ...solverRunFixtures.pareto,
        result: solverProblemFixtures.goal_seek.result,
      }),
    ).toBe(false);
  });

  it('names objectives, constraints, decision sets and methods verbatim from solvers.json', () => {
    const mix = problem('min_risk_mix');
    expect([...DecisionSet.options]).toEqual(Object.keys(solvers.decision_variable_sets));
    expect([...SolverObjective.options]).toEqual(Object.keys(mix.objective_options!));
    expect([...SolverConstraintId.options]).toEqual(Object.keys(mix.constraints!).map(specKey));
    const methods = Object.keys(mix.methods!).map(specKey);
    for (const m of OptimiserMethod.options) expect(methods).toContain(m);
    expect([...SensitivityMethod.options]).toEqual(Object.keys(problem('sensitivity').methods!));
  });

  it('SOL-13: sensitivity rows carry tier 2\'s category and swing; min_risk_mix metrics carry the C, D and allvps reference points', () => {
    expect([...TornadoCategory.options]).toEqual(['lever', 'policy', 'timing']);
    const sens = solverProblemFixtures.sensitivity.result;
    const row = sens.detail!.rows[0]!;
    expect([row.category, row.swing]).toEqual(['lever', 12.5]);
    expectParses(SolverResult, sens, 'sensitivity result with category and swing');
    // still readable without them (a Sobol row, or a run stored before SOL-13) …
    const { category: _c, swing: _s, ...bare } = row;
    void _c;
    void _s;
    expectParses(SolverResult, { ...sens, detail: { ...sens.detail, rows: [bare] } }, 'row without category');
    // … but never with a class the UI has no colour for, or a negative bar
    expect(ok(SolverResult, { ...sens, detail: { ...sens.detail, rows: [{ ...row, category: 'risk' }] } })).toBe(false);
    expect(ok(SolverResult, { ...sens, detail: { ...sens.detail, rows: [{ ...row, swing: -1 }] } })).toBe(false);

    const metrics: Readonly<Record<string, number>> = solverProblemFixtures.min_risk_mix.result.metrics;
    for (const key of ['C', 'D', 'allvps']) {
      expect(typeof metrics[`net[${key}]`], key).toBe('number');
      expect(typeof metrics[`risk_exposure[${key}]`], key).toBe('number');
    }
  });

  it('quick runs only logic problems (03 §3): Sobol and optimisers are worker jobs', () => {
    const sobol = { problem: 'sensitivity', params: { method: 'sobol', outputs: ['res.net[]'] } };
    expect(ok(SolverRunRequest, { scenarioId: 'sc-1', spec: sobol })).toBe(true);
    expect(ok(QuickSolverRunRequest, { scenarioId: 'sc-1', spec: sobol })).toBe(false);
    expect([...quickProblems]).toEqual([
      'goal_seek',
      'breakeven',
      'scenario_blend',
      'sensitivity',
      'stress_presets',
    ]);
  });

  it('rejects malformed params (unknown problem, bad cell, bad bounds, empty presets)', () => {
    const run = (spec: unknown) => ok(SolverRunRequest, { scenarioId: 'sc-1', spec });
    expect(run({ problem: 'optimize', params: {} })).toBe(false);
    expect(
      run({ problem: 'goal_seek', params: { var: 'lev.L05.nb', output: 'res.gap[]', target: 0 } }),
    ).toBe(false);
    expect(
      run({
        problem: 'goal_seek',
        params: { var: 'a[]', output: 'b[]', target: 0, bounds: [2, 1] },
      }),
    ).toBe(false);
    expect(run({ problem: 'stress_presets', params: { presets: [] } })).toBe(false);
    expect(run({ problem: 'min_risk_mix', params: { constraints: [{ id: 'bounds' }] } })).toBe(
      false,
    );
  });

  it('API-13 solver-runs/lookup: a GET with (scenario, problem, params) that answers a run or null, with the Monte Carlo trial count from tier 2', () => {
    const { solverRunLookup: route, solverRunGet } = jobRoutes;
    const table = Object.keys(jobRoutes);
    // before `:id`, which would otherwise take `lookup` for a run id
    expect(table.indexOf('solverRunLookup')).toBeLessThan(table.indexOf('solverRunGet'));
    expect([route.method, route.response, route.query]).toEqual(['GET', SolverLookup, SolverLookupQuery]);
    expect('body' in route).toBe(false);
    expect(solverRunGet.path).toBe('/api/t/:tenant/solver-runs/:id');
    expect(shapeKeys(SolverLookup)).toEqual(['current', 'run', 'trials']);
    // params are tier 2's defaults when absent; given, they are the JSON object of the problem's params
    const q = { scenarioId: 'sc-1', problem: 'monte_carlo' };
    expect(ok(SolverLookupQuery, q)).toBe(true);
    expect(ok(SolverLookupQuery, { ...q, params: '{"iterations":500}' })).toBe(true);
    expect(ok(SolverLookupQuery, { ...q, params: '[1]' })).toBe(false);
    expect(ok(SolverLookupQuery, { ...q, params: 'not json' })).toBe(false);
    expect(ok(SolverLookupQuery, { ...q, problem: 'nope' })).toBe(false);
    // nothing held: run null, not current, no trials for a problem without draws
    expect(ok(SolverLookup, { run: null, current: false, trials: null })).toBe(true);
    expect(ok(SolverLookup, { run: null, current: false, trials: 0 })).toBe(false);
    expect(ok(SolverLookup, { run: solverRunFixtures.min_risk_mix, current: true, trials: null })).toBe(true);
  });

  it('API-13 metrics: a cell metric is keyed by its wire cell key in every result fixture', () => {
    for (const [id, fx] of Object.entries(solverProblemFixtures)) {
      for (const key of Object.keys(fx.result.metrics)) {
        if (key.includes('.')) expect(key, `${id} metric ${key}`).toMatch(/^[^[\]\s]+\[[^[\]]*\]$/);
      }
    }
  });

  it('job progress matches DATA-11 solver_run.progress / progress_note / cancel_requested', () => {
    const sql = read('tier3-data/migrations/manual/0001_solver_run_progress_scenario_archived.sql');
    for (const col of ['progress', 'progress_note', 'cancel_requested']) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN ${col}\\b`));
    }
    expect(sql).toMatch(/progress >= 0 AND progress <= 1/);
    expect(shapeKeys(JobState)).toEqual(['cancelRequested', 'progress', 'progressNote', 'status']);
    for (const k of shapeKeys(JobState)) expect(SolverRun.shape).toHaveProperty(k);
    const run = solverRunFixtures.goal_seek;
    expect(ok(SolverRun, { ...run, progress: 1.5 })).toBe(false);
    expect(ok(SolverRun, { ...run, progress: -0.1 })).toBe(false);
    expect([...JobState.shape.status.options]).toEqual(specEnum('solver_run', 'status'));
    // The WS job message carries the same values; kind and cancelRequested are additive.
    expect(ok(Job, serverMessageFixtures.job)).toBe(true);
    expect(ok(Job, { ...serverMessageFixtures.job, kind: 'import', cancelRequested: true })).toBe(
      true,
    );
    expect(ok(Job, { ...serverMessageFixtures.job, kind: 'export' })).toBe(false);
  });
});

describe('jobs.spec: exports, imports and the delta report (05, excel_template.json)', () => {
  const spec = excelTemplate.delta_report_schema;

  it('delta report schema equals excel_template.json delta_report_schema field for field (test compares key sets)', () => {
    expect(shapeKeys(DeltaReport)).toEqual(keys(spec));
    expect(shapeKeys(DeltaSummary)).toEqual(keys(spec.summary));
    expect(shapeKeys(DeltaChange)).toEqual(keys(spec.changes[0]!));
    // impact: `scenario` plus one [before, after] per hero node id.
    expect(shapeKeys(DeltaImpact)).toEqual(['scenario']);
    expect(Object.keys(spec.impact)).toContain('scenario');
    expectParses(DeltaImpact, spec.impact, 'spec impact');
    expect(ok(DeltaImpact, { scenario: 'C', 'res.net': 'x' })).toBe(false);
    expectParses(DeltaChange, spec.changes[0], 'spec change row');
    // Types: "int" summary counts, "three_way|foreign", "uuid|null".
    for (const [k, t] of Object.entries(spec.summary)) {
      expect(t, k).toBe('int');
      expect(ok(DeltaSummary.shape[k as keyof typeof DeltaSummary.shape], 1.5), k).toBe(false);
    }
    expect([...DeltaMode.options]).toEqual(String(spec.mode).split('|'));
    expect(spec.export_job_id).toBe('uuid|null');
    expect(DeltaReport.shape.export_job_id.safeParse(null).success).toBe(true);
    expect(DeltaReport.shape.import_job_id.safeParse(null).success).toBe(false);
    expect(DeltaChange.shape.status.safeParse(spec.changes[0]!.status).success).toBe(true);
    // Field for field: an extra key is refused at every level.
    expectParses(DeltaReport, deltaReportFixture, 'delta report fixture');
    expect(ok(DeltaReport, { ...deltaReportFixture, extra: 1 })).toBe(false);
    expect(
      ok(DeltaReport, { ...deltaReportFixture, summary: { ...deltaReportFixture.summary, x: 0 } }),
    ).toBe(false);
    expect(
      ok(DeltaReport, { ...deltaReportFixture, changes: [{ ...spec.changes[0], x: 0 }] }),
    ).toBe(false);
  });

  it('sheet names and import statuses are verbatim from the spec', () => {
    expect([...ExcelSheet.options]).toEqual(excelTemplate.sheets.map((s) => s.name));
    expect([...ImportStatus.options]).toEqual(specEnum('import_job', 'status'));
    expect(jobRoutes.importGet.response.shape.report.unwrap()).toBe(DeltaReport);
  });

  it('export request: csv names exactly one sheet; result carries a FileRef, not a URL', () => {
    expect(ok(ExportRequest, { scenarioIds: ['sc-1'], format: 'csv', sheets: ['Levers'] })).toBe(
      true,
    );
    expect(ok(ExportRequest, { scenarioIds: ['sc-1'], format: 'csv' })).toBe(false);
    expect(ok(ExportRequest, { scenarioIds: [] })).toBe(false);
    expect(ExportResult.shape.file).toBe(FileRef);
    expect(shapeKeys(FileRef)).toEqual(['contentType', 'expiresAt', 'filename', 'id', 'size']);
  });
});

describe('jobs.spec: AI job list, tenant parity, onboarding states (API-14)', () => {
  it('GET /api/ai/reconfig lists jobs with the latest parity per tenant; every job carries tier 2 onboarding states', () => {
    const { aiReconfigList } = jobRoutes;
    expect([aiReconfigList.method, aiReconfigList.path, aiReconfigList.response]).toEqual([
      'GET',
      '/api/ai/reconfig',
      ReconfigList,
    ]);
    const list = jobRouteFixtures.aiReconfigList.response;
    expectParses(ReconfigList, list, 'reconfig list');
    expect(ok(ReconfigList, { ...list, parity: undefined })).toBe(false);
    expect(ok(ReconfigList, { jobs: [], parity: [] })).toBe(true);
    expect(ok(TenantParity, { ...list.parity[0], passed: -1 })).toBe(false);

    const job = jobRouteFixtures.aiReconfigGet.response;
    expect(job.onboarding.steps.map((s) => s.state)).toEqual(['done', 'review', 'todo']);
    expect(job.onboarding).toMatchObject({ done: 1, total: 3 });
    expect(ok(ReconfigJob, { ...job, onboarding: undefined })).toBe(false);
    expect(
      ok(ReconfigJob, {
        ...job,
        onboarding: { steps: [{ id: 'org', state: 'started' }], done: 0, total: 1 },
      }),
    ).toBe(false);
  });
});

describe('jobs.spec: AI reconfiguration (06 §2) and market refresh', () => {
  it('ai/reconfig (POST, GET, POST apply) with plan, sources, draft changeset summaries, calibration report, open questions, cost estimate; market/refresh request', () => {
    const { aiReconfigStart, aiReconfigGet, aiReconfigApply, marketRefresh } = jobRoutes;
    expect([aiReconfigStart.method, aiReconfigStart.body, aiReconfigStart.response]).toEqual([
      'POST',
      ReconfigRequest,
      ReconfigJob,
    ]);
    expect([aiReconfigGet.method, aiReconfigGet.response]).toEqual(['GET', ReconfigJob]);
    expect([aiReconfigApply.method, aiReconfigApply.body]).toEqual(['POST', ReconfigApplyRequest]);
    for (const k of ['plan', 'sources', 'drafts', 'calibration', 'openQuestions', 'costEstimate']) {
      expect(ReconfigJob.shape, k).toHaveProperty(k);
    }
    const job = jobRouteFixtures.aiReconfigGet.response;
    expectParses(ReconfigJob, job, 'reconfig job');
    expect(job.drafts.map((d) => d.kind)).toEqual(['seed', 'lever_tuning']);
    expect(ok(ReconfigJob, { ...job, costEstimate: undefined })).toBe(false);
    expect(ok(ReconfigRequest, { prompt: '  ', tenant: null })).toBe(false);
    expect(ok(ReconfigRequest, { prompt: 'Tune ZZ levers', tenant: 'zz' })).toBe(true);
    expect(ok(ReconfigApplyRequest, { drafts: [] })).toBe(false);
    expect(ChangesetOrigin.options).toContain('ai_reconfig');

    expect([marketRefresh.method, marketRefresh.body, marketRefresh.response]).toEqual([
      'POST',
      MarketRefreshRequest,
      MarketRefreshResult,
    ]);
    expect(ok(MarketRefreshRequest, { source: 'feed' })).toBe(true);
    expectParses(MarketRefreshRequest, jobRouteFixtures.marketRefresh.body, 'manual refresh');
    expect(ok(MarketRefreshRequest, { source: 'manual', asOf: '2026-11-20', values: [] })).toBe(
      false,
    );
    expect(
      ok(MarketRefreshRequest, {
        source: 'manual',
        asOf: '20 Nov',
        values: [{ var: 'corp.price_now', member: '', value: 1 }],
      }),
    ).toBe(false);
    expect(ChangesetOrigin.options).toContain('market_refresh');
  });
});

describe('jobs.spec: files and storage (04 §5, ADR-025)', () => {
  /** Every zod schema the contract exports, plus every route part and WS message. */
  const allSchemas = (): [string, z.ZodType][] => {
    const out: [string, z.ZodType][] = [];
    for (const [name, value] of Object.entries(contract)) {
      if (value instanceof z.ZodType) out.push([name, value]);
    }
    for (const [id, route] of Object.entries(apiRoutes) as [string, RouteDef][]) {
      for (const part of ['params', 'query', 'body', 'response'] as const) {
        const s = route[part];
        if (s) out.push([`${id}.${part}`, s]);
      }
      for (const [status, s] of Object.entries(route.errors ?? {})) {
        if (s) out.push([`${id}.errors.${status}`, s]);
      }
    }
    return out;
  };

  /** Property paths of a JSON schema (`a.b[].c`), with the schema node at each. */
  const walk = (node: unknown, path: string, visit: (path: string, node: object) => void): void => {
    if (!node || typeof node !== 'object') return;
    visit(path, node);
    const n = node as Record<string, unknown>;
    for (const [k, v] of Object.entries((n.properties as object | undefined) ?? {})) {
      walk(v, `${path}.${k}`, visit);
    }
    if (n.items) walk(n.items, `${path}[]`, visit);
    if (Array.isArray(n.prefixItems)) n.prefixItems.forEach((v) => walk(v, `${path}[]`, visit));
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      if (Array.isArray(n[key])) (n[key] as unknown[]).forEach((v) => walk(v, path, visit));
    }
    for (const key of ['additionalProperties', 'not'] as const) {
      if (n[key] && typeof n[key] === 'object') walk(n[key], `${path}.*`, visit);
    }
    for (const defs of ['$defs', 'definitions'] as const) {
      for (const [k, v] of Object.entries((n[defs] as object | undefined) ?? {})) {
        walk(v, `#${k}`, visit);
      }
    }
  };

  /** The only URL in the contract: the public web page an AI research source cites. */
  const allowedUrlPaths = [/^ReconfigSource\.url$/, /\.sources\[\]\.url$/];
  const storageName =
    /bucket|storage|presign|signed_?url|object_?key|file_?ur[il]|s3|minio|^ur[il]$|ur[il]$/i;
  const storageText =
    /s3:\/\/|minio|stored_object|https?:\/\/|\b(exports|export-snapshots|imports|ai)\/|bucket/i;

  it('files/:id is a byte stream; no schema contains bucket names or storage URLs (test greps the JSON schemas)', () => {
    const file = jobRoutes.fileDownload as RouteDef;
    expect([file.method, file.path, file.responseType]).toEqual([
      'GET',
      '/api/t/:tenant/files/:id',
      'bytes',
    ]);
    expect(
      Object.values(apiRoutes).filter((r) => (r as RouteDef).responseType === 'bytes'),
    ).toEqual([file]);

    const schemas = allSchemas();
    expect(schemas.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    let urlFields = 0;
    for (const [name, schema] of schemas) {
      const json = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' });
      walk(json, name, (path, node) => {
        const n = node as Record<string, unknown>;
        const leaf = path.split('.').pop()!.replace(/\[\]$/, '');
        const allowed = allowedUrlPaths.some((re) => re.test(path));
        if (allowed) urlFields += 1;
        if (!allowed && path !== name && storageName.test(leaf)) offenders.push(`${path}: name`);
        if (!allowed && (n.format === 'uri' || n.format === 'url'))
          offenders.push(`${path}: format`);
        for (const key of ['const', 'enum', 'default', 'pattern', 'description', 'examples']) {
          if (n[key] !== undefined && storageText.test(JSON.stringify(n[key]))) {
            offenders.push(`${path}: ${key}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
    expect(urlFields).toBeGreaterThan(0);

    // No fixture carries a storage location either (the source citation is a public page).
    const fixtures = JSON.stringify([
      coreRouteFixtures,
      { ...jobRouteFixtures, fileDownload: null, importCreate: null },
      clientMessageFixtures,
      serverMessageFixtures,
    ]);
    expect(fixtures).not.toMatch(/s3:\/\/|minio|bucket|stored_object|\b(exports|imports|ai)\//i);
    expect(clientMessageTypes).not.toContain('file');
  });
});
