import type { z } from 'zod';
import type { DeltaReport, ImportJob } from '../excel';
import type { ReconfigJob } from '../ai';
import type { ProblemId, SolverResult, SolverRun, SolverSpec } from '../solvers';
import type { ApiRouteId, apiRoutes, jobRoutes, JobRouteId } from '../routes';
import { coreRouteFixtures, type RouteFixture } from './core';

/**
 * CON-03 wire fixtures: one per job route, one spec + result per solver problem id, and a
 * delta report. Tenant `zz` and "Fixture Air" are fictional; numbers are test data only.
 * Byte routes hold `Uint8Array` bodies (not JSON) for `fileDownload` and `importCreate`.
 */
export type JobRouteFixtures = { [Id in JobRouteId]: RouteFixture<(typeof jobRoutes)[Id]> };
export type ApiRouteFixtures = { [Id in ApiRouteId]: RouteFixture<(typeof apiRoutes)[Id]> };

const tenant = 'zz';
const at = '2026-11-20T09:30:00.000Z';
const later = '2026-11-20T09:30:04.000Z';

type ProblemFixture<P extends ProblemId> = {
  spec: Extract<z.input<typeof SolverSpec>, { problem: P }>;
  result: z.input<typeof SolverResult>;
};

const diagnostics = { iterations: 14, ms: 212 };

