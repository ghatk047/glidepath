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
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ScenarioId,
  TenantSlug,
  apiRoutes,
  type ChangesetRequest,
  type SearchResult,
} from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  presetSnapshot,
  specFixtures,
} from '@glidepath/api-contract/testing';
import { MAX_RESULTS } from '@glidepath/ui/overlays/palette';
import { isModuleId, type ModuleId } from '../../app/modules';
import { parseViewSearch } from '../../app/search';
import { viewStore } from '../../app/view-store';
import { BoundEditable, Value, formatFor } from '../../bind';
import { DataProvider, createDataClient, createServerState } from '../../data';
import { createSessionClient } from '../../session';
import { GlobalLayout } from '../shell';
import {
  GlobalOverlays,
  createOverlayController,
  traceContent,
  type OverlayController,
} from './index';

// ---------------------------------------------------------------------------------------------
// Fixtures: spec ids verbatim, values read from the generated fixtures (never typed in).
// ---------------------------------------------------------------------------------------------

const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const tenant = TenantSlug.parse(specFixtures.tenant);
const C = presetSnapshot('C');
const PRESET_C = ScenarioId.parse(C.scenarioId);
const bundle = specFixtures.bundle;
const variables = bundle.variables;
const nodes = bundle.nodes;
const vars = new Map(variables.map((v) => [v.id, v]));

const LEVER_VAR = 'lev.L10.shelf'; // shown on the Levers screen in this harness
const OUTPUT = 'res.net';
const OUTPUT_CELL = `${OUTPUT}[]`;
const explain = fx.nodeExplain.response;

/** `GET /scenarios/:id/inputs` built from the preset snapshot's input cells. */
function inputsBody() {
  const inputs = Object.entries(C.cells).flatMap(([cell, value]) => {
    const m = /^(.*)\[(.*)\]$/.exec(cell)!;
    const def = vars.get(m[1]!);
    if (!def) return [];
    return [
      {
        var: m[1]!,
        member: m[2]!,
        value,
        from: def.scenarioVaries ? 'scenario' : 'tenant',
        fromScenarioId: def.scenarioVaries ? C.scenarioId : null,
        confidence: null,
        note: null,
      },
    ];
  });
  return { scenarioId: C.scenarioId, version: C.version, inputs, overrides: [] };
}

/**
 * Tier 2's `/search`, doubled over the bundle fixture: an exact id first, then ids and labels
 * containing the query. Inputs and levers jump to Levers when the registry layer says so.
 */
function searchBundle(q: string, limit: number): SearchResult[] {
  const ql = q.toLowerCase();
  const hit = (id: string, label: string) =>
    id.toLowerCase() === ql
      ? 0
      : id.toLowerCase().includes(ql) || label.toLowerCase().includes(ql)
        ? 1
        : 2;
  const all: (SearchResult & { rank: number })[] = [
    ...variables.map((v) => ({
      kind: 'input' as const,
      id: v.id,
      label: v.label,
      unit: v.unit,
      group: v.group,
      module: v.layer === 'levers' ? ('levers' as const) : null,
      hint: null,
      rank: hit(v.id, v.label),
    })),
    ...nodes.map((n) => ({
      kind: 'node' as const,
      id: n.id,
      label: n.label,
      unit: n.unit,
      group: null,
      module: 'cockpit' as const,
      hint: null,
      rank: hit(n.id, n.label),
    })),
  ];
  return all
    .filter((r) => r.rank < 2)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((r): SearchResult => ({
      kind: r.kind,
      id: r.id,
      label: r.label,
      unit: r.unit,
      group: r.group,
      module: r.module,
      hint: r.hint,
    }));
}

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
  viewStore.getState().closeAllPanels();
});
afterAll(() => server.close());

/** Rule warnings the double answers each commit with (tier 2's, verbatim). */
let applyWarnings: unknown[] = [];

