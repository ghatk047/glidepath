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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ScenarioId,
  TenantSlug,
  apiRoutes,
  type ReconfigApplyRequest,
  type ReconfigJob,
  type ReconfigList,
  type ReconfigRequest,
} from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  jobRouteFixtures,
  presetSnapshot,
  specFixtures,
} from '@glidepath/api-contract/testing';
import { fmt } from '@glidepath/ui/format';
import { DataProvider, createDataClient, createServerState } from '../../data';
import { GlobalLayout } from '../../global/shell';
import { createSessionClient } from '../../session';
import { PIPELINE, stepLabel } from './copy';
import Airlines from './index';
import { POLL_MS } from './useReconfig';

const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const aa = TenantSlug.parse(specFixtures.tenant);
const C = presetSnapshot('C');
const PRESET_C = ScenarioId.parse(C.scenarioId);
const row = fx.tenants.response.tenants[0]!;
const tenants = [
  { ...row, slug: aa, name: 'Fixture Air', status: 'active' as const },
  { ...row, id: 't-ua', slug: 'ua', name: 'Fixture United', status: 'setup' as const },
  { ...row, id: 't-as', slug: 'as', name: 'Fixture Alaska', status: 'setup' as const },
];

/** The cached UA job (06 §3): a plan reviewed with four checklist steps done and one in review. */
const base = jobRouteFixtures.aiReconfigGet.response;
const fact = (id: string, item: string, sourceId: string | null, confidence: 'H' | 'M' | 'L') => ({
  id,
  item,
  label: `${item} fact`,
  value: 1,
  unit: 'x',
  sourceId,
  asOf: null,
  confidence,
});
/** What tier 2 sends: nine steps of 07 section 2, four done, one in review (ids as the AI package names them). */
const STEP_IDS = [
  'tenant_record',
  'baseline_lines',
  'org',
  'workforce',
  'vendors',
  'corporate_drivers',
  'target',
  'scenarios',
  'sources',
] as const;
const onboarding = (states: ('done' | 'review' | 'todo')[]) => ({
  steps: STEP_IDS.map((id, i) => ({ id, state: states[i] ?? 'todo' })),
  done: states.filter((x) => x === 'done').length,
  total: STEP_IDS.length,
});
const uaJob = {
  ...base,
  id: 'ai-ua',
  prompt: 'Set up Fixture United for CY27',
  tenant: null,
  status: 'review',
  step: 'review',
  plan: {
    ...base.plan,
    tenant: { name: 'Fixture United', slug: 'ua', monogram: 'UA', ticker: null, currency: 'USD' },
  },
  onboarding: onboarding(['done', 'done', 'done', 'done', 'review']),
  facts: [
    fact('f1', 'tenant_record', 'src-1', 'H'),
    fact('f2', 'baseline_lines', 'src-1', 'M'),
    fact('f3', 'org', 'src-1', 'M'),
    fact('f4', 'workforce', 'src-1', 'M'),
    fact('f5', 'vendors', 'src-1', 'M'),
  ],
  openQuestions: [
    {
      id: 'q-1',
      question: 'Which vendors are preferred?',
      context: null,
      item: 'vendors',
      blocking: false,
    },
  ],
} as unknown as ReconfigJob;
const running = {
  ...uaJob,
  status: 'running',
  step: 'research',
  progress: 0.4,
  progressNote: 'Reading public filings',
  drafts: [],
  calibration: null,
} as unknown as ReconfigJob;
const estimated = {
  ...uaJob,
  status: 'estimated',
  step: 'scope',
  progress: 0.1,
  drafts: [],
  facts: [],
  openQuestions: [],
  onboarding: onboarding([]),
  calibration: null,
} as unknown as ReconfigJob;

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined;
});
beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

interface Served {
  starts: ReconfigRequest[];
  applies: ReconfigApplyRequest[];
  /** What `GET /api/ai/reconfig/:id` answers; the test changes it. */
  current: { job: ReconfigJob | null };
  /** What `GET /api/ai/reconfig` answers (tier 2's list of the caller's jobs and tenant parity). */
  list: ReconfigList;
  lists: number;
}

const PARITY = [{ tenant: aa, passed: 12, total: 14, recordedAt: '2026-11-23T10:00:00.000Z' }];

