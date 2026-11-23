// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import { ScenarioId, TenantSlug, apiRoutes, type ChangesetRequest } from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  presetSnapshot,
  specFixtures,
} from '@glidepath/api-contract/testing';
import { fmt } from '@glidepath/ui/format';
import { GlassProvider } from '@glidepath/ui/glass';
import { formatByUnit } from '@glidepath/ui/inputs/slider';
import { viewStore } from '../../app/view-store';
import { parseViewSearch } from '../../app/search';
import { BindProvider } from '../../bind';
import { DataProvider, createDataClient, createServerState } from '../../data';
import { createSessionClient } from '../../session';
import Levers from './index';

// ---------------------------------------------------------------------------------------------
// Fixtures: spec ids verbatim; every expected number is read from the generated fixtures.
// ---------------------------------------------------------------------------------------------

const BASE = 'http://tier2.test';
const tenant = TenantSlug.parse(specFixtures.tenant);
const C = presetSnapshot('C');
const D = presetSnapshot('D');
const scenarioId = ScenarioId.parse(C.scenarioId);
const cell = (id: string, member = '') => C.cells[`${id}[${member}]`] as number;
const bundleVar = (id: string) => specFixtures.bundle.variables.find((v) => v.id === id)!;

const members = specFixtures.members.dimensions['lever']!;
const memberLabel = (key: string) => members.find((m) => m.key === key)!.label;

// Hypothesis text of the seed (docs/spec/seed/aa/lever_library.json); tier 2 sends it as the
// lever member's `hypothesis` attribute.
const library = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../docs/spec/seed/aa/lever_library.json'), 'utf8'),
) as { levers: { id: string; hypothesis: string }[] };
const hypothesisOf = (id: string) => library.levers.find((l) => l.id === id)!.hypothesis;
const membersBody = {
  ...specFixtures.members,
  dimensions: {
    ...specFixtures.members.dimensions,
    lever: members.map((m) => ({ ...m, attrs: { ...m.attrs, hypothesis: hypothesisOf(m.key) } })),
  },
};

// Families as tier 2 would push them: lever order of the library, three families.
const FAMILY_OF: Record<string, { key: string; label: string }> = {
  L01: { key: 'labour', label: 'Labour' },
  L02: { key: 'labour', label: 'Labour' },
  L03: { key: 'labour', label: 'Labour' },
  L04: { key: 'labour', label: 'Labour' },
  L05: { key: 'labour', label: 'Labour' },
  L06: { key: 'labour', label: 'Labour' },
  L07: { key: 'labour', label: 'Labour' },
  L08: { key: 'labour', label: 'Labour' },
  L09: { key: 'technology', label: 'Technology' },
  L10: { key: 'technology', label: 'Technology' },
  L11: { key: 'technology', label: 'Technology' },
  L12: { key: 'technology', label: 'Technology' },
  L13: { key: 'technology', label: 'Technology' },
  L14: { key: 'technology', label: 'Technology' },
  L15: { key: 'platforms', label: 'Platforms & avoidance' },
  L16: { key: 'platforms', label: 'Platforms & avoidance' },
  L17: { key: 'platforms', label: 'Platforms & avoidance' },
};
const leverKeys = members.map((m) => m.key as string);
const familyKeys = [...new Set(leverKeys.map((k) => FAMILY_OF[k]!.key))];
const iy = (k: string) => cell('lev.iy', k);
const familyValue = (fk: string) =>
  leverKeys.filter((k) => FAMILY_OF[k]!.key === fk).reduce((a, k) => a + iy(k), 0);
const familiesPayload = {
  total: cell('res.tot_iy'),
  families: familyKeys.map((fk) => ({
    key: fk,
    label: FAMILY_OF[leverKeys.find((k) => FAMILY_OF[k]!.key === fk)!]!.label,
    value: familyValue(fk),
    levers: leverKeys.filter((k) => FAMILY_OF[k]!.key === fk),
  })),
};
const SCALE = Math.max(...leverKeys.map(iy));
const monthlyOf = (k: string) => Array.from({ length: 12 }, (_, i) => (iy(k) * (i + 1)) / 78);
const monthlyPayload = {
  families: familyKeys.map((fk) => ({
    key: fk,
    values: Array.from({ length: 12 }, (_, i) =>
      leverKeys.filter((k) => FAMILY_OF[k]!.key === fk).reduce((a, k) => a + monthlyOf(k)[i]!, 0),
    ),
  })),
  levers: leverKeys.map((k) => ({ key: k, family: FAMILY_OF[k]!.key, values: monthlyOf(k) })),
};
const view = (name: string, payload: unknown) => ({
  v: 1 as const,
  type: 'view' as const,
  view: name,
  params: {},
  seq: null,
  payload,
});

