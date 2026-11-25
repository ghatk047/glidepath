// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import axe from 'axe-core';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  WS_PROTOCOL_VERSION,
  apiRoutes,
  toCellKey,
  type ChangesetRequest,
  type QuickSolverRunRequest,
  type SolverRunRequest,
} from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  presetSnapshot,
  solverRunFixtures,
  specFixtures,
  type MockSession,
} from '@glidepath/api-contract/testing';
import { fmt } from '@glidepath/ui/format';
import { motionMs } from '@glidepath/ui/motion';
import { createAppRouter } from '../../app/router';
import { loadModule } from '../../app/modules';
import { COMMIT_DEBOUNCE_MS } from '../../commit';
import { createDataClient, createServerState } from '../../data';
import { createSessionClient } from '../../session';
import { OBJECTIVES, TARGET_VARIABLE } from './copy';

// ---------------------------------------------------------------------------------------------
// Fixtures: spec ids verbatim; session values from the generated golden fixtures, solver answers
// from the spec's reference run (docs/spec/reference/solver_demo_results.json). Never typed in.
// ---------------------------------------------------------------------------------------------

const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const tenant = specFixtures.tenant;
const presets = specFixtures.scenarios.scenarios;
const C = presetSnapshot('C');
const D = presetSnapshot('D');
const SCENARIO = C.scenarioId;
const presetId = (key: string) => presets.find((p) => p.key === key)!.id;
const bundle = specFixtures.bundle;
const tenantRow = { ...fx.tenants.response.tenants[0]!, slug: tenant };
const cell = (id: string) => C.cells[toCellKey(id, '')] as number;
const defOf = (id: string) => bundle.variables.find((v) => v.id === id)!;

const HERE = dirname(fileURLToPath(import.meta.url));
interface Moved {
  from: number;
  to: number;
}
interface TornadoRow {
  id: string;
  label: string;
  min: number;
  max: number;
  net_at_min: number;
  net_at_max: number;
  swing: number;
}
interface McRef {
  iterations: number;
  net_p10_p50_p90: [number, number, number];
  bar_p10_p50_p90: [number, number, number];
  prob_clear_bar: number;
}
const reference = JSON.parse(
  readFileSync(join(HERE, '../../../../../docs/spec/reference/solver_demo_results.json'), 'utf8'),
) as {
  min_risk_total_bar: {
    evaluations: number;
    steps: number;
    net: number;
    bar: number;
    risk_adj_net: number;
    risk_exposure: number;
    one_time_it: number;
    eps27: number;
    inputs_moved_from_C: Record<string, Moved>;
  };
  min_risk_total_and_vp_bars: { net: number; risk_exposure: number };
  min_risk_reference: { C_risk_exposure: number; D_risk_exposure: number };
  goal_seek_blend_C_to_D: {
    lambda: number;
    net: number;
    bar: number;
    risk_adj_net: number;
    one_time_it: number;
    eps27: number;
  };
  tornado_net_top15: TornadoRow[];
  monte_carlo_C: McRef;
  monte_carlo_D: McRef;
};
const ref = reference.min_risk_total_bar;
const allVps = reference.min_risk_total_and_vp_bars;

/**
 * Tier 2's answer to "Find a path", as API-09 will send it: the reference run's moves in an order
 * that is neither the registry's nor sorted by impact (the optimizer's order is whatever tier 2
 * says), its headline metrics, and the risk-exposure references of C and D.
 */
const moved = Object.entries(ref.inputs_moved_from_C).reverse();
const ranked = moved.map(([id, m], i) => ({
  cell: toCellKey(id, ''),
  from: m.from,
  to: m.to,
  impact: i + 1, // increasing on purpose: the UI must not re-sort
}));
const pathMetrics: Record<string, number> = {
  [toCellKey('res.net', '')]: ref.net,
  [toCellKey('res.bar', '')]: ref.bar,
  [toCellKey('res.risk', '')]: ref.risk_adj_net,
  [toCellKey('res.tot_ot_it', '')]: ref.one_time_it,
  // tier 2 reports the engine value; equal to the start scenario's, so "unchanged"
  [toCellKey('res.fte_us', '')]: cell('res.fte_us'),
  [toCellKey('br.eps27', '')]: ref.eps27,
  risk_exposure: ref.risk_exposure,
  'risk_exposure[C]': reference.min_risk_reference.C_risk_exposure,
  'risk_exposure[D]': reference.min_risk_reference.D_risk_exposure,
  'risk_exposure[allvps]': allVps.risk_exposure,
  // Savings-vs-risk reference nets tier 2 reports beside the risk references (MOD-07).
  'net[C]': cell('res.net'),
  'net[D]': D.cells[toCellKey('res.net', '')] as number,
  'net[allvps]': allVps.net,
  evaluations: ref.evaluations,
  steps: ref.steps,
};
const pathResult = {
  ...solverRunFixtures.min_risk_mix.result!,
  status: 'feasible' as const,
  changes: moved.map(([key, m]) => ({ target: 'variable' as const, key, member: '', value: m.to })),
  ranked,
  metrics: pathMetrics,
};
const JOB = 'job-path';
const queuedPath = {
  ...solverRunFixtures.min_risk_mix,
  id: JOB,
  scenarioId: SCENARIO,
  status: 'queued' as const,
  progress: 0,
  result: null,
};
const donePath = { ...queuedPath, status: 'done' as const, progress: 1, result: pathResult };

const blendRef = reference.goal_seek_blend_C_to_D;
const blendRun = {
  ...solverRunFixtures.scenario_blend,
  id: 'job-blend',
  scenarioId: SCENARIO,
  quick: true,
  spec: {
    problem: 'scenario_blend' as const,
    params: { from: presetId('C'), to: presetId('D') },
  },
  result: {
    ...solverRunFixtures.scenario_blend.result!,
    status: 'feasible' as const,
    metrics: {
      lambda: blendRef.lambda,
      [toCellKey('res.net', '')]: blendRef.net,
      [toCellKey('res.bar', '')]: blendRef.bar,
      [toCellKey('res.risk', '')]: blendRef.risk_adj_net,
      [toCellKey('res.tot_ot_it', '')]: blendRef.one_time_it,
      [toCellKey('br.eps27', '')]: blendRef.eps27,
    },
    detail: { problem: 'scenario_blend' as const, lambda: blendRef.lambda },
  },
};
const SAVED = 'sc-path-143';

