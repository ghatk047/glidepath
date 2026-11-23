// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useEffect } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ScenarioId,
  TenantSlug,
  WS_PROTOCOL_VERSION,
  apiRoutes,
  type ChangesetRequest,
} from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  presetSnapshot,
  specFixtures,
} from '@glidepath/api-contract/testing';
import { fmt } from '@glidepath/ui/format';
import { viewStore } from '../../app/view-store';
import { useCommit, type CommitQueue } from '../../commit';
import { DataProvider, createDataClient, createServerState } from '../../data';
import { GlobalLayout } from '../../global/shell';
import { GlobalOverlays, overlayController } from '../../global/overlays';
import { createSessionClient } from '../../session';
import { CORPORATE_GROUP, DRIVER_GROUPS, TRACE_IDS } from './copy';
import * as marketFormat from './format';
import { asCost, epsFmt } from './format';
import Market from './index';

// Spec ids verbatim; every value is read from the generated fixtures, never typed in.
const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const tenant = TenantSlug.parse(specFixtures.tenant);
const C = presetSnapshot('C');
const PRESET_C = ScenarioId.parse(C.scenarioId);
const cell = (id: string, member = '') => `${id}[${member}]`;
const num = (key: string) => C.cells[key] as number;
const bundleVars = specFixtures.bundle.variables;
const def = (id: string) => bundleVars.find((v) => v.id === id)!;
const corporate = bundleVars.filter((v) => v.group === CORPORATE_GROUP);
const yearKeys = specFixtures.members.dimensions['year']!.filter((m) => m.active).map((m) => m.key);
const explain = fx.nodeExplain.response;

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  viewStore.getState().closeAllPanels();
});
afterAll(() => server.close());

function serve() {
  const posts: ChangesetRequest[] = [];
  const explains: string[] = [];
  server.use(
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, () =>
      HttpResponse.json({ tenants: [{ ...fx.tenants.response.tenants[0]!, slug: tenant }] }),
    ),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(specFixtures.bundle)),
    http.get(`${BASE}${apiRoutes.members.path}`, () => HttpResponse.json(specFixtures.members)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () =>
      HttpResponse.json({ scenarios: specFixtures.scenarios.scenarios }),
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
      HttpResponse.json({ ...fx.scenarioCalc.response, scenarioId: String(params['id']) }),
    ),
    http.get(`${BASE}${apiRoutes.changesetHistory.path}`, ({ params }) =>
      HttpResponse.json({ scenarioId: String(params['id']), changesets: [], nextCursor: null }),
    ),
    http.get(`${BASE}${apiRoutes.nodeExplain.path}`, ({ params }) => {
      explains.push(decodeURIComponent(String(params['cell'])));
      return HttpResponse.json(explain);
    }),
    http.post(`${BASE}${apiRoutes.changesetApply.path}`, async ({ request }) => {
      const body = (await request.json()) as ChangesetRequest;
      posts.push(body);
      return HttpResponse.json({
        ...fx.changesetApply.response,
        scenarioId: body.scenarioId,
        version: body.baseVersion + 1,
        forkedFrom: undefined,
      });
    }),
  );
  return { posts, explains };
}

let queueRef: CommitQueue | null = null;
function GrabQueue() {
  const q = useCommit();
  useEffect(() => {
    queueRef = q;
  }, [q]);
  return null;
}

async function mount() {
  const served = serve();
  const mock = createMockSession({ snapshots: [C] });
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
      <GlobalLayout
        tenant={tenant}
        scenarioId={PRESET_C}
        module="market"
        session={session}
        onTrace={overlayController.openTrace}
        glass={{ frameSampling: false }}
      >
        <GrabQueue />
        <GlobalOverlays tenant={tenant} scenarioId={PRESET_C} />
        <Market />
      </GlobalLayout>
    );
  }
  const rootRoute = createRootRoute({ component: Outlet });
  const moduleRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$tenant/$scenario/$module',
    component: Screen,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([moduleRoute]),
    history: createMemoryHistory({ initialEntries: [`/${tenant}/${PRESET_C}/market`] }),
  });
  render(
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
  await until(() => expect(document.querySelectorAll('.gp-tnode').length).toBe(TRACE_IDS.length));
  await until(() =>
    expect(
      document.querySelector('.gp-tnode[data-node="res.net"] .gp-tnode-value')?.textContent,
    ).toBe(fmt.money(num(cell('res.net')))),
  );
  return { ...served, mock, session, settle, until, flush };
}

