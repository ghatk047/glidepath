// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import axe from 'axe-core';
import { useEffect } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  BusinessCase,
  ScenarioId,
  SolverRun,
  SourcingParams,
  TenantSlug,
  WS_PROTOCOL_VERSION,
  apiRoutes,
  type BundleResponse,
  type ChangesetRequest,
  type QuickSolverRunRequest,
  type SolverDetail,
  type SolverLookup,
  type SolverRunRequest,
} from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  planRouteFixtures,
  presetSnapshot,
  solverRunFixtures,
  specFixtures,
} from '@glidepath/api-contract/testing';
import { fmt } from '@glidepath/ui/format';
import { useCommit, type CommitQueue } from '../../commit';
import { DataProvider, createDataClient, createServerState } from '../../data';
import { GlobalLayout } from '../../global/shell';
import { createSessionClient } from '../../session';
import Plan from './index';
import { byVariable, capPct, signedByNode } from './parts';

// Every value is read from the contract fixtures (or the variations below), never typed in the assertions.
const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const tenant = TenantSlug.parse(specFixtures.tenant);
const PRESET_C = ScenarioId.parse(presetSnapshot('C').scenarioId);
const SAVED = 'sc-wave-1';
const bundle = specFixtures.bundle as BundleResponse;
const varDef = (id: string) => bundle.variables.find((v) => v.id === id);
const nodeDef = (id: string) => bundle.nodes.find((n) => n.id === id);

const run = (problem: 'breakeven' | 'stress_presets' | 'wave_plan', extra: object = {}) =>
  SolverRun.parse({ ...solverRunFixtures[problem], scenarioId: PRESET_C, ...extra });

// Breakeven: one row reachable in range, one only outside it, one by no value (served out of order).
const beFx = solverRunFixtures.breakeven.result!;
const BE_ROWS = [
  { cell: 'lev.L08.cut[]', current: 0.1, needed: null, min: 0, max: 0.2, feasible: false, best: 0.2, bestOutput: -3.4 },
  { cell: 'lev.L17.cola[]', current: 0.2, needed: 0.9, min: 0, max: 0.6, feasible: false },
  { cell: 'lev.L03.pct[]', current: 0.2, needed: 0.31, min: 0, max: 0.4, feasible: true },
];
const BREAKEVEN = run('breakeven', {
  quick: true,
  result: { ...beFx, status: 'optimal', metrics: { feasible: 1, rows: 3 }, detail: { problem: 'breakeven', rows: BE_ROWS } },
});

// Stress: tier 2's catalog of three shocks; each run answers the ones asked, with the four outputs it reports.
const stFx = solverRunFixtures.stress_presets.result!;
const CATALOG = [
  { name: 'Shock A', set: { 'lev.L03.pct': 0 } as Record<string, number | string> },
  { name: 'Shock B', set: { 'corp.jet_direct': '+0.30' } as Record<string, number | string> },
  { name: 'Shock C', shift: { 'lev.start': 3 } },
];
const SHOCKS = [
  { name: 'Shock A', scale: 1, outputs: { 'res.net[]': 104.2, 'res.gap[]': -10.1, 'br.eps27[]': 0.21, 'res.risk[]': 90.1 }, delta: { 'res.net[]': -15.1, 'res.gap[]': -15.1, 'br.eps27[]': -0.03, 'res.risk[]': -12.2 } },
  { name: 'Shock B', scale: 1, outputs: { 'res.net[]': 112.4, 'res.gap[]': -1.9, 'br.eps27[]': 0.23, 'res.risk[]': 97.4 }, delta: { 'res.net[]': -6.9, 'res.gap[]': -6.9, 'br.eps27[]': -0.01, 'res.risk[]': -5.5 } },
  { name: 'Shock C', scale: 1, outputs: { 'res.net[]': 110.0, 'res.gap[]': -4.3, 'br.eps27[]': 0.22, 'res.risk[]': 95.0 }, delta: { 'res.net[]': -9.3, 'res.gap[]': -9.3, 'br.eps27[]': -0.02, 'res.risk[]': -7.9 } },
];
const STRESS = run('stress_presets', {
  quick: true,
  spec: { problem: 'stress_presets', params: {} },
  result: { ...stFx, detail: { problem: 'stress_presets', presets: SHOCKS, catalog: CATALOG } },
});

