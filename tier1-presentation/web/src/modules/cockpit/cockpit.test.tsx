// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import axe from 'axe-core';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  SolverRun,
  apiRoutes,
  toCellKey,
  type BridgeView,
  type ChangesetRequest,
  MembersResponse,
  type SolverLookup,
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
import { vpColour } from '@glidepath/ui/charts/gauge';
import { fmt } from '@glidepath/ui/format';
import { formatByUnit } from '@glidepath/ui/inputs/slider';
import { createAppRouter } from '../../app/router';
import { loadModule } from '../../app/modules';
import { COMMIT_DEBOUNCE_MS } from '../../commit';
import { viewStore } from '../../app/view-store';
import { createDataClient, createServerState } from '../../data';
import { createSessionClient } from '../../session';
import {
  BRIDGE_CELLS,
  COPY,
  HERO_LABELS,
  MOVE_LABELS,
  NET_NODES,
  PATH_METRICS,
  PATH_TOP_MOVES,
  SHAREHOLDER_NODES,
  SHAREHOLDER_YEARS,
  TARGET_VARIABLE,
  VP_LABELS,
  VP_NODES,
} from './copy';
import { resetCockpitRuns } from './runs';
import { gaugeMax } from './scale';
// the spec's reference solver runs (test data only; tier 2 produces these at run time)
import solverReference from '../../../../../docs/spec/reference/solver_demo_results.json';

type SolverRunIn = SolverRun;

// ---------------------------------------------------------------------------------------------
// Fixtures: spec ids verbatim; every value read from the generated fixtures (never typed in).
// ---------------------------------------------------------------------------------------------

const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const tenant = specFixtures.tenant;
const presets = specFixtures.scenarios.scenarios;
const C = presetSnapshot('C');
const SCENARIO = C.scenarioId;
const bundle = specFixtures.bundle;
const tenantRow = { ...fx.tenants.response.tenants[0]!, slug: tenant };

const cell = (id: string) => C.cells[toCellKey(id, '')] as number;
const heroIds = bundle.variables.filter((v) => v.ui.hero).map((v) => v.id);
const defOf = (id: string) => bundle.variables.find((v) => v.id === id)!;

/**
 * The `bridge` view tier 2 (DOM-06) sends for preset C, assembled here from the golden cells the
 * way the contract documents it (tests play tier 2; the module never does this arithmetic).
 */
function bridgePayload(cells: Record<string, number>): BridgeView {
  const [base, growth, iy, ot, outlay] = BRIDGE_CELLS.map((id) => cells[toCellKey(id, '')]!);
  const targetOutlay = base! - cells[toCellKey(NET_NODES.target, '')]!;
  return {
    steps: [
      { key: 'base', cell: toCellKey(BRIDGE_CELLS[0], ''), value: base!, from: 0, to: base! },
      {
        key: 'growth',
        cell: toCellKey(BRIDGE_CELLS[1], ''),
        value: growth!,
        from: base!,
        to: base! + growth!,
      },
      {
        key: 'savings',
        cell: toCellKey(BRIDGE_CELLS[2], ''),
        value: -iy!,
        from: base! + growth!,
        to: base! + growth! - iy!,
      },
      {
        key: 'oneTime',
        cell: toCellKey(BRIDGE_CELLS[3], ''),
        value: ot!,
        from: base! + growth! - iy!,
        to: outlay!,
      },
      { key: 'outlay', cell: toCellKey(BRIDGE_CELLS[4], ''), value: outlay!, from: 0, to: outlay! },
    ],
    targetOutlay,
    gap: outlay! - targetOutlay,
  };
}
const bridgeView = (cells: Record<string, number>, seq: number | null = null) => ({
  v: 1 as const,
  type: 'view' as const,
  view: 'bridge' as const,
  params: {},
  seq,
  payload: bridgePayload(cells),
});

// ---------------------------------------------------------------------------------------------
// tier 2 double (msw) and the WS session (the contract's mock session), through the app router
// ---------------------------------------------------------------------------------------------

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined; // jsdom: the router restores scroll
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  viewStore.getState().closePanel?.('commandPalette');
  resetCockpitRuns();
});
afterAll(() => server.close());

interface MountOptions {
  /** `/members` answer (default: the generated AA members). */
  members?: MembersResponse;
  /** Preset C's snapshot (default: the generated golden snapshot). */
  snapshotC?: typeof C;
  /** `GET /solver-runs/lookup` answers by problem (default: nothing held; Monte Carlo trials 2,000, as tier 2's default). */
  lookups?: Partial<Record<string, SolverLookup>>;
  /** `POST /solver-runs` answers by problem, in order (none left: a 404 problem). */
  starts?: Partial<Record<string, SolverRunIn[]>>;
  /** `GET /solver-runs/:id` answers by id. */
  runs?: Record<string, SolverRunIn>;
}