const node = (id: string) => document.querySelector<HTMLElement>(`.gp-tnode[data-node="${id}"]`)!;
const text = (el: Element | null | undefined, sel: string) =>
  el?.querySelector(sel)?.textContent ?? '';

describe('AC1: trace chain', () => {
  it('res.net, pnl.o27, res.tot_ot_all, br.ebitda27, br.eps27 (+ br.eps_pct27), br.px27, br.mcap27 are trace nodes that open the trace drawer', async () => {
    const t = await mount();
    const chain = screen.getByRole('list', { name: 'From IT savings to share price' });
    const ids = [...chain.querySelectorAll<HTMLElement>('.gp-tnode')].map((n) => n.dataset['node']);
    expect(ids).toEqual([...TRACE_IDS]);

    // values are the fixture's, in the render's display
    expect(text(node('res.net'), '.gp-tnode-value')).toBe(fmt.money(num(cell('res.net'))));
    expect(text(node('pnl.o27'), '.gp-tnode-value')).toBe(fmt.money(num(cell('pnl.o27'))));
    expect(text(node('res.tot_ot_all'), '.gp-tnode-value')).toBe(
      asCost(num(cell('res.tot_ot_all'))),
    );
    expect(text(node('br.ebitda27'), '.gp-tnode-value')).toBe(
      fmt.signed(num(cell('br.ebitda27')), 'money'),
    );
    expect(text(node('br.eps27'), '.gp-tnode-value')).toBe(
      fmt.signed(num(cell('br.eps27')), 'eps'),
    );
    expect(text(node('br.eps27'), '.gp-tnode-note')).toBe(
      `${fmt.pct(num(cell('br.eps_pct27')), { digits: 1, signed: true, scale: 'points' })} vs base`,
    );
    expect(text(node('br.px27'), '.gp-tnode-value')).toBe(
      fmt.eps(num(cell('br.px27')), { digits: 2, signed: true }),
    );
    expect(text(node('br.px27'), '.gp-tnode-note')).toContain(fmt.mult(num(cell('corp.ev_mult'))));
    expect(text(node('br.mcap27'), '.gp-tnode-value')).toBe(
      fmt.money(num(cell('br.mcap27')), { digits: 0, signed: true }),
    );

    // each node opens the trace drawer on its own cell
    for (const id of TRACE_IDS) {
      fireEvent.click(node(id));
      expect(viewStore.getState().openPanels).toContain('traceDrawer');
      expect(overlayController.store.getState().trace).toBe(cell(id));
      await t.until(() => expect(node(id).getAttribute('aria-current')).toBe('true'));
      await t.until(() => expect(t.explains.at(-1)).toBe(cell(id)));
    }
    await t.until(() =>
      expect(document.querySelector('.gp-drawer')?.textContent).toContain(explain.words),
    );
  });

  it('Show formulas opens the trace drawer on the selected node (res.net first)', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Show formulas' }));
    expect(overlayController.store.getState().trace).toBe(cell('res.net'));
  });

  it('has no accessibility violations (G12)', async () => {
    const t = await mount();
    fireEvent.click(node('br.eps27'));
    await t.until(() =>
      expect(document.querySelector('.gp-drawer')?.textContent).toContain(explain.words),
    );
    const r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});

const dial = (id: string) =>
  document.querySelector<HTMLElement>(`.gp-market-dial[data-variable-id="${id}"]`)!;

describe('AC2: drivers', () => {
  it('dials for corp.brent, corp.crack, corp.gdp, corp.lab_wage_g, corp.ac_add, corp.sofr show the session values', async () => {
    const t = await mount();
    const members = specFixtures.members.dimensions;
    const labor = `${members['lgroup']![0]!.key as string},fy27`;
    const expected: Record<string, string> = {
      'corp.brent': cell('corp.brent', 'fy27'),
      'corp.crack': cell('corp.crack', 'fy27'),
      'corp.gdp': cell('corp.gdp', 'fy27'),
      'corp.lab_wage_g': cell('corp.lab_wage_g', labor),
      'corp.ac_add': cell('corp.ac_add', 'fy27'),
      'corp.sofr': cell('corp.sofr', 'fy27'),
    };
    await t.until(() =>
      expect(document.querySelectorAll('.gp-market-dial [role="slider"]').length).toBe(6),
    );
    for (const [id, key] of Object.entries(expected)) {
      const slider = dial(id).querySelector('[role="slider"]')!;
      expect(slider.getAttribute('aria-valuenow'), id).toBe(String(num(key)));
      expect(slider.getAttribute('aria-valuemin'), id).toBe(String(def(id).min));
      expect(slider.getAttribute('aria-valuemax'), id).toBe(String(def(id).max));
    }
    // percent drivers are percentage points: GDP 2 reads 2.0%, not 200%
    expect(text(dial('corp.gdp'), '.gp-dial-value')).toBe(
      fmt.pct(num(cell('corp.gdp', 'fy27')), { digits: 1, scale: 'points' }),
    );
    expect(text(dial('corp.gdp'), '.gp-dial-value')).toMatch(/^[0-9]\.[0-9]%$/);
    expect(text(dial('corp.brent'), '.gp-dial-value')).toBe(
      fmt.eps(num(cell('corp.brent', 'fy27')), { digits: 0 }),
    );
  });

  it('turning a dial previews on tier 2 and commits corp.brent on release', async () => {
    const t = await mount();
    await t.until(() => expect(dial('corp.brent').querySelector('[role="slider"]')).not.toBeNull());
    const slider = dial('corp.brent').querySelector('[role="slider"]')!;
    const before = num(cell('corp.brent', 'fy27'));
    const step = def('corp.brent').step!;
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    await t.settle();
    // the dial snaps to the registry's step grid, one step up
    const sent = t.mock
      .sentOf('preview')
      .at(-1)!
      .changes.find((c) => c.var === 'corp.brent')!;
    expect(sent.member).toBe('fy27');
    expect(sent.value).toBeGreaterThan(before);
    expect(sent.value - before).toBeLessThanOrEqual(2 * step);
    await t.flush();
    await waitFor(() => expect(t.posts).toHaveLength(1));
    expect(t.posts[0]!.changes).toContainEqual(
      expect.objectContaining({ key: 'corp.brent', member: 'fy27', value: sent.value }),
    );
  });

  it('the labor dial follows the group picker (corp.lab_wage_g[group,fy27])', async () => {
    const t = await mount();
    const groups = specFixtures.members.dimensions['lgroup']!;
    const second = groups[1]!.key as string;
    await t.until(() =>
      expect(dial('corp.lab_wage_g').querySelector('[role="slider"]')).not.toBeNull(),
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Labor group' }), {
      target: { value: second },
    });
    await t.until(() =>
      expect(
        dial('corp.lab_wage_g').querySelector('[role="slider"]')!.getAttribute('aria-valuenow'),
      ).toBe(String(num(cell('corp.lab_wage_g', `${second},fy27`)))),
    );
  });

  it('valuation: EV / EBITDAR shows corp.ev_mult; P/E writes corp.w_pe and shows corp.pe', async () => {
    const t = await mount();
    const group = await screen.findByRole('group', { name: 'Valuation basis' });
    const [ev, pe] = within(group).getAllByRole('button');
    await t.until(() => expect(ev!.getAttribute('aria-pressed')).toBe('true'));
    const shown = () => document.querySelector('.gp-market-valuation-value')!;
    await t.until(() => expect(shown().textContent).toContain(fmt.mult(num(cell('corp.ev_mult')))));
    expect(num(cell('corp.w_pe'))).toBe(def('corp.w_pe').min);

    fireEvent.click(pe!);
    await t.flush();
    await waitFor(() => expect(t.posts).toHaveLength(1));
    expect(t.posts[0]!.changes).toContainEqual(
      expect.objectContaining({ key: 'corp.w_pe', value: def('corp.w_pe').max }),
    );

    // tier 2 pushes the new weight: the screen switches to the P/E multiple
    await t.mock.replay([
      {
        v: WS_PROTOCOL_VERSION,
        type: 'delta',
        seq: null,
        cells: { [cell('corp.w_pe')]: def('corp.w_pe').max! },
      },
    ]);
    await t.until(() => expect(pe!.getAttribute('aria-pressed')).toBe('true'));
    await t.until(() => expect(shown().textContent).toContain(fmt.mult(num(cell('corp.pe')))));
  });
});