const WAVE = run('wave_plan', { spec: { problem: 'wave_plan', params: { quarterlyOneTimeCap: 10, maxLaunchesPerQuarter: 5 } } });
const waveDetail = WAVE.result!.detail as Extract<SolverDetail, { problem: 'wave_plan' }>;

// Business case: the fixture plus a lever whose IRR and ROI run past the display cap.
const bcFx = planRouteFixtures.planBusinessCase.response;
const HUGE = { ...bcFx.levers[0]!, lever: 'L09', label: 'Huge return lever', npv: 30, irr: 18.42, roi: 9.1 };
const BC = BusinessCase.parse({ ...bcFx, scenarioId: PRESET_C, levers: [...bcFx.levers, HUGE] });

const { params: PARAMS } = SourcingParams.parse({ params: [
  { key: 'discount_rate', label: 'Discount rate', group: 'business_case', value: 0.09, unit: '%', min: 0.04, max: 0.15, step: 0.005, sort: 1 },
  { key: 'horizon_years', label: 'Business case horizon', group: 'business_case', value: 5, unit: 'years', min: 3, max: 7, step: 1, sort: 2 },
  { key: 'quarterly_onetime_cap_musd', label: 'One-time cap per quarter', group: 'wave_plan', value: 10, unit: '$M', min: 2, max: 30, step: 1, sort: 14 },
  { key: 'max_launches_per_quarter', label: 'Launches per quarter', group: 'wave_plan', value: 5, unit: 'levers', min: 1, max: 17, step: 1, sort: 15 },
  { key: 'max_moves', label: 'Maximum moves', group: 'consolidation', value: 10, unit: 'moves', min: 1, max: 20, step: 1, sort: 40 },
] });

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

interface Served {
  posts: ChangesetRequest[];
  quicks: QuickSolverRunRequest[];
  starts: SolverRunRequest[];
  lookups: Record<string, string>[];
  /** One entry per `GET /plan/business-case` and `GET /sourcing/params`. */
  bcReads: string[];
  paramReads: string[];
}

const none = (): SolverLookup => ({ run: null, current: false, trials: null });

interface ServeOpts {
  lookups?: Record<string, SolverLookup>;
  /** After the first wave run, `POST /solver-runs` answers `queued` and the GET `running` until `done` is set. */
  queueWaves?: { done: boolean };
}

const WAVE_JOB = 'job-wave-2';