// ---------------------------------------------------------------------------------------------
// MOD-07 analysis fixtures: the tornado, Monte Carlo and Pareto runs tier 2 answers.
// ---------------------------------------------------------------------------------------------

const NET = toCellKey('res.net', '');
const BAR = toCellKey('res.bar', '');

/** Tier 2's top-15 net sensitivity, already sorted by swing; `impact` is the signed net delta. */
const tornadoRanked = reference.tornado_net_top15.map((r) => ({
  cell: toCellKey(r.id, ''),
  from: r.min,
  to: r.max,
  impact: r.net_at_max - r.net_at_min,
}));
/** Tier 2's colour class for the inputs the fixture names (SOL-13: it rides on every sensitivity row); the rest are levers. */
const TIER2_CATEGORY: Readonly<Record<string, 'policy' | 'timing'>> = {
  'g.ot_out_share': 'policy',
  'g.ot_in_year': 'timing',
  'g.head_start': 'timing',
};
const tornadoRows = (
  category: (id: string) => 'lever' | 'policy' | 'timing' = (id) => TIER2_CATEGORY[id] ?? 'lever',
) =>
  reference.tornado_net_top15.map((r) => ({
    cell: toCellKey(r.id, ''),
    category: category(r.id),
    swing: r.swing,
    low: { input: r.min, output: r.net_at_min },
    high: { input: r.max, output: r.net_at_max },
    elasticity: null,
    first: null,
    total: null,
  }));
const sensitivityRunWith = (
  rows: ReturnType<typeof tornadoRows>,
  ranked: typeof tornadoRanked = tornadoRanked,
) => ({
  ...sensitivityRun,
  result: {
    ...sensitivityRun.result,
    ranked,
    detail: { ...sensitivityRun.result.detail, rows },
  },
});
const sensitivityRun = {
  ...solverRunFixtures.sensitivity,
  id: 'job-sens',
  scenarioId: SCENARIO,
  quick: true,
  spec: { problem: 'sensitivity' as const, params: { method: 'tornado' as const, outputs: [NET] } },
  result: {
    ...solverRunFixtures.sensitivity.result!,
    status: 'feasible' as const,
    ranked: tornadoRanked,
    metrics: { [NET]: ref.net },
    detail: {
      problem: 'sensitivity' as const,
      method: 'tornado' as const,
      output: NET,
      rows: [] as ReturnType<typeof tornadoRows>,
    },
  },
};
sensitivityRun.result.detail.rows = tornadoRows();

/** 20 bins over P10..P90 ± half the spread, a tent of counts (tier 2 bins the sample; the UI never does). */
function mcBins(mc: McRef) {
  const [p10, , p90] = mc.net_p10_p50_p90;
  const n = 20;
  const lo = p10 - (p90 - p10) / 2;
  const width = (2 * (p90 - p10)) / n;
  return Array.from({ length: n }, (_, i) => ({
    lo: lo + i * width,
    hi: lo + (i + 1) * width,
    count: Math.round(100 - Math.abs(i - (n - 1) / 2) * 8),
  }));
}
const mcRun = (id: string, scenarioId: string, mc: McRef) => {
  const [p10, p50, p90] = mc.net_p10_p50_p90;
  const [b10, b50, b90] = mc.bar_p10_p50_p90;
  return {
    ...solverRunFixtures.monte_carlo,
    id,
    scenarioId,
    quick: false,
    spec: { problem: 'monte_carlo' as const, params: {} },
    result: {
      ...solverRunFixtures.monte_carlo.result!,
      status: 'feasible' as const,
      metrics: { p_clear_bar: mc.prob_clear_bar },
      diagnostics: { iterations: mc.iterations, ms: 1 },
      detail: {
        problem: 'monte_carlo' as const,
        iterations: mc.iterations,
        seed: 1,
        percentiles: [
          { cell: NET, p10, p50, p90 },
          { cell: BAR, p10: b10, p50: b50, p90: b90 },
        ],
        probabilities: [{ cell: NET, against: BAR, p: mc.prob_clear_bar }],
        histograms: [{ cell: NET, bins: mcBins(mc) }],
        contributions: [],
      },
    },
  };
};
const mcC = mcRun('job-mc-c', SCENARIO, reference.monte_carlo_C);
const mcD = mcRun('job-mc-d', 'sc-D', reference.monte_carlo_D);

/** A Pareto frontier run (post-demo): feasible (risk, net) points the scatter curve connects. */
const frontierPoints = [
  { bar: 100, net: 119.3, risk: 37.3, oneTime: 20, feasible: true, scenarioId: null },
  { bar: 120, net: 143.0, risk: 42.0, oneTime: 20, feasible: true, scenarioId: null },
  { bar: 130, net: 148.1, risk: 43.6, oneTime: 20, feasible: true, scenarioId: null },
  { bar: 140, net: 166.9, risk: 54.8, oneTime: 20, feasible: true, scenarioId: null },
];
const paretoRun = {
  ...solverRunFixtures.pareto,
  id: 'job-pareto',
  scenarioId: SCENARIO,
  spec: { problem: 'pareto' as const, params: {} },
  result: {
    ...solverRunFixtures.pareto.result!,
    status: 'feasible' as const,
    detail: { problem: 'pareto' as const, points: frontierPoints },
  },
};

type Lookup = { run: object | null; current: boolean; trials: number | null };
const noneLookup = (problem: string): Lookup => ({
  run: null,
  current: false,
  trials: problem === 'monte_carlo' ? 2000 : null,
});