describe('AC3: adjusted EPS and share price', () => {
  it('pl.eps per year in the bars; val.px for fy27b and fy27it; br.fuel_equiv_cents', async () => {
    const t = await mount();
    const bars = () => [...document.querySelectorAll<HTMLElement>('.gp-market-eps-bars > li')];
    await t.until(() => expect(bars().map((b) => b.dataset['year'])).toEqual(yearKeys));
    // the golden fixture carries pl.eps for the two FY27 members only; tier 2 pushes the rest
    const pushed = { [cell('pl.eps', 'fy25')]: 0.5, [cell('pl.eps', 'fy26')]: -0.5 };
    await t.mock.replay([{ v: WS_PROTOCOL_VERSION, type: 'delta', seq: null, cells: pushed }]);
    const all = { ...C.cells, ...pushed };
    await t.until(() =>
      expect(document.querySelectorAll('.gp-market-eps-bars > li [data-value]').length).toBe(
        yearKeys.length,
      ),
    );
    for (const b of bars()) {
      const v = all[cell('pl.eps', b.dataset['year']!)] as number;
      expect(b.querySelector('[data-value]')!.getAttribute('data-value')).toBe(String(v));
      expect(text(b, '.gp-market-eps-value')).toBe(epsFmt(v));
      expect(b.hasAttribute('data-negative')).toBe(v < 0);
    }
    // the IT member is the highlighted bar
    expect(
      bars()
        .filter((b) => b.hasAttribute('data-it'))
        .map((b) => b.dataset['year']),
    ).toEqual(['fy27it']);

    const price = screen.getByTestId('market-price');
    await t.until(() =>
      expect(within(price).getByText(epsFmt(num(cell('val.px', 'fy27it'))))).toBeTruthy(),
    );
    expect(within(price).getByText(epsFmt(num(cell('val.px', 'fy27b'))))).toBeTruthy();
    expect(price.textContent).toContain(fmt.cents(num(cell('br.fuel_equiv_cents'))));
    expect(price.querySelector('[data-node="br.fuel_equiv_cents"]')).not.toBeNull();
  });
});

