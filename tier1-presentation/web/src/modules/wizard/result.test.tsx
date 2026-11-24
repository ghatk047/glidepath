// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
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
import { motionMs } from '@glidepath/ui/motion';
import { createAppRouter } from '../../app/router';
import { loadModule } from '../../app/modules';
import { COMMIT_DEBOUNCE_MS } from '../../commit';
import { createDataClient, createServerState } from '../../data';
import { createSessionClient } from '../../session';
import { oddsSpec, pathSpec } from '../path/params';
import { wizardStore, type WizardStep } from './store';

// The WIZ-05 screen is not under test here: the router loads a test screen that mounts the
// provider and the two steps this package owns.
vi.mock('./index', async () => {
  const { useMemo } = await import('react');
  const { useBindContext } = await import('../../bind');
  const { useApiClient } = await import('../../data');
  const { JobsProvider, solverRunCanceller } = await import('../../jobs');
  const { OptimizerProvider } = await import('./optimizer');
  const { StepPolicy } = await import('./StepPolicy');
  const { StepResult } = await import('./StepResult');
  const { useWizard } = await import('./store');
  return {
    default: function TestWizard() {
      const { tenant, session } = useBindContext();
      const api = useApiClient();
      const cancel = useMemo(() => solverRunCanceller(api, tenant), [api, tenant]);
      const step = useWizard((s) => s.step);
      return (
        <JobsProvider session={session} cancel={cancel}>
          <OptimizerProvider>
            <main className="gp-module gp-wizard" data-module="wizard" aria-label="Build a plan">
              {step === 3 ? <StepPolicy /> : <StepResult />}
            </main>
          </OptimizerProvider>
        </JobsProvider>
      );
    },
  };
});

const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const tenant = specFixtures.tenant;
const presets = specFixtures.scenarios.scenarios;
const C = presetSnapshot('C');
const SCENARIO = C.scenarioId;
const bundle = specFixtures.bundle;
const tenantRow = { ...fx.tenants.response.tenants[0]!, slug: tenant };
const defOf = (id: string) => bundle.variables.find((v) => v.id === id)!;
const cell = (id: string, member = '') => C.cells[toCellKey(id, member)] as number;
const NET = toCellKey('res.net', '');
const BAR = toCellKey('res.bar', '');

const HERE = dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(
  readFileSync(join(HERE, '../../../../../docs/spec/reference/solver_demo_results.json'), 'utf8'),
) as {
  min_risk_total_bar: {
    net: number;
    risk_adj_net: number;
    risk_exposure: number;
    one_time_it: number;
    inputs_moved_from_C: Record<string, { from: number; to: number }>;
  };
  monte_carlo_C: { iterations: number; prob_clear_bar: number };
};
const ref = reference.min_risk_total_bar;
const moved = Object.entries(ref.inputs_moved_from_C);
const ranked = moved.map(([id, m], i) => ({
  cell: toCellKey(id, ''),
  from: m.from,
  to: m.to,
  impact: i + 1,
}));
const pathResult = {
  ...solverRunFixtures.min_risk_mix.result!,
  status: 'feasible' as const,
  changes: moved.map(([key, m]) => ({ target: 'variable' as const, key, member: '', value: m.to })),
  ranked,
  metrics: {
    [NET]: ref.net,
    [toCellKey('res.tot_ot_it', '')]: ref.one_time_it,
    risk_exposure: ref.risk_exposure,
  },
};
const JOB = 'job-wiz-path';
const queued = {
  ...solverRunFixtures.min_risk_mix,
  id: JOB,
  scenarioId: SCENARIO,
  status: 'queued' as const,
  progress: 0,
  result: null,
};
const done = { ...queued, status: 'done' as const, progress: 1, result: pathResult };
const failed = {
  ...queued,
  status: 'failed' as const,
  result: null,
  error: { type: 'about:blank', title: 'Failed', status: 422, detail: 'No mix clears the bar.' },
};
const SAVED = 'sc-wiz-saved';
const mcRun = {
  ...solverRunFixtures.monte_carlo,
  id: 'job-wiz-mc',
  scenarioId: SCENARIO,
  quick: false,
  spec: oddsSpec,
  result: {
    ...solverRunFixtures.monte_carlo.result!,
    status: 'feasible' as const,
    detail: {
      problem: 'monte_carlo' as const,
      iterations: reference.monte_carlo_C.iterations,
      seed: 1,
      percentiles: [],
      probabilities: [{ cell: NET, against: BAR, p: reference.monte_carlo_C.prob_clear_bar }],
      histograms: [],
      contributions: [],
    },
  },
};

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  wizardStore.getState().reset();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