function serve(initial: ReconfigJob | null = null, parity: ReconfigList['parity'] = []): Served {
  const served: Served = {
    starts: [],
    applies: [],
    current: { job: initial },
    list: { jobs: initial ? [initial] : [], parity },
    lists: 0,
  };
  server.use(
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, () => HttpResponse.json({ tenants })),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(specFixtures.bundle)),
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
    http.get(`${BASE}${apiRoutes.members.path}`, () => HttpResponse.json(specFixtures.members)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () =>
      HttpResponse.json({ scenarios: specFixtures.scenarios.scenarios }),
    ),
    http.post(`${BASE}${apiRoutes.aiReconfigStart.path}`, async ({ request }) => {
      const body = (await request.json()) as ReconfigRequest;
      served.starts.push(body);
      return HttpResponse.json(body.dryRun ? estimated : running, { status: 201 });
    }),
    http.get(`${BASE}${apiRoutes.aiReconfigList.path}`, () => {
      served.lists += 1;
      return HttpResponse.json(served.list);
    }),
    http.get(`${BASE}${apiRoutes.aiReconfigGet.path}`, () =>
      served.current.job
        ? HttpResponse.json(served.current.job)
        : HttpResponse.json(
            { type: 'about:blank', title: 'Not found', status: 404, detail: 'No job' },
            { status: 404 },
          ),
    ),
    http.post(`${BASE}${apiRoutes.aiReconfigApply.path}`, async ({ request }) => {
      served.applies.push((await request.json()) as ReconfigApplyRequest);
      served.current.job = {
        ...uaJob,
        status: 'applied',
        onboarding: onboarding(['done', 'done', 'done', 'done', 'done']),
      } as ReconfigJob;
      return HttpResponse.json({
        jobId: 'ai-ua',
        tenantId: 't-ua',
        tenant: 'ua',
        applied: [{ kind: 'seed', changesetId: 'cs-1', editsCount: 1840 }],
      });
    }),
  );
  return served;
}

async function mount(served: Served) {
  const mock = createMockSession({ snapshots: [C] });
  const frames: (() => void)[] = [];
  const session = createSessionClient({
    tenant: aa,
    scenario: PRESET_C,
    origin: 'ws://localhost:8080',
    connect: mock.connect,
    requestFrame: (cb) => void frames.push(cb),
    random: () => 0,
  });
  function Screen() {
    return (
      <GlobalLayout
        tenant={aa}
        scenarioId={PRESET_C}
        module="airlines"
        session={session}
        onTrace={() => undefined}
        glass={{ frameSampling: false }}
      >
        <Airlines />
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
    history: createMemoryHistory({ initialEntries: [`/${aa}/${PRESET_C}/airlines`] }),
  });
  render(
    <DataProvider client={createDataClient({ baseUrl: BASE })} serverState={createServerState()}>
      <RouterProvider router={router as never} />
    </DataProvider>,
  );
  await waitFor(() => expect(document.querySelector('[data-tile="ua"]')).not.toBeNull(), {
    timeout: 4000,
  });
  return { served, flush: () => act(async () => void (await mock.flush())) };
}

const tile = (slug: string) => document.querySelector<HTMLElement>(`[data-tile="${slug}"]`)!;
const dims = specFixtures.members.dimensions;
const activeCount = (d: string) => dims[d]!.filter((m) => m.active).length;

async function draftAndStart(prompt: string) {
  const input = screen.getByLabelText('Describe the airline or the change');
  fireEvent.change(input, { target: { value: prompt } });
  fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
  await screen.findByRole('group', { name: 'Cost estimate' }, { timeout: 4000 });
}