function serve() {
  const searches: { q: string; limit: string | null; scenario: string | null }[] = [];
  const explains: { cell: string; scenario: string | null }[] = [];
  const posts: ChangesetRequest[] = [];
  server.use(
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, () =>
      HttpResponse.json({ tenants: [{ ...fx.tenants.response.tenants[0]!, slug: tenant }] }),
    ),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(bundle)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () => HttpResponse.json(specFixtures.scenarios)),
    http.get(`${BASE}${apiRoutes.scenarioInputs.path}`, () => HttpResponse.json(inputsBody())),
    http.get(`${BASE}${apiRoutes.scenarioCalc.path}`, ({ params }) =>
      HttpResponse.json({ ...fx.scenarioCalc.response, scenarioId: String(params['id']) }),
    ),
    http.get(`${BASE}${apiRoutes.changesetHistory.path}`, ({ params }) =>
      HttpResponse.json({ scenarioId: String(params['id']), changesets: [], nextCursor: null }),
    ),
    http.get(`${BASE}${apiRoutes.search.path}`, ({ request }) => {
      const url = new URL(request.url);
      const q = url.searchParams.get('q') ?? '';
      const limit = url.searchParams.get('limit');
      searches.push({ q, limit, scenario: url.searchParams.get('scenario') });
      return HttpResponse.json({ q, results: searchBundle(q, Number(limit ?? MAX_RESULTS)) });
    }),
    http.get(`${BASE}${apiRoutes.nodeExplain.path}`, ({ params, request }) => {
      const cell = decodeURIComponent(String(params['cell']));
      explains.push({ cell, scenario: new URL(request.url).searchParams.get('scenario') });
      return HttpResponse.json(explain);
    }),
    http.post(`${BASE}${apiRoutes.changesetApply.path}`, async ({ request }) => {
      const body = (await request.json()) as ChangesetRequest;
      posts.push(body);
      return HttpResponse.json({
        ...fx.changesetApply.response,
        scenarioId: body.scenarioId,
        version: body.baseVersion + 1,
        warnings: applyWarnings,
        forkedFrom: undefined,
      });
    }),
  );
  return { searches, explains, posts };
}

/** The app's route shape around `GlobalLayout` + `GlobalOverlays`, as MOD-01 wires them. */
async function mount(module: ModuleId, opts: { focusWaitMs?: number } = {}) {
  const served = serve();
  const controller: OverlayController = createOverlayController(viewStore);
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
    const p = moduleRoute.useParams();
    const m = p.module as ModuleId;
    return (
      <GlobalLayout
        tenant={TenantSlug.parse(p.tenant)}
        scenarioId={ScenarioId.parse(p.scenario)}
        module={m}
        session={session}
        onTrace={controller.openTrace}
        glass={{ frameSampling: false }}
      >
        <GlobalOverlays
          tenant={TenantSlug.parse(p.tenant)}
          scenarioId={ScenarioId.parse(p.scenario)}
          controller={controller}
          focusWaitMs={opts.focusWaitMs}
        />
        <main aria-label="Module">
          {m === 'levers' && <BoundEditable variable={LEVER_VAR} />}
          {m === 'cockpit' && <Value node={OUTPUT} className="module-net" />}
        </main>
      </GlobalLayout>
    );
  }
  const rootRoute = createRootRoute({ component: Outlet });
  const moduleRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$tenant/$scenario/$module',
    params: {
      parse: ({ tenant: t, scenario: s, module: md }) => {
        if (!isModuleId(md)) throw new Error('unknown module');
        return { tenant: t, scenario: s, module: md };
      },
      stringify: (p) => p,
    },
    validateSearch: (raw: Record<string, unknown>) => parseViewSearch(raw),
    component: Screen,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([moduleRoute]),
    history: createMemoryHistory({ initialEntries: [`/${tenant}/${PRESET_C}/${module}`] }),
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
  // the screen is up once the bundle and the session's first values arrived
  await until(() => expect(document.querySelector('.gp-app')).not.toBeNull());
  return { ...served, controller, router, settle, until };
}

const openPalette = () => fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
const palette = () => screen.getByRole('dialog', { name: 'Find any number' });
const type = (q: string) =>
  fireEvent.change(within(palette()).getByRole('combobox'), { target: { value: q } });
const option = (id: string) =>
  document.querySelector<HTMLElement>(`.gp-palette [role="option"][data-id="${id}"]`);
const popover = () => document.querySelector<HTMLElement>('.gp-pop');
const drawer = () => document.querySelector<HTMLElement>('.gp-drawer');
const label = (id: string, member: string) => {
  const l = vars.get(id)!.label;
  return member ? `${l} · ${member}` : l;
};
const firstMember = (id: string) =>
  vars.get(id)!.dims.length === 0 ? '' : inputsBody().inputs.find((i) => i.var === id)!.member;

// ---------------------------------------------------------------------------------------------