// ---------------------------------------------------------------------------------------------
// tier 2 double (msw; API-09 is mocked here) and the WS session, through the app router
// ---------------------------------------------------------------------------------------------

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined; // jsdom: the router restores scroll
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

interface Served {
  posts: ChangesetRequest[];
  starts: SolverRunRequest[];
  quicks: QuickSolverRunRequest[];
  lookupQueries: Record<string, string>[];
}

interface MountExtra {
  /** `GET /solver-runs/lookup` answers, keyed `${scenarioId}|${problem}` (default: nothing held). */
  lookups?: Record<string, Lookup>;
  /** `POST /solver-runs` (and `/quick`) answers for the analysis panels, keyed by problem. */
  analysis?: Record<string, object>;
}

function serve(
  start: (body: SolverRunRequest) => object,
  get: () => object,
  extra: MountExtra = {},
): Served {
  const posts: ChangesetRequest[] = [];
  const starts: SolverRunRequest[] = [];
  const quicks: QuickSolverRunRequest[] = [];
  const lookupQueries: Record<string, string>[] = [];
  let saved = false;
  server.use(
    // API-13: a side-effect-free read of what tier 2 holds for (scenario, problem, params).
    http.get(`${BASE}${apiRoutes.solverRunLookup.path}`, ({ request }) => {
      const query = Object.fromEntries(new URL(request.url).searchParams);
      lookupQueries.push(query);
      const problem = query['problem'] ?? '';
      const held = extra.lookups?.[`${query['scenarioId'] ?? ''}|${problem}`];
      return HttpResponse.json(held ?? noneLookup(problem));
    }),
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, () => HttpResponse.json({ tenants: [tenantRow] })),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(bundle)),
    http.get(`${BASE}${apiRoutes.members.path}`, () => HttpResponse.json(specFixtures.members)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () =>
      HttpResponse.json({
        scenarios: saved
          ? [
              ...presets,
              {
                ...presets[0]!,
                id: SAVED,
                key: 'path-143',
                label: 'Path to bar',
                kind: 'solver',
                parentId: SCENARIO,
              },
            ]
          : presets,
      }),
    ),
    http.get(`${BASE}${apiRoutes.scenarioInputs.path}`, ({ params }) =>
      HttpResponse.json({
        scenarioId: String(params['id']),
        version: 0,
        inputs: [],
        overrides: [],
      }),
    ),
    http.get(`${BASE}${apiRoutes.scenarioCalc.path}`, ({ params }) =>
      HttpResponse.json({
        ...fx.scenarioCalc.response,
        scenarioId: String(params['id']),
        stale: false,
      }),
    ),
    http.get(`${BASE}${apiRoutes.changesetHistory.path}`, ({ params }) =>
      HttpResponse.json({ scenarioId: String(params['id']), changesets: [], nextCursor: null }),
    ),
    http.post(`${BASE}${apiRoutes.changesetApply.path}`, async ({ request }) => {
      const body = (await request.json()) as ChangesetRequest;
      posts.push(body);
      return HttpResponse.json({
        ...fx.changesetApply.response,
        changesetId: `cs-${String(posts.length)}`,
        scenarioId: body.scenarioId,
        version: body.baseVersion + 1,
        editsCount: posts.length,
        outputs: {},
        forkedFrom: undefined,
      });
    }),
    http.post(`${BASE}${apiRoutes.solverRunStart.path}`, async ({ request }) => {
      const body = (await request.json()) as SolverRunRequest;
      starts.push(body);
      if (body.save) {
        saved = true;
        return HttpResponse.json(
          { ...donePath, id: 'job-save', save: true, cached: true, resultScenarioId: SAVED },
          { status: 201 },
        );
      }
      // The analysis panels (Odds) start their own problem; the Path flow stays with `start`.
      const answer =
        body.spec.problem === 'min_risk_mix' ? start(body) : extra.analysis?.[body.spec.problem];
      return HttpResponse.json(answer ?? start(body), { status: 201 });
    }),
    http.post(`${BASE}${apiRoutes.solverRunQuick.path}`, async ({ request }) => {
      const body = (await request.json()) as QuickSolverRunRequest;
      quicks.push(body);
      const answer =
        body.spec.problem === 'scenario_blend' ? blendRun : extra.analysis?.[body.spec.problem];
      return HttpResponse.json(answer ?? blendRun);
    }),
    http.get(`${BASE}${apiRoutes.solverRunGet.path}`, ({ params }) => {
      const id = String(params['id']);
      // The analysis panels re-read a started run once its job ends; answer by id.
      const byId =
        extra.analysis &&
        Object.values(extra.analysis).find((r) => (r as { id?: string }).id === id);
      return HttpResponse.json(byId ?? get());
    }),
  );
  return { posts, starts, quicks, lookupQueries };
}

async function mount(
  start: (body: SolverRunRequest) => object = () => donePath,
  get: () => object = () => donePath,
  extra: MountExtra = {},
) {
  const served = serve(start, get, extra);
  const mock: MockSession = createMockSession({
    snapshots: presets.map((p) => presetSnapshot(p.key)),
  });
  const frames: (() => void)[] = [];
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [`/${tenant}/${SCENARIO}/path`] }),
    {
      client: createDataClient({ baseUrl: BASE }),
      serverState: createServerState(),
      createSession: (t, s) =>
        createSessionClient({
          tenant: t,
          scenario: s,
          origin: 'ws://localhost:8080',
          connect: mock.connect,
          requestFrame: (cb) => void frames.push(cb),
          random: () => 0,
        }),
    },
  );
  await loadModule('path');
  const view = render(<RouterProvider router={router} />);
  const settle = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      await mock.flush();
    });
    act(() => {
      for (const cb of frames.splice(0)) cb();
    });
  };
  const until = async (check: () => void, tries = 300) => {
    for (let i = 0; ; i++) {
      await settle();
      try {
        check();
        return;
      } catch (e) {
        if (i > tries) throw e;
      }
    }
  };
  const debounce = async () => {
    await act(() => new Promise((r) => setTimeout(r, COMMIT_DEBOUNCE_MS + 50)));
    await settle();
  };
  /** Waits until every ranked move has landed (the stagger runs on real timers). */
  const landed = async () => {
    for (let i = 0; i < 100; i++) {
      if (rows().length === ranked.length) return;
      await act(() => new Promise((r) => setTimeout(r, motionMs('stagger'))));
    }
    expect(rows()).toHaveLength(ranked.length);
  };
  await until(() =>
    expect(screen.getByRole('button', { name: /^Goal / }).dataset['value']).toBe(
      String(cell('res.bar')),
    ),
  );
  return { ...served, mock, router, view, settle, until, debounce, landed };
}

