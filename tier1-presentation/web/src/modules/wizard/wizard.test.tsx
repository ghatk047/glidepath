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
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScenarioId, TenantSlug, apiRoutes, type ChangesetRequest } from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  presetSnapshot,
  specFixtures,
} from '@glidepath/api-contract/testing';
import { fmt } from '@glidepath/ui/format';
import { GlassProvider } from '@glidepath/ui/glass';
import { parseViewSearch } from '../../app/search';
import { BindProvider } from '../../bind';
import { DataProvider, createDataClient, createServerState } from '../../data';
import { createSessionClient } from '../../session';
import { wizardStore } from './store';

// The real provider belongs to WIZ-06; the tape is driven here through a controllable double.
const optimizer = vi.hoisted(() => ({
  state: {
    objective: 'min_risk_exposure',
    setObjective: () => undefined,
    perVp: false,
    setPerVp: () => undefined,
    busy: false,
    jobId: null as string | null,
    run: null,
    result: null,
    moves: [],
    moved: new Set<string>(),
    error: null,
    find: () => undefined,
    applying: false,
    apply: () => undefined,
    discard: () => undefined,
  } as Record<string, unknown>,
}));
vi.mock('./optimizer', () => ({
  OptimizerProvider: ({ children }: { children: ReactNode }) => children,
  useWizardOptimizer: () => optimizer.state,
}));
vi.mock('./StepPolicy', () => ({
  StepPolicy: () => <section data-wizard-step="3" aria-label="Policy" />,
}));
vi.mock('./StepResult', () => ({
  StepResult: () => <section data-wizard-step="4" aria-label="Result" />,
}));

import Wizard from './index';

const BASE = 'http://tier2.test';
const tenant = TenantSlug.parse(specFixtures.tenant);
const C = presetSnapshot('C');
const D = presetSnapshot('D');
const scenarioId = ScenarioId.parse(C.scenarioId);
const cell = (id: string, member = '') => C.cells[`${id}[${member}]`] as number;

const members = specFixtures.members.dimensions['lever']!;
const memberLabel = (key: string) => members.find((m) => m.key === key)!.label;
const leverKeys = members.map((m) => m.key as string);
const FAMILIES = [
  { key: 'labour', label: 'Labour', levers: leverKeys.slice(0, 8) },
  { key: 'technology', label: 'Technology', levers: leverKeys.slice(8, 14) },
  { key: 'platforms', label: 'Platforms', levers: leverKeys.slice(14) },
];
const iy = (k: string) => cell('lev.iy', k);
const familiesPayload = {
  total: cell('res.tot_iy'),
  families: FAMILIES.map((f) => ({
    ...f,
    value: f.levers.reduce((a, k) => a + iy(k), 0),
  })),
};
const SCALE = Math.max(...leverKeys.map(iy));
const view = (name: string, payload: unknown) => ({
  v: 1 as const,
  type: 'view' as const,
  view: name,
  params: {},
  seq: null,
  payload,
});

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

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined;
});
beforeEach(() => {
  wizardStore.getState().reset();
  optimizer.state['busy'] = false;
  optimizer.state['jobId'] = null;
  optimizer.state['moved'] = new Set<string>();
  optimizer.state['find'] = () => undefined;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

const fx = coreRouteFixtures;

async function mount() {
  const posts: ChangesetRequest[] = [];
  server.use(
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(specFixtures.bundle)),
    http.get(`${BASE}${apiRoutes.members.path}`, () => HttpResponse.json(specFixtures.members)),
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
  const rootRoute = createRootRoute({ component: Outlet, validateSearch: parseViewSearch });
  const moduleRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$tenant/$scenario/$module',
    component: () => (
      <GlassProvider frameSampling={false}>
        <BindProvider tenant={tenant} scenarioId={scenarioId} session={session}>
          <Wizard />
        </BindProvider>
      </GlassProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([moduleRoute]),
    history: createMemoryHistory({ initialEntries: [`/${tenant}/${scenarioId}/wizard`] }),
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
        if (i > 40) throw e;
      }
    }
  };
  await screen.findByRole('navigation', { name: 'Steps' });
  return { posts, router, settle, until, mock };
}