/** One `SolverSpec` and one `SolverResult` per `solvers.json` problem id. */
export const solverProblemFixtures = {
  goal_seek: {
    spec: {
      problem: 'goal_seek',
      params: { var: 'lev.L05.nb[]', output: 'res.gap[]', target: 0, bounds: [0, 1] },
    },
    result: {
      problem: 'goal_seek',
      status: 'unreachable',
      changes: [{ target: 'variable', key: 'lev.L05.nb', member: '', value: 1 }],
      ranked: [{ cell: 'lev.L05.nb[]', from: 0.6, to: 1, impact: 4.1 }],
      metrics: { 'res.gap[]': -3.2 },
      diagnostics,
      detail: { problem: 'goal_seek', value: 1, output: -3.2, reachable: false },
    },
  },
  breakeven: {
    spec: { problem: 'breakeven', params: { output: 'res.gap[]', target: 0 } },
    result: {
      problem: 'breakeven',
      status: 'feasible',
      changes: [],
      ranked: [{ cell: 'lev.L03.pct[]', from: 0.2, to: 0.31, impact: 7.3 }],
      metrics: {},
      diagnostics,
      detail: {
        problem: 'breakeven',
        rows: [
          { cell: 'lev.L03.pct[]', current: 0.2, needed: 0.31, min: 0, max: 0.4, feasible: true },
          { cell: 'lev.L08.cut[]', current: 0.1, needed: null, min: 0, max: 0.2, feasible: false },
        ],
      },
    },
  },
  scenario_blend: {
    spec: {
      problem: 'scenario_blend',
      params: { from: 'sc-preset-c', to: 'sc-preset-d', output: 'res.gap[]', target: 0 },
    },
    result: {
      problem: 'scenario_blend',
      status: 'feasible',
      changes: [{ target: 'variable', key: 'lev.L03.pct', member: '', value: 0.27 }],
      ranked: [],
      metrics: { lambda: 0.62 },
      diagnostics,
      detail: { problem: 'scenario_blend', lambda: 0.62 },
    },
  },
  min_risk_mix: {
    spec: {
      problem: 'min_risk_mix',
      params: {
        objective: 'min_risk_exposure',
        decisionSets: ['lever_intensity'],
        constraints: [{ id: 'total' }, { id: 'one_time_cap', value: 40 }],
        method: 'explainable',
        seed: 7,
      },
    },
    result: {
      problem: 'min_risk_mix',
      status: 'optimal',
      changes: [
        { target: 'variable', key: 'lev.L09.dc', member: '', value: 0.5 },
        { target: 'variable', key: 'lev.L06.gain', member: '', value: 0.3 },
      ],
      ranked: [
        { cell: 'lev.L09.dc[]', from: 0.3, to: 0.5, impact: 9.1 },
        { cell: 'lev.L06.gain[]', from: 0.2, to: 0.3, impact: 4.4 },
      ],
      binding: [{ constraint: 'total', shadowPrice: 0.42 }],
      metrics: { 'res.net[]': 143, 'res.risk[]': 42 },
      diagnostics: { ...diagnostics, seed: 7 },
      detail: { problem: 'min_risk_mix' },
    },
  },
  pareto: {
    spec: {
      problem: 'pareto',
      params: { axis: 'risk', sweep: { from: 100, to: 110, step: 5 } },
    },
    result: {
      problem: 'pareto',
      status: 'feasible',
      changes: [],
      ranked: [],
      metrics: {},
      diagnostics,
      detail: {
        problem: 'pareto',
        points: [
          { bar: 100, net: 100.2, risk: 21, oneTime: 30, feasible: true, scenarioId: null },
          { bar: 105, net: 105.1, risk: 24, oneTime: 31, feasible: true, scenarioId: null },
          { bar: 110, net: 110, risk: 28, oneTime: 33, feasible: true, scenarioId: null },
        ],
      },
    },
  },
  vp_feasible: {
    spec: {
      problem: 'vp_feasible',
      params: {
        constraints: [{ id: 'per_vp' }],
        decisionSets: ['lever_intensity', 'lever_timing'],
      },
    },
    result: {
      problem: 'vp_feasible',
      status: 'infeasible',
      changes: [],
      ranked: [],
      binding: [{ constraint: 'per_vp[vp_x]', shadowPrice: 1.3 }],
      metrics: { 'res.net[]': 148.1 },
      diagnostics,
      detail: { problem: 'vp_feasible', coverage: [{ vp: 'vp_x', coverage: 0.94 }] },
    },
  },
  monte_carlo: {
    spec: {
      problem: 'monte_carlo',
      params: { iterations: 200, seed: 1, outputs: ['res.net[]'] },
    },
    result: {
      problem: 'monte_carlo',
      status: 'feasible',
      changes: [],
      ranked: [],
      metrics: { pClear: 0.045 },
      diagnostics: { iterations: 200, ms: 820, seed: 1 },
      detail: {
        problem: 'monte_carlo',
        iterations: 200,
        seed: 1,
        percentiles: [{ cell: 'res.net[]', p10: 101, p50: 118, p90: 136 }],
        probabilities: [{ cell: 'res.net[]', against: 'res.bar[]', p: 0.045 }],
        histograms: [
          {
            cell: 'res.net[]',
            bins: [
              { lo: 90, hi: 110, count: 70 },
              { lo: 110, hi: 130, count: 100 },
              { lo: 130, hi: 150, count: 30 },
            ],
          },
        ],
        contributions: [{ lever: 'L05', share: 0.31 }],
      },
    },
  },
  sensitivity: {
    spec: {
      problem: 'sensitivity',
      params: { method: 'tornado', outputs: ['res.net[]'], range: { mode: 'registry' } },
    },
    result: {
      problem: 'sensitivity',
      status: 'feasible',
      changes: [],
      ranked: [{ cell: 'lev.L05.nb[]', from: 0, to: 1, impact: 12.5 }],
      metrics: {},
      diagnostics,
      detail: {
        problem: 'sensitivity',
        method: 'tornado',
        output: 'res.net[]',
        rows: [
          {
            cell: 'lev.L05.nb[]',
            low: { input: 0, output: 110.1 },
            high: { input: 1, output: 122.6 },
            elasticity: null,
            first: null,
            total: null,
          },
        ],
      },
    },
  },
  stress_presets: {
    spec: { problem: 'stress_presets', params: { presets: ['GCC hiring freeze'] } },
    result: {
      problem: 'stress_presets',
      status: 'feasible',
      changes: [],
      ranked: [],
      metrics: {},
      diagnostics,
      detail: {
        problem: 'stress_presets',
        presets: [
          {
            name: 'GCC hiring freeze',
            outputs: { 'res.net[]': 104.2 },
            delta: { 'res.net[]': -15.1 },
          },
        ],
      },
    },
  },
} satisfies { [P in ProblemId]: ProblemFixture<P> };