describe('AC4: more drivers', () => {
  it('lists every corporate driver, grouped macro, fuel, demand, labor, fleet, airports, financing, tax, valuation', async () => {
    const t = await mount();
    expect(corporate.length).toBe(91);
    const toggle = screen.getByRole('button', { name: `More drivers · ${corporate.length}` });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelectorAll('.gp-market-driver')).toHaveLength(0);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await t.until(() =>
      expect(document.querySelectorAll('.gp-market-driver').length).toBe(corporate.length),
    );

    // count equals the bundle's Corporate drivers group, every id once
    const listed = [...document.querySelectorAll<HTMLElement>('.gp-market-driver')].map(
      (e) => e.dataset['variableId'],
    );
    expect(new Set(listed).size).toBe(corporate.length);
    expect([...listed].sort()).toEqual(corporate.map((v) => v.id).sort());

    // sections in the screen's order, none left over
    const sections = [...document.querySelectorAll<HTMLElement>('.gp-market-group-section')];
    expect(sections.map((s) => s.dataset['group'])).toEqual(DRIVER_GROUPS.map((g) => g.key));
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(
      DRIVER_GROUPS.map((g) => g.label),
    );
    expect(document.querySelector('[data-group="other"]')).toBeNull();
    // a driver sits in its group
    expect(sections[0]!.querySelector('[data-variable-id="corp.gdp"]')).not.toBeNull();
    expect(sections[1]!.querySelector('[data-variable-id="corp.brent"]')).not.toBeNull();

    // a cell shows tier 2's value and writes through the queue
    const row = document.querySelector<HTMLElement>('[data-variable-id="corp.cpi"]')!;
    await t.until(() => expect(row.querySelector('[data-member="fy27"] input')).not.toBeNull());
    const input = row.querySelector<HTMLInputElement>('[data-member="fy27"] input')!;
    expect(input.value).toContain(String(num(cell('corp.cpi', 'fy27'))));
  });
});