const goal = () => screen.getByRole('region', { name: 'Goal' });
const result = () => screen.getByTestId('path-result');
const rows = () => [...document.querySelectorAll<HTMLElement>('ol.gp-path-moves > li')];
const find = () => within(goal()).getByRole('button', { name: /Find a path/ });
const scatter = () => screen.getByTestId('path-scatter');
const oddsPanel = () => screen.getByTestId('path-odds');
const tornadoPanel = () => screen.getByTestId('path-tornado');
const point = (label: string) => scatter().querySelector<HTMLElement>(`[data-point="${label}"]`);
/** Lookups that hand the Odds panel the Monte Carlo runs for C and D. */
const mcLookups = {
  [`${SCENARIO}|monte_carlo`]: { run: mcC, current: true, trials: 2000 },
  [`sc-D|monte_carlo`]: { run: mcD, current: true, trials: 2000 },
};
const tornadoLookup = {
  [`${SCENARIO}|sensitivity`]: { run: sensitivityRun, current: true, trials: null },
};
/** The bare swing label the tornado prints (chart `plain(v, 1)`): $M dropped, from `fmt`. */
const plainSwing = (v: number) => fmt.money(v, { digits: 1 }).replace(/^(−?)\$(.*)M$/, '$1$2');

// ---------------------------------------------------------------------------------------------

