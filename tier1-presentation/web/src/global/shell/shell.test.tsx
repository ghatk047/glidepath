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
import axe from 'axe-core';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useEffect } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ScenarioId,
  ScenariosResponse,
  TenantSlug,
  apiRoutes,
  type Change,
  type ChangesetRequest,
  type CreateScenarioRequest,
} from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  presetSnapshot,
  specFixtures,
} from '@glidepath/api-contract/testing';
import { fmt } from '@glidepath/ui/format';
import { formatByUnit } from '@glidepath/ui/inputs/slider';
import { MODULE_IDS, isModuleId, type ModuleId } from '../../app/modules';
import { viewStore } from '../../app/view-store';
import { Value } from '../../bind';
import { useCommit, type CommitQueue } from '../../commit';
import { DataProvider, createDataClient, createServerState } from '../../data';
import { createSessionClient } from '../../session';
import { GlobalLayout, HUD_NODES, MODULE_COPY, scenarioBarModel } from './index';

// ---------------------------------------------------------------------------------------------
// Fixtures: spec ids verbatim, values read from the generated fixtures (never typed in).
// ---------------------------------------------------------------------------------------------

const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const tenant = TenantSlug.parse(specFixtures.tenant);
const presets = specFixtures.scenarios.scenarios;
const snap = (key: string) => presetSnapshot(key);
const C = snap('C');
const B = snap('B');
const D = snap('D');
const PRESET_C = ScenarioId.parse(C.scenarioId);
const PRESET_B = ScenarioId.parse(B.scenarioId);

const history = fx.changesetHistory.response;
const CUSTOM = ScenarioId.parse(history.scenarioId);
const SAVED = ScenarioId.parse('sc-saved-1');
const PATH = ScenarioId.parse('sc-path-1');
const custom = {
  ...presets.find((s) => s.id === PRESET_C)!,
  id: CUSTOM,
  key: 'user-1',
  label: 'Custom (from C)',
  shortLabel: 'Custom (from C)',
  kind: 'user' as const,
  parentId: PRESET_C,
  locked: false,
  editsCount: history.changesets[0]!.editsCount,
};
const pathScenario = {
  ...custom,
  id: PATH,
  key: 'path-1',
  label: 'Min-risk mix',
  shortLabel: 'Min-risk mix',
  kind: 'solver' as const,
  parentId: null,
};
const saved = { ...custom, id: SAVED, key: 'user-2', label: 'Custom 2', shortLabel: 'Custom 2' };
const scenarioList = [...presets, custom, pathScenario];

const tenantRow = { ...fx.tenants.response.tenants[0]!, slug: tenant };
const NET = `${HUD_NODES.net}[]`;
const cellsOf = (s: typeof C) =>
  Object.fromEntries(Object.values(HUD_NODES).map((id) => [id, s.cells[`${id}[]`] as number]));

const problem = (status: number, detail: string) =>
  HttpResponse.json(
    { type: '/problems/validation', title: 'Rejected', status, detail },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );

// ---------------------------------------------------------------------------------------------
// tier 2 double (msw) and the WS session (the contract's mock session)
// ---------------------------------------------------------------------------------------------

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined; // jsdom: the router restores scroll
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  viewStore.getState().setTheme('cruise');
});
afterAll(() => server.close());

interface ServeOptions {
  calcStale?: boolean;
  /** Answer of the n-th `POST /changesets` (default: an applied result on the scenario). */
  apply?: (n: number, body: ChangesetRequest) => Response;
  /** Delay the first answers (loading state). */
  hold?: Promise<void>;
}