describe('AC5: values come from the session', () => {
  it('a pushed delta changes the chain; nothing is derived from another cell', async () => {
    const t = await mount();
    const before = text(node('pnl.o27'), '.gp-tnode-value');
    await t.mock.replay([
      {
        v: WS_PROTOCOL_VERSION,
        type: 'delta',
        seq: null,
        cells: { [cell('res.net')]: 100, [cell('val.px', 'fy27it')]: 13 },
      },
    ]);
    await t.until(() => expect(text(node('res.net'), '.gp-tnode-value')).toBe(fmt.money(100)));
    expect(text(node('pnl.o27'), '.gp-tnode-value')).toBe(before);
    // output numbers roll to the pushed value
    await waitFor(
      () => expect(within(screen.getByTestId('market-price')).getByText(epsFmt(13))).toBeTruthy(),
      { timeout: 3000 },
    );
  });
});

describe('WEB-10: percent scale on the shared path', () => {
  it('the Market module drops its local scaling: no pctPoints, no "/ 100" in format.ts; percent units go through formatByUnit with the bundle scale', () => {
    expect('pctPoints' in marketFormat).toBe(false);
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'format.ts'), 'utf8');
    expect(source).not.toMatch(/\/\s*100/);
    expect(source).toContain('formatByUnit');
    const gdp = def('corp.gdp');
    expect(gdp.percentScale).toBe('points');
    expect(marketFormat.driverFormat(gdp.unit, gdp.step, gdp.percentScale)(2)).toBe('2.0%');
    // a fraction percent shows the same way through the same path
    const target = def('g.target_pct');
    expect(target.percentScale).toBe('fraction');
    expect(marketFormat.driverFormat(target.unit, target.step, target.percentScale)(0.1)).toBe(
      '10.0%',
    );
  });

  it('every scalar percent driver of the Corporate group lists as points in More drivers (none reads 100x too large)', async () => {
    const t = await mount();
    fireEvent.click(screen.getByRole('button', { name: `More drivers · ${corporate.length}` }));
    await t.until(() =>
      expect(document.querySelectorAll('.gp-market-driver').length).toBe(corporate.length),
    );
    const pct = corporate.filter((v) => v.unit === '%' && v.dims.length === 0);
    expect(pct.length).toBeGreaterThan(0);
    for (const v of pct) {
      const raw = C.cells[cell(v.id)];
      if (typeof raw !== 'number') continue;
      // scoped to the More drivers panel: the same id may also carry a Drivers-panel control
      const row = document.querySelector<HTMLElement>(
        `[data-testid="market-more"] [data-variable-id="${v.id}"]`,
      )!;
      await t.until(() => expect(row.querySelector('input')).not.toBeNull());
      expect(row.querySelector<HTMLInputElement>('input')!.value, v.id).toBe(
        marketFormat.driverFormat(v.unit, v.step, 'points')(raw),
      );
    }
  });
});