interface Options {
  start?: () => object;
  get?: () => object;
  lookup?: object | null;
}

async function mount(step: WizardStep, options: Options = {}) {
  const starts: SolverRunRequest[] = [];
  const posts: ChangesetRequest[] = [];
  let saved = false;
  server.use(
    http.get(`${BASE}${apiRoutes.solverRunLookup.path}`, () =>
      HttpResponse.json(
        options.lookup
          ? { run: options.lookup, current: true, trials: 2000 }
          : { run: null, current: false, trials: 2000 },
      ),
    ),
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, () => HttpResponse.json({ tenants: [tenantRow] })),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(bundle)),
    http.get(`${BASE}${apiRoutes.members.path}`, () => HttpResponse.json(specFixtures.members)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () =>
      HttpResponse.json({
        scenarios: saved
          ? [
              ...presets,
              { ...presets[0]!, id: SAVED, key: 'wiz', label: 'Path', kind: 'solver', parentId: SCENARIO },
            ]
          : presets,
      }),
    ),
    http.get(`${BASE}${apiRoutes.scenarioInputs.path}`, ({ params }) =>
      HttpResponse.json({ scenarioId: String(params['id']), version: 0, inputs: [], overrides: [] }),
    ),
    http.get(`${BASE}${apiRoutes.scenarioCalc.path}`, ({ params }) =>
      HttpResponse.json({ ...fx.scenarioCalc.response, scenarioId: String(params['id']), stale: false }),
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
          { ...done, id: 'job-wiz-save', save: true, cached: true, resultScenarioId: SAVED },
          { status: 201 },
        );
      }
      if (body.spec.problem === 'monte_carlo') return HttpResponse.json(mcRun, { status: 201 });
      return HttpResponse.json((options.start ?? (() => done))(), { status: 201 });
    }),
    http.get(`${BASE}${apiRoutes.solverRunGet.path}`, ({ params }) =>
      HttpResponse.json(String(params['id']) === mcRun.id ? mcRun : (options.get ?? (() => done))()),
    ),
  );
  const domains = specFixtures.members.dimensions['domain']!.slice(0, 2);
  const mock: MockSession = createMockSession({
    snapshots: presets.map((p) => presetSnapshot(p.key)),
    views: [
      {
        v: WS_PROTOCOL_VERSION as 1,
        type: 'view' as const,
        view: 'vps.domain_outlay' as const,
        params: {},
        seq: null,
        payload: { domains: domains.map((d, i) => ({ key: d.key as string, value: 100 + i })) },
      },
    ],
  });
  const frames: (() => void)[] = [];
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [`/${tenant}/${SCENARIO}/wizard`] }),
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
  wizardStore.getState().setStep(step);
  await loadModule('wizard');
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
  const rows = () => [...document.querySelectorAll<HTMLElement>('ol.gp-wzr-moves > li')];
  const landed = async () => {
    for (let i = 0; i < 100; i++) {
      if (rows().length === ranked.length) return;
      await act(() => new Promise((r) => setTimeout(r, motionMs('stagger'))));
    }
    expect(rows()).toHaveLength(ranked.length);
  };
  await until(() =>
    expect(document.querySelector(`[data-wizard-step="${String(step)}"]`)).toBeTruthy(),
  );
  return { starts, posts, mock, router, view, settle, until, rows, landed };
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);