describe('AC1: tenant tiles', () => {
  it('shows the live tenant with counts from tier 2, UA draft, AS not started, Add an airline; IATA monograms only', async () => {
    await mount(serve(uaJob));
    await waitFor(() => expect(tile('ua').dataset['kind']).toBe('draft'), { timeout: 4000 });

    const live = tile(aa);
    expect(live.dataset['kind']).toBe('live');
    expect(within(live).getByText('Live')).toBeTruthy();
    await waitFor(
      () =>
        expect(within(live).getByTestId(`facts-${aa}`).textContent).toBe(
          `${activeCount('line')} lines · ${activeCount('vp')} VPs · ${specFixtures.scenarios.scenarios.length} scenarios`,
        ),
      { timeout: 4000 },
    );

    expect(within(tile('ua')).getByText('Continue setup')).toBeTruthy();
    expect(tile('as').dataset['kind']).toBe('new');
    expect(within(tile('as')).getByText('Not started')).toBeTruthy();
    expect(within(tile('as')).getByRole('button', { name: 'Set up with AI' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add an airline' })).toBeTruthy();

    const marks = [...document.querySelectorAll('[data-monogram]')].map((e) => e.textContent);
    expect(marks.length).toBeGreaterThanOrEqual(3);
    for (const m of marks) expect(m).toMatch(/^[A-Z0-9]{2,3}$/);
    expect(document.querySelector('.gp-airlines-tile img, .gp-airlines-tile svg')).toBeNull();
  });

  it('finds the cached UA job through GET /api/ai/reconfig, with nothing remembered in the browser', async () => {
    const served = serve(uaJob);
    window.localStorage.clear();
    await mount(served);
    await waitFor(() => expect(tile('ua').dataset['kind']).toBe('draft'), { timeout: 4000 });
    expect(served.lists).toBe(1);
    expect(within(tile('ua')).getByText('Continue setup')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Review' })).toBeTruthy();
    // the browser keeps no job id (neither read nor written)
    expect(window.localStorage.length).toBe(0);

    // a list without a job leaves UA as a tenant not started
    cleanup();
    server.resetHandlers();
    await mount(serve());
    expect(tile('ua').dataset['kind']).toBe('new');
  });

  it('shows the tenant parity tier 2 recorded on the live tile, and none where it recorded none', async () => {
    await mount(serve(null, PARITY));
    await waitFor(
      () =>
        expect(within(tile(aa)).getByTestId(`facts-${aa}`).textContent).toBe(
          `${activeCount('line')} lines · ${activeCount('vp')} VPs · ${specFixtures.scenarios.scenarios.length} scenarios · parity 12/14`,
        ),
      { timeout: 4000 },
    );
    expect(tile('as').textContent).not.toContain('parity');
    expect(tile('ua').textContent).not.toContain('parity');

    cleanup();
    server.resetHandlers();
    await mount(serve(null, []));
    await waitFor(() => expect(within(tile(aa)).getByTestId(`facts-${aa}`)).toBeTruthy(), {
      timeout: 4000,
    });
    expect(tile(aa).textContent).not.toContain('parity');
  });

  it('Set up with AI fills the prompt for that airline and asks tier 2 for that tenant', async () => {
    const served = serve();
    await mount(served);
    fireEvent.click(within(tile('as')).getByRole('button', { name: 'Set up with AI' }));
    const input = screen.getByLabelText('Describe the airline or the change') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('Set up Fixture Alaska for CY27'));
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    await waitFor(() => expect(served.starts.length).toBe(1));
    expect(served.starts[0]).toEqual({
      prompt: 'Set up Fixture Alaska for CY27',
      tenant: 'as',
      dryRun: true,
    });
  });
});

describe('AC2: Reconfigure with AI', () => {
  it('prices the job first (dry run), starts it, shows progress, then the review of the cached UA job', async () => {
    const served = serve();
    await mount(served);
    await draftAndStart('Set up Fixture United for CY27');

    expect(served.starts[0]).toEqual({
      prompt: 'Set up Fixture United for CY27',
      tenant: null,
      dryRun: true,
    });
    const cost = estimated.costEstimate;
    const est = screen.getByRole('group', { name: 'Cost estimate' });
    expect(est.textContent).toContain(cost.model);
    expect(est.textContent).toContain(fmt.money(cost.usd));
    expect(est.textContent).toContain(String(cost.maxTokens));

    served.current.job = running;
    fireEvent.click(screen.getByRole('button', { name: 'Start job' }));
    await waitFor(() => expect(served.starts.length).toBe(2));
    expect(served.starts[1]).toEqual({ prompt: 'Set up Fixture United for CY27', tenant: null });
    await waitFor(() => expect(screen.getByText('Reading public filings')).toBeTruthy());
    const bar = screen.getByRole('progressbar', { name: 'Job progress' });
    expect(bar.getAttribute('value')).toBe(String(running.progress));
    const steps = screen.getByRole('list', { name: 'Reconfiguration steps' });
    expect([...steps.querySelectorAll('li')].map((li) => li.dataset['state'])).toEqual([
      'active',
      'todo',
      'todo',
      'todo',
    ]);
    expect(steps.querySelectorAll('li').length).toBe(PIPELINE.length);

    // tier 2 finishes: the next poll brings the review
    served.current.job = uaJob;
    await waitFor(() => expect(screen.getByRole('region', { name: 'Review' })).toBeTruthy(), {
      timeout: POLL_MS * 3,
    });
    expect([...steps.querySelectorAll('li')].map((li) => li.dataset['state'])).toEqual([
      'done',
      'done',
      'active',
      'todo',
    ]);
    const review = screen.getByRole('region', { name: 'Review' });
    const block = (n: string) => review.querySelector<HTMLElement>(`[data-block="${n}"]`)!;
    expect(block('plan').textContent).toContain(uaJob.plan!.tenant.name);
    expect(block('plan').textContent).toContain(uaJob.plan!.steps[0]!);
    expect(block('sources').textContent).toContain(uaJob.sources[0]!.title);
    expect(block('questions').textContent).toContain(uaJob.openQuestions[0]!.question);
    const cal = uaJob.calibration!;
    expect(block('calibration').textContent).toContain(cal.lines[0]!.metric);
    expect(block('calibration').textContent).toContain(fmt.pct(cal.lines[0]!.residual));
    expect(block('calibration').dataset['passed']).toBe('true');
    for (const d of uaJob.drafts) {
      expect(block('changesets').textContent).toContain(d.title);
      expect(block('changesets').textContent).toContain(`${d.changes} changes`);
      expect(block('changesets').textContent).toContain(d.summary);
    }

    // apply accepts the drafts tier 2 listed; nothing else is written
    fireEvent.click(within(review).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(served.applies.length).toBe(1));
    expect(served.applies[0]).toEqual({ drafts: uaJob.drafts.map((d) => d.kind) });
    await waitFor(() =>
      expect(document.querySelector('.gp-airlines-applied')?.textContent).toContain('Applied'),
    );
  }, 15000);

  it('keeps Apply disabled while a blocking question is open', async () => {
    const blocked = {
      ...uaJob,
      openQuestions: [{ ...uaJob.openQuestions[0]!, blocking: true }],
    } as ReconfigJob;
    await mount(serve(blocked));
    const apply = await screen.findByRole('button', { name: 'Apply' }, { timeout: 4000 });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('AC3: onboarding checklist', () => {
  it('shows the steps and states tier 2 sent on the job, and the count it sent, without deriving either', async () => {
    await mount(serve(uaJob));
    const list = await screen.findByRole('list', { name: 'Onboarding checklist' });
    await waitFor(() => expect(list.querySelectorAll('li').length).toBe(9), { timeout: 4000 });
    const items = [...list.querySelectorAll('li')];
    expect(items.map((li) => li.dataset['step'])).toEqual([...STEP_IDS]);
    expect(items.map((li) => li.querySelector('.gp-airlines-check-label')!.textContent)).toEqual(
      STEP_IDS.map((id) => stepLabel(id)),
    );
    expect(items.map((li) => li.dataset['state'])).toEqual([
      'done',
      'done',
      'done',
      'done',
      'review',
      'todo',
      'todo',
      'todo',
      'todo',
    ]);
    expect(within(items[4]!).getByText('In review')).toBeTruthy();
    expect(within(items[0]!).getByText('Done')).toBeTruthy();
    expect(within(items[8]!).getByText('To do')).toBeTruthy();
    expect(screen.getAllByText('4 of 9').length).toBe(2); // tile chip and panel header
  });

  it('prints what tier 2 sent even where the facts on the job would say otherwise', async () => {
    // Every fact is sourced and no question is open, yet tier 2 says org is in review, and counts 2 of 3 steps.
    const told = {
      ...uaJob,
      openQuestions: [],
      onboarding: {
        steps: [
          { id: 'tenant_record', state: 'done' },
          { id: 'org', state: 'review' },
          { id: 'steps_a_new_model_added', state: 'done' },
        ],
        done: 2,
        total: 3,
      },
    } as unknown as ReconfigJob;
    await mount(serve(told));
    const list = await screen.findByRole('list', { name: 'Onboarding checklist' });
    await waitFor(() => expect(list.querySelectorAll('li').length).toBe(3), { timeout: 4000 });
    expect([...list.querySelectorAll('li')].map((li) => li.dataset['state'])).toEqual([
      'done',
      'review',
      'done',
    ]);
    // an id the screen has no words for is shown by its own words
    expect(list.querySelectorAll('li')[2]!.textContent).toContain('Steps a new model added');
    expect(screen.getAllByText('2 of 3').length).toBe(2);
    expect(document.querySelector('progress[aria-label$="onboarding"]')!.getAttribute('max')).toBe(
      '3',
    );
  });
});

describe('AC4: values come from tier 2', () => {
  it('shows the tenant name, model and counts as sent, and no number the API did not send', async () => {
    await mount(serve());
    expect(within(tile(aa)).getByText('Fixture Air')).toBeTruthy();
    expect(tile(aa).textContent).toContain(`model ${tenants[0]!.modelVersionId}`);
    // before any job tier 2 has sent no step: the empty line, no checklist rows
    expect(document.querySelectorAll('.gp-airlines-checklist li').length).toBe(0);
    expect(screen.getByText('Draft an airline to see its onboarding steps.')).toBeTruthy();
  });
});

describe('G12: accessibility', () => {
  it('has no serious or critical axe violations', async () => {
    await mount(serve(uaJob));
    await screen.findByRole('region', { name: 'Review' }, { timeout: 4000 });
    const r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(
      r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.help}`),
    ).toEqual([]);
  });
});