describe('AC1: goal, objective and constraints map to solver params', () => {
  it('goal (editable), objective radio cards and constraint toggles map to the contract min_risk_mix params', async () => {
    const t = await mount();
    const g = goal();
    // goal: the bar tier 2 pushed, "net, CY27"; editing it commits the net target
    const value = within(g).getByRole('button', { name: /^Goal / });
    expect(value.textContent).toBe(fmt.money(cell('res.bar')));
    expect(g.textContent).toContain('net, CY27');
    fireEvent.click(value);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(defOf(TARGET_VARIABLE).label);
    const field = within(dialog).getByRole('textbox');
    const next = defOf(TARGET_VARIABLE).max!;
    fireEvent.change(field, { target: { value: String(next) } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await t.debounce();
    await t.until(() =>
      expect(t.posts.at(-1)?.changes[0]).toMatchObject({ key: TARGET_VARIABLE, value: next }),
    );
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    // objective radio cards, in the render's order and words
    const group = within(g).getByRole('radiogroup', { name: 'Optimise for' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual([
      'Lowest delivery risk',
      'Most risk-adjusted savings',
      'Least one-time cost',
      'Fewest people moves',
      'Smallest change from plan',
    ]);
    expect(radios[0]!.checked).toBe(true);

    // constraint toggles: render defaults; stretch cap and estimates are always on (locked)
    const hold = within(g).getByRole('list', { name: 'Hold to' });
    const sw = (name: RegExp) => within(hold).getByRole('switch', { name }) as HTMLInputElement;
    expect(sw(/Every VP clears/).checked).toBe(false);
    expect(sw(/US headcount floor/).checked).toBe(true);
    expect(sw(/One-time in IT cap/).checked).toBe(false);
    expect([sw(/full stretch/).checked, sw(/full stretch/).disabled]).toEqual([true, true]);
    expect([sw(/Estimates stay fixed/).checked, sw(/Estimates stay fixed/).disabled]).toEqual([
      true,
      true,
    ]);
    // the floor and the cap start at the session's values
    const floor = within(hold).getByRole('textbox', { name: 'US headcount floor' });
    expect(floor.dataset['value']).toBe(String(cell('res.fte_us')));
    expect((floor as HTMLInputElement).value).toBe(fmt.fte(cell('res.fte_us')));
    const cap = within(hold).getByRole('textbox', { name: /One-time in IT cap/ });
    expect(cap.dataset['value']).toBe(String(cell('res.tot_ot_it')));

    // default: lowest risk, total + US floor
    fireEvent.click(find());
    await t.until(() => expect(t.starts).toHaveLength(1));
    expect(t.starts[0]).toEqual({
      scenarioId: SCENARIO,
      spec: {
        problem: 'min_risk_mix',
        params: {
          objective: 'min_risk_exposure',
          method: 'explainable',
          constraints: [{ id: 'total' }, { id: 'us_floor', value: cell('res.fte_us') }],
        },
      },
    });

    // every objective maps to its solvers.json key; every VP, cap (typed) and no floor
    fireEvent.click(sw(/Every VP clears/));
    fireEvent.click(sw(/US headcount floor/));
    fireEvent.click(sw(/One-time in IT cap/));
    fireEvent.change(cap, { target: { value: '$25M' } });
    for (const [i, o] of OBJECTIVES.entries()) {
      fireEvent.click(radios[i]!);
      await t.until(() => expect(find()).toHaveProperty('disabled', false));
      fireEvent.click(find());
      await t.until(() => expect(t.starts).toHaveLength(i + 2));
      expect(t.starts.at(-1)!.spec).toEqual({
        problem: 'min_risk_mix',
        params: {
          objective: o.id,
          method: 'explainable',
          constraints: [{ id: 'total' }, { id: 'per_vp' }, { id: 'one_time_cap', value: 25 }],
        },
      });
    }
  });
});

describe('MOD-11: GCC hiring-capacity constraint', () => {
  it("a 'GCC' switch (prefilled from the bundle's solver default, editable) adds gcc_hiring to the run params and Find a path reruns with it", async () => {
    const t = await mount();
    const hold = within(goal()).getByRole('list', { name: 'Hold to' });
    const sw = within(hold).getByRole('switch', { name: /GCC/ }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    const input = within(hold).getByRole('textbox', { name: /GCC/ }) as HTMLInputElement;
    const capacity = bundle.solverDefaults.gcc_hiring!;
    expect(input.dataset['value']).toBe(String(capacity));
    expect(input.value).toBe(fmt.fte(capacity));

    fireEvent.click(find());
    await t.until(() => expect(t.starts).toHaveLength(1));
    expect(JSON.stringify(t.starts[0]!.spec)).not.toContain('gcc_hiring');

    fireEvent.click(sw);
    expect(sw.checked).toBe(true);
    await t.until(() => expect(find()).toHaveProperty('disabled', false));
    fireEvent.click(find());
    await t.until(() => expect(t.starts).toHaveLength(2));
    expect(t.starts[1]!.spec).toMatchObject({
      problem: 'min_risk_mix',
      params: {
        constraints: [
          { id: 'total' },
          { id: 'us_floor', value: cell('res.fte_us') },
          { id: 'gcc_hiring', value: capacity },
        ],
      },
    });

    // the capacity is editable like every number
    fireEvent.change(input, { target: { value: '120' } });
    await t.until(() => expect(find()).toHaveProperty('disabled', false));
    fireEvent.click(find());
    await t.until(() => expect(t.starts).toHaveLength(3));
    expect(t.starts[2]!.spec).toMatchObject({
      params: { constraints: expect.arrayContaining([{ id: 'gcc_hiring', value: 120 }]) },
    });
  });
});

describe('AC2: Find a path runs the job and lands the moves', () => {
  it("'Find a path' starts min_risk_mix, shows job progress, then lands moves one by one with a 90 ms stagger in optimizer order", async () => {
    let finished = false;
    const t = await mount(
      () => queuedPath,
      () => (finished ? donePath : { ...queuedPath, status: 'running' }),
    );
    fireEvent.click(find());
    await t.until(() => expect(t.starts).toHaveLength(1));
    expect(t.starts[0]!.spec.problem).toBe('min_risk_mix');

    // progress: the job messages tier 2 sends, shown as sent
    const note = `Searching ${fmt.fte(ref.evaluations)} combinations`;
    await t.mock.replay([
      { v: WS_PROTOCOL_VERSION, type: 'job', id: JOB, status: 'running', progress: 0.4, note },
    ]);
    const panel = screen.getByRole('region', { name: /Finding a path · lowest risk/ });
    await t.until(() => {
      const bar = within(panel).getByRole('progressbar', { name: 'Job progress' });
      expect(bar.getAttribute('aria-valuenow')).toBe('0.4');
      expect(bar.getAttribute('aria-valuetext')).toBe(note);
    });
    expect(within(panel).queryByTestId('path-result')).toBeNull();

    // done: the result is read, then the moves land one by one, 90 ms apart, in tier 2's order
    const delays: unknown[] = [];
    const real = window.setInterval.bind(window);
    vi.spyOn(window, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms);
      return real(fn, ms);
    }) as typeof window.setInterval);
    const seen: number[] = [];
    const watch = new MutationObserver(() => {
      if (seen.at(-1) !== rows().length) seen.push(rows().length);
    });
    watch.observe(document.body, { childList: true, subtree: true });
    finished = true;
    await t.mock.replay([
      { v: WS_PROTOCOL_VERSION, type: 'job', id: JOB, status: 'done', progress: 1, note: null },
    ]);
    await t.until(() => expect(screen.getByTestId('path-result')).toBeTruthy());
    await t.landed();
    watch.disconnect();

    expect(delays).toContain(motionMs('stagger'));
    expect(motionMs('stagger')).toBe(90); // the screens doc's 90 ms, from the motion token
    expect(seen[0]).toBeLessThanOrEqual(1);
    expect(seen.filter((n) => n > 0)).toEqual(ranked.map((_, i) => i + 1));
    expect(rows().map((r) => r.dataset['cell'])).toEqual(ranked.map((m) => m.cell));
    expect(rows().map((r) => r.textContent!.slice(0, 2))).toEqual(
      ranked.map((_, i) => String(i + 1).padStart(2, '0')),
    );
    expect(screen.getByRole('region', { name: 'Path found · lowest risk' })).toBeTruthy();
  });
});

describe('WIZ-08: the compute indicator while a path is found', () => {
  it("shows the inline flow in the header and the field flow above 'Finding a path…' until the result lands", async () => {
    const t = await mount(
      () => queuedPath,
      () => ({ ...queuedPath, status: 'running' }),
    );
    expect(document.querySelector('[data-testid="path-flow"]')).toBeNull();
    fireEvent.click(find());
    await t.until(() => expect(t.starts).toHaveLength(1));
    await t.until(() => {
      const flow = screen.getByTestId('path-flow').querySelector('.gp-compute');
      expect(flow!.getAttribute('data-variant')).toBe('field');
      expect(screen.getByTestId('path-flow').parentElement!.textContent).toContain('Finding a path…');
    });
    await t.mock.replay([
      {
        v: WS_PROTOCOL_VERSION,
        type: 'job',
        id: JOB,
        status: 'running',
        progress: 0.4,
        note: null,
      },
    ]);
    await t.until(() => {
      const panel = screen.getByRole('region', { name: /Finding a path · lowest risk/ });
      expect(panel.querySelector('header .gp-compute[data-variant="inline"]')).toBeTruthy();
    });
  });
});

describe('AC3: Blend C → D', () => {
  it("'Blend C → D' runs quick scenario_blend and shows the result", async () => {
    const t = await mount();
    fireEvent.click(within(goal()).getByRole('button', { name: 'Blend C → D' }));
    await t.until(() => expect(t.quicks).toHaveLength(1));
    expect(t.quicks[0]).toEqual({
      scenarioId: SCENARIO,
      spec: { problem: 'scenario_blend', params: { from: presetId('C'), to: presetId('D') } },
    });
    expect(t.starts).toHaveLength(0);
    await t.until(() => expect(result().dataset['status']).toBe('feasible'));
    const panel = screen.getByRole('region', { name: 'Blend C → D' });
    const r = result();
    expect(r.querySelector('.gp-path-hero')!.getAttribute('data-value')).toBe(String(blendRef.net));
    expect(r.querySelector('.gp-path-hero')!.textContent).toBe(`${fmt.money(blendRef.net)}`);
    expect(within(panel).getByText(/Bar cleared$/)).toBeTruthy();
    const line = r.querySelector('.gp-path-lambda')!;
    expect(line.getAttribute('data-value')).toBe(String(blendRef.lambda));
    expect(line.textContent).toBe(
      `Bar cleared ${fmt.pct(blendRef.lambda, { digits: 0 })} of the way from C to D`,
    );
    expect(r.textContent).toContain(fmt.money(blendRef.one_time_it));
    expect(r.textContent).toContain(fmt.signed(blendRef.eps27, 'eps'));
  });
});

describe('AC4: the result', () => {
  it("result: net, 'Bar cleared' chip, risk exposure with C and D references, one-time, US headcount, EPS; ranked MoveRows; save as scenario; compare with C", async () => {
    const t = await mount();
    fireEvent.click(find());
    await t.until(() => expect(result()).toBeTruthy());
    await t.landed();
    const r = result();
    const panel = screen.getByRole('region', { name: 'Path found · lowest risk' });
    expect(within(panel).getByTestId('path-search').textContent).toBe(
      `${fmt.fte(ref.evaluations)} evaluations · ${fmt.fte(ref.steps)} steps`,
    );

    // headline numbers, exactly the metrics tier 2 sent
    const hero = r.querySelector<HTMLElement>('.gp-path-hero')!;
    expect(hero.dataset['value']).toBe(String(ref.net));
    expect(hero.textContent).toBe(fmt.money(ref.net));
    const chip = r.querySelector<HTMLElement>('.gp-chip')!;
    expect([chip.dataset['status'], chip.textContent?.includes('Bar cleared')]).toEqual([
      'clear',
      true,
    ]);
    const stat = (label: string) =>
      r.querySelector<HTMLElement>(`.gp-path-stat[data-metric="${label}"]`)!;
    const val = (label: string) => stat(label).querySelector<HTMLElement>('[data-value]')!;
    expect(val('Risk exposure').dataset['value']).toBe(String(ref.risk_exposure));
    expect(val('Risk exposure').textContent).toBe(fmt.money(ref.risk_exposure));
    expect(stat('Risk exposure').textContent).toContain(
      `C: ${fmt.money(reference.min_risk_reference.C_risk_exposure)} · D: ${fmt.money(
        reference.min_risk_reference.D_risk_exposure,
      )}`,
    );
    expect(val('One-time in IT').textContent).toBe(fmt.money(ref.one_time_it));
    expect(val('US headcount').textContent).toBe(fmt.fte(cell('res.fte_us')));
    expect(stat('US headcount').textContent).toContain('unchanged');
    expect(val('EPS 27').textContent).toBe(fmt.signed(ref.eps27, 'eps'));

    // ranked move rows: label, track and "from → to" from the bundle's definitions
    expect(screen.getByText('Moves from C, most valuable first')).toBeTruthy();
    expect(screen.getByText('grey tick = C')).toBeTruthy();
    for (const [i, row] of rows().entries()) {
      const move = ranked[i]!;
      const id = move.cell.replace(/\[\]$/, '');
      const group = within(row).getByRole('group');
      expect(group.dataset['variableId']).toBe(id);
      expect(group.getAttribute('aria-label')).toContain(defOf(id).label);
    }

    // compare with C: the start scenario's session cells beside the result's metrics
    fireEvent.click(within(r).getByRole('button', { name: 'Compare with C' }));
    const table = await within(r).findByRole('table', { name: 'Path compared with C' });
    const line = (node: string) => table.querySelector<HTMLElement>(`tr[data-node="${node}"]`)!;
    await t.until(() =>
      expect(
        line('res.net')
          .querySelector('[data-side="start"] [data-value]')!
          .getAttribute('data-value'),
      ).toBe(String(cell('res.net'))),
    );
    expect(line('res.net').querySelector('[data-side="result"]')!.textContent).toBe(
      fmt.money(ref.net),
    );
    expect(
      line('br.eps27')
        .querySelector('[data-side="start"] [data-value]')!
        .getAttribute('data-value'),
    ).toBe(String(cell('br.eps27')));
    expect(
      within(r).getByRole('button', { name: 'Compare with C' }).getAttribute('aria-pressed'),
    ).toBe('true');

    // save as scenario: the same spec again with save, then the URL moves to the new scenario
    fireEvent.click(within(r).getByRole('button', { name: 'Save as scenario' }));
    await t.until(() => expect(t.starts).toHaveLength(2));
    expect(t.starts[1]).toEqual({ ...t.starts[0], save: true });
    await t.until(() => expect(t.router.state.location.pathname).toBe(`/${tenant}/${SAVED}/path`));
  });
});

describe('AC5: every value from the session or the API', () => {
  it('values equal the fixtures; the module computes nothing', async () => {
    const t = await mount();
    fireEvent.click(find());
    await t.until(() => expect(result()).toBeTruthy());
    await t.landed();
    // every number on the result carries the value tier 2 sent
    const sent = new Set([...Object.values(pathMetrics), ...ranked.map((m) => m.impact)]);
    for (const el of result().querySelectorAll<HTMLElement>('[data-value]')) {
      expect(sent.has(Number(el.dataset['value'])), el.outerHTML).toBe(true);
    }
    // the move rows show tier 2's from / to as the bundle formats them, nothing derived
    for (const [i, row] of rows().entries()) {
      expect(row.dataset['impact']).toBe(String(ranked[i]!.impact));
    }
    // no arithmetic helpers or formatting outside `fmt` in the module's sources
    const files = readdirSync(HERE).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.tsx'));
    for (const f of files) {
      const src = readFileSync(join(HERE, f), 'utf8');
      expect(src, f).not.toMatch(/Math\.|toFixed|toLocaleString|Intl\.|\.reduce\(/);
      expect(src, f).not.toMatch(
        /from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/tier2|@glidepath\/(engine|solvers|domain)/,
      );
    }
  });
});

describe('AC-MOD07-1: savings vs risk scatter', () => {
  it('plots C, Path, All VPs and D from tier-2 metrics with the bar line; the frontier shows only with a Pareto result', async () => {
    const t = await mount();
    fireEvent.click(find());
    await t.until(() => expect(point('Path')).toBeTruthy());

    // the four points sit at the (risk, net) the Path run reported — nothing derived here
    const at = (label: string) => {
      const g = point(label)!;
      return [g.dataset['x'], g.dataset['y']];
    };
    expect(at('Path')).toEqual([String(ref.risk_exposure), String(ref.net)]);
    expect(at('C')).toEqual([
      String(reference.min_risk_reference.C_risk_exposure),
      String(cell('res.net')),
    ]);
    expect(at('All VPs')).toEqual([String(allVps.risk_exposure), String(allVps.net)]);
    expect(at('D')).toEqual([
      String(reference.min_risk_reference.D_risk_exposure),
      String(D.cells[toCellKey('res.net', '')]),
    ]);

    // the bar line is res.bar; no Pareto run, so no frontier curve
    const barLine = scatter().querySelector<HTMLElement>('[data-part="bar-line"]')!;
    expect(barLine.dataset['value']).toBe(String(ref.bar));
    expect(scatter().querySelector('[data-part="frontier"]')).toBeNull();
  });

  it('draws the frontier curve when a Pareto run exists (post-demo)', async () => {
    const t = await mount(
      () => donePath,
      () => donePath,
      {
        lookups: { [`${SCENARIO}|pareto`]: { run: paretoRun, current: true, trials: null } },
      },
    );
    fireEvent.click(find());
    await t.until(() => expect(point('Path')).toBeTruthy());
    await t.until(() => expect(scatter().querySelector('[data-part="frontier"]')).toBeTruthy());
    expect(
      t.lookupQueries.some((q) => q['problem'] === 'pareto' && q['scenarioId'] === SCENARIO),
    ).toBe(true);
  });
});

describe('AC-MOD07-2: odds', () => {
  it('shows P(clear) for C and D and the D histogram from the Monte Carlo runs', async () => {
    const t = await mount(
      () => donePath,
      () => donePath,
      { lookups: mcLookups },
    );
    await t.until(() =>
      expect(oddsPanel().querySelector('[data-scenario="C"] [data-clear]')).toBeTruthy(),
    );
    const clearOf = (name: string) =>
      oddsPanel().querySelector<HTMLElement>(`[data-scenario="${name}"] [data-clear]`)!;
    expect(clearOf('C').dataset['clear']).toBe(String(reference.monte_carlo_C.prob_clear_bar));
    expect(clearOf('C').textContent).toBe('0%');
    expect(clearOf('D').dataset['clear']).toBe(String(reference.monte_carlo_D.prob_clear_bar));
    expect(clearOf('D').textContent).toBe('4.5%');
    // the full-stretch (D) net histogram, bound by name
    expect(
      within(oddsPanel()).getByRole('img', { name: 'Distribution of net savings for D' }),
    ).toBeTruthy();
  });

  it('offers a run action when a scenario has not been simulated (tier 2 trial count)', async () => {
    const t = await mount(
      () => donePath,
      () => donePath,
      { analysis: { monte_carlo: mcD } },
    );
    await t.until(() =>
      expect(within(oddsPanel()).getByText('D has not been simulated.')).toBeTruthy(),
    );
    // the trial count on the action is tier 2's (the look-up's 2,000), never a literal
    const action = oddsPanel().querySelector<HTMLElement>('.gp-empty-action')!;
    expect(action.textContent).toBe(`Run ${fmt.fte(2000)} trials`);
    fireEvent.click(action);
    await t.until(() =>
      expect(
        t.starts.some(
          (s) => s.spec.problem === 'monte_carlo' && s.scenarioId === 'sc-D' && s.save === false,
        ),
      ).toBe(true),
    );
    await t.until(() =>
      expect(
        within(oddsPanel()).getByRole('img', { name: /Distribution of net savings for D/ }),
      ).toBeTruthy(),
    );
  });
});

describe('AC-MOD07-3: what moves net most (tornado)', () => {
  it('shows the top ten inputs in tier 2 swing order, policy and timing amber by category', async () => {
    const t = await mount(
      () => donePath,
      () => donePath,
      { lookups: tornadoLookup },
    );
    await t.until(() =>
      expect(tornadoPanel().querySelectorAll('[data-part="row"]').length).toBe(10),
    );
    const trows = [...tornadoPanel().querySelectorAll<HTMLElement>('[data-part="row"]')];
    const top = reference.tornado_net_top15.slice(0, 10);
    // tier 2's order is kept; tier 1 does not re-sort
    expect(trows.map((r) => r.dataset['variableId'])).toEqual(top.map((r) => r.id));
    // the swing drawn is the row's swing in $M, the value tier 2 sent
    expect(trows[0]!.querySelector('[data-part="value"]')!.textContent).toBe(
      plainSwing(top[0]!.swing),
    );
    // policy and timing inputs are amber by category; levers are blue
    const cat = (id: string) =>
      tornadoPanel().querySelector<HTMLElement>(`[data-variable-id="${id}"]`)!.dataset['category'];
    expect(cat('g.ot_out_share')).toBe('policy');
    expect(cat('g.ot_in_year')).toBe('timing');
    expect(cat('g.head_start')).toBe('timing');
    expect(cat('lev.L10.ren')).toBe('lever');
    expect(cat('hc.ctr')).toBe('lever');
  });

  it("SOL-13: draws tier 2's category and swing as sent; it classifies nothing and takes no magnitude", async () => {
    // Tier 2 says the opposite of what the registry group would: lev.L10.ren is timing, g.ot_out_share a lever.
    // `ranked` is empty and its impacts would be signed: the bars must come from the rows alone.
    const flipped = (id: string) =>
      id === 'lev.L10.ren' ? 'timing' : id === 'g.ot_out_share' ? 'lever' : 'policy';
    const run = sensitivityRunWith(tornadoRows(flipped), []);
    const t = await mount(
      () => donePath,
      () => donePath,
      {
        lookups: { [`${SCENARIO}|sensitivity`]: { run, current: true, trials: null } },
      },
    );
    await t.until(() =>
      expect(tornadoPanel().querySelectorAll('[data-part="row"]').length).toBe(10),
    );
    const cat = (id: string) =>
      tornadoPanel().querySelector<HTMLElement>(`[data-variable-id="${id}"]`)!.dataset['category'];
    expect(cat('lev.L10.ren')).toBe('timing');
    expect(cat('g.ot_out_share')).toBe('lever');
    expect(cat('g.head_start')).toBe('policy');
    const first = [...tornadoPanel().querySelectorAll<HTMLElement>('[data-part="row"]')][0]!;
    expect(first.querySelector('[data-part="value"]')!.textContent).toBe(
      plainSwing(reference.tornado_net_top15[0]!.swing),
    );
  });

  it("SOL-13: a row without tier 2's category or swing is not drawn", async () => {
    const rows = tornadoRows();
    const { category: _c, ...noCategory } = rows[0]!;
    const { swing: _s, ...noSwing } = rows[1]!;
    void _c;
    void _s;
    const run = sensitivityRunWith([noCategory, noSwing, ...rows.slice(2)] as typeof rows);
    const t = await mount(
      () => donePath,
      () => donePath,
      {
        lookups: { [`${SCENARIO}|sensitivity`]: { run, current: true, trials: null } },
      },
    );
    await t.until(() =>
      expect(tornadoPanel().querySelectorAll('[data-part="row"]').length).toBe(10),
    );
    const ids = [...tornadoPanel().querySelectorAll<HTMLElement>('[data-part="row"]')].map(
      (r) => r.dataset['variableId'],
    );
    expect(ids).toEqual(reference.tornado_net_top15.slice(2, 12).map((r) => r.id));
  });

  it('runs a quick sensitivity when the scenario has none', async () => {
    const t = await mount(
      () => donePath,
      () => donePath,
      { analysis: { sensitivity: sensitivityRun } },
    );
    await t.until(() =>
      expect(within(tornadoPanel()).getByRole('button', { name: 'Run sensitivity' })).toBeTruthy(),
    );
    fireEvent.click(within(tornadoPanel()).getByRole('button', { name: 'Run sensitivity' }));
    await t.until(() => expect(t.quicks.some((q) => q.spec.problem === 'sensitivity')).toBe(true));
    const sent = t.quicks.find((q) => q.spec.problem === 'sensitivity')!;
    expect(sent).toMatchObject({
      scenarioId: SCENARIO,
      spec: { problem: 'sensitivity', params: { method: 'tornado', outputs: [NET] } },
      save: false,
    });
    await t.until(() =>
      expect(tornadoPanel().querySelectorAll('[data-part="row"]').length).toBe(10),
    );
  });
});

describe('AC-MOD07-4: every analysis value from tier 2', () => {
  it('scatter, odds and tornado values equal the fixtures (the module computes nothing)', async () => {
    const t = await mount(
      () => donePath,
      () => donePath,
      {
        lookups: { ...mcLookups, ...tornadoLookup },
      },
    );
    fireEvent.click(find());
    await t.until(() => expect(point('Path')).toBeTruthy());
    await t.until(() => expect(oddsPanel().querySelector('[data-clear]')).toBeTruthy());
    await t.until(() =>
      expect(tornadoPanel().querySelectorAll('[data-part="row"]').length).toBe(10),
    );
    // every scatter coordinate is a metric tier 2 sent
    const metricValues = new Set(Object.values(pathMetrics).map(String));
    for (const g of scatter().querySelectorAll<HTMLElement>('[data-point]')) {
      expect(metricValues.has(g.dataset['x'] ?? ''), g.outerHTML).toBe(true);
      expect(metricValues.has(g.dataset['y'] ?? ''), g.outerHTML).toBe(true);
    }
    // the tornado swings equal the swing of the rows tier 2 sent
    const swings = new Set(reference.tornado_net_top15.map((r) => plainSwing(r.swing)));
    for (const v of tornadoPanel().querySelectorAll<HTMLElement>('[data-part="value"]')) {
      expect(swings.has(v.textContent ?? ''), v.textContent ?? '').toBe(true);
    }
  });
});

describe('G12: accessibility', () => {
  it('has no serious or critical axe violations (empty and with a result)', async () => {
    const t = await mount(
      () => donePath,
      () => donePath,
      {
        lookups: { ...mcLookups, ...tornadoLookup },
      },
    );
    const run = async () => {
      const out = await axe.run(t.view.container, {
        rules: { 'color-contrast': { enabled: false } }, // jsdom has no layout or colours
      });
      return out.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.help}`);
    };
    expect(await run()).toEqual([]);
    fireEvent.click(find());
    await t.until(() => expect(result()).toBeTruthy());
    await t.landed();
    await t.until(() => expect(point('Path')).toBeTruthy());
    fireEvent.click(within(result()).getByRole('button', { name: 'Compare with C' }));
    expect(await run()).toEqual([]);
  });
});