describe('step 3 · Policy', () => {
  it('binds target, growth, funding, timing and ownership to their ids, with the read-outs', async () => {
    const t = await mount(3);
    const labelled = (id: string) =>
      [...document.querySelectorAll('label')].some((l) =>
        l.textContent?.startsWith(defOf(id).label),
      );
    await t.until(() => {
      // sliders are found by their registry label; toggles and segments carry the id
      for (const id of ['g.target_net', 'g.ot_out_share', 'g.head_start'])
        expect(labelled(id), id).toBe(true);
      for (const id of [
        'g.absorb_growth',
        'lev.start',
        'g.vp_target_method',
        'g.chargeback_on',
      ])
        expect(q(`[data-variable-id="${id}"]`), id).toBeTruthy();
      // org.dom_share: one ownership bar per domain
      expect(q('[data-domain]'), 'org.dom_share').toBeTruthy();
    });
    for (const node of [
      'res.target',
      'base.headwinds',
      'res.bar',
      'res.tot_ot_it',
      'res.tot_ot_out',
      'vp.outlay',
    ])
      expect(q(`[data-node="${node}"]`), node).toBeTruthy();
    // a chosen lever has a start month in tier 2's value
    const start = q('select[data-variable-id="lev.start"]') as HTMLSelectElement;
    expect(start).toBeTruthy();
    const lever = start.closest('li')!.dataset['lever']!;
    await t.until(() => expect(start.value).toBe(String(cell('lev.start', lever))));
  });

  it('shows g.target_pct instead of g.target_net when the target is a percentage', async () => {
    const t = await mount(3);
    const has = (id: string) =>
      [...document.querySelectorAll('label')].some((l) => l.textContent?.startsWith(defOf(id).label));
    await t.until(() => expect(has('g.target_net')).toBe(true));
    // C seeds the target as an amount: the percentage slider is not shown
    expect(has('g.target_pct')).toBe(false);
  });

  it('the growth toggle commits g.absorb_growth through the commit queue', async () => {
    const t = await mount(3);
    await t.until(() => expect(q('[data-variable-id="g.absorb_growth"]')).toBeTruthy());
    fireEvent.click(within(q('[data-variable-id="g.absorb_growth"]')!).getByRole('switch'));
    await act(() => new Promise((r) => setTimeout(r, COMMIT_DEBOUNCE_MS + 50)));
    await t.until(() => expect(t.posts.length).toBeGreaterThan(0), 80);
    expect(
      t.posts[0]!.changes.some((c) => 'key' in c && c.key === 'g.absorb_growth'),
    ).toBe(true);
  });
});

describe('step 4 · Result', () => {
  it('shows net against the bar, the gap, risk, EPS and a tile per VP', async () => {
    const t = await mount(4);
    await t.until(() => expect(q('[data-wizard-step="4"] [data-node="res.net"]')).toBeTruthy());
    for (const node of [
      'res.net',
      'res.bar',
      'res.target',
      'base.headwinds',
      'res.gap',
      'res.coverage',
      'res.risk',
      'res.gap_risk',
      'br.eps27',
    ])
      expect(q(`[data-wizard-step="4"] [data-node="${node}"]`), node).toBeTruthy();
    const tiles = document.querySelectorAll('.gp-wzr-vp');
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles)
      for (const node of ['vp.net', 'vp.bar', 'vp.gap'])
        expect(tile.querySelector(`[data-node="${node}"]`), node).toBeTruthy();
  });

  it('odds: "Run N trials" with tier 2 count when nothing is held, P(clear) from the look-up', async () => {
    const t = await mount(4);
    const odds = () => screen.getByTestId('wizard-odds');
    await t.until(() =>
      expect(within(odds()).getByRole('button', { name: 'Run 2,000 trials' })).toBeTruthy(),
    );
    cleanup();
    const t2 = await mount(4, { lookup: mcRun });
    await t2.until(() =>
      expect(Number(screen.getByTestId('wizard-odds').querySelector<HTMLElement>('[data-clear]')?.dataset['clear'])).toBe(
        reference.monte_carlo_C.prob_clear_bar,
      ),
    );
  });
});