function serve(opts: ServeOpts = {}): Served {
  const served: Served = { posts: [], quicks: [], starts: [], lookups: [], bcReads: [], paramReads: [] };
  let held = PARAMS;
  server.use(
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, () =>
      HttpResponse.json({ tenants: [{ ...fx.tenants.response.tenants[0]!, slug: tenant }] }),
    ),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(specFixtures.bundle)),
    http.get(`${BASE}${apiRoutes.members.path}`, () => HttpResponse.json(specFixtures.members)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () => HttpResponse.json({ scenarios: specFixtures.scenarios.scenarios })),
    http.get(`${BASE}${apiRoutes.scenarioInputs.path}`, ({ params }) =>
      HttpResponse.json({ scenarioId: String(params['id']), version: 0, inputs: [], overrides: [] }),
    ),
    http.get(`${BASE}${apiRoutes.scenarioCalc.path}`, ({ params }) =>
      HttpResponse.json({ ...fx.scenarioCalc.response, scenarioId: String(params['id']) }),
    ),
    http.get(`${BASE}${apiRoutes.changesetHistory.path}`, ({ params }) =>
      HttpResponse.json({ scenarioId: String(params['id']), changesets: [], nextCursor: null }),
    ),
    http.post(`${BASE}${apiRoutes.changesetApply.path}`, async ({ request }) => {
      const body = (await request.json()) as ChangesetRequest;
      served.posts.push(body);
      for (const c of body.changes)
        if (c.target === 'structural' && c.key === 'sourcing_param' && c.value) {
          const attrs = c.value['attrs'] as { value: number };
          held = held.map((p) => (p.key === c.member ? { ...p, value: attrs.value } : p));
        }
      return HttpResponse.json({
        ...fx.changesetApply.response,
        scenarioId: body.scenarioId,
        version: body.baseVersion + 1,
        forkedFrom: undefined,
      });
    }),
    http.get(`${BASE}${apiRoutes.sourcingParams.path}`, () => {
      served.paramReads.push('params');
      return HttpResponse.json({ params: held });
    }),
    http.get(`${BASE}${apiRoutes.planBusinessCase.path}`, () => {
      served.bcReads.push('case');
      return HttpResponse.json(BC);
    }),
    http.get(`${BASE}${apiRoutes.solverRunLookup.path}`, ({ request }) => {
      const query = Object.fromEntries(new URL(request.url).searchParams);
      served.lookups.push(query);
      return HttpResponse.json(opts.lookups?.[query['problem'] ?? ''] ?? none());
    }),
    http.post(`${BASE}${apiRoutes.solverRunQuick.path}`, async ({ request }) => {
      const body = (await request.json()) as QuickSolverRunRequest;
      served.quicks.push(body);
      if (body.spec.problem === 'stress_presets') {
        const { presets: names, scales = {} } = body.spec.params;
        const asked = SHOCKS.filter((s) => !names?.length || names.includes(s.name)).map((s) => ({ ...s, scale: scales[s.name] ?? 1 }));
        return HttpResponse.json({
          ...STRESS,
          spec: body.spec,
          result: { ...STRESS.result!, detail: { problem: 'stress_presets', presets: asked, catalog: CATALOG } },
        });
      }
      return HttpResponse.json(BREAKEVEN);
    }),
    http.post(`${BASE}${apiRoutes.solverRunStart.path}`, async ({ request }) => {
      const body = (await request.json()) as SolverRunRequest;
      served.starts.push(body);
      const queued = { ...WAVE, id: WAVE_JOB, status: 'queued', progress: 0, result: null };
      const answer = body.save
        ? { ...WAVE, id: 'job-save', save: true, cached: true, resultScenarioId: SAVED }
        : opts.queueWaves && served.starts.length > 1
          ? queued
          : WAVE;
      return HttpResponse.json(answer, { status: 201 });
    }),
    http.get(`${BASE}${apiRoutes.solverRunGet.path}`, ({ params }) =>
      HttpResponse.json(
        String(params['id']) === WAVE_JOB && !opts.queueWaves?.done
          ? { ...WAVE, id: WAVE_JOB, status: 'running', progress: 0.5, result: null }
          : { ...WAVE, id: String(params['id']) },
      ),
    ),
  );
  return served;
}

let queueRef: CommitQueue | null = null;
function GrabQueue() {
  const q = useCommit();
  useEffect(() => {
    queueRef = q;
  }, [q]);
  return null;
}

async function mount(opts: ServeOpts = {}) {
  const served = serve(opts);
  const mock = createMockSession({ views: [] });
  const frames: (() => void)[] = [];
  const session = createSessionClient({
    tenant,
    scenario: PRESET_C,
    origin: 'ws://localhost:8080',
    connect: mock.connect,
    requestFrame: (cb) => void frames.push(cb),
    random: () => 0,
  });
  function Screen() {
    return (
      <GlobalLayout tenant={tenant} scenarioId={PRESET_C} module="plan" session={session} glass={{ frameSampling: false }}>
        <GrabQueue />
        <Plan />
      </GlobalLayout>
    );
  }
  const rootRoute = createRootRoute({ component: Outlet });
  const moduleRoute = createRoute({ getParentRoute: () => rootRoute, path: '$tenant/$scenario/$module', component: Screen });
  const router = createRouter({
    routeTree: rootRoute.addChildren([moduleRoute]),
    history: createMemoryHistory({ initialEntries: [`/${tenant}/${PRESET_C}/plan`] }),
  });
  const view = render(
    <DataProvider client={createDataClient({ baseUrl: BASE })} serverState={createServerState()}>
      <RouterProvider router={router as never} />
    </DataProvider>,
  );
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
  const flush = async () => {
    await act(async () => {
      await queueRef!.flush();
    });
  };
  await until(() => {
    expect(document.querySelectorAll('[data-standing]').length).toBe(BE_ROWS.length);
    expect(document.querySelectorAll('[data-preset]').length).toBe(SHOCKS.length);
    expect(document.querySelectorAll('[data-lever]').length).toBe(BC.levers.length);
    expect(document.querySelectorAll('[data-quarter]').length).toBe(waveDetail.quarters.length);
    expect(document.querySelectorAll('[data-param]').length).toBe(4);
  });
  return { ...served, mock, router, settle, until, flush, view };
}

const panel = (id: string) => screen.getByTestId(`plan-${id}`);
const kpi = (root: HTMLElement, id: string) => root.querySelector(`[data-kpi="${id}"] dd`)?.textContent;