/** `GET /scenarios/:id/inputs` for a preset: the lever parameter cells of its snapshot. */
function inputsBody(snapshot: typeof C) {
  const inputs = Object.entries(snapshot.cells).flatMap(([c, value]) => {
    const m = /^(lev\.L\d+\.[a-z_0-9]+)\[(.*)\]$/.exec(c);
    if (!m) return [];
    return [
      {
        var: m[1]!,
        member: m[2]!,
        value,
        from: 'scenario',
        fromScenarioId: snapshot.scenarioId,
        confidence: null,
        note: null,
      },
    ];
  });
  return { scenarioId: snapshot.scenarioId, version: snapshot.version, inputs, overrides: [] };
}

// ---------------------------------------------------------------------------------------------
// tier 2 double (msw) + the contract's mock session
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

const fx = coreRouteFixtures;

async function mount(search = '') {
  const posts: ChangesetRequest[] = [];
  server.use(
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(specFixtures.bundle)),
    http.get(`${BASE}${apiRoutes.members.path}`, () => HttpResponse.json(membersBody)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () => HttpResponse.json(specFixtures.scenarios)),
    http.get(`${BASE}${apiRoutes.scenarioInputs.path}`, ({ params }) => {
      const id = String(params['id']);
      return HttpResponse.json(
        inputsBody(id === D.scenarioId ? D : id === C.scenarioId ? C : { ...C, cells: {} }),
      );
    }),
    http.post(`${BASE}${apiRoutes.changesetApply.path}`, async ({ request }) => {
      posts.push((await request.json()) as ChangesetRequest);
      return HttpResponse.json(fx.changesetApply.response);
    }),
  );
  const mock = createMockSession({
    views: [
      view('levers.families', familiesPayload),
      view('levers.scale', { max: SCALE }),
      view('levers.monthly', monthlyPayload),
    ] as never,
  });
  const frames: (() => void)[] = [];
  const session = createSessionClient({
    tenant,
    scenario: scenarioId,
    origin: 'ws://localhost:8080',
    connect: mock.connect,
    requestFrame: (cb) => void frames.push(cb),
    random: () => 0,
  });

  function Screen() {
    const s = moduleRoute.useSearch();
    // As the app's module route does: the URL's selection goes to the view store.
    useEffect(() => viewStore.getState().syncSelection(s), [s]);
    return (
      <GlassProvider frameSampling={false}>
        <BindProvider tenant={tenant} scenarioId={scenarioId} session={session}>
          <Levers />
        </BindProvider>
      </GlassProvider>
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
    history: createMemoryHistory({ initialEntries: [`/${tenant}/${scenarioId}/levers${search}`] }),
  });
  const rendered = render(
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
        if (i > 40) throw e;
      }
    }
  };
  await screen.findByRole('heading', { name: 'Levers' });
  return { posts, mock, router, settle, until, rendered };
}

const row = (lever: string) =>
  document.querySelector<HTMLElement>(`[data-lever="${lever}"]`)!.closest('li')!;
const detail = () => document.querySelector<HTMLElement>('[data-lever-detail]')!;
const shown = (el: Element) => el.querySelector<HTMLElement>('[data-value]')?.dataset['value'];

// ---------------------------------------------------------------------------------------------

describe('AC1: lever list', () => {
  it('shows three families with totals from levers.families, rows with toggle, name, bar and lev.iy', async () => {
    const t = await mount();
    await t.until(() => expect(row('L10').querySelector('[data-value]')).toBeTruthy());

    const groups = screen.getAllByRole('group').filter((g) => g.classList.contains('gp-lv-group'));
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(
      familiesPayload.families.map((f) => f.label),
    );
    expect(groups).toHaveLength(3);
    for (const f of familiesPayload.families) {
      const total = document.querySelector<HTMLElement>(`[data-family-total="${f.key}"]`)!;
      expect(total.dataset['value']).toBe(String(f.value));
      expect(total.textContent).toBe(fmt.money(f.value));
      for (const k of f.levers) {
        const li = row(k);
        expect(within(li).getByRole('button', { name: memberLabel(k) })).toBeTruthy();
        expect(within(li).getByRole('switch', { name: `${memberLabel(k)} on` })).toHaveProperty(
          'checked',
          cell('lev.on', k) === 1,
        );
        expect(shown(li)).toBe(String(iy(k)));
        expect(li.textContent).toContain(fmt.money(iy(k)));
        // Bar: scaled by the levers.scale view (CSS draws value / max).
        const bar = li.querySelector<HTMLElement>('.gp-lv-bar > i')!;
        expect(bar.style.getPropertyValue('--max')).toBe(String(SCALE));
        expect(bar.style.getPropertyValue('--value')).toBe(String(iy(k)));
      }
    }
  });

  it('the lev.on toggle commits the opposite value for that lever', async () => {
    const t = await mount();
    await t.until(() => expect(row('L03')).toBeTruthy());
    const sw = within(row('L03')).getByRole('switch', { name: `${memberLabel('L03')} on` });
    await t.until(() => expect((sw as HTMLInputElement).checked).toBe(true));
    fireEvent.click(sw);
    await waitFor(() => expect(t.posts).toHaveLength(1));
    expect(t.posts[0]!.changes).toEqual([
      { target: 'variable', key: 'lev.on', member: 'L03', value: 0 },
    ]);
  });
});