describe('optimizer', () => {
  const find = () => q('[data-wizard-find]') as HTMLButtonElement;

  it('find() posts min_risk_mix with pathSpec on the current scenario, shows the flow, lands the moves in tier 2 order', async () => {
    const t = await mount(4, { start: () => queued, get: () => done });
    // the objective and "every VP" choices travel in the spec
    fireEvent.click(screen.getByRole('switch', { name: 'Every VP clears' }));
    fireEvent.click(find());
    await t.until(() => expect(t.starts).toHaveLength(1));
    expect(t.starts[0]).toEqual({
      scenarioId: SCENARIO,
      spec: pathSpec({ objective: 'min_risk_exposure', perVp: true, usFloor: null, oneTimeCap: null, gccHiring: null }),
    });
    expect(wizardStore.getState().step).toBe(4);
    // the run is queued and never ends here: the field flow shows meanwhile
    await t.until(() => expect(screen.getByTestId('wizard-flow')).toBeTruthy());
    expect(screen.queryByTestId('wizard-found')).toBeNull();
  });

  it('after the run ends the moves land one by one, in the order tier 2 sent', async () => {
    const t = await mount(4);
    fireEvent.click(find());
    await t.until(() => expect(screen.getByTestId('wizard-found')).toBeTruthy());
    await t.landed();
    t.rows().forEach((row, i) => expect(row.dataset['impact']).toBe(String(ranked[i]!.impact)));
    expect(screen.getByTestId('wizard-found').dataset['status']).toBe('feasible');
    expect(screen.getByText('Bar cleared')).toBeTruthy();
  });

  it('Use this path asks again with save true and switches to the saved scenario; the moves stay', async () => {
    const t = await mount(4);
    fireEvent.click(find());
    await t.until(() => expect(screen.getByTestId('wizard-found')).toBeTruthy());
    await t.landed();
    fireEvent.click(screen.getByRole('button', { name: 'Use this path' }));
    await t.until(() => expect(t.starts).toHaveLength(2));
    expect(t.starts[1]).toEqual({ ...t.starts[0], save: true });
    await t.until(() =>
      expect(t.router.state.location.pathname).toBe(`/${tenant}/${SAVED}/wizard`),
    );
    expect(t.rows()).toHaveLength(ranked.length);
    expect(wizardStore.getState().step).toBe(4);
  });

  it('Discard clears the result', async () => {
    const t = await mount(4);
    fireEvent.click(find());
    await t.until(() => expect(screen.getByTestId('wizard-found')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await t.until(() => expect(screen.queryByTestId('wizard-found')).toBeNull());
  });

  it('a failed run shows tier 2 detail', async () => {
    const t = await mount(4, { start: () => failed, get: () => failed });
    fireEvent.click(find());
    await t.until(() => expect(screen.getByRole('alert').textContent).toBe('No mix clears the bar.'));
  });
});

describe('no business logic, axe', () => {
  it('has no serious or critical axe violations on steps 3 and 4', async () => {
    const check = async (container: HTMLElement) => {
      const out = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
      return out.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.help}`);
    };
    const t3 = await mount(3);
    await t3.until(() => expect(q('[data-domain]')).toBeTruthy());
    expect(await check(t3.view.container)).toEqual([]);
    cleanup();
    const t4 = await mount(4);
    fireEvent.click(q('[data-wizard-find]')!);
    await t4.until(() => expect(screen.getByTestId('wizard-found')).toBeTruthy());
    await t4.landed();
    expect(await check(t4.view.container)).toEqual([]);
  });

  it('the sources do arithmetic on no received value', () => {
    for (const f of ['Moves.tsx', 'Odds.tsx', 'StepPolicy.tsx', 'StepResult.tsx', 'optimizer.tsx']) {
      const src = readFileSync(join(HERE, f), 'utf8');
      expect(src, f).not.toMatch(/Math\.(round|floor|ceil|max|min)\(/);
    }
  });
});