describe('SRC-18 layout', () => {
  it('four panels in a 2x2 grid, each with a tour anchor', async () => {
    await mount();
    const grid = screen.getByTestId('plan-grid');
    const anchors = { breakeven: 'plan-breakeven', stress: 'plan-stress', 'business-case': 'plan-business-case', waves: 'plan-wave' };
    for (const [id, tour] of Object.entries(anchors)) {
      expect(within(grid).getByTestId(`plan-${id}`).getAttribute('data-tour')).toBe(tour);
    }
  });
});

describe('F1 breakeven', () => {
  it('runs the quick breakeven on load with tier 2 defaults; rows reachable → outside range → not reachable', async () => {
    const t = await mount();
    expect(t.quicks.filter((q) => q.spec.problem === 'breakeven')).toEqual([
      { scenarioId: PRESET_C, spec: { problem: 'breakeven', params: {} }, save: false },
    ]);
    const p = panel('breakeven');
    const rows = [...p.querySelectorAll<HTMLElement>('[data-standing]')];
    expect(rows.map((r) => r.dataset['cell'])).toEqual(['lev.L03.pct[]', 'lev.L17.cola[]', 'lev.L08.cut[]']);
    expect(rows.map((r) => r.dataset['standing'])).toEqual(['reachable', 'beyond', 'none']);
    expect(rows[0]!.querySelector('[data-needed]')?.textContent).toBe(byVariable(varDef('lev.L03.pct'), 0.31));
    expect(rows[1]!.querySelector('[data-needed]')?.textContent).toBe(byVariable(varDef('lev.L17.cola'), 0.9));
    // No value closes it: tier 2's best value in range and the gap it leaves.
    expect(rows[2]!.querySelector('[data-best]')?.textContent).toBe(`best ${byVariable(varDef('lev.L08.cut'), 0.2)}`);
    expect(rows[2]!.querySelector('[data-best-gap]')?.textContent).toBe(`gap ${signedByNode(nodeDef('res.gap'), -3.4)}`);
    expect(within(p).getByTestId('plan-breakeven-count').textContent).toBe(fmt.fte(1));
  });

  it('a current run tier 2 already holds is shown without running again', async () => {
    const t = await mount({ lookups: { breakeven: { run: BREAKEVEN, current: true, trials: null } } });
    expect(t.quicks.filter((q) => q.spec.problem === 'breakeven')).toHaveLength(0);
    expect(panel('breakeven').querySelectorAll('[data-standing]')).toHaveLength(BE_ROWS.length);
  });
});