describe('AC1: ⌘K calls /search; Enter navigates to the module and focuses the control', () => {
  it('cmdk_search_enter_navigates_and_focuses', async () => {
    const t = await mount('cockpit');

    // the shell's button and ⌘K open the same palette; nothing typed lists the screens
    openPalette();
    expect(palette()).toBeTruthy();
    expect(within(palette()).getAllByRole('option').length).toBeGreaterThan(0);
    expect(t.searches).toEqual([]);

    // each typed query goes to tier 2, scoped to the scenario, capped at the palette's 9
    type(LEVER_VAR);
    await t.until(() => expect(option(LEVER_VAR)).not.toBeNull());
    expect(t.searches.at(-1)).toEqual({
      q: LEVER_VAR,
      limit: String(MAX_RESULTS),
      scenario: PRESET_C,
    });
    expect(option(LEVER_VAR)!.textContent).toContain(vars.get(LEVER_VAR)!.label);

    // Enter on the (first, exact) result: module changes, the control has focus
    fireEvent.keyDown(within(palette()).getByRole('combobox'), { key: 'Enter' });
    await t.until(() => expect(t.router.state.location.pathname).toMatch(/\/levers$/));
    expect(screen.queryByRole('dialog', { name: 'Find any number' })).toBeNull();
    // the input's edit popover opens on the focused control (its number field takes focus) ...
    await t.until(() => expect(popover()?.getAttribute('aria-label')).toBe(label(LEVER_VAR, '')));
    expect(popover()!.contains(document.activeElement)).toBe(true);
    // ... and hands focus back to the control it hangs from
    fireEvent.keyDown(document, { key: 'Escape' });
    expect((document.activeElement as HTMLElement | null)?.dataset['id']).toBe(LEVER_VAR);
  });

  it('a node result selects it in the URL (?node=) and opens its trace', async () => {
    const t = await mount('levers');
    openPalette();
    type(OUTPUT);
    await t.until(() => expect(option(OUTPUT)).not.toBeNull());
    fireEvent.click(option(OUTPUT)!);
    await t.until(() => expect(t.router.state.location.pathname).toMatch(/\/cockpit$/));
    expect(t.router.state.location.search).toMatchObject({ node: OUTPUT });
    await t.until(() => expect(drawer()?.dataset['state']).toBe('open'));
    expect(t.explains.at(-1)).toEqual({ cell: OUTPUT_CELL, scenario: PRESET_C });
  });
});