function serve(opts: ServeOptions = {}) {
  const posts: ChangesetRequest[] = [];
  const reverts: string[] = [];
  const creates: CreateScenarioRequest[] = [];
  const patches: { id: string; body: unknown }[] = [];
  const hold = async () => {
    if (opts.hold) await opts.hold;
  };
  server.use(
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, async () => {
      await hold();
      return HttpResponse.json({ tenants: [tenantRow] });
    }),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(specFixtures.bundle)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, async () => {
      await hold();
      return HttpResponse.json({ scenarios: scenarioList });
    }),
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
        stale: opts.calcStale ?? false,
      }),
    ),
    http.get(`${BASE}${apiRoutes.changesetHistory.path}`, ({ params }) =>
      String(params['id']) === CUSTOM
        ? HttpResponse.json(history)
        : HttpResponse.json({ scenarioId: String(params['id']), changesets: [], nextCursor: null }),
    ),
    http.post(`${BASE}${apiRoutes.changesetApply.path}`, async ({ request }) => {
      const body = (await request.json()) as ChangesetRequest;
      posts.push(body);
      if (opts.apply) return opts.apply(posts.length, body);
      return HttpResponse.json({
        ...fx.changesetApply.response,
        changesetId: `cs-apply-${String(posts.length)}`,
        scenarioId: body.scenarioId,
        version: body.baseVersion + 1,
        editsCount: custom.editsCount + posts.length,
        outputs: { [NET]: D.cells[NET] },
        forkedFrom: undefined,
      });
    }),
    http.post(`${BASE}${apiRoutes.changesetRevert.path}`, async ({ params, request }) => {
      const id = String(params['id']);
      reverts.push(id);
      const { baseVersion } = (await request.json()) as { baseVersion: number };
      return HttpResponse.json({
        ...fx.changesetRevert.response,
        changesetId: `cs-revert-${String(reverts.length)}`,
        scenarioId: CUSTOM,
        version: baseVersion + 1,
        editsCount: custom.editsCount,
        outputs: { [NET]: C.cells[NET] },
        forkedFrom: undefined,
        reverts: id,
      });
    }),
    http.post(`${BASE}${apiRoutes.scenarioCreate.path}`, async ({ request }) => {
      creates.push((await request.json()) as CreateScenarioRequest);
      return HttpResponse.json(saved, { status: 201 });
    }),
    http.patch(`${BASE}${apiRoutes.scenarioPatch.path}`, async ({ params, request }) => {
      patches.push({ id: String(params['id']), body: await request.json() });
      return HttpResponse.json({ ...custom, archived: true });
    }),
  );
  return { posts, reverts, creates, patches };
}

const variable = (key: string, value: number): Change =>
  ({ target: 'variable', key, member: '', value }) as Change;

let queueRef: CommitQueue | null = null;
function GrabQueue() {
  const q = useCommit();
  useEffect(() => {
    queueRef = q;
  }, [q]);
  return null;
}

/** The app's route shape (`/:tenant/:scenario/:module`) around `GlobalLayout`. */
async function mount(path: string, opts: ServeOptions = {}) {
  const served = serve(opts);
  const mock = createMockSession({
    snapshots: [
      ...presets.map((p) => snap(p.key)),
      { ...C, scenarioId: CUSTOM },
      { ...D, scenarioId: SAVED },
    ],
  });
  const frames: (() => void)[] = [];
  const [, , scenario] = path.split('/');
  const session = createSessionClient({
    tenant,
    scenario: scenario!,
    origin: 'ws://localhost:8080',
    connect: mock.connect,
    requestFrame: (cb) => void frames.push(cb),
    random: () => 0,
  });

  function Screen() {
    const p = moduleRoute.useParams();
    const module = p.module as ModuleId;
    return (
      <GlobalLayout
        tenant={TenantSlug.parse(p.tenant)}
        scenarioId={ScenarioId.parse(p.scenario)}
        module={module}
        session={session}
        glass={{ frameSampling: false }}
      >
        <main aria-label="Module">
          <Value node={HUD_NODES.net} format="money" className="module-net" />
          <GrabQueue />
        </main>
      </GlobalLayout>
    );
  }
  const rootRoute = createRootRoute({ component: Outlet });
  const moduleRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$tenant/$scenario/$module',
    params: {
      parse: ({ tenant: t, scenario: s, module: m }) => {
        if (!isModuleId(m)) throw new Error('unknown module');
        return { tenant: t, scenario: s, module: m };
      },
      stringify: (p) => p,
    },
    component: Screen,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([moduleRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(
    <DataProvider client={createDataClient({ baseUrl: BASE })} serverState={createServerState()}>
      <RouterProvider router={router as never} />
    </DataProvider>,
  );
  /** Delivers queued WS frames and applies them (one animation frame). */
  const settle = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      await mock.flush();
    });
    act(() => {
      for (const cb of frames.splice(0)) cb();
    });
  };
  /** Settles until `check` passes. */
  const until = async (check: () => void) => {
    for (let i = 0; ; i++) {
      await settle();
      try {
        check();
        return;
      } catch (e) {
        if (i > 40) throw e;
      }
    }
  };
  return { ...served, mock, session, router, settle, until, view };
}