function serve(options: MountOptions = {}) {
  const posts: ChangesetRequest[] = [];
  const solverStarts: SolverRunRequest[] = [];
  const solverLookups: Record<string, string>[] = [];
  const solverGets: string[] = [];
  const solverCancels: string[] = [];
  const starts = Object.fromEntries(
    Object.entries(options.starts ?? {}).map(([k, v]) => [k, [...(v ?? [])]]),
  );
  server.use(
    http.get(`${BASE}${apiRoutes.members.path}`, () =>
      HttpResponse.json(options.members ?? specFixtures.members),
    ),
    // before `:id`: the lookup is a read that tier 2 answers from what it holds
    http.get(`${BASE}${apiRoutes.solverRunLookup.path}`, ({ request }) => {
      const query = Object.fromEntries(new URL(request.url).searchParams);
      solverLookups.push(query);
      const held = options.lookups?.[query['problem'] ?? ''];
      const none: SolverLookup = {
        run: null,
        current: false,
        trials: query['problem'] === 'monte_carlo' ? 2000 : null,
      };
      return HttpResponse.json(held ?? none);
    }),
    http.post(`${BASE}${apiRoutes.solverRunStart.path}`, async ({ request }) => {
      const body = (await request.json()) as SolverRunRequest;
      solverStarts.push(body);
      const next = starts[body.spec.problem]?.shift();
      return next
        ? HttpResponse.json(next, { status: apiRoutes.solverRunStart.status })
        : HttpResponse.json(
            { type: 'about:blank', title: 'Not found', status: 404, detail: 'No such route' },
            { status: 404, headers: { 'content-type': 'application/problem+json' } },
          );
    }),
    http.delete(`${BASE}${apiRoutes.solverRunCancel.path}`, ({ params }) => {
      const id = String(params['id']);
      solverCancels.push(id);
      return HttpResponse.json(
        SolverRun.parse({
          ...solverRunFixtures.monte_carlo,
          id,
          status: 'queued',
          progress: 0,
          result: null,
          cancelRequested: true,
        }),
      );
    }),
    http.get(`${BASE}${apiRoutes.solverRunGet.path}`, ({ params }) => {
      const id = String(params['id']);
      solverGets.push(id);
      const run = options.runs?.[id];
      return run
        ? HttpResponse.json(run)
        : HttpResponse.json(
            { type: 'about:blank', title: 'Not found', status: 404, detail: 'No such run' },
            { status: 404, headers: { 'content-type': 'application/problem+json' } },
          );
    }),
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, () => HttpResponse.json({ tenants: [tenantRow] })),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(bundle)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () => HttpResponse.json({ scenarios: presets })),
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
  );
  return { posts, solverStarts, solverLookups, solverGets, solverCancels };
}

async function mount(options: MountOptions = {}) {
  const served = serve(options);
  const mock: MockSession = createMockSession({
    snapshots: presets.map((p) =>
      p.key === 'C' && options.snapshotC ? options.snapshotC : presetSnapshot(p.key),
    ),
    views: [bridgeView(C.cells as Record<string, number>)],
  });
  const frames: (() => void)[] = [];
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [`/${tenant}/${SCENARIO}/cockpit`] }),
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
  await loadModule('cockpit');
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
  const until = async (check: () => void) => {
    for (let i = 0; ; i++) {
      await settle();
      try {
        check();
        return;
      } catch (e) {
        if (i > 60) throw e;
      }
    }
  };
  /** Waits out the commit queue's debounce, then settles. */
  const debounce = async () => {
    await act(() => new Promise((r) => setTimeout(r, COMMIT_DEBOUNCE_MS + 50)));
    await settle();
  };
  return { ...served, mock, router, view, settle, until, debounce };
}

const panel = (id: string) => screen.getByTestId(id);
const valueOf = (root: HTMLElement, node: string) =>
  Number(
    root.querySelector<HTMLElement>(
      `[data-node="${node}"] [data-value], [data-node="${node}"][data-value]`,
    )?.dataset['value'],
  );
const heroValue = () =>
  Number(
    panel('cockpit-net').querySelector<HTMLElement>('.gp-cockpit-hero [data-value]')?.dataset[
      'value'
    ],
  );
const notchText = (kind: 'bar' | 'target') =>
  panel('cockpit-net').querySelector(`[data-mark="${kind}"] text`)?.textContent;

const loaded = async (t: Awaited<ReturnType<typeof mount>>) =>
  t.until(() => {
    expect(heroValue()).toBe(cell(NET_NODES.net));
    expect(panel('cockpit-bridge').querySelector('svg.gp-bridge')).not.toBeNull();
    expect(within(panel('cockpit-inputs')).getAllByRole('slider')).toHaveLength(2);
  });

// ---------------------------------------------------------------------------------------------

