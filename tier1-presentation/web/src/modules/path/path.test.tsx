// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
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
  type QuickSolverRunRequest,
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
import { fmt } from '@glidepath/ui/format';
import { motionMs } from '@glidepath/ui/motion';
import { createAppRouter } from '../../app/router';
import { loadModule } from '../../app/modules';
import { COMMIT_DEBOUNCE_MS } from '../../commit';
import { createDataClient, createServerState } from '../../data';
import { createSessionClient } from '../../session';
import { OBJECTIVES, TARGET_VARIABLE } from './copy';

// ---------------------------------------------------------------------------------------------
// Fixtures: spec ids verbatim; session values from the generated golden fixtures, solver answers
// from the spec's reference run (docs/spec/reference/solver_demo_results.json). Never typed in.
// ---------------------------------------------------------------------------------------------

const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const tenant = specFixtures.tenant;
const presets = specFixtures.scenarios.scenarios;
const C = presetSnapshot('C');
const SCENARIO = C.scenarioId;
const presetId = (key: string) => presets.find((p) => p.key === key)!.id;
const bundle = specFixtures.bundle;
const tenantRow = { ...fx.tenants.response.tenants[0]!, slug: tenant };
const cell = (id: string) => C.cells[toCellKey(id, '')] as number;
const defOf = (id: string) => bundle.variables.find((v) => v.id === id)!;

const HERE = dirname(fileURLToPath(import.meta.url));
interface Moved {
  from: number;
  to: number;
}
const reference = JSON.parse(
  readFileSync(join(HERE, '../../../../../docs/spec/reference/solver_demo_results.json'), 'utf8'),
) as {
  min_risk_total_bar: {
    evaluations: number;
    steps: number;
    net: number;
    bar: number;
    risk_adj_net: number;
    risk_exposure: number;
    one_time_it: number;
    eps27: number;
    inputs_moved_from_C: Record<string, Moved>;
  };
  min_risk_reference: { C_risk_exposure: number; D_risk_exposure: number };
  goal_seek_blend_C_to_D: {
    lambda: number;
    net: number;
    bar: number;
    risk_adj_net: number;
    one_time_it: number;
    eps27: number;
  };
};
const ref = reference.min_risk_total_bar;

/**
 * Tier 2's answer to "Find a path", as API-09 will send it: the reference run's moves in an order
 * that is neither the registry's nor sorted by impact (the optimizer's order is whatever tier 2
 * says), its headline metrics, and the risk-exposure references of C and D.
 */
const moved = Object.entries(ref.inputs_moved_from_C).reverse();
const ranked = moved.map(([id, m], i) => ({
  cell: toCellKey(id, ''),
  from: m.from,
  to: m.to,
  impact: i + 1, // increasing on purpose: the UI must not re-sort
}));
const pathMetrics: Record<string, number> = {
  [toCellKey('res.net', '')]: ref.net,
  [toCellKey('res.bar', '')]: ref.bar,
  [toCellKey('res.risk', '')]: ref.risk_adj_net,
  [toCellKey('res.tot_ot_it', '')]: ref.one_time_it,
  // tier 2 reports the engine value; equal to the start scenario's, so "unchanged"
  [toCellKey('res.fte_us', '')]: cell('res.fte_us'),
  [toCellKey('br.eps27', '')]: ref.eps27,
  risk_exposure: ref.risk_exposure,
  'risk_exposure[C]': reference.min_risk_reference.C_risk_exposure,
  'risk_exposure[D]': reference.min_risk_reference.D_risk_exposure,
  evaluations: ref.evaluations,
  steps: ref.steps,
};
const pathResult = {
  ...solverRunFixtures.min_risk_mix.result!,
  status: 'feasible' as const,
  changes: moved.map(([key, m]) => ({ target: 'variable' as const, key, member: '', value: m.to })),
  ranked,
  metrics: pathMetrics,
};
const JOB = 'job-path';
const queuedPath = {
  ...solverRunFixtures.min_risk_mix,
  id: JOB,
  scenarioId: SCENARIO,
  status: 'queued' as const,
  progress: 0,
  result: null,
};
const donePath = { ...queuedPath, status: 'done' as const, progress: 1, result: pathResult };