const solverRun = (
  problem: ProblemId,
  extra: Partial<z.input<typeof SolverRun>> = {},
): z.input<typeof SolverRun> => ({
  id: `job-${problem}`,
  scenarioId: 'sc-custom-c',
  scenarioVersion: 3,
  inputHash: 'sha256:9f2c',
  spec: solverProblemFixtures[problem].spec,
  quick: false,
  save: false,
  status: 'done',
  progress: 1,
  progressNote: null,
  cancelRequested: false,
  cached: false,
  result: solverProblemFixtures[problem].result,
  resultScenarioId: null,
  error: null,
  createdBy: 'u-1',
  createdAt: at,
  updatedAt: later,
  ...extra,
});

/** A complete `SolverRun` per problem id (done, with its result). */
export const solverRunFixtures = Object.fromEntries(
  (Object.keys(solverProblemFixtures) as ProblemId[]).map((p) => [p, solverRun(p)]),
) as Record<ProblemId, z.input<typeof SolverRun>>;

/** `excel_template.json` `delta_report_schema`, with the spec's example rows. */
export const deltaReportFixture = {
  import_job_id: 'imp-1',
  export_job_id: 'exp-1',
  mode: 'three_way',
  summary: {
    unchanged: 412,
    changed_in_excel: 1,
    changed_in_app: 0,
    conflict: 1,
    invalid: 0,
    new_rows: 0,
    deleted_rows: 0,
    ignored: 0,
  },
  changes: [
    {
      sheet: 'Levers',
      key: 'lev.L05.nb',
      member: '',
      scenario: 'C',
      export: 0.6,
      workbook: 0.75,
      current: 0.6,
      status: 'changed_in_excel',
      messages: [],
    },
    {
      sheet: 'Targets',
      key: 'g.target_net',
      member: '',
      scenario: null,
      export: 140,
      workbook: 150,
      current: 145,
      status: 'conflict',
      messages: ['Changed in the app after export.'],
    },
  ],
  impact: {
    scenario: 'C',
    'res.net': [119.3, 123.1],
    'res.gap': [-23.7, -19.9],
    'br.eps27': [0.091, 0.094],
  },
} satisfies z.input<typeof DeltaReport>;

const workbookBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

const importJob = {
  id: 'imp-1',
  filename: 'zz_it_savings_C_20261120-0930.xlsx',
  exportId: 'exp-1',
  status: 'awaiting_review',
  progress: 1,
  progressNote: null,
  report: deltaReportFixture,
  violations: [],
  ignored: { sheets: ['Notes'], columns: [{ sheet: 'Levers', header: 'My comments' }] },
  changesetId: null,
  error: null,
  createdBy: 'u-1',
  createdAt: at,
} satisfies z.input<typeof ImportJob>;