describe('MOD-01 Cockpit hero', () => {
  it('AC1 net savings panel binds res.net, res.bar, res.target, res.gap, res.risk, res.tot_rr, res.tot_ot_it to the mock-session values', async () => {
    const t = await mount();
    await loaded(t);
    const net = panel('cockpit-net');
    for (const id of Object.values(NET_NODES))
      expect(t.mock.subscribed.has(toCellKey(id, ''))).toBe(true);

    // hero, bar, gap, stats: exactly the pushed values
    expect(heroValue()).toBe(cell(NET_NODES.net));
    expect(valueOf(net, NET_NODES.bar)).toBe(cell(NET_NODES.bar));
    expect(net.querySelector('.gp-cockpit-bar')?.textContent).toBe(fmt.money(cell(NET_NODES.bar)));
    expect(valueOf(net, NET_NODES.gap)).toBe(cell(NET_NODES.gap));
    expect(net.textContent).toContain(fmt.money(Math.abs(cell(NET_NODES.gap))));
    await t.until(() => {
      for (const id of [NET_NODES.risk, NET_NODES.runRate, NET_NODES.oneTimeIt])
        expect(valueOf(net, id)).toBe(cell(id));
    });

    // gauge: bar notch solid, target notch dotted, scale end
    expect(notchText('bar')).toBe(`Bar ${fmt.fte(cell(NET_NODES.bar))}`);
    expect(notchText('target')).toBe(`Target ${fmt.fte(cell(NET_NODES.target))}`);
    expect(net.querySelector('[data-label="max"]')?.textContent).toBe(
      fmt.fte(gaugeMax(cell(NET_NODES.bar), cell(NET_NODES.net))),
    );
    // header: year from the tenant row, scenario chip from /scenarios
    expect(net.textContent).toContain('Net savings · CY27');
    expect(net.querySelector('[data-scenario="C"]')).not.toBeNull();

    // res.target is editable: the bar opens the g.target_net popover, edits preview and commit
    fireEvent.click(within(net).getByRole('button', { name: /Edit the net target/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(defOf(TARGET_VARIABLE).label);
    const field = within(dialog).getByRole('textbox');
    const next = defOf(TARGET_VARIABLE).max!;
    fireEvent.change(field, { target: { value: String(next) } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await t.debounce();
    await t.until(() => {
      expect(t.posts.at(-1)?.changes[0]).toMatchObject({ key: TARGET_VARIABLE, value: next });
    });
  });

  it('AC2 bridge binds base.total, base.headwinds, res.tot_iy, res.tot_ot_it, res.cy27_outlay and the bridge view', async () => {
    const t = await mount();
    await loaded(t);
    expect(t.mock.views).toContainEqual({ view: 'bridge', params: {} });
    const bridge = panel('cockpit-bridge');
    const steps = [...bridge.querySelectorAll<SVGGElement>('[data-step][data-cell]')];
    expect(steps.map((s) => s.dataset['cell'])).toEqual(
      BRIDGE_CELLS.map((id) => toCellKey(id, '')),
    );
    const payload = bridgePayload(C.cells as Record<string, number>);
    const names = steps.map((s) => s.getAttribute('aria-label'));
    expect(names[0]).toContain(fmt.money(cell('base.total')));
    expect(names[1]).toContain(fmt.signed(cell('base.headwinds')));
    expect(names[2]).toContain(fmt.signed(-cell('res.tot_iy')));
    expect(names[3]).toContain(fmt.signed(cell('res.tot_ot_it')));
    expect(names[4]).toContain(fmt.money(cell('res.cy27_outlay')));
    expect(
      within(bridge).getByRole('img', { name: `Target outlay ${fmt.money(payload.targetOutlay)}` }),
    ).toBeTruthy();
    expect(
      within(bridge).getByRole('img', { name: `Gap to target outlay ${fmt.money(payload.gap)}` }),
    ).toBeTruthy();
    expect(bridge.textContent).toContain('CY26 → CY27 outlay');
    expect(bridge.textContent).toMatch(/axis starts at \$\d[\d,]*M/);
  });

  it("AC3 your inputs: the registry's ui.hero inputs as sliders and steppers; 'All 194' opens ⌘K", async () => {
    const t = await mount();
    await loaded(t);
    const inputs = panel('cockpit-inputs');
    const shown = [...inputs.querySelectorAll<HTMLElement>('.gp-cockpit-input')].map(
      (e) => e.dataset['variableId'],
    );
    expect(shown).toEqual(heroIds);
    expect(heroIds).toEqual(['g.target_net', 'g.ot_out_share', 'hc.us', 'hc.gcc', 'hc.ctr']);

    const sliders = within(inputs).getAllByRole('slider');
    expect(sliders.map((s) => Number((s as HTMLInputElement).value))).toEqual([
      cell('g.target_net'),
      cell('g.ot_out_share'),
    ]);
    expect(within(inputs).getByLabelText(HERO_LABELS['g.target_net']!)).toBe(sliders[0]);
    for (const id of ['hc.us', 'hc.gcc', 'hc.ctr']) {
      const group = within(inputs).getByRole('group', { name: HERO_LABELS[id] });
      expect(within(group).getByRole('textbox').getAttribute('value')).toBe(fmt.fte(cell(id)));
    }

    // a stepper press previews and commits the next step from the registry
    const us = within(inputs).getByRole('group', { name: HERO_LABELS['hc.us'] });
    fireEvent.click(within(us).getByRole('button', { name: /Increase/ }));
    await t.debounce();
    await t.until(() =>
      expect(t.posts.at(-1)?.changes[0]).toMatchObject({
        key: 'hc.us',
        value: cell('hc.us') + defOf('hc.us').step!,
      }),
    );

    const all = within(inputs).getByRole('button', {
      name: `Find any of the ${String(bundle.variables.length)} inputs`,
    });
    expect(all.textContent).toBe(`All ${String(bundle.variables.length)}`);
    fireEvent.click(all);
    expect(viewStore.getState().openPanels).toContain('commandPalette');
  });

  it('AC4 dragging the target sends previews; the bar notch, target line and gap update from deltas', async () => {
    const t = await mount();
    await loaded(t);
    const def = defOf(TARGET_VARIABLE);
    const slider = within(panel('cockpit-inputs')).getByLabelText(HERO_LABELS[TARGET_VARIABLE]!);
    const next = def.max!;
    fireEvent.input(slider, { target: { value: String(next) } });
    fireEvent.change(slider, { target: { value: String(next) } });
    await t.until(() => {
      const p = t.mock.sentOf('preview').at(-1);
      expect(p?.changes).toContainEqual({ var: TARGET_VARIABLE, member: '', value: next });
    });
    const seq = t.mock.sentOf('preview').at(-1)!.seq;

    // tier 2 answers the preview (played here): new target, bar and gap, and the bridge view
    const cells = { ...(C.cells as Record<string, number>) };
    const target = next;
    const bar = target + cell('base.headwinds');
    cells[toCellKey(NET_NODES.target, '')] = target;
    cells[toCellKey(NET_NODES.bar, '')] = bar;
    cells[toCellKey(NET_NODES.gap, '')] = cell(NET_NODES.net) - bar;
    await act(async () => {
      t.mock.emit({
        v: 1,
        type: 'delta',
        seq,
        cells: {
          [toCellKey(NET_NODES.target, '')]: target,
          [toCellKey(NET_NODES.bar, '')]: bar,
          [toCellKey(NET_NODES.gap, '')]: cells[toCellKey(NET_NODES.gap, '')]!,
          [toCellKey(TARGET_VARIABLE, '')]: target,
        },
      });
      t.mock.emit(bridgeView(cells, seq));
      await t.mock.flush();
    });
    const payload = bridgePayload(cells);
    await t.until(() => {
      expect(notchText('bar')).toBe(`Bar ${fmt.fte(bar)}`);
      expect(notchText('target')).toBe(`Target ${fmt.fte(target)}`);
      expect(valueOf(panel('cockpit-net'), NET_NODES.gap)).toBe(
        cells[toCellKey(NET_NODES.gap, '')],
      );
      expect(
        within(panel('cockpit-bridge')).getByRole('img', {
          name: `Target outlay ${fmt.money(payload.targetOutlay)}`,
        }),
      ).toBeTruthy();
    });
    expect(panel('cockpit-net').textContent).toContain(
      fmt.money(Math.abs(cells[toCellKey(NET_NODES.gap, '')]!)),
    );
    // the slider label follows the registry unit and step
    expect(panel('cockpit-inputs').textContent).toContain(formatByUnit(next, def.unit, def.step!));
    // release commits the dragged value
    await t.debounce();
    expect(t.posts.at(-1)?.changes[0]).toMatchObject({ key: TARGET_VARIABLE, value: next });
  });

  it('renders inside the global layer: rail and scenario bar around the cockpit (router wiring)', async () => {
    const t = await mount();
    await loaded(t);
    expect(screen.getByRole('navigation', { name: 'Modules' })).toBeTruthy();
    expect(screen.getByRole('main', { name: 'Cockpit' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Path to the bar');
    expect(t.router.state.location.pathname).toBe(`/${tenant}/${SCENARIO}/cockpit`);
  });

  it('G12 has no serious or critical axe violations', async () => {
    const t = await mount();
    await loaded(t);
    const result = await axe.run(t.view.container, {
      rules: { 'color-contrast': { enabled: false } }, // jsdom has no layout or computed colours
    });
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// MOD-02 tiles. Solver results are the spec's reference runs
// (docs/spec/reference/solver_demo_results.json), shaped as tier 2 sends a `solver_run`.
// ---------------------------------------------------------------------------------------------

interface McReference {
  iterations: number;
  net_p10_p50_p90: [number, number, number];
  bar_p10_p50_p90: [number, number, number];
  prob_clear_bar: number;
}
interface PathReference {
  net: number;
  risk_exposure: number;
  evaluations: number;
  inputs_moved_from_C: Record<string, { from: number; to: number }>;
}
const reference = solverReference as unknown as {
  monte_carlo_C: McReference;
  min_risk_total_bar: PathReference;
};

const NET_CELL = toCellKey('res.net', '');
const MC_SPEC = { problem: 'monte_carlo', params: {} } as const;
const PATH_SPEC = { problem: 'min_risk_mix', params: {} } as const;
const BAR_CELL = toCellKey('res.bar', '');
const vps = specFixtures.members.dimensions['vp']!;
const cellAt = (id: string, member = '') => C.cells[toCellKey(id, member)] as number;
type MonteCarloDetail = Extract<
  NonNullable<SolverRun['result']>['detail'],
  { problem: 'monte_carlo' }
>;

/**
 * Tier 2's Monte Carlo run for preset C (`monte_carlo_C`). The reference keeps percentiles and
 * P(clear) but no bins, so the test plays tier 2's binning: 20 bins over P10..P90 ± half the
 * spread, with a tent of counts. The module never bins.
 */
function monteCarloRun(id: string, status: 'queued' | 'done' = 'done', cached = false): SolverRun {
  const mc = reference.monte_carlo_C;
  const [p10, p50, p90] = mc.net_p10_p50_p90;
  const [b10, b50, b90] = mc.bar_p10_p50_p90;
  const bins = 20;
  const lo = p10 - (p90 - p10) / 2;
  const width = (2 * (p90 - p10)) / bins;
  return SolverRun.parse({
    ...solverRunFixtures.monte_carlo,
    id,
    scenarioId: SCENARIO,
    scenarioVersion: C.version,
    spec: MC_SPEC,
    status,
    cached,
    progress: status === 'done' ? 1 : 0,
    result:
      status === 'done'
        ? {
            problem: 'monte_carlo',
            status: 'feasible',
            changes: [],
            ranked: [],
            metrics: { p_clear_bar: mc.prob_clear_bar },
            diagnostics: { iterations: mc.iterations, ms: 1 },
            detail: {
              problem: 'monte_carlo',
              iterations: mc.iterations,
              seed: 1,
              percentiles: [
                { cell: NET_CELL, p10, p50, p90 },
                { cell: BAR_CELL, p10: b10, p50: b50, p90: b90 },
              ],
              probabilities: [{ cell: NET_CELL, against: BAR_CELL, p: mc.prob_clear_bar }],
              histograms: [
                {
                  cell: NET_CELL,
                  bins: Array.from({ length: bins }, (_, i) => ({
                    lo: lo + i * width,
                    hi: lo + (i + 1) * width,
                    count: Math.round(100 - Math.abs(i - (bins - 1) / 2) * 10),
                  })),
                },
              ],
              contributions: [],
            },
          }
        : null,
  });
}

/**
 * The moves of the reference min-risk run in the order the optimizer valued them (spec
 * 04_solvers_simulation.md "Moves from C, in the order the optimizer valued them").
 */
const RANKED = [
  'lev.L17.cola',
  'lev.L17.sw',
  'lev.L17.cl',
  'lev.L01.cut',
  'lev.L01.rel',
  'lev.L02.cut',
  'lev.L08.cov',
  'lev.L14.pct',
  'lev.L11.pct',
  'lev.L10.shelf',
  'lev.L10.ms',
  'lev.L10.rcut',
  'lev.L12.tpm',
  'lev.L07.pct',
  'lev.L16.pct',
];

/** Tier 2's min-risk run for preset C (`min_risk_total_bar`), "without touching the people levers". */
function minRiskRun(id: string, status: 'queued' | 'done' = 'done', cached = false): SolverRun {
  const ref = reference.min_risk_total_bar;
  const moved = ref.inputs_moved_from_C;
  return SolverRun.parse({
    ...solverRunFixtures.min_risk_mix,
    id,
    scenarioId: SCENARIO,
    scenarioVersion: C.version,
    spec: PATH_SPEC,
    status,
    cached,
    progress: status === 'done' ? 1 : 0,
    result:
      status === 'queued'
        ? null
        : {
            problem: 'min_risk_mix',
            status: 'optimal',
            changes: RANKED.map((k) => ({
              target: 'variable',
              key: k,
              member: '',
              value: moved[k]!.to,
            })),
            ranked: RANKED.map((k, i) => ({
              cell: toCellKey(k, ''),
              from: moved[k]!.from,
              to: moved[k]!.to,
              impact: RANKED.length - i,
            })),
            metrics: {
              [NET_CELL]: ref.net,
              [PATH_METRICS.risk]: ref.risk_exposure,
              [PATH_METRICS.people]: 0,
            },
            diagnostics: { iterations: ref.evaluations, ms: 1 },
            detail: { problem: 'min_risk_mix' },
          },
  });
}

/** What the tiles ask for: tier 2's defaults, the key the JOB-04 warmer files C under. */
const looked = (t: Awaited<ReturnType<typeof mount>>, problem: string) =>
  t.solverStarts.filter((b) => b.spec.problem === problem);

const valueAt = (root: HTMLElement, node: string, member = '') =>
  Number(
    root.querySelector<HTMLElement>(
      `[data-node="${node}"][data-member="${member}"] [data-value], [data-node="${node}"][data-member="${member}"][data-value]`,
    )?.dataset['value'],
  );

const jobDone = (id: string) =>
  ({ v: 1, type: 'job', id, status: 'done', progress: 1, note: null, kind: 'solver' }) as const;

async function expectVpTiles(
  t: Awaited<ReturnType<typeof mount>>,
  members: readonly { key: string; label: string }[],
  cells: Record<string, number>,
) {
  await t.until(() => expect(screen.getAllByTestId('cockpit-vp')).toHaveLength(members.length));
  const tiles = screen.getAllByTestId('cockpit-vp');
  expect(tiles.map((e) => e.dataset['member'])).toEqual(members.map((m) => m.key));
  for (const [i, m] of members.entries()) {
    const tile = tiles[i]!;
    for (const id of Object.values(VP_NODES))
      expect(t.mock.subscribed.has(toCellKey(id, m.key))).toBe(true);
    await t.until(() => {
      for (const id of Object.values(VP_NODES))
        expect(valueAt(tile, id, m.key)).toBe(cells[toCellKey(id, m.key)]);
    });
    const net = cells[toCellKey(VP_NODES.net, m.key)]!;
    const bar = cells[toCellKey(VP_NODES.bar, m.key)]!;
    const gap = cells[toCellKey(VP_NODES.gap, m.key)]!;
    const name = VP_LABELS[m.key] ?? m.label;
    expect(within(tile).getByRole('button', { name: COPY.openVps(name) }).textContent).toBe(name);
    const ring = tile.querySelector('svg.gp-ring');
    expect(ring?.getAttribute('aria-label')).toContain(
      `${name}: ${fmt.money(net)} of ${fmt.money(bar)} bar`,
    );
    expect(tile.textContent).toContain(fmt.money(net));
    expect(tile.textContent).toContain(`of ${fmt.money(bar)} bar`);
    expect(tile.textContent).toContain(fmt.money(cells[toCellKey(VP_NODES.outlay, m.key)]));
    expect(tile.textContent).toContain(
      `${fmt.money(Math.abs(gap))} ${gap < 0 ? 'short' : 'clear'}`,
    );
    expect(
      tile
        .querySelector<HTMLElement>('.gp-cockpit-swatch')
        ?.style.getPropertyValue('--gp-vp-colour'),
    ).toBe(vpColour(i));
  }
}

describe('MOD-02 Cockpit tiles', () => {
  it('AC1 VP rings bind vp.net, vp.bar, vp.gap, vp.outlay for each vp member from /members: 4 rings for the generated tenant fixture', async () => {
    const t = await mount();
    await loaded(t);
    expect(vps).toHaveLength(4);
    await expectVpTiles(t, vps, C.cells as Record<string, number>);
    // the name opens the VPs module
    fireEvent.click(
      within(screen.getAllByTestId('cockpit-vp')[0]!).getByRole('button', {
        name: COPY.openVps(VP_LABELS[vps[0]!.key]!),
      }),
    );
    await t.until(() =>
      expect(t.router.state.location.pathname).toBe(`/${tenant}/${SCENARIO}/vps`),
    );
  });

  it('AC1 VP rings: 5 rings for a five-VP fixture (slot colours in member order, label from /members)', async () => {
    const fifth = { key: 'vp_data', label: 'Data Technology', attrs: {}, sort: null, active: true };
    const members = MembersResponse.parse({
      ...specFixtures.members,
      dimensions: { ...specFixtures.members.dimensions, vp: [...vps, fifth] },
    });
    // tier 2's cells for the fifth VP (played here with another VP's values)
    const cells = { ...(C.cells as Record<string, number>) };
    for (const id of Object.values(VP_NODES))
      cells[toCellKey(id, fifth.key)] = cells[toCellKey(id, vps[3]!.key)]!;
    const t = await mount({ members, snapshotC: { ...C, cells } as typeof C });
    await loaded(t);
    await expectVpTiles(t, [...vps, fifth], cells);
  });

  it('AC2 shareholder binds br.eps27, br.px27, pl.eps, val.px, br.fuel_equiv_cents', async () => {
    const t = await mount();
    await loaded(t);
    const sh = panel('cockpit-shareholder');
    const N = SHAREHOLDER_NODES;
    const Y = SHAREHOLDER_YEARS;
    const bound: [string, string][] = [
      [N.eps, ''],
      [N.price, ''],
      [N.epsLevel, Y.before],
      [N.epsLevel, Y.after],
      [N.priceLevel, Y.before],
      [N.priceLevel, Y.after],
      [N.fuel, ''],
    ];
    await t.until(() => {
      for (const [id, member] of bound) {
        expect(t.mock.subscribed.has(toCellKey(id, member))).toBe(true);
        expect(valueAt(sh, id, member)).toBe(cellAt(id, member));
      }
    });
    const text = sh.textContent;
    expect(text).toContain(`Shareholder view · ${String(tenantRow.targetYear)}`);
    expect(text).toContain(fmt.eps(cellAt(N.eps), { signed: true }));
    expect(text).toContain(fmt.eps(cellAt(N.price), { digits: 2, signed: true }));
    expect(text).toContain(
      `${fmt.eps(cellAt(N.epsLevel, Y.before))} → ${fmt.eps(cellAt(N.epsLevel, Y.after))}`,
    );
    expect(text).toContain(
      `${fmt.eps(cellAt(N.priceLevel, Y.before), { digits: 2 })} → ${fmt.eps(cellAt(N.priceLevel, Y.after), { digits: 2 })}`,
    );
    expect(text).toContain(`Same as ${fmt.cents(cellAt(N.fuel))} off every gallon of jet fuel`);
    // the chevron opens the Market module
    fireEvent.click(within(sh).getByRole('button', { name: COPY.openMarket }));
    await t.until(() =>
      expect(t.router.state.location.pathname).toBe(`/${tenant}/${SCENARIO}/market`),
    );
  });

  it("AC3 odds: 'Run 2,000 trials' without a Monte Carlo result; then histogram, P10/P50/P90, bar and P(clear) from the solver_run (monte_carlo_C)", async () => {
    const id = 'job-mc-c';
    const t = await mount({
      // the look-up finds nothing held; the user's run is the first start
      starts: { monte_carlo: [monteCarloRun(id, 'queued')] },
      runs: { [id]: monteCarloRun(id) },
    });
    await loaded(t);
    const odds = panel('cockpit-odds');
    // the look-up asks for the tile's problem with tier 2's defaults (no params) and is a read
    await t.until(() =>
      expect(t.solverLookups.filter((q) => q['problem'] === 'monte_carlo')).toEqual([
        { scenarioId: SCENARIO, problem: 'monte_carlo' },
      ]),
    );
    await t.until(() =>
      expect(within(odds).getByRole('button', { name: 'Run 2,000 trials' })).toBeTruthy(),
    );
    expect(odds.textContent).toContain('This scenario has not been simulated.');
    expect(odds.querySelector('[data-chart="histogram"]')).toBeNull();
    expect(odds.querySelector('[data-status="cancelled"]')).toBeNull();
    // looking at the Cockpit queued nothing and cancelled nothing
    expect(t.solverStarts).toEqual([]);
    expect(t.solverCancels).toEqual([]);

    // the action starts tier 2's Monte Carlo on this scenario with tier 2's defaults, not saving
    fireEvent.click(within(odds).getByRole('button', { name: 'Run 2,000 trials' }));
    await t.until(() =>
      expect(looked(t, 'monte_carlo')).toEqual([
        { scenarioId: SCENARIO, spec: MC_SPEC, save: false },
      ]),
    );
    expect(t.solverCancels).toEqual([]);
    // progress arrives as `job` messages: the header shows tier 2's note, the action waits
    await act(async () => {
      t.mock.emit({
        v: 1,
        type: 'job',
        id,
        status: 'running',
        progress: 0.4,
        note: 'Draw 800 of 2,000',
        kind: 'solver',
      });
      await t.mock.flush();
    });
    await t.until(() => {
      expect(odds.textContent).toContain('Draw 800 of 2,000');
      const action = within(odds).getByRole('button', { name: 'Run 2,000 trials' });
      expect((action as HTMLButtonElement).disabled).toBe(true);
    });

    // done: the run is read back and drawn
    await act(async () => {
      t.mock.emit(jobDone(id));
      await t.mock.flush();
    });
    const mc = reference.monte_carlo_C;
    await t.until(() => expect(odds.querySelector('[data-chart="histogram"]')).not.toBeNull());
    expect(t.solverGets).toContain(id);
    expect(odds.textContent).not.toContain('This scenario has not been simulated.');
    expect(odds.querySelector('.gp-cockpit-big')?.textContent).toBe(
      fmt.pct(mc.prob_clear_bar).replace(/\.0%$/, '%'),
    );
    expect(odds.textContent).toContain('chance of clearing the bar');
    expect(odds.textContent).toContain(`${fmt.fte(mc.iterations)} runs`);
    expect(odds.textContent).toContain(`P50 ${fmt.money(mc.net_p10_p50_p90[1])}`);
    const labels = [...odds.querySelectorAll('[data-part="p-label"]')].map((e) => e.textContent);
    expect(labels).toEqual(
      (['P10', 'P50', 'P90'] as const).map(
        (p, i) => `${p} ${String(Math.round(mc.net_p10_p50_p90[i]!))}`,
      ),
    );
    expect(odds.querySelector('[data-part="bar"]')).not.toBeNull();
    expect(odds.querySelector('desc')?.textContent).toContain(
      `bar ${String(Math.round(mc.bar_p10_p50_p90[1]))}`,
    );
    const detail = monteCarloRun(id).result!.detail as MonteCarloDetail;
    expect(odds.querySelectorAll('.gp-hist-bin')).toHaveLength(detail.histograms[0]!.bins.length);
  });

  it("AC4 fastest path: min-risk result (net, moves count, risk, people-lever flag, top 3 moves); 'Show me a path' → Path", async () => {
    const id = 'job-path';
    const t = await mount({ runs: { [id]: minRiskRun(id) } });
    await loaded(t);
    const path = panel('cockpit-path');
    // the look-up finds nothing: the Cockpit never runs (or saves) a path by itself, and starts nothing
    await t.until(() =>
      expect(t.solverLookups).toContainEqual({ scenarioId: SCENARIO, problem: 'min_risk_mix' }),
    );
    await t.settle();
    expect(t.solverStarts).toEqual([]);
    expect(t.solverCancels).toEqual([]);
    expect(path.textContent).toContain(COPY.noPath);
    expect(within(path).getByRole('button', { name: 'Show me a path' })).toBeTruthy();

    // a min-risk job ends on this scenario (e.g. started from Path): the tile picks it up
    await act(async () => {
      t.mock.emit(jobDone(id));
      await t.mock.flush();
    });
    const ref = reference.min_risk_total_bar;
    await t.until(() =>
      expect(path.querySelector('.gp-cockpit-big')?.textContent).toBe(fmt.money(ref.net)),
    );
    expect(t.solverGets).toEqual([id]);
    expect(path.textContent).toContain(
      `${String(RANKED.length)} moves · risk exposure ${fmt.money(ref.risk_exposure)} · no people levers`,
    );
    const rows = within(within(path).getByRole('list', { name: 'Top moves' })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(PATH_TOP_MOVES);
    rows.forEach((row, i) => {
      const k = RANKED[i]!;
      const def = defOf(k);
      const { from, to } = ref.inputs_moved_from_C[k]!;
      expect(row.dataset['variableId']).toBe(k);
      expect(row.textContent).toBe(
        `${String(i + 1).padStart(2, '0')}${MOVE_LABELS[k]!}${formatByUnit(from, def.unit, def.step!)} → ${formatByUnit(to, def.unit, def.step!)}`,
      );
    });

    fireEvent.click(within(path).getByRole('button', { name: 'Show me a path' }));
    await t.until(() =>
      expect(t.router.state.location.pathname).toBe(`/${tenant}/${SCENARIO}/path`),
    );
  });

  it('API-13 Cockpit Odds and Fastest path read tier 2 with a look-up: nothing is queued, cancelled or saved by viewing; an older result is shown dimmed', async () => {
    const t = await mount({
      lookups: {
        monte_carlo: {
          run: { ...monteCarloRun('job-mc-old'), scenarioVersion: C.version + 1 },
          current: false,
          trials: 2000,
        },
        min_risk_mix: { run: minRiskRun('job-path-now'), current: true, trials: null },
      },
    });
    await loaded(t);
    await t.until(() => {
      expect(panel('cockpit-odds').querySelector('[data-chart="histogram"]')).not.toBeNull();
      expect(panel('cockpit-path').querySelector('.gp-cockpit-moves')).not.toBeNull();
    });
    await t.settle();
    // one look-up per tile, no params; no POST (so no queued run to cancel) and no DELETE
    expect([...t.solverLookups].sort((a, b) => a['problem']!.localeCompare(b['problem']!))).toEqual([
      { scenarioId: SCENARIO, problem: 'min_risk_mix' },
      { scenarioId: SCENARIO, problem: 'monte_carlo' },
    ]);
    expect(t.solverStarts).toEqual([]);
    expect(t.solverCancels).toEqual([]);
    expect(t.solverGets).toEqual([]);
    // the older Monte Carlo result is kept as tier 2 sent it, dimmed; the current path is not
    expect(panel('cockpit-odds').querySelector('[data-stale]')).not.toBeNull();
    expect(panel('cockpit-path').querySelector('[data-stale]')).toBeNull();
  });

  it("API-13 the trial count on 'Run N trials' is tier 2's (the look-up's), never a literal in tier 1", async () => {
    const t = await mount({
      lookups: { monte_carlo: { run: null, current: false, trials: 500 } },
    });
    await loaded(t);
    const odds = panel('cockpit-odds');
    await t.until(() =>
      expect(within(odds).getByRole('button', { name: 'Run 500 trials' })).toBeTruthy(),
    );
    expect(odds.textContent).not.toContain('2,000');
    expect(COPY.runTrials(null)).toBe('Run trials');
  });

  it('AC5 every tile value is a session cell or a solver_run field as sent (nothing computed in tier 1); axe clean with results', async () => {
    const mcId = 'job-mc-cached';
    const pathId = 'job-path';
    const mcRun = monteCarloRun(mcId);
    const pathRun = minRiskRun(pathId);
    // JOB-04: the warmed cache answers both look-ups (done, current): no click, no GET
    const t = await mount({
      lookups: {
        monte_carlo: { run: monteCarloRun(mcId, 'done', true), current: true, trials: 2000 },
        min_risk_mix: { run: minRiskRun(pathId, 'done', true), current: true, trials: null },
      },
    });
    await loaded(t);
    await t.until(() => {
      expect(panel('cockpit-odds').querySelector('[data-chart="histogram"]')).not.toBeNull();
      expect(panel('cockpit-path').querySelector('.gp-cockpit-moves')).not.toBeNull();
    });

    // session cells: every bound number on the VP and shareholder tiles is the pushed cell
    const roots = [...screen.getAllByTestId('cockpit-vp'), panel('cockpit-shareholder')];
    await t.until(() => {
      let seen = 0;
      for (const root of roots)
        for (const el of root.querySelectorAll<HTMLElement>('[data-node][data-member]')) {
          const node = el.dataset['node']!;
          const member = el.dataset['member']!;
          expect(valueAt(root, node, member)).toBe(cellAt(node, member));
          seen++;
        }
      expect(seen).toBe(vps.length * Object.keys(VP_NODES).length + 7);
    });

    // solver_run fields: shown as sent
    const detail = mcRun.result!.detail as MonteCarloDetail;
    const odds = panel('cockpit-odds');
    const data = (root: HTMLElement, attr: string) =>
      Number(root.querySelector<HTMLElement>(`[data-${attr}]`)?.getAttribute(`data-${attr}`));
    expect(data(odds, 'clear')).toBe(detail.probabilities[0]!.p);
    expect(data(odds, 'p50')).toBe(detail.percentiles[0]!.p50);
    expect(data(odds, 'iterations')).toBe(detail.iterations);
    const path = panel('cockpit-path');
    const r = pathRun.result!;
    expect(Number(path.querySelector<HTMLElement>('[data-metric]')?.dataset['value'])).toBe(
      r.metrics[NET_CELL],
    );
    expect(data(path, 'moves')).toBe(r.ranked.length);
    const rows = [...path.querySelectorAll<HTMLElement>('.gp-cockpit-move')];
    expect(rows.map((e) => [Number(e.dataset['from']), Number(e.dataset['to'])])).toEqual(
      r.ranked.slice(0, PATH_TOP_MOVES).map((m) => [m.from, m.to]),
    );
    expect(t.solverGets).toEqual([]);
    expect(t.solverStarts).toEqual([]);
    expect(t.solverCancels).toEqual([]);

    const result = await axe.run(t.view.container, {
      rules: { 'color-contrast': { enabled: false } }, // jsdom has no layout or computed colours
    });
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