const blendRef = reference.goal_seek_blend_C_to_D;
const blendRun = {
  ...solverRunFixtures.scenario_blend,
  id: 'job-blend',
  scenarioId: SCENARIO,
  quick: true,
  spec: {
    problem: 'scenario_blend' as const,
    params: { from: presetId('C'), to: presetId('D') },
  },
  result: {
    ...solverRunFixtures.scenario_blend.result!,
    status: 'feasible' as const,
    metrics: {
      lambda: blendRef.lambda,
      [toCellKey('res.net', '')]: blendRef.net,
      [toCellKey('res.bar', '')]: blendRef.bar,
      [toCellKey('res.risk', '')]: blendRef.risk_adj_net,
      [toCellKey('res.tot_ot_it', '')]: blendRef.one_time_it,
      [toCellKey('br.eps27', '')]: blendRef.eps27,
    },
    detail: { problem: 'scenario_blend' as const, lambda: blendRef.lambda },
  },
};
const SAVED = 'sc-path-143';

// ---------------------------------------------------------------------------------------------
// tier 2 double (msw; API-09 is mocked here) and the WS session, through the app router
// ---------------------------------------------------------------------------------------------

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined; // jsdom: the router restores scroll
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

interface Served {
  posts: ChangesetRequest[];
  starts: SolverRunRequest[];
  quicks: QuickSolverRunRequest[];
}

function serve(start: (body: SolverRunRequest) => object, get: () => object): Served {
  const posts: ChangesetRequest[] = [];
  const starts: SolverRunRequest[] = [];
  const quicks: QuickSolverRunRequest[] = [];
  let saved = false;
  server.use(
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, () => HttpResponse.json({ tenants: [tenantRow] })),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(bundle)),
    http.get(`${BASE}${apiRoutes.members.path}`, () => HttpResponse.json(specFixtures.members)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () =>
      HttpResponse.json({
        scenarios: saved
          ? [
              ...presets,
              {
                ...presets[0]!,
                id: SAVED,
                key: 'path-143',
                label: 'Path to bar',
                kind: 'solver',
                parentId: SCENARIO,
              },
            ]
          : presets,
      }),
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
    http.post(`${BASE}${apiRoutes.solverRunStart.path}`, async ({ request }) => {
      const body = (await request.json()) as SolverRunRequest;
      starts.push(body);
      if (body.save) {
        saved = true;
        return HttpResponse.json(
          { ...donePath, id: 'job-save', save: true, cached: true, resultScenarioId: SAVED },
          { status: 201 },
        );
      }
      return HttpResponse.json(start(body), { status: 201 });
    }),
    http.post(`${BASE}${apiRoutes.solverRunQuick.path}`, async ({ request }) => {
      const body = (await request.json()) as QuickSolverRunRequest;
      quicks.push(body);
      return HttpResponse.json(blendRun);
    }),
    http.get(`${BASE}${apiRoutes.solverRunGet.path}`, () => HttpResponse.json(get())),
  );
  return { posts, starts, quicks };
}

async function mount(
  start: (body: SolverRunRequest) => object = () => donePath,
  get: () => object = () => donePath,
) {
  const served = serve(start, get);
  const mock: MockSession = createMockSession({
    snapshots: presets.map((p) => presetSnapshot(p.key)),
  });
  const frames: (() => void)[] = [];
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [`/${tenant}/${SCENARIO}/path`] }),
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
  await loadModule('path');
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
  const debounce = async () => {
    await act(() => new Promise((r) => setTimeout(r, COMMIT_DEBOUNCE_MS + 50)));
    await settle();
  };
  /** Waits until every ranked move has landed (the stagger runs on real timers). */
  const landed = async () => {
    for (let i = 0; i < 100; i++) {
      if (rows().length === ranked.length) return;
      await act(() => new Promise((r) => setTimeout(r, motionMs('stagger'))));
    }
    expect(rows()).toHaveLength(ranked.length);
  };
  await until(() =>
    expect(screen.getByRole('button', { name: /^Goal / }).dataset['value']).toBe(
      String(cell('res.bar')),
    ),
  );
  return { ...served, mock, router, view, settle, until, debounce, landed };
}

const goal = () => screen.getByRole('region', { name: 'Goal' });
const result = () => screen.getByTestId('path-result');
const rows = () => [...document.querySelectorAll<HTMLElement>('ol.gp-path-moves > li')];
const find = () => within(goal()).getByRole('button', { name: /Find a path/ });

// ---------------------------------------------------------------------------------------------