describe('AC2: lever detail (L10)', () => {
  it('shows chips, in-year / run-rate / one-time, sliders with ghosts, timing, dial and the hypothesis', async () => {
    const t = await mount('?lever=L10');
    await t.until(() => expect(shown(detail().querySelector('.gp-lv-kpi')!)).toBeDefined());
    const d = detail();

    expect(within(d).getByRole('heading', { name: memberLabel('L10') })).toBeTruthy();
    expect(d.querySelector('[data-chip="id"]')!.textContent).toBe('L10');
    expect(d.querySelector('[data-chip="category"]')!.textContent).toBe('Technology');
    expect(d.querySelector('[data-chip="confidence"]')!.textContent).toBe(
      `Confidence ${fmt.pct(cell('lev.conf', 'L10'))}`,
    );

    const [kIy, kRr, kOt] = Array.from(d.querySelectorAll<HTMLElement>('.gp-lv-kpi'));
    expect(shown(kIy!)).toBe(String(cell('lev.iy', 'L10')));
    expect(shown(kRr!)).toBe(String(cell('lev.rr', 'L10')));
    expect(shown(kOt!)).toBe(String(cell('lev.ot', 'L10')));
    expect(kIy!.textContent).toContain(fmt.money(cell('lev.iy', 'L10')));

    // One slider per lev.L10.* parameter of the registry; estimates are locked.
    const params = specFixtures.bundle.variables.filter(
      (v) => v.id.startsWith('lev.L10.') && v.ui.control === 'slider',
    );
    expect(params.length).toBeGreaterThan(0);
    for (const p of params) {
      const slider = await within(d).findByRole('slider', { name: p.label });
      expect(slider).toHaveProperty('value', String(cell(p.id)));
      expect(slider.closest('[data-variant]')!.getAttribute('data-variant')).toBe(
        p.kind === 'decision' ? 'decision' : 'estimate',
      );
    }
    // C and D ghosts for a decision slider, read from the scenarios' inputs.
    const shelf = bundleVar('lev.L10.shelf');
    const text = (v: number) => formatByUnit(v, shelf.unit, shelf.step!);
    await waitFor(() =>
      expect(
        within(d).getByText(
          `Reference marks: C ${text(cell('lev.L10.shelf'))}, D ${text(D.cells['lev.L10.shelf[]'] as number)}`,
        ),
      ).toBeTruthy(),
    );

    // Timing strip: start select, ramp, 12 monthly cells from levers.monthly.
    const start = within(d).getByRole('combobox', { name: 'Start' });
    await t.until(() =>
      expect((start as HTMLSelectElement).value).toBe(String(cell('lev.start', 'L10'))),
    );
    expect(within(start).getAllByRole('option')).toHaveLength(12);
    expect(d.textContent).toContain(
      formatByUnit(
        cell('lev.ramp', 'L10'),
        bundleVar('lev.ramp').unit,
        bundleVar('lev.ramp').step!,
      ),
    );
    const cells = d.querySelectorAll<HTMLElement>('.gp-lv-cells li');
    expect(cells).toHaveLength(12);
    cells.forEach((li, i) => expect(li.dataset['monthValue']).toBe(String(monthlyOf('L10')[i])));

    // Confidence is a dial; the hypothesis line is the library text.
    const dial = within(d).getByRole('slider', { name: 'Confidence' });
    expect(dial.getAttribute('aria-valuenow')).toBe(String(cell('lev.conf', 'L10')));
    expect(d.querySelector('.gp-lv-hyp')!.textContent).toBe(hypothesisOf('L10'));
  });

  it('the start select commits lev.start for the lever through tier 2', async () => {
    const t = await mount('?lever=L10');
    await t.until(() => expect(detail()).toBeTruthy());
    const start = within(detail()).getByRole('combobox', { name: 'Start' });
    await t.until(() => expect((start as HTMLSelectElement).value).toBe('2'));
    fireEvent.change(start, { target: { value: '4' } });
    await waitFor(() => expect(t.posts).toHaveLength(1));
    expect(t.posts[0]!.changes).toEqual([
      { target: 'variable', key: 'lev.start', member: 'L10', value: 4 },
    ]);
  });
});