const hud = () => document.querySelector<HTMLElement>('aside.gp-hud');
const hudValue = (cell: string) =>
  hud()?.querySelector<HTMLElement>(`[data-cell="${cell}"] [data-value]`)?.dataset['value'];
const moduleNet = () => document.querySelector<HTMLElement>('.module-net')?.dataset['value'];
const commit = async (change: Change) => {
  await act(async () => {
    const done = queueRef!.commit(change);
    await queueRef!.flush();
    await done.catch(() => undefined);
  });
};

// ---------------------------------------------------------------------------------------------

describe('AC1: rail, tenant monogram, scenario bar from /scenarios, switching', () => {
  it('rail lists the 8 modules and the tenant monogram opens Airlines', async () => {
    const t = await mount(`/${tenant}/${PRESET_C}/levers`);
    const nav = await screen.findByRole('navigation', { name: 'Modules' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(MODULE_IDS.map((id) => MODULE_COPY[id].label));
    expect(links).toHaveLength(MODULE_IDS.length);
    expect(within(nav).getByRole('link', { current: 'page' }).textContent).toBe(
      MODULE_COPY.levers.label,
    );
    // Monogram: the tenant code, never a logo.
    const mono = within(nav).getByRole('button', { name: /switch airline/ });
    expect(mono.textContent).toBe(tenant.toUpperCase());
    expect(nav.querySelector('img')).toBeNull();

    fireEvent.click(mono);
    await t.until(() =>
      expect(t.router.state.location.pathname).toBe(`/${tenant}/${PRESET_C}/airlines`),
    );
    fireEvent.click(within(nav).getByRole('link', { name: MODULE_COPY.vps.label }));
    await t.until(() =>
      expect(t.router.state.location.pathname).toBe(`/${tenant}/${PRESET_C}/vps`),
    );
  });

  it('scenario bar shows R/A/B/C/D from /scenarios, customs and paths in the menu', async () => {
    const t = await mount(`/${tenant}/${PRESET_C}/levers`);
    const group = await screen.findByRole('group', { name: 'Scenario' });
    const expected = scenarioBarModel(
      ScenariosResponse.parse({ scenarios: scenarioList }).scenarios,
      PRESET_C,
    );
    const pressable = within(group)
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('aria-pressed'));
    expect(pressable.map((b) => b.querySelector('.gp-seg-k')!.textContent)).toEqual([
      'R',
      'A',
      'B',
      'C',
      'D',
    ]);
    expect(pressable.map((b) => b.dataset['scenario'])).toEqual(presets.map((p) => p.id));
    // chips carry tier 2's short names, as the Cockpit render shows them (WEB-11)
    expect(pressable.map((b) => b.querySelector('.gp-seg-t')!.textContent)).toEqual([
      'Rates only',
      'Commercial',
      'Op-model reset',
      'Balanced',
      'Full stretch',
    ]);
    expect(pressable.map((b) => b.querySelector('.gp-seg-t')!.textContent)).toEqual(
      presets.map((p) => p.shortLabel),
    );
    expect(within(group).getByRole('button', { pressed: true }).dataset['scenario']).toBe(PRESET_C);
    expect(expected.customs).toEqual([{ id: CUSTOM, name: custom.label }]);
    expect(expected.paths).toEqual([{ id: PATH, name: pathScenario.label }]);

    fireEvent.click(within(group).getByRole('button', { name: /More scenarios/ }));
    const menu = screen.getByRole('menu', { name: 'More scenarios' });
    expect(within(menu).getByRole('group', { name: 'Custom' }).textContent).toContain(custom.label);
    expect(within(menu).getByRole('group', { name: 'Paths' }).textContent).toContain(
      pathScenario.label,
    );
    expect(t.posts).toHaveLength(0);
  });

  it('switching updates the URL, opens the scenario on the session and every bound number rolls', async () => {
    const t = await mount(`/${tenant}/${PRESET_C}/levers?lever=L10`);
    await t.until(() => {
      expect(moduleNet()).toBe(String(C.cells[NET]));
      expect(hudValue('net')).toBe(String(C.cells[NET]));
    });
    const group = screen.getByRole('group', { name: 'Scenario' });
    fireEvent.click(group.querySelector<HTMLElement>(`[data-scenario="${PRESET_B}"]`)!);

    await t.until(() => {
      expect(t.router.state.location.pathname).toBe(`/${tenant}/${PRESET_B}/levers`);
      expect(t.router.state.location.search).toMatchObject({ lever: 'L10' });
      expect(t.mock.sentOf('open').map((m) => m.scenarioId)).toEqual([PRESET_B]);
      // Every bound number has the new scenario's value: the module's and the strip's.
      expect(moduleNet()).toBe(String(B.cells[NET]));
      for (const [id, value] of Object.entries(cellsOf(B))) {
        const cell = Object.entries(HUD_NODES).find(([, v]) => v === id)![0];
        if (cell !== 'gap') expect(hudValue(cell)).toBe(String(value));
      }
    });
    expect(within(group).getByRole('button', { pressed: true }).dataset['scenario']).toBe(PRESET_B);
    // Back in history returns to C on the same session.
    act(() => t.router.history.back());
    await t.until(() => expect(moduleNet()).toBe(String(C.cells[NET])));
    expect(t.mock.sentOf('open').map((m) => m.scenarioId)).toEqual([PRESET_B, PRESET_C]);
  });
});

describe('AC2: flight strip bound via useNode', () => {
  it('subscribes res.net, res.bar, res.gap, res.risk, br.eps27 and shows the pushed values', async () => {
    const t = await mount(`/${tenant}/${PRESET_C}/levers`);
    await t.until(() => expect(hud()).not.toBeNull());
    for (const id of Object.values(HUD_NODES)) expect(t.mock.subscribed.has(`${id}[]`)).toBe(true);
    const values = cellsOf(C);
    expect(hudValue('net')).toBe(String(values[HUD_NODES.net]));
    expect(hudValue('bar')).toBe(String(values[HUD_NODES.bar]));
    expect(hudValue('risk')).toBe(String(values[HUD_NODES.risk]));
    expect(hudValue('eps27')).toBe(String(values[HUD_NODES.eps27]));
    const gap = values[HUD_NODES.gap]!;
    expect(hud()!.querySelector('[data-cell="gap"]')!.textContent).toContain(
      fmt.money(Math.abs(gap)),
    );
    expect(hud()!.hidden).toBe(false);
  });

  it('is hidden on Cockpit and shows again elsewhere', async () => {
    const t = await mount(`/${tenant}/${PRESET_C}/cockpit`);
    await t.until(() => expect(hud()).not.toBeNull());
    expect(hud()!.hidden).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: MODULE_COPY.market.label }));
    await t.until(() => expect(hud()!.hidden).toBe(false));
    expect(hudValue('net')).toBe(String(C.cells[NET]));
  });
});