const reconfigJob = {
  id: 'ai-1',
  prompt: 'Set up Fixture Air',
  tenant: null,
  status: 'review',
  step: 'review',
  progress: 1,
  progressNote: null,
  plan: {
    mode: 'new_tenant',
    tenant: { name: 'Fixture Air', slug: 'zz', monogram: 'ZZ', ticker: null, currency: 'USD' },
    baseYear: 2026,
    targetYear: 2027,
    produce: ['seed', 'lever_tuning'],
    steps: ['Research public filings', 'Draft the seed', 'Calibrate the last fiscal year'],
  },
  sources: [
    {
      id: 'src-1',
      title: 'Fixture Air annual report 2025',
      publisher: 'Fixture Air',
      url: 'https://example.com/fixture-air/annual-report-2025',
      publishedAt: '2026-02-14',
      retrievedAt: at,
    },
  ],
  facts: [
    {
      id: 'f-1',
      item: 'headcount',
      label: 'IT headcount',
      value: 1200,
      unit: 'FTE',
      sourceId: 'src-1',
      asOf: '2025-12-31',
      confidence: 'M',
    },
    {
      id: 'f-2',
      item: 'gcc',
      label: 'Global capability centre',
      value: 'none found',
      unit: '',
      sourceId: null,
      asOf: null,
      confidence: 'L',
    },
  ],
  drafts: [
    {
      kind: 'seed',
      title: 'Fixture Air seed',
      summary: 'Tenant, 212 baseline lines, org, workforce, vendors and drivers.',
      changes: 1840,
      sections: [
        { section: 'line_items', changes: 212 },
        { section: 'workforce', changes: 96 },
      ],
      warnings: [],
      impact: [{ cell: 'res.net[]', before: null, after: 61.4 }],
    },
    {
      kind: 'lever_tuning',
      title: 'Lever tuning',
      summary: 'No large GCC: L03–L05 start low.',
      changes: 9,
      sections: [{ section: 'levers', changes: 9 }],
      warnings: [],
      impact: [{ cell: 'res.net[]', before: 61.4, after: 58.2 }],
    },
  ],
  validation: [],
  calibration: {
    fiscalYear: 2025,
    tolerance: 0.01,
    passed: true,
    repairRounds: 1,
    lines: [
      { metric: 'Revenue', cell: null, reported: 10000, model: 10012, residual: 0.0012, ok: true },
    ],
  },
  openQuestions: [
    {
      id: 'q-1',
      question: 'Which unions represent the IT workforce?',
      context: null,
      item: 'unions',
      blocking: false,
    },
  ],
  onboarding: {
    steps: [
      { id: 'tenant_record', state: 'done' },
      { id: 'baseline_lines', state: 'review' },
      { id: 'sources', state: 'todo' },
    ],
    done: 1,
    total: 3,
  },
  costEstimate: {
    model: 'claude-opus-5-5',
    inputTokens: 400000,
    outputTokens: 60000,
    usd: 7.5,
    maxTokens: 1000000,
  },
  usage: { inputTokens: 380000, outputTokens: 52000, usd: 6.9 },
  error: null,
  createdBy: 'u-1',
  createdAt: at,
  updatedAt: later,
} satisfies z.input<typeof ReconfigJob>;