const tape = () => document.querySelector<HTMLElement>('[data-wizard-tape]')!;
const stepBtn = (n: number) => document.querySelector<HTMLElement>(`.gp-wz-step[data-step="${n}"]`)!;
const row = (lever: string) =>
  document.querySelector<HTMLElement>(`[data-lever="${lever}"]`)!.closest('li')!;
const shown = (el: Element) => el.querySelector<HTMLElement>('[data-value]')?.dataset['value'];

describe('stepper', () => {
  it('shows four steps, aria-current on the current one, Back/Next, and any step is a click away', async () => {
    const t = await mount();
    await t.until(() => expect(document.querySelector('[data-wizard-step="1"]')).toBeTruthy());
    const nav = screen.getByRole('navigation', { name: 'Steps' });
    expect(nav.hasAttribute('data-wizard-stepper')).toBe(true);
    expect(within(nav).getAllByRole('listitem')).toHaveLength(4);
    expect(stepBtn(1).getAttribute('aria-current')).toBe('step');
    expect((document.querySelector('[data-wizard-back]') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(document.querySelector('[data-wizard-next]')!);
    expect(stepBtn(2).getAttribute('aria-current')).toBe('step');
    expect(stepBtn(1).getAttribute('aria-current')).toBeNull();
    expect(document.querySelector('[data-wizard-step="2"]')).toBeTruthy();

    fireEvent.click(stepBtn(4));
    expect(document.querySelector('[data-wizard-step="4"]')).toBeTruthy();
    expect(document.querySelector('[data-wizard-next]')).toBeNull();
    fireEvent.click(document.querySelector('[data-wizard-back]')!);
    expect(stepBtn(3).getAttribute('aria-current')).toBe('step');
  });

  it('keeps the step when the URL scenario changes (a fork)', async () => {
    const t = await mount();
    fireEvent.click(stepBtn(3));
    await act(async () => {
      await t.router.navigate({ to: `/${tenant}/${D.scenarioId}/wizard` } as never);
    });
    expect(wizardStore.getState().step).toBe(3);
    expect(stepBtn(3).getAttribute('aria-current')).toBe('step');
  });
});

describe('tape', () => {
  it('shows res.tot_iy, res.tot_ot_it, res.net, res.bar and the gap chip on every step', async () => {
    const t = await mount();
    for (const n of [1, 2, 3, 4]) {
      fireEvent.click(stepBtn(n));
      await t.until(() => expect(shown(tape().querySelector('[data-node="res.net"]')!)).toBeDefined());
      for (const id of ['res.tot_iy', 'res.tot_ot_it', 'res.net', 'res.bar']) {
        const el = tape().querySelector<HTMLElement>(`[data-node="${id}"]`)!;
        expect(shown(el)).toBe(String(cell(id)));
        expect(el.textContent).toContain(fmt.money(cell(id)));
      }
      const gap = cell('res.gap');
      expect(tape().querySelector('.gp-chip')!.textContent).toContain(
        fmt.money(gap >= 0 ? gap : -gap),
      );
      const meter = tape().querySelector<HTMLElement>('.gp-wz-meter > i')!;
      expect(meter.style.getPropertyValue('--value')).toBe(String(cell('res.net')));
      expect(meter.style.getPropertyValue('--max')).toBe(String(cell('res.bar')));
    }
  });

  it('Find a path calls the optimizer; busy without a job shows ComputeFlow, with a job shows JobHeader', async () => {
    const find = vi.fn();
    optimizer.state['find'] = find;
    const t = await mount();
    const btn = () => tape().querySelector<HTMLButtonElement>('[data-wizard-optimize]')!;
    expect(btn().textContent).toBe('Find a path');
    expect(tape().querySelector('[data-compute]')).toBeNull();
    fireEvent.click(btn());
    expect(find).toHaveBeenCalledTimes(1);

    optimizer.state['busy'] = true;
    cleanup();
    await mount();
    await t.settle();
    expect(btn().textContent).toBe('Starting…');
    expect(btn().disabled).toBe(true);
    expect(tape().querySelector('[data-compute]')).toBeTruthy();
  });
});

describe('tape job', () => {
  it('with a job id the tape shows JobHeader (tier 2 note and progress) and no starting state', async () => {
    optimizer.state['busy'] = true;
    optimizer.state['jobId'] = 'job-1';
    const t = await mount();
    await act(async () => {
      await t.mock.replay([
        {
          v: 1 as const,
          type: 'job' as const,
          id: 'job-1',
          status: 'running' as const,
          progress: 0.4,
          note: 'Searching 1,634 combinations…',
        },
      ] as never);
    });
    await t.settle();
    const job = tape().querySelector('.gp-job')!;
    expect(job).toBeTruthy();
    expect(job.textContent).toContain('Searching 1,634 combinations…');
    expect(job.querySelector('[data-compute]')).toBeTruthy();
  });
});

describe('step 1: levers', () => {
  it('lists the levers by family with a lev.on toggle each; toggling commits 1/0', async () => {
    const t = await mount();
    await t.until(() => expect(row('L10').querySelector('[data-value]')).toBeTruthy());
    const groups = screen.getAllByRole('group').filter((g) => g.classList.contains('gp-wz-group'));
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(
      FAMILIES.map((f) => f.label),
    );
    for (const k of leverKeys) {
      const li = row(k);
      expect(within(li).getByRole('button', { name: memberLabel(k) })).toBeTruthy();
      expect(shown(li)).toBe(String(iy(k)));
      const bar = li.querySelector<HTMLElement>('.gp-wz-bar > i')!;
      expect(bar.style.getPropertyValue('--max')).toBe(String(SCALE));
    }
    expect(leverKeys).toHaveLength(17);

    const sw = within(row('L03')).getByRole('switch', { name: `${memberLabel('L03')} on` });
    await t.until(() => expect((sw as HTMLInputElement).checked).toBe(cell('lev.on', 'L03') === 1));
    fireEvent.click(sw);
    await waitFor(() => expect(t.posts).toHaveLength(1));
    expect(t.posts[0]!.changes).toEqual([
      {
        target: 'variable',
        key: 'lev.on',
        member: 'L03',
        value: cell('lev.on', 'L03') === 1 ? 0 : 1,
      },
    ]);
  });

  it('families panel shows each family value and the res.tot_iy total; a name click focuses and opens Tune', async () => {
    const t = await mount();
    await t.until(() => expect(document.querySelector('[data-family-total]')).toBeTruthy());
    for (const f of familiesPayload.families) {
      const el = document.querySelector<HTMLElement>(`[data-family-total="${f.key}"]`)!;
      expect(el.dataset['value']).toBe(String(f.value));
    }
    await t.until(() =>
      expect(shown(document.querySelector('.gp-wz-total')!)).toBe(String(cell('res.tot_iy'))),
    );
    fireEvent.click(within(row('L05')).getByRole('button', { name: memberLabel('L05') }));
    expect(wizardStore.getState().focusLever).toBe('L05');
    expect(wizardStore.getState().step).toBe(2);
  });

  it('is axe clean', async () => {
    const t = await mount();
    await t.until(() => expect(row('L10').querySelector('[data-value]')).toBeTruthy());
    const res = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('step 2: tune', () => {
  const firstOn = leverKeys.find((k) => cell('lev.on', k) === 1)!;

  it('lists only levers that are on and shows KPIs plus one slider per lev.<Lxx>.* variable', async () => {
    const t = await mount();
    wizardStore.getState().setFocusLever(firstOn);
    fireEvent.click(stepBtn(2));
    await t.until(() => expect(document.querySelector('.gp-wz-chosen li')).toBeTruthy());
    const listed = Array.from(
      document.querySelectorAll<HTMLElement>('.gp-wz-chosen [data-lever]'),
    ).map((b) => b.dataset['lever']);
    expect(listed).toEqual(leverKeys.filter((k) => cell('lev.on', k) === 1));

    const d = document.querySelector<HTMLElement>('[data-lever-detail]')!;
    expect(d.dataset['leverDetail']).toBe(firstOn);
    await t.until(() => expect(d.querySelectorAll('.gp-wz-kpi [data-value]')).toHaveLength(3));
    const [a, b, c] = Array.from(d.querySelectorAll<HTMLElement>('.gp-wz-kpi'));
    expect(shown(a!)).toBe(String(cell('lev.iy', firstOn)));
    expect(shown(b!)).toBe(String(cell('lev.rr', firstOn)));
    expect(shown(c!)).toBe(String(cell('lev.ot', firstOn)));

    const params = specFixtures.bundle.variables.filter(
      (v) => v.id.startsWith(`lev.${firstOn}.`) && v.ui.control === 'slider',
    );
    const decisions = params.filter((v) => v.kind === 'decision');
    const rest = params.filter((v) => v.kind !== 'decision');
    for (const p of decisions) {
      const slider = await within(d).findByRole('slider', { name: p.label });
      expect(slider.closest('[data-variant]')!.getAttribute('data-variant')).toBe('decision');
      expect(slider.closest('details')).toBeNull();
    }
    const details = d.querySelector('details')!;
    expect(details.open).toBe(false);
    for (const p of rest) {
      const slider = await within(details).findByRole('slider', { name: p.label, hidden: true });
      expect(slider.closest('[data-variant]')!.getAttribute('data-variant')).toBe('estimate');
    }
    expect(
      within(details).getByRole('slider', { name: 'Confidence', hidden: true }).getAttribute(
        'aria-valuenow',
      ),
    ).toBe(String(cell('lev.conf', firstOn)));
  });

  it('shows Switched off with its toggle for an off lever and drops it from the chosen list', async () => {
    const t = await mount();
    const target = leverKeys.find((k) => k !== firstOn && cell('lev.on', k) === 1)!;
    wizardStore.getState().setFocusLever(target);
    fireEvent.click(stepBtn(2));
    await t.until(() =>
      expect(document.querySelector(`.gp-wz-chosen [data-lever="${target}"]`)).toBeTruthy(),
    );
    await act(async () => {
      await t.mock.replay([
        { v: 1 as const, type: 'delta' as const, seq: 50, cells: { [`lev.on[${target}]`]: 0 } },
      ] as never);
    });
    await t.until(() => expect(document.querySelector('.gp-wz-off')).toBeTruthy());
    expect(document.querySelector('.gp-wz-off')!.textContent).toContain('Switched off');
    expect(document.querySelector(`.gp-wz-chosen [data-lever="${target}"]`)).toBeNull();
    expect(document.querySelector('[data-lever-detail] .gp-wz-sliders')).toBeNull();
  });

  it('marks variables the optimizer moved with data-moved', async () => {
    const decision = specFixtures.bundle.variables.find(
      (v) => v.id.startsWith(`lev.${firstOn}.`) && v.ui.control === 'slider' && v.kind === 'decision',
    )!;
    optimizer.state['moved'] = new Set([decision.id]);
    const t = await mount();
    wizardStore.getState().setFocusLever(firstOn);
    fireEvent.click(stepBtn(2));
    await t.until(() => expect(document.querySelector('[data-moved]')).toBeTruthy());
    const marked = document.querySelectorAll('.gp-wz-slide[data-moved]');
    expect(marked).toHaveLength(1);
    expect(
      await within(marked[0] as HTMLElement).findByRole('slider', { name: decision.label }),
    ).toBeTruthy();
  });

  it('is axe clean', async () => {
    const t = await mount();
    wizardStore.getState().setFocusLever(firstOn);
    fireEvent.click(stepBtn(2));
    await t.until(() => expect(document.querySelector('.gp-wz-kpi [data-value]')).toBeTruthy());
    const res = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations.map((v) => v.id)).toEqual([]);
  });
});