describe('AC1: goal, objective and constraints map to solver params', () => {
  it('goal (editable), objective radio cards and constraint toggles map to the contract min_risk_mix params', async () => {
    const t = await mount();
    const g = goal();
    // goal: the bar tier 2 pushed, "net, CY27"; editing it commits the net target
    const value = within(g).getByRole('button', { name: /^Goal / });
    expect(value.textContent).toBe(fmt.money(cell('res.bar')));
    expect(g.textContent).toContain('net, CY27');
    fireEvent.click(value);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(defOf(TARGET_VARIABLE).label);
    const field = within(dialog).getByRole('textbox');
    const next = defOf(TARGET_VARIABLE).max!;
    fireEvent.change(field, { target: { value: String(next) } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await t.debounce();
    await t.until(() =>
      expect(t.posts.at(-1)?.changes[0]).toMatchObject({ key: TARGET_VARIABLE, value: next }),
    );
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    // objective radio cards, in the render's order and words
    const group = within(g).getByRole('radiogroup', { name: 'Optimise for' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual([
      'Lowest delivery risk',
      'Most risk-adjusted savings',
      'Least one-time cost',
      'Fewest people moves',
      'Smallest change from plan',
    ]);
    expect(radios[0]!.checked).toBe(true);

    // constraint toggles: render defaults; stretch cap and estimates are always on (locked)
    const hold = within(g).getByRole('list', { name: 'Hold to' });
    const sw = (name: RegExp) => within(hold).getByRole('switch', { name }) as HTMLInputElement;
    expect(sw(/Every VP clears/).checked).toBe(false);
    expect(sw(/US headcount floor/).checked).toBe(true);
    expect(sw(/One-time in IT cap/).checked).toBe(false);
    expect([sw(/full stretch/).checked, sw(/full stretch/).disabled]).toEqual([true, true]);
    expect([sw(/Estimates stay fixed/).checked, sw(/Estimates stay fixed/).disabled]).toEqual([
      true,
      true,
    ]);
    // the floor and the cap start at the session's values
    const floor = within(hold).getByRole('textbox', { name: 'US headcount floor' });
    expect(floor.dataset['value']).toBe(String(cell('res.fte_us')));
    expect((floor as HTMLInputElement).value).toBe(fmt.fte(cell('res.fte_us')));
    const cap = within(hold).getByRole('textbox', { name: /One-time in IT cap/ });
    expect(cap.dataset['value']).toBe(String(cell('res.tot_ot_it')));

    // default: lowest risk, total + US floor
    fireEvent.click(find());
    await t.until(() => expect(t.starts).toHaveLength(1));
    expect(t.starts[0]).toEqual({
      scenarioId: SCENARIO,
      spec: {
        problem: 'min_risk_mix',
        params: {
          objective: 'min_risk_exposure',
          method: 'explainable',
          constraints: [{ id: 'total' }, { id: 'us_floor', value: cell('res.fte_us') }],
        },
      },
    });

    // every objective maps to its solvers.json key; every VP, cap (typed) and no floor
    fireEvent.click(sw(/Every VP clears/));
    fireEvent.click(sw(/US headcount floor/));
    fireEvent.click(sw(/One-time in IT cap/));
    fireEvent.change(cap, { target: { value: '$25M' } });
    for (const [i, o] of OBJECTIVES.entries()) {
      fireEvent.click(radios[i]!);
      await t.until(() => expect(find()).toHaveProperty('disabled', false));
      fireEvent.click(find());
      await t.until(() => expect(t.starts).toHaveLength(i + 2));
      expect(t.starts.at(-1)!.spec).toEqual({
        problem: 'min_risk_mix',
        params: {
          objective: o.id,
          method: 'explainable',
          constraints: [{ id: 'total' }, { id: 'per_vp' }, { id: 'one_time_cap', value: 25 }],
        },
      });
    }
  });
});

describe('AC2: Find a path runs the job and lands the moves', () => {
  it("'Find a path' starts min_risk_mix, shows job progress, then lands moves one by one with a 90 ms stagger in optimizer order", async () => {
    let finished = false;
    const t = await mount(
      () => queuedPath,
      () => (finished ? donePath : { ...queuedPath, status: 'running' }),
    );
    fireEvent.click(find());
    await t.until(() => expect(t.starts).toHaveLength(1));
    expect(t.starts[0]!.spec.problem).toBe('min_risk_mix');

    // progress: the job messages tier 2 sends, shown as sent
    const note = `Searching ${fmt.fte(ref.evaluations)} combinations`;
    await t.mock.replay([
      { v: WS_PROTOCOL_VERSION, type: 'job', id: JOB, status: 'running', progress: 0.4, note },
    ]);
    const panel = screen.getByRole('region', { name: /Finding a path · lowest risk/ });
    await t.until(() => {
      const bar = within(panel).getByRole('progressbar', { name: 'Job progress' });
      expect(bar.getAttribute('aria-valuenow')).toBe('0.4');
      expect(bar.getAttribute('aria-valuetext')).toBe(note);
    });
    expect(within(panel).queryByTestId('path-result')).toBeNull();

    // done: the result is read, then the moves land one by one, 90 ms apart, in tier 2's order
    const delays: unknown[] = [];
    const real = window.setInterval.bind(window);
    vi.spyOn(window, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms);
      return real(fn, ms);
    }) as typeof window.setInterval);
    const seen: number[] = [];
    const watch = new MutationObserver(() => {
      if (seen.at(-1) !== rows().length) seen.push(rows().length);
    });
    watch.observe(document.body, { childList: true, subtree: true });
    finished = true;
    await t.mock.replay([
      { v: WS_PROTOCOL_VERSION, type: 'job', id: JOB, status: 'done', progress: 1, note: null },
    ]);
    await t.until(() => expect(screen.getByTestId('path-result')).toBeTruthy());
    await t.landed();
    watch.disconnect();

    expect(delays).toContain(motionMs('stagger'));
    expect(motionMs('stagger')).toBe(90); // the screens doc's 90 ms, from the motion token
    expect(seen[0]).toBeLessThanOrEqual(1);
    expect(seen.filter((n) => n > 0)).toEqual(ranked.map((_, i) => i + 1));
    expect(rows().map((r) => r.dataset['cell'])).toEqual(ranked.map((m) => m.cell));
    expect(rows().map((r) => r.textContent!.slice(0, 2))).toEqual(
      ranked.map((_, i) => String(i + 1).padStart(2, '0')),
    );
    expect(screen.getByRole('region', { name: 'Path found · lowest risk' })).toBeTruthy();
  });
});

describe('AC3: Blend C → D', () => {
  it("'Blend C → D' runs quick scenario_blend and shows the result", async () => {
    const t = await mount();
    fireEvent.click(within(goal()).getByRole('button', { name: 'Blend C → D' }));
    await t.until(() => expect(t.quicks).toHaveLength(1));
    expect(t.quicks[0]).toEqual({
      scenarioId: SCENARIO,
      spec: { problem: 'scenario_blend', params: { from: presetId('C'), to: presetId('D') } },
    });
    expect(t.starts).toHaveLength(0);
    await t.until(() => expect(result().dataset['status']).toBe('feasible'));
    const panel = screen.getByRole('region', { name: 'Blend C → D' });
    const r = result();
    expect(r.querySelector('.gp-path-hero')!.getAttribute('data-value')).toBe(String(blendRef.net));
    expect(r.querySelector('.gp-path-hero')!.textContent).toBe(`${fmt.money(blendRef.net)}`);
    expect(within(panel).getByText(/Bar cleared$/)).toBeTruthy();
    const line = r.querySelector('.gp-path-lambda')!;
    expect(line.getAttribute('data-value')).toBe(String(blendRef.lambda));
    expect(line.textContent).toBe(
      `Bar cleared ${fmt.pct(blendRef.lambda, { digits: 0 })} of the way from C to D`,
    );
    expect(r.textContent).toContain(fmt.money(blendRef.one_time_it));
    expect(r.textContent).toContain(fmt.signed(blendRef.eps27, 'eps'));
  });
});

describe('AC4: the result', () => {
  it("result: net, 'Bar cleared' chip, risk exposure with C and D references, one-time, US headcount, EPS; ranked MoveRows; save as scenario; compare with C", async () => {
    const t = await mount();
    fireEvent.click(find());
    await t.until(() => expect(result()).toBeTruthy());
    await t.landed();
    const r = result();
    const panel = screen.getByRole('region', { name: 'Path found · lowest risk' });
    expect(within(panel).getByTestId('path-search').textContent).toBe(
      `${fmt.fte(ref.evaluations)} evaluations · ${fmt.fte(ref.steps)} steps`,
    );

    // headline numbers, exactly the metrics tier 2 sent
    const hero = r.querySelector<HTMLElement>('.gp-path-hero')!;
    expect(hero.dataset['value']).toBe(String(ref.net));
    expect(hero.textContent).toBe(fmt.money(ref.net));
    const chip = r.querySelector<HTMLElement>('.gp-chip')!;
    expect([chip.dataset['status'], chip.textContent?.includes('Bar cleared')]).toEqual([
      'clear',
      true,
    ]);
    const stat = (label: string) =>
      r.querySelector<HTMLElement>(`.gp-path-stat[data-metric="${label}"]`)!;
    const val = (label: string) => stat(label).querySelector<HTMLElement>('[data-value]')!;
    expect(val('Risk exposure').dataset['value']).toBe(String(ref.risk_exposure));
    expect(val('Risk exposure').textContent).toBe(fmt.money(ref.risk_exposure));
    expect(stat('Risk exposure').textContent).toContain(
      `C: ${fmt.money(reference.min_risk_reference.C_risk_exposure)} · D: ${fmt.money(
        reference.min_risk_reference.D_risk_exposure,
      )}`,
    );
    expect(val('One-time in IT').textContent).toBe(fmt.money(ref.one_time_it));
    expect(val('US headcount').textContent).toBe(fmt.fte(cell('res.fte_us')));
    expect(stat('US headcount').textContent).toContain('unchanged');
    expect(val('EPS 27').textContent).toBe(fmt.signed(ref.eps27, 'eps'));

    // ranked move rows: label, track and "from → to" from the bundle's definitions
    expect(screen.getByText('Moves from C, most valuable first')).toBeTruthy();
    expect(screen.getByText('grey tick = C')).toBeTruthy();
    for (const [i, row] of rows().entries()) {
      const move = ranked[i]!;
      const id = move.cell.replace(/\[\]$/, '');
      const group = within(row).getByRole('group');
      expect(group.dataset['variableId']).toBe(id);
      expect(group.getAttribute('aria-label')).toContain(defOf(id).label);
    }

    // compare with C: the start scenario's session cells beside the result's metrics
    fireEvent.click(within(r).getByRole('button', { name: 'Compare with C' }));
    const table = await within(r).findByRole('table', { name: 'Path compared with C' });
    const line = (node: string) => table.querySelector<HTMLElement>(`tr[data-node="${node}"]`)!;
    await t.until(() =>
      expect(
        line('res.net')
          .querySelector('[data-side="start"] [data-value]')!
          .getAttribute('data-value'),
      ).toBe(String(cell('res.net'))),
    );
    expect(line('res.net').querySelector('[data-side="result"]')!.textContent).toBe(
      fmt.money(ref.net),
    );
    expect(
      line('br.eps27')
        .querySelector('[data-side="start"] [data-value]')!
        .getAttribute('data-value'),
    ).toBe(String(cell('br.eps27')));
    expect(
      within(r).getByRole('button', { name: 'Compare with C' }).getAttribute('aria-pressed'),
    ).toBe('true');

    // save as scenario: the same spec again with save, then the URL moves to the new scenario
    fireEvent.click(within(r).getByRole('button', { name: 'Save as scenario' }));
    await t.until(() => expect(t.starts).toHaveLength(2));
    expect(t.starts[1]).toEqual({ ...t.starts[0], save: true });
    await t.until(() => expect(t.router.state.location.pathname).toBe(`/${tenant}/${SAVED}/path`));
  });
});

describe('AC5: every value from the session or the API', () => {
  it('values equal the fixtures; the module computes nothing', async () => {
    const t = await mount();
    fireEvent.click(find());
    await t.until(() => expect(result()).toBeTruthy());
    await t.landed();
    // every number on the result carries the value tier 2 sent
    const sent = new Set([...Object.values(pathMetrics), ...ranked.map((m) => m.impact)]);
    for (const el of result().querySelectorAll<HTMLElement>('[data-value]')) {
      expect(sent.has(Number(el.dataset['value'])), el.outerHTML).toBe(true);
    }
    // the move rows show tier 2's from / to as the bundle formats them, nothing derived
    for (const [i, row] of rows().entries()) {
      expect(row.dataset['impact']).toBe(String(ranked[i]!.impact));
    }
    // no arithmetic helpers or formatting outside `fmt` in the module's sources
    const files = readdirSync(HERE).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.tsx'));
    for (const f of files) {
      const src = readFileSync(join(HERE, f), 'utf8');
      expect(src, f).not.toMatch(/Math\.|toFixed|toLocaleString|Intl\.|\.reduce\(/);
      expect(src, f).not.toMatch(
        /from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/tier2|@glidepath\/(engine|solvers|domain)/,
      );
    }
  });
});

describe('G12: accessibility', () => {
  it('has no serious or critical axe violations (empty and with a result)', async () => {
    const t = await mount();
    const run = async () => {
      const out = await axe.run(t.view.container, {
        rules: { 'color-contrast': { enabled: false } }, // jsdom has no layout or colours
      });
      return out.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.help}`);
    };
    expect(await run()).toEqual([]);
    fireEvent.click(find());
    await t.until(() => expect(result()).toBeTruthy());
    await t.landed();
    fireEvent.click(within(result()).getByRole('button', { name: 'Compare with C' }));
    expect(await run()).toEqual([]);
  });
});
