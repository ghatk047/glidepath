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
  TenantSlug,
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
import { parseViewSearch } from '../../app/search';
import { DataProvider, createDataClient, createServerState } from '../../data';
import { GlobalLayout } from '../../global/shell';
import { createSessionClient } from '../../session';
import Baseline from './index';
import { TOP_LINES } from './GroupDetail';
import { showAmount } from './LineAmount';

// ---------------------------------------------------------------------------------------------
// Fixtures: spec ids verbatim; values come from the generated spec fixtures (never typed in here).
// The tier 2 double below only repackages them into the views and cells tier 2 would push.
// ---------------------------------------------------------------------------------------------

const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const tenant = TenantSlug.parse(specFixtures.tenant);
const C = presetSnapshot('C');
const PRESET_C = ScenarioId.parse(C.scenarioId);
const cell = (id: string, member = '') => C.cells[`${id}[${member}]`] as number;

const dims = specFixtures.members.dimensions;
const lineMembers = dims['line']!;
const attr = (l: (typeof lineMembers)[number], k: string) => String(l.attrs[k]);
const lineOf = (key: string) => lineMembers.find((l) => l.key === key)!;

/** `baseline.groups` as tier 2 would send it, grouped by a line attribute (fixture builder). */
const groupsBy = (by: 'pool' | 'domain') => {
  const groups = dims[by]!
    .map((g) => {
      const lines = lineMembers
        .filter((l) => attr(l, by) === g.key)
        .map((l) => ({ key: l.key, value: cell('line.amount', l.key) }));
      return { key: g.key, label: g.label, value: lines.reduce((s, l) => s + l.value, 0), lines };
    })
    .filter((g) => g.lines.length > 0);
  return { total: cell('base.total'), groups };
};
const poolView = groupsBy('pool');
const domainView = groupsBy('domain');
const vpView = {
  total: cell('base.total'),
  groups: dims['vp']!.slice(0, 2).map((g, i) => ({
    key: g.key,
    label: g.label,
    value: 10 + i,
    lines: [{ key: lineMembers[i]!.key, value: 10 + i }],
  })),
};
const SUMMARY = { lines: lineMembers.length, linesInScope: lineMembers.length - 21 };

const viewMsg = (view: string, params: Record<string, unknown>, payload: unknown) =>
  ({ v: 1, type: 'view', view, params, seq: null, payload }) as never;
const views = [
  viewMsg('baseline.summary', {}, SUMMARY),
  viewMsg('baseline.groups', { by: 'pool' }, poolView),
  viewMsg('baseline.groups', { by: 'domain' }, domainView),
  viewMsg('baseline.groups', { by: 'vp' }, vpView),
];

/** Pool-level cells the preset snapshot does not carry (tier 2 pushes them on subscribe). */
const POOL_OUTLAY: Record<string, number> = Object.fromEntries(
  poolView.groups.map((g) => [g.key, g.value]),
);
const POOL_ADDRESSABLE: Record<string, number> = Object.fromEntries(
  poolView.groups.map((g, i) => [g.key, g.value / (i + 2)]),
);
const snapshot = {
  ...C,
  cells: {
    ...C.cells,
    ...Object.fromEntries(
      poolView.groups.flatMap((g) => [
        [`base.pool_outlay[${g.key}]`, POOL_OUTLAY[g.key]!],
        [`base.pool_addressable[${g.key}]`, POOL_ADDRESSABLE[g.key]!],
      ]),
    ),
  },
};

const first = poolView.groups[0]!;
const second = poolView.groups[1]!;

// ---------------------------------------------------------------------------------------------
// tier 2 double (msw) and the WS session (the contract's mock session)
// ---------------------------------------------------------------------------------------------

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  viewStore.getState().clearSelection();
});
afterAll(() => server.close());

async function mount(search = '') {
  const posts: ChangesetRequest[] = [];
  server.use(
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, () =>
      HttpResponse.json({ tenants: [{ ...fx.tenants.response.tenants[0]!, slug: tenant }] }),
    ),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(specFixtures.bundle)),
    http.get(`${BASE}${apiRoutes.members.path}`, () => HttpResponse.json(specFixtures.members)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () =>
      HttpResponse.json(specFixtures.scenarios),
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
  const mock = createMockSession({ snapshots: [snapshot], views });
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
    const s = moduleRoute.useSearch();
    useEffect(() => {
      viewStore.getState().syncSelection(s);
    }, [s]);
    return (
      <GlobalLayout
        tenant={tenant}
        scenarioId={PRESET_C}
        module="baseline"
        session={session}
        glass={{ frameSampling: false }}
      >
        <Baseline />
      </GlobalLayout>
    );
  }
  const rootRoute = createRootRoute({ component: Outlet, validateSearch: parseViewSearch });
  const moduleRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$tenant/$scenario/$module',
    component: Screen,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([moduleRoute]),
    history: createMemoryHistory({ initialEntries: [`/${tenant}/${PRESET_C}/baseline${search}`] }),
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
  return { mock, router, posts, settle, until, view };
}