describe('AC2: edit popover via useVariable; output "Pin with reason" posts an override', () => {
  it('popover_input_useVariable_and_output_pin_posts_override', async () => {
    const t = await mount('levers');
    const def = vars.get(LEVER_VAR)!;
    const trigger = document.querySelector<HTMLElement>(`[data-id="${LEVER_VAR}"]`)!;

    // input: definition from tier 2 (label, unit, source, confidence, range)
    act(() => t.controller.openPopover({ kind: 'input', variable: LEVER_VAR, anchor: trigger }));
    await t.until(() => expect(popover()).not.toBeNull());
    const pop = popover()!;
    expect(pop.getAttribute('aria-label')).toBe(def.label);
    expect(pop.textContent).toContain(`Source · ${def.source}`);
    expect(pop.textContent).toContain(`Confidence · ${def.confidence}`);
    const range = within(pop).getByRole('slider') as HTMLInputElement;
    expect(range.min).toBe(String(def.min));
    expect(range.max).toBe(String(def.max));
    expect(Number(range.value)).toBe(C.cells[`${LEVER_VAR}[]`]);

    // an edit is a variable change through the commit queue
    const next = def.max!;
    fireEvent.change(range, { target: { value: String(next) } });
    await waitFor(() => expect(t.posts).toHaveLength(1), { timeout: 3000 });
    expect(t.posts[0]!.changes).toEqual([
      { target: 'variable', key: LEVER_VAR, member: '', value: next },
    ]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(popover()).toBeNull();
    expect(viewStore.getState().openPanels).not.toContain('editPopover');

    // output: "Pin with reason" writes an Override with the typed value and the reason
    act(() => t.controller.openPopover({ kind: 'output', node: OUTPUT }));
    await t.until(() => expect(popover()?.dataset['mode']).toBe('output'));
    const out = popover()!;
    expect(out.getAttribute('aria-label')).toBe(nodes.find((n) => n.id === OUTPUT)!.label);
    const pinned = C.cells[OUTPUT_CELL]! + def.step!; // any other number: the pinned value
    const field = within(out).getByRole('textbox', { name: out.getAttribute('aria-label')! });
    fireEvent.change(field, { target: { value: String(pinned) } });
    fireEvent.keyDown(field, { key: 'Enter' });
    const pinBtn = within(out).getByRole('button', { name: 'Pin with reason' });
    expect((pinBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(out).getByRole('textbox', { name: 'Reason for pinning' }), {
      target: { value: 'Board-approved figure' },
    });
    fireEvent.click(pinBtn);
    await waitFor(() => expect(t.posts).toHaveLength(2), { timeout: 3000 });
    expect(t.posts[1]!.changes).toEqual([
      { target: 'override', key: OUTPUT, member: '', value: pinned, note: 'Board-approved figure' },
    ]);
    expect(popover()).toBeNull();
  });
});

describe('Edit popover: commit warnings', () => {
  it("shows tier 2's rule warnings of the commit verbatim", async () => {
    const cell = `${LEVER_VAR}[]`;
    const message = 'Shelfware cut is above the reference range; tier 2 kept it.';
    applyWarnings = [{ rule: 'VR03', cells: [cell], severity: 'warning', message }];
    try {
      const t = await mount('levers');
      act(() => t.controller.openPopover({ kind: 'input', variable: LEVER_VAR }));
      await t.until(() => expect(popover()).not.toBeNull());
      expect(popover()!.querySelector('.gp-pop-warn')).toBeNull();
      const range = within(popover()!).getByRole('slider');
      fireEvent.change(range, { target: { value: String(vars.get(LEVER_VAR)!.max) } });
      await waitFor(() => expect(t.posts).toHaveLength(1), { timeout: 3000 });
      await t.until(() =>
        expect(popover()!.querySelector('.gp-pop-warn')?.textContent).toBe(message),
      );
      expect(within(popover()!).getByRole('status').textContent).toBe(message);
    } finally {
      applyWarnings = [];
    }
  });
});

describe('AC3: trace drawer from /nodes/:cell/explain', () => {
  it('trace_drawer_value_id_words_upstream_drivers', async () => {
    const t = await mount('cockpit');
    await t.until(() => expect(document.querySelector('.module-net')).not.toBeNull());
    const net = document.querySelector<HTMLElement>(`[data-mode="output"][data-id="${OUTPUT}"]`)!;
    fireEvent.pointerDown(net);
    fireEvent.click(net);
    await t.until(() => expect(drawer()?.textContent).toContain(explain.words));
    expect(t.explains).toContainEqual({ cell: OUTPUT_CELL, scenario: PRESET_C });

    const d = drawer()!;
    const show = (v: number | null, unit: string) =>
      v === null ? '' : formatFor(undefined, unit)(v);
    expect(d.querySelector('[data-slot="value"]')!.textContent).toBe(
      show(explain.value, explain.unit),
    );
    expect(d.querySelector('[data-slot="node-id"]')!.textContent).toBe(explain.node);
    expect(d.querySelector('[data-slot="formula"]')!.textContent).toBe(explain.words);
    expect(within(d).getByRole('heading', { level: 2 }).textContent).toContain(explain.label);
    const up = [...d.querySelectorAll('[data-slot="upstream"] li')].map((li) => li.textContent);
    expect(up).toEqual([
      ...explain.upstream.map((u) => `${u.label}${show(u.value, u.unit)}`),
      `${explain.label}${show(explain.value, explain.unit)}`,
    ]);
    expect(d.querySelector('[data-slot="upstream"] [aria-current="step"]')!.textContent).toContain(
      explain.label,
    );
    const dr = [...d.querySelectorAll('[data-slot="drivers"] li')].map((li) => li.textContent);
    expect(dr).toEqual(explain.drivers.map((x) => `${x.label}${show(x.value, x.unit)}`));

    // the same content as the pure mapping; Escape closes it
    expect(traceContent(explain as never).nodeId).toBe(explain.node);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(viewStore.getState().openPanels).not.toContain('traceDrawer');
  });

  it('has no accessibility violations with the palette, the popover and the drawer open (G12)', async () => {
    const t = await mount('cockpit');
    openPalette();
    type('cola');
    await t.until(() =>
      expect(within(palette()).queryAllByRole('option').length).toBeGreaterThan(0),
    );
    let r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
    fireEvent.keyDown(document, { key: 'Escape' });

    act(() => t.controller.openPopover({ kind: 'input', variable: LEVER_VAR }));
    act(() => t.controller.openTrace(OUTPUT_CELL));
    await t.until(() => expect(drawer()?.textContent).toContain(explain.words));
    await t.until(() => expect(popover()).not.toBeNull());
    r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('AC4: all 194 inputs editable', () => {
  it('every_bundle_variable_found_by_cmdk_and_popover_opens_with_definition', async () => {
    const t = await mount('cockpit', { focusWaitMs: 0 });
    expect(variables).toHaveLength(194);
    for (const v of variables) {
      openPalette();
      type(v.id);
      await t.until(() => expect(option(v.id)).not.toBeNull());
      fireEvent.click(option(v.id)!);
      const member = firstMember(v.id);
      await t.until(() => expect(popover()?.getAttribute('aria-label')).toBe(label(v.id, member)));
      const pop = popover()!;
      expect(pop.dataset['mode'], v.id).toBe('input');
      expect(pop.textContent, v.id).toContain(`Source · ${v.source}`);
      expect(pop.querySelector('.gp-pop-h .gp-chip')!.textContent, v.id).toBe(v.unit);
      const range = within(pop).getByRole('slider') as HTMLInputElement;
      if (v.min !== null) expect(range.getAttribute('min'), v.id).toBe(String(v.min));
      if (v.max !== null) expect(range.getAttribute('max'), v.id).toBe(String(v.max));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(popover(), v.id).toBeNull();
    }
    expect(new Set(t.searches.map((s) => s.q))).toEqual(new Set(variables.map((v) => v.id)));
  }, 120_000);
});

describe('WEB-10: the edit popover shows and parses both percent scales', () => {
  const POINTS_VAR = 'corp.gdp';
  const FRACTION_VAR = 'g.target_pct';

  it('popover_percent_scale_display_and_parse', async () => {
    const t = await mount('market');
    const points = vars.get(POINTS_VAR)!;
    const fraction = vars.get(FRACTION_VAR)!;
    expect([points.percentScale, fraction.percentScale]).toEqual(['points', 'fraction']);
    const member = firstMember(POINTS_VAR);

    // points: corp.gdp 2 reads 2.0% in the field and the Default chip; typing 2.5 commits 2.5
    act(() => t.controller.openPopover({ kind: 'input', variable: POINTS_VAR, member }));
    await t.until(() => expect(popover()).not.toBeNull());
    let pop = popover()!;
    expect(C.cells[`${POINTS_VAR}[${member}]`]).toBe(2);
    let field = within(pop).getByRole('textbox') as HTMLInputElement;
    expect(field.value).toBe('2.0%');
    fireEvent.change(field, { target: { value: '2.5' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(t.posts).toHaveLength(1), { timeout: 3000 });
    expect(t.posts[0]!.changes).toEqual([
      { target: 'variable', key: POINTS_VAR, member, value: 2.5 },
    ]);
    fireEvent.keyDown(document, { key: 'Escape' });

    // fraction: g.target_pct 0.1 reads 10.0%; typing 12 commits 0.12
    act(() => t.controller.openPopover({ kind: 'input', variable: FRACTION_VAR }));
    await t.until(() => expect(popover()).not.toBeNull());
    pop = popover()!;
    expect(C.cells[`${FRACTION_VAR}[]`]).toBe(0.1);
    field = within(pop).getByRole('textbox') as HTMLInputElement;
    expect(field.value).toBe('10.0%');
    fireEvent.change(field, { target: { value: '12' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(t.posts).toHaveLength(2), { timeout: 3000 });
    expect(t.posts[1]!.changes).toEqual([
      { target: 'variable', key: FRACTION_VAR, member: '', value: 0.12 },
    ]);
  });

  it('the trace drawer renders a percent cell by the bundle scale', () => {
    const scaleOf = (cell: string) =>
      vars.get(cell.slice(0, cell.indexOf('[')))?.percentScale ??
      nodes.find((n) => n.id === cell.slice(0, cell.indexOf('[')))?.percentScale ??
      null;
    const content = traceContent(
      {
        ...explain,
        node: 'pl.op_margin',
        unit: '%',
        value: 2.976,
        upstream: [
          {
            cell: 'g.target_pct[]',
            kind: 'input',
            label: 'Target %',
            unit: '%',
            value: 0.1,
            depth: 1,
          },
        ],
        drivers: [],
      } as never,
      (cell) => (cell === 'pl.op_margin' ? 'points' : scaleOf(cell)),
    );
    expect(content.value).toBe('3.0%');
    expect(content.upstream?.[0]?.value).toBe('10.0%');
  });
});