export const jobRouteFixtures = {
  solverRunStart: {
    params: { tenant },
    body: { scenarioId: 'sc-custom-c', spec: solverProblemFixtures.min_risk_mix.spec, save: true },
    response: solverRun('min_risk_mix', {
      save: true,
      status: 'queued',
      progress: 0,
      inputHash: null,
      result: null,
      updatedAt: at,
    }),
  },
  solverRunQuick: {
    params: { tenant },
    body: { scenarioId: 'sc-custom-c', spec: solverProblemFixtures.goal_seek.spec },
    response: solverRun('goal_seek', { quick: true }),
  },
  solverRunLookup: {
    params: { tenant },
    query: { scenarioId: 'sc-custom-c', problem: 'monte_carlo' },
    response: { run: solverRun('monte_carlo', { cached: true }), current: true, trials: 2000 },
  },
  solverRunGet: {
    params: { tenant, id: 'job-monte_carlo' },
    response: solverRun('monte_carlo', {
      status: 'running',
      progress: 0.4,
      progressNote: 'Draw 800 of 2,000',
      result: null,
    }),
  },
  solverRunCancel: {
    params: { tenant, id: 'job-pareto' },
    response: solverRun('pareto', {
      status: 'running',
      progress: 0.6,
      progressNote: 'Bar 160',
      cancelRequested: true,
      result: null,
    }),
  },
  exportCreate: {
    params: { tenant },
    body: { scenarioIds: ['sc-preset-c'], sheets: ['Levers', 'Targets'], format: 'xlsx' },
    response: {
      id: 'exp-1',
      templateVersion: '1.0',
      format: 'xlsx',
      scenarioIds: ['sc-preset-c'],
      sheets: ['README', 'Targets', 'Levers', '_lists', '_meta'],
      file: {
        id: 'file-1',
        filename: 'zz_it_savings_C_20261120-0930.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 48213,
        expiresAt: '2026-12-20T09:30:00.000Z',
      },
      checksum: 'sha256:51ab',
      createdBy: 'u-1',
      createdAt: at,
    },
  },
  fileDownload: {
    params: { tenant, id: 'file-1' },
    response: {
      bytes: workbookBytes,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'zz_it_savings_C_20261120-0930.xlsx',
      size: workbookBytes.byteLength,
    },
  },
  importCreate: {
    params: { tenant },
    query: { filename: 'zz_it_savings_C_20261120-0930.xlsx' },
    body: workbookBytes,
    response: {
      ...importJob,
      status: null,
      progress: 0,
      report: null,
      ignored: { sheets: [], columns: [] },
    },
  },
  importGet: {
    params: { tenant, id: 'imp-1' },
    response: importJob,
  },
  importApply: {
    params: { tenant, id: 'imp-1' },
    body: {
      accept: 'all',
      decisions: [
        { sheet: 'Targets', key: 'g.target_net', member: '', scenario: null, take: 'excel' },
      ],
      clientRequestId: 'req-imp-1',
    },
    response: {
      importId: 'imp-1',
      changesetId: 'cs-10',
      editsCount: 2,
      scenarios: [
        { scenarioId: 'sc-custom-c', version: 4, editsCount: 3, forkedFrom: 'sc-preset-c' },
      ],
      warnings: [],
    },
  },
  aiReconfigStart: {
    body: { prompt: 'Set up Fixture Air', tenant: null, dryRun: true },
    response: {
      ...reconfigJob,
      status: 'estimated',
      step: 'scope',
      progress: 0.1,
      sources: [],
      facts: [],
      drafts: [],
      calibration: null,
      openQuestions: [],
      usage: null,
      updatedAt: at,
    },
  },
  aiReconfigList: {
    response: {
      jobs: [reconfigJob],
      parity: [{ tenant: 'zz', passed: 1005, total: 1005, recordedAt: at }],
    },
  },
  aiReconfigGet: {
    params: { id: 'ai-1' },
    response: reconfigJob,
  },
  aiReconfigApply: {
    params: { id: 'ai-1' },
    body: { drafts: ['seed'] },
    response: {
      jobId: 'ai-1',
      tenantId: 't-zz',
      tenant: 'zz',
      applied: [{ kind: 'seed', changesetId: 'cs-11', editsCount: 1840 }],
    },
  },
  marketRefresh: {
    params: { tenant },
    body: {
      source: 'manual',
      asOf: '2026-11-20',
      values: [
        { var: 'corp.price_now', member: '', value: 14.2 },
        { var: 'corp.brent', member: 'fy27', value: 78.5 },
      ],
    },
    response: {
      snapshotId: 'ms-1',
      asOf: '2026-11-20',
      source: 'Manual entry by Pat Owner',
      values: [
        { var: 'corp.price_now', member: '', from: 13.9, to: 14.2 },
        { var: 'corp.brent', member: 'fy27', from: 80, to: 78.5 },
      ],
      changesetId: 'cs-12',
    },
  },
} satisfies JobRouteFixtures;

/** One fixture per route of `apiRoutes` (CON-01 core + CON-03 job routes). */
export const apiRouteFixtures = {
  ...coreRouteFixtures,
  ...jobRouteFixtures,
} satisfies ApiRouteFixtures;