const kpi = (id: string) => document.querySelector<HTMLElement>(`[data-kpi="${id}"]`)!;
const search = (t: Awaited<ReturnType<typeof mount>>) => t.router.state.location.search as object;

// ---------------------------------------------------------------------------------------------

describe('AC1: header strip and group-by', () => {
  it('shows base.total, opex, capex, locked share and line counts as tier 2 sent them', async () => {
    const t = await mount();
    await t.until(() => {
      expect(kpi('base.total').textContent).toBe(fmt.money(cell('base.total'), { digits: 0 }));
      expect(kpi('base.opex_total').textContent).toBe(fmt.money(cell('base.opex_total')));
      expect(kpi('base.capex_total').textContent).toBe(fmt.money(cell('base.capex_total')));
      expect(kpi('base.locked_share').textContent).toBe(fmt.pct(cell('base.locked_share')));
      expect(kpi('lines').textContent).toBe(
        `${SUMMARY.lines} · ${SUMMARY.linesInScope} in scope`,
      );
    });
    expect(t.mock.views.map((v) => v.view)).toContain('baseline.summary');
  });

  it('group-by segmented Cost pool / Domain / VP subscribes the matching view and sets ?group', async () => {
    const t = await mount();
    await t.until(() => expect(screen.getByRole('group', { name: 'Group by' })).toBeTruthy());
    const seg = screen.getByRole('group', { name: 'Group by' });
    expect(within(seg).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Cost pool',
      'Domain',
      'VP',
    ]);
    expect(within(seg).getByRole('button', { name: 'Cost pool' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(within(seg).getByRole('button', { name: 'Domain' }));
    await t.until(() => expect(search(t)).toEqual({ group: 'domain' }));
    await t.until(() =>
      expect(t.mock.views).toContainEqual({ view: 'baseline.groups', params: { by: 'domain' } }),
    );
    await t.until(() =>
      expect(
        screen.getByRole('button', { name: new RegExp(`^${domainView.groups[0]!.label}`) }),
      ).toBeTruthy(),
    );
  });
});

describe('AC2: treemap from baseline.groups', () => {
  it('draws a group per view group and clicking one sets ?group and ?key', async () => {
    const t = await mount();
    await t.until(() =>
      expect(screen.getByRole('group', { name: /Treemap of CY26 IT outlay/ })).toBeTruthy(),
    );
    const tm = screen.getByRole('group', { name: /Treemap of CY26 IT outlay/ });
    expect(within(tm).getAllByRole('button')).toHaveLength(poolView.groups.length);
    const btn = within(tm).getByRole('button', { name: new RegExp(`^${second.label} `) });
    fireEvent.click(btn);
    await t.until(() => expect(search(t)).toEqual({ group: 'pool', key: second.key }));
    await t.until(() =>
      expect(btn.getAttribute('aria-pressed')).toBe('true'),
    );
  });

  it('colours cells by the addr attribute of each line from members', async () => {
    const t = await mount();
    await t.until(() => {
      const cells = document.querySelectorAll('.gp-treemap-cell');
      expect(cells.length).toBeGreaterThan(0);
      expect(document.querySelectorAll('.gp-treemap-cell[data-slot="none"]').length).toBe(0);
    });
  });
});

describe('AC3: group detail', () => {
  it('shows name, total, editable pool.growth, addressable split and the top 7 lines', async () => {
    const t = await mount(`?group=pool&key=${first.key}`);
    await t.until(() => expect(document.querySelector('.gp-bl-detail')).not.toBeNull());
    const panel = document.querySelector<HTMLElement>('.gp-bl-detail')!;
    await t.until(() => {
      expect(within(panel).getByRole('heading', { name: first.label })).toBeTruthy();
      expect(within(panel).getByTestId('group-total').textContent).toBe(fmt.money(first.value));
      // pool.growth: an Editable number showing tier 2's value, opening the Edit popover
      const growth = panel.querySelector<HTMLElement>('[data-id="pool.growth"]')!;
      expect(growth.textContent).toBe(fmt.pct(cell('pool.growth', first.key)));
      // addressable split: base.pool_addressable of base.pool_outlay
      const meter = panel.querySelector<HTMLMeterElement>('meter')!;
      expect(meter.value).toBe(POOL_ADDRESSABLE[first.key]);
      expect(meter.max).toBe(POOL_OUTLAY[first.key]);
      expect(panel.textContent).toContain(fmt.money(POOL_ADDRESSABLE[first.key]!));
      expect(panel.textContent).toContain(fmt.money(POOL_OUTLAY[first.key]!));
    });
    const rows = within(panel).getAllByRole('listitem');
    expect(rows).toHaveLength(Math.min(TOP_LINES, first.lines.length));
    const expected = [...first.lines].sort((a, b) => b.value - a.value).slice(0, TOP_LINES);
    expect(rows.map((r) => r.dataset['line'])).toEqual(expected.map((l) => l.key));
    await t.until(() => {
      for (const [i, l] of expected.entries()) {
        expect(rows[i]!.textContent).toContain(fmt.money(cell('line.amount', l.key)));
        expect(rows[i]!.textContent).toContain(String(attr(lineOf(l.key), 'vendor')));
      }
    });
  });

  it('editing a top-line amount commits line.amount for that line', async () => {
    const t = await mount(`?group=pool&key=${first.key}`);
    await t.until(() => expect(document.querySelector('.gp-bl-detail')).not.toBeNull());
    const panel = document.querySelector<HTMLElement>('.gp-bl-detail')!;
    const top = [...first.lines].sort((a, b) => b.value - a.value)[0]!;
    const li = panel.querySelector<HTMLElement>(`li[data-line="${top.key}"]`)!;
    await t.until(() =>
      expect(li.querySelector('[data-id="line.amount"]')?.textContent).toBe(
        fmt.money(cell('line.amount', top.key)),
      ),
    );
    fireEvent.click(li.querySelector('[data-id="line.amount"]')!);
    const field = await screen.findByRole('textbox', { name: /CY26 \$M$/ });
    fireEvent.change(field, { target: { value: '12.5' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(t.posts).toHaveLength(1), { timeout: 3000 });
    expect(t.posts[0]!.changes).toEqual([
      expect.objectContaining({
        target: 'variable',
        key: 'line.amount',
        member: top.key,
        value: 12.5,
      }),
    ]);
  });
});

describe('AC4: line table', () => {
  it('lists the group lines with vendor, domain, addressability, confidence, capex and amount', async () => {
    const t = await mount(`?group=pool&key=${first.key}`);
    await t.until(() => expect(screen.getByRole('table')).toBeTruthy());
    const table = screen.getByRole('table');
    const heads = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads).toEqual([
      'Line',
      'Vendor',
      'Domain',
      'Addressability',
      'Conf.',
      'Capex',
      'CY26 $M',
    ]);
    const sorted = [...first.lines].sort((a, b) => b.value - a.value);
    const rows = within(table.querySelector('tbody')!).getAllByRole('row');
    expect(rows).toHaveLength(first.lines.length);
    const l0 = lineOf(sorted[0]!.key);
    const domainLabel = dims['domain']!.find((d) => d.key === attr(l0, 'domain'))!.label;
    const addrLabel = dims['addr_tag']!.find((d) => d.key === attr(l0, 'addr'))!.label;
    await t.until(() => {
      const r = rows[0]!;
      const tds = within(r).getAllByRole('cell').map((c) => c.textContent);
      expect(within(r).getByRole('rowheader').textContent).toBe(l0.label);
      expect(tds).toEqual([
        attr(l0, 'vendor'),
        domainLabel,
        addrLabel,
        attr(l0, 'confidence'),
        fmt.pct(cell('line.capex_share', l0.key), { digits: 0 }),
        showAmount(cell('line.amount', l0.key)),
      ]);
    });
  });

  it('"Edit in Excel" goes to the Excel module', async () => {
    const t = await mount(`?group=pool&key=${first.key}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit in Excel' }));
    await t.until(() =>
      expect(t.router.state.location.pathname).toBe(`/${tenant}/${PRESET_C}/excel`),
    );
  });
});

describe('AC5: values come from the session, never computed in tier 1', () => {
  it('a pushed change shows in the strip and detail without any local arithmetic', async () => {
    const t = await mount(`?group=pool&key=${first.key}`);
    await t.until(() =>
      expect(kpi('base.total').textContent).toBe(fmt.money(cell('base.total'), { digits: 0 })),
    );
    const pushed = cell('base.total') + 100;
    act(() => {
      t.mock.emit({
        v: 1,
        type: 'delta',
        seq: null,
        version: 99,
        cells: { 'base.total[]': pushed },
      } as never);
    });
    await t.until(() =>
      expect(kpi('base.total').querySelector('[data-value]')?.getAttribute('data-value')).toBe(
        String(pushed),
      ),
    );
  });
});

describe('G12: accessibility', () => {
  it('has no serious or critical axe violations', async () => {
    const t = await mount(`?group=pool&key=${first.key}`);
    await t.until(() => expect(screen.getByRole('table')).toBeTruthy());
    const result = await axe.run(t.view.container, {
      rules: { 'color-contrast': { enabled: false } }, // jsdom has no layout or computed colours
    });
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