describe('AC3: edits tray from tier 2 history; undo, redo, save as scenario, discard', () => {
  it('lists tier 2 history and undoes, redoes, saves as scenario and discards through tier 2', async () => {
    const t = await mount(`/${tenant}/${CUSTOM}/levers`);
    const counter = await screen.findByRole('button', {
      name: `${String(custom.editsCount)} edit: open changeset`,
    });
    fireEvent.click(counter);
    const tray = screen.getByRole('dialog', { name: `Changeset · ${custom.label}` });
    const record = history.changesets[0]!.changes[0]!;
    const def = specFixtures.bundle.variables.find((v) => v.id === record.key)!;
    await waitFor(() => expect(within(tray).getAllByRole('listitem')).toHaveLength(1));
    const row = within(tray).getByRole('listitem');
    expect(row.textContent).toContain('You'); // createdBy is the viewer (`/me`)
    expect(row.textContent).toContain(def.label);
    expect(row.textContent).toContain(formatByUnit(record.oldValue as number, def.unit, def.step!));
    expect(row.textContent).toContain(formatByUnit(record.newValue as number, def.unit, def.step!));
    expect(within(tray).getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);

    // An edit in this session: the counter shows tier 2's count, undo is offered.
    await commit(variable(record.key, D.cells[`${record.key}[]`] as number));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /edits: open changeset/ }).textContent).toContain(
        String(custom.editsCount + 1),
      ),
    );
    const undo = within(tray).getByRole('button', { name: 'Undo' });
    await waitFor(() => expect(undo).toHaveProperty('disabled', false));
    fireEvent.click(undo);
    await waitFor(() => expect(t.reverts).toEqual(['cs-apply-1']));
    const redo = within(tray).getByRole('button', { name: 'Redo' });
    await waitFor(() => expect(redo).toHaveProperty('disabled', false));
    fireEvent.click(redo);
    await waitFor(() => expect(t.reverts).toEqual(['cs-apply-1', 'cs-revert-1']));

    // Save as scenario: tier 2 copies the scenario; the URL moves to the copy.
    fireEvent.click(within(tray).getByRole('button', { name: 'Save as scenario' }));
    await t.until(() => {
      expect(t.creates).toEqual([{ mode: 'copy', from: CUSTOM }]);
      expect(t.router.state.location.pathname).toBe(`/${tenant}/${SAVED}/levers`);
    });
    await waitFor(() =>
      expect(document.querySelector('.gp-toast-region')!.textContent).toBe(
        `Saved as ${saved.label}`,
      ),
    );
  });

  it('discard archives the custom scenario and returns to its preset', async () => {
    const t = await mount(`/${tenant}/${CUSTOM}/levers`);
    const counter = await screen.findByRole('button', { name: /edit: open changeset/ });
    fireEvent.click(counter);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await t.until(() => {
      expect(t.patches).toEqual([{ id: CUSTOM, body: { archived: true } }]);
      expect(t.router.state.location.pathname).toBe(`/${tenant}/${PRESET_C}/levers`);
    });
    await t.until(() => expect(moduleNet()).toBe(String(C.cells[NET])));
  });
});