describe('AC3: All levers and 2027 by month', () => {
  it('shows res.tot_iy, res.tot_ot_it, res.net, res.bar and the monthly chart with the selected line', async () => {
    const t = await mount('?lever=L10');
    await t.until(() => expect(document.querySelector('[data-cell="res.net[]"]')).toBeDefined());
    const all = screen.getByRole('heading', { name: 'All levers · in-year' }).closest('section')!;
    await t.until(() => expect(all.querySelectorAll('[data-value]')).toHaveLength(4));
    const vals = Array.from(all.querySelectorAll<HTMLElement>('[data-value]')).map(
      (e) => e.dataset['value'],
    );
    expect(vals).toEqual(
      ['res.tot_iy', 'res.tot_ot_it', 'res.net', 'res.bar'].map((id) => String(cell(id))),
    );
    expect(all.textContent).toContain(fmt.money(cell('res.tot_iy')));

    const chart = await screen.findByRole('group', {
      name: 'Monthly savings in 2027 by lever family',
    });
    // One area per family from levers.monthly (values as tier 2 sent), the selected lever as a line.
    for (const f of monthlyPayload.families) {
      const last = f.values[11]!;
      expect(
        within(chart).getByRole('img', {
          name: new RegExp(`Dec ${fmt.money(last).replace(/[$]/g, '\\$')}/mo`),
        }),
      ).toBeTruthy();
    }
    const line = monthlyPayload.levers.find((l) => l.key === 'L10')!.values[11]!;
    expect(
      within(chart).getAllByRole('img', {
        name: new RegExp(`${fmt.money(line).replace(/[$]/g, '\\$')}/mo`),
      }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Line: L10')).toBeTruthy();
  });
});

describe('AC4: deep link', () => {
  it('?lever=L10 selects the lever; a click moves ?lever=', async () => {
    const t = await mount('?lever=L10');
    await t.until(() => expect(row('L10').getAttribute('aria-current')).toBe('true'));
    expect(row('L01').getAttribute('aria-current')).toBeNull();
    expect(within(detail()).getByRole('heading', { name: memberLabel('L10') })).toBeTruthy();

    fireEvent.click(within(row('L01')).getByRole('button', { name: memberLabel('L01') }));
    await t.until(() => expect(t.router.state.location.search).toEqual({ lever: 'L01' }));
    await t.until(() => expect(row('L01').getAttribute('aria-current')).toBe('true'));
    expect(within(detail()).getByRole('heading', { name: memberLabel('L01') })).toBeTruthy();
  });

  it('without ?lever the first listed lever is shown; every lever row carries data-lever for the palette', async () => {
    const t = await mount();
    await t.until(() => expect(row('L01').getAttribute('aria-current')).toBe('true'));
    expect(document.querySelectorAll('[data-lever]').length).toBeGreaterThanOrEqual(
      leverKeys.length,
    );
  });
});

describe('AC5: values come from the session or API', () => {
  it('a pushed value replaces the shown one; nothing is derived in tier 1', async () => {
    const t = await mount('?lever=L10');
    await t.until(() => expect(shown(row('L10'))).toBe(String(iy('L10'))));
    act(() => {
      t.mock.emit({
        v: 1,
        type: 'delta',
        seq: null,
        cells: { 'lev.iy[L10]': 12.5, 'res.net[]': 99 },
      });
    });
    await t.until(() => expect(shown(row('L10'))).toBe('12.5'));
    // Family totals are tier 2's view, not a sum of the rows.
    const tech = document.querySelector<HTMLElement>('[data-family-total="technology"]')!;
    expect(tech.dataset['value']).toBe(String(familyValue('technology')));
  });
});

describe('G12: accessibility', () => {
  it('has no axe violations', async () => {
    const t = await mount('?lever=L10');
    await t.until(() => expect(shown(row('L10'))).toBe(String(iy('L10'))));
    await t.until(() =>
      expect(within(detail()).getByRole('combobox', { name: 'Start' })).toBeTruthy(),
    );
    const results = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