describe('F3 stress tests', () => {
  it("runs every shock tier 2 knows (no names); each shows tier 2's deltas, risk-adjusted net included, as diverging bars", async () => {
    const t = await mount();
    const asks = t.quicks.filter((q) => q.spec.problem === 'stress_presets');
    expect(asks.map((q) => q.spec.params)).toEqual([{}]);
    expect(t.lookups.find((q) => q['problem'] === 'stress_presets')?.['params']).toBe('{}');
    const p = panel('stress');
    // The chips are tier 2's catalog, titled with each definition.
    expect([...p.querySelectorAll<HTMLElement>('[data-preset-toggle]')].map((b) => b.dataset['presetToggle'])).toEqual(CATALOG.map((c) => c.name));
    expect(p.querySelector('[data-preset-toggle="Shock B"]')?.getAttribute('title')).toBe('corp.jet_direct = +0.30');
    expect(p.querySelector('thead')?.textContent).toContain('Δ Risk-adj');
    for (const s of SHOCKS) {
      const row = p.querySelector(`[data-preset="${s.name}"]`)!;
      for (const [cell, d] of Object.entries(s.delta)) {
        const td = row.querySelector<HTMLElement>(`[data-delta="${cell}"] .gp-plan-div`)!;
        expect(td.textContent).toBe(signedByNode(nodeDef(cell.slice(0, cell.indexOf('['))), d));
        expect(td.style.getPropertyValue('--d')).toBe(String(d));
        expect(td.dataset['sign']).toBe('neg');
      }
    }
  });

  it('toggling a shock off asks tier 2 again with the remaining names', async () => {
    const t = await mount();
    const p = panel('stress');
    fireEvent.click(p.querySelector('[data-preset-toggle="Shock A"]')!);
    await t.until(() => expect(t.quicks.filter((q) => q.spec.problem === 'stress_presets')).toHaveLength(2));
    const last = t.quicks.filter((q) => q.spec.problem === 'stress_presets').at(-1)!;
    expect(last.spec.params).toEqual({ presets: ['Shock B', 'Shock C'] });
    await t.until(() => expect(p.querySelectorAll('[data-preset]')).toHaveLength(2));
    expect(p.querySelector('[data-preset-toggle="Shock A"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it("a shock's size stepper reruns with that scale (a run parameter, nothing committed)", async () => {
    const t = await mount();
    const p = panel('stress');
    fireEvent.click(within(p).getByRole('button', { name: 'Increase Size · Shock B' }));
    await t.until(() => expect(t.quicks.filter((q) => q.spec.problem === 'stress_presets')).toHaveLength(2));
    const last = t.quicks.filter((q) => q.spec.problem === 'stress_presets').at(-1)!;
    expect(last.spec.params).toEqual({ scales: { 'Shock B': 1.25 } });
    await t.until(() =>
      expect(within(p).getByRole('textbox', { name: 'Size · Shock B' })).toHaveProperty('value', fmt.mult(1.25)),
    );
    expect(t.posts).toHaveLength(0);
  });
});

describe('F9 business case', () => {
  it('rows by NPV; IRR/ROI null read "—", past the display cap ">500%"; totals are tier 2 values', async () => {
    await mount();
    const p = panel('business-case');
    const order = [...p.querySelectorAll<HTMLElement>('[data-lever]')].map((r) => r.dataset['lever']);
    expect(order).toEqual(['L09', 'L01', 'L02']);
    const huge = p.querySelector('[data-lever="L09"]')!;
    expect(huge.querySelector('[data-irr]')?.textContent).toBe('>500%');
    expect(huge.querySelector('[data-roi]')?.textContent).toBe('>500%');
    const none = p.querySelector('[data-lever="L02"]')!;
    expect(none.querySelector('[data-irr]')?.textContent).toBe('—');
    expect(none.querySelector('[data-roi]')?.textContent).toBe('—');
    expect(p.querySelector('[data-lever="L01"] [data-irr]')?.textContent).toBe(capPct(bcFx.levers[0]!.irr));
    expect(kpi(p, 'npv')).toBe(fmt.money(BC.totals.npv));
    expect(kpi(p, 'onetime')).toBe(fmt.money(BC.totals.oneTime));
    expect(within(p).getByTestId('plan-business-case-basis').textContent).toContain(fmt.pct(BC.discountRate));
  });

  it('a discount-rate step commits the whole sourcing_param row and reads the case again', async () => {
    const t = await mount();
    const p = panel('business-case');
    const rate = PARAMS.find((x) => x.key === 'discount_rate')!;
    const reads = t.bcReads.length;
    fireEvent.click(within(p).getByRole('button', { name: `Increase ${rate.label}` }));
    await t.flush();
    await t.until(() => expect(t.posts).toHaveLength(1));
    expect(t.posts[0]!.changes).toEqual([
      {
        target: 'structural',
        key: 'sourcing_param',
        member: rate.key,
        value: {
          label: rate.label,
          attrs: { value: 0.095, unit: rate.unit, min: rate.min, max: rate.max, step: rate.step, group: rate.group },
          sort: rate.sort,
          active: true,
        },
      },
    ]);
    await t.until(() => expect(t.bcReads.length).toBeGreaterThan(reads));
  });
});

describe('F10 wave planner', () => {
  it('runs as a worker job on load; quarters, moves, net and binding constraints are tier 2 values', async () => {
    const t = await mount();
    expect(t.starts).toEqual([{ scenarioId: PRESET_C, spec: { problem: 'wave_plan', params: {} }, save: false }]);
    const p = panel('waves');
    expect(within(p).getByTestId('plan-wave-status').textContent).toBe(WAVE.result!.status);
    expect(p.querySelector('[data-net="before"]')?.textContent).toBe(fmt.money(waveDetail.netBefore));
    expect(p.querySelector('[data-net="after"]')?.textContent).toBe(fmt.money(waveDetail.netAfter));
    const q1 = waveDetail.quarters[0]!;
    const row = p.querySelector<HTMLElement>('[data-quarter="1"]')!;
    expect(row.querySelector('[data-onetime]')?.textContent).toBe(`${fmt.money(q1.oneTime)} / ${fmt.money(q1.cap!)}`);
    expect(row.querySelector('[data-launches]')?.textContent).toBe(`${fmt.fte(q1.launches)} / ${fmt.fte(q1.launchCap!)}`);
    expect(row.style.getPropertyValue('--ot')).toBe(String(q1.oneTime));
    const moved = waveDetail.levers.filter((l) => l.from !== l.to);
    expect([...p.querySelectorAll<HTMLElement>('[data-wave-move]')].map((r) => r.dataset['waveMove'])).toEqual(moved.map((l) => l.lever));
    for (const b of WAVE.result!.binding!) expect(p.querySelector(`[data-binding="${b.constraint}"]`)?.textContent).toContain(b.constraint);
  });

  it('a cap step commits the wave_plan parameter and runs the planner again', async () => {
    const t = await mount();
    const p = panel('waves');
    const cap = PARAMS.find((x) => x.key === 'quarterly_onetime_cap_musd')!;
    const reads = t.paramReads.length;
    fireEvent.click(within(p).getByRole('button', { name: `Increase ${cap.label}` }));
    await t.flush();
    await t.until(() => expect(t.posts).toHaveLength(1));
    expect(t.posts[0]!.changes[0]).toMatchObject({ target: 'structural', key: 'sourcing_param', member: cap.key });
    expect((t.posts[0]!.changes[0]!.value as { attrs: { value: number } }).attrs.value).toBe(cap.value + cap.step);
    await t.until(() => expect(t.starts).toHaveLength(2));
    await t.until(() => expect(t.paramReads.length).toBeGreaterThan(reads));
    expect(t.starts[1]).toEqual({ scenarioId: PRESET_C, spec: { problem: 'wave_plan', params: {} }, save: false });
  });

  it('a rerun that queues as a worker job keeps the last plan and the steppers on screen until tier 2 ends it', async () => {
    const ctl = { done: false };
    const t = await mount({ queueWaves: ctl });
    const p = panel('waves');
    const cap = PARAMS.find((x) => x.key === 'quarterly_onetime_cap_musd')!;
    fireEvent.click(within(p).getByRole('button', { name: `Increase ${cap.label}` }));
    await t.flush();
    await t.until(() => expect(t.starts).toHaveLength(2));
    await t.mock.replay([{ v: WS_PROTOCOL_VERSION, type: 'job', id: WAVE_JOB, status: 'running', progress: 0.5, note: null }]);
    await t.settle();
    // While the job runs: the old quarters stay (dimmed), the steppers stay, Open is disabled.
    expect(within(p).getByTestId('plan-running')).toBeTruthy();
    expect(p.querySelectorAll('[data-quarter]')).toHaveLength(waveDetail.quarters.length);
    expect(p.querySelector('.gp-src-stale')).toBeTruthy();
    expect(within(p).getByRole('button', { name: `Increase ${cap.label}` })).toBeTruthy();
    expect(within(p).getByTestId('plan-wave-open')).toHaveProperty('disabled', true);
    ctl.done = true;
    await t.mock.replay([{ v: WS_PROTOCOL_VERSION, type: 'job', id: WAVE_JOB, status: 'done', progress: 1, note: null }]);
    await t.until(() => {
      expect(within(p).queryByTestId('plan-running')).toBeNull();
      expect(p.querySelector('.gp-src-stale')).toBeNull();
    });
    expect(within(p).getByTestId('plan-wave-open')).toHaveProperty('disabled', false);
  });

  it('"Open as scenario" saves the run as asked (save: true) and moves to the saved scenario', async () => {
    const t = await mount();
    fireEvent.click(within(panel('waves')).getByTestId('plan-wave-open'));
    await t.until(() => expect(t.starts.filter((s) => s.save)).toHaveLength(1));
    expect(t.starts.find((s) => s.save)).toEqual({ scenarioId: PRESET_C, spec: WAVE.spec, save: true });
    await t.until(() => expect(t.router.state.location.pathname).toBe(`/${tenant}/${SAVED}/plan`));
  });
});

describe('G1: no arithmetic in tier 1', () => {
  it('module sources hold no maths on business numbers', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.tsx'));
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/Math\.|toFixed|toLocaleString|Intl\.|\.reduce\(/);
    }
  });
});

describe('G12: accessibility', () => {
  it('has no serious or critical axe violations', async () => {
    const t = await mount();
    const result = await axe.run(t.view.container, { rules: { 'color-contrast': { enabled: false } } });
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