describe('AC4: theme, toast after commit, screen states', () => {
  it('theme toggle switches Cruise ⇄ Daylight on <html> and is remembered', async () => {
    await mount(`/${tenant}/${PRESET_C}/levers`);
    const toggle = await screen.findByRole('button', { name: /Theme Cruise: switch to Daylight/ });
    fireEvent.click(toggle);
    expect(document.documentElement.dataset['theme']).toBe('daylight');
    expect(localStorage.getItem('glidepath.theme')).toBe('daylight');
    fireEvent.click(screen.getByRole('button', { name: /Theme Daylight: switch to Cruise/ }));
    expect(document.documentElement.dataset['theme']).toBe('cruise');
  });

  it('shows a toast after a commit with the effect tier 2 reported', async () => {
    const t = await mount(`/${tenant}/${CUSTOM}/levers`);
    await t.until(() => expect(queueRef).not.toBeNull());
    await commit(variable('g.target_net', D.cells['g.target_net[]'] as number));
    const toast = document.querySelector('.gp-toast-region')!;
    await waitFor(() =>
      expect(toast.textContent).toBe(`Change saved · net ${fmt.money(D.cells[NET] as number)}`),
    );
    expect(toast.getAttribute('role')).toBe('status');
  });

  it('loading: skeletons rest in the bar and the strip until tier 2 answers', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const t = await mount(`/${tenant}/${PRESET_C}/levers`, { hold });
    await waitFor(() =>
      expect(screen.getByLabelText('Scenarios').getAttribute('aria-busy')).toBe('true'),
    );
    expect(document.querySelector('[data-hud-loading]')?.getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('.gp-skel')).not.toBeNull();
    release();
    await t.until(() => {
      expect(screen.getByRole('group', { name: 'Scenario' })).toBeTruthy();
      expect(document.querySelector('[data-hud-loading]')).toBeNull();
    });
  });

  it('error chip shows problem.detail; reconnecting chip and dimmed values on a drop; stale chip', async () => {
    const detail = 'Org_Map row sums to 95%. Make it 100%.';
    const t = await mount(`/${tenant}/${CUSTOM}/levers`, {
      calcStale: true,
      apply: () => problem(422, detail),
    });
    await t.until(() => expect(hud()).not.toBeNull());
    await waitFor(() =>
      expect(document.querySelector('[data-state="stale"]')?.textContent).toContain('Recalculate'),
    );

    await commit(variable('g.target_net', D.cells['g.target_net[]'] as number));
    await waitFor(() =>
      expect(document.querySelector('[data-state="error"]')?.textContent).toContain(detail),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(document.querySelector('[data-state="error"]')).toBeNull();

    act(() => t.mock.drop());
    await t.until(() => {
      expect(document.querySelector('[data-state="reconnecting"]')?.textContent).toContain(
        'Reconnecting',
      );
      expect(document.querySelector('[data-hud]')?.hasAttribute('data-stale')).toBe(true);
    });
  });
});

describe('G12: accessibility', () => {
  it('has no serious or critical axe violations', async () => {
    const t = await mount(`/${tenant}/${CUSTOM}/levers`);
    await t.until(() => expect(hud()).not.toBeNull());
    await screen.findByRole('group', { name: 'Scenario' });
    const result = await axe.run(t.view.container, {
      rules: { 'color-contrast': { enabled: false } }, // jsdom has no layout or computed colours
    });
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
