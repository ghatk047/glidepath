// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import axe from 'axe-core';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  apiRoutes,
  toCellKey,
  type BridgeView,
  type ChangesetRequest,
} from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  presetSnapshot,
  specFixtures,
  type MockSession,
} from '@glidepath/api-contract/testing';
import { fmt } from '@glidepath/ui/format';
import { formatByUnit } from '@glidepath/ui/inputs/slider';
import { createAppRouter } from '../../app/router';
import { loadModule } from '../../app/modules';
import { COMMIT_DEBOUNCE_MS } from '../../commit';
import { viewStore } from '../../app/view-store';
import { createDataClient, createServerState } from '../../data';
import { createSessionClient } from '../../session';
import { BRIDGE_CELLS, HERO_LABELS, NET_NODES, TARGET_VARIABLE } from './copy';
import { gaugeMax } from './scale';

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
});
afterAll(() => server.close());

function serve() {
  const posts: ChangesetRequest[] = [];
  server.use(
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
  return { posts };
}

async function mount() {
  const served = serve();
  const mock: MockSession = createMockSession({
    snapshots: presets.map((p) => presetSnapshot(p.key)),
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
