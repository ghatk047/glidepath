// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  solverRunFixtures,
  specFixtures,
} from '@glidepath/api-contract/testing';
import { fmt } from '@glidepath/ui/format';
import { viewStore } from '../../app/view-store';
import { useCommit, type CommitQueue } from '../../commit';
import { DataProvider, createDataClient, createServerState } from '../../data';
import { GlobalLayout } from '../../global/shell';
import { createSessionClient } from '../../session';
import Vps from './index';

// Spec ids verbatim; every value is read from the generated fixtures, never typed in.
const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const tenant = TenantSlug.parse(specFixtures.tenant);
const C = presetSnapshot('C');
const PRESET_C = ScenarioId.parse(C.scenarioId);
const cell = (id: string, member = '') => `${id}[${member}]`;
const num = (key: string) => C.cells[key] as number;

const members = specFixtures.members.dimensions;
const vpKeys = members['vp']!.map((m) => m.key as string);
const INFRA = vpKeys.find((k) => C.cells[cell('org.ss_flag', k)] === 1)!;
const others = vpKeys.filter((k) => k !== INFRA);
// The one domain row shared by three VPs in the preset (a row with dividers to move).
const SHARED = members['domain']!.find(
  (d) => C.cells[cell('org.dom_share', `${d.key as string},${vpKeys[0]!}`)] === 0.4,
)!.key as string;
const SOLO = members['domain']!.find(
  (d) => C.cells[cell('org.dom_share', `${d.key as string},${vpKeys[0]!}`)] === 1,
)!.key as string;
const memoLess = [SHARED, SOLO];
const OUTLAY: Record<string, number> = { [SHARED]: 207.9, [SOLO]: 96.8 };
const domainView = {
  v: WS_PROTOCOL_VERSION as 1,
  type: 'view' as const,
  view: 'vps.domain_outlay' as const,
  params: {},
  seq: null,
  payload: { domains: memoLess.map((key) => ({ key, value: OUTLAY[key]! })) },
};

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  viewStore.getState().setTheme('cruise');
});
afterAll(() => server.close());

interface Served {
  posts: ChangesetRequest[];
  solverStarts: unknown[];
}

function serve(solverRun: object = solverRunFixtures.vp_feasible): Served {
  const posts: ChangesetRequest[] = [];
  const solverStarts: unknown[] = [];
  const preset = specFixtures.scenarios.scenarios;
  server.use(
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, () =>
      HttpResponse.json({ tenants: [{ ...fx.tenants.response.tenants[0]!, slug: tenant }] }),
    ),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(specFixtures.bundle)),
    http.get(`${BASE}${apiRoutes.members.path}`, () => HttpResponse.json(specFixtures.members)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () => HttpResponse.json({ scenarios: preset })),
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
    http.post(`${BASE}${apiRoutes.solverRunStart.path}`, async ({ request }) => {
      solverStarts.push(await request.json());
      return HttpResponse.json(solverRun, { status: 201 });
    }),
    http.get(`${BASE}${apiRoutes.solverRunGet.path}`, () =>
      HttpResponse.json(solverRunFixtures.vp_feasible),
    ),
  );
  return { posts, solverStarts };
}

let queueRef: CommitQueue | null = null;
function GrabQueue() {
  const q = useCommit();
  useEffect(() => {
    queueRef = q;
  }, [q]);
  return null;
}

async function mount(solverRun?: object) {
  const served = serve(solverRun);
  const mock = createMockSession({ views: [domainView] });
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
        module="vps"
        session={session}
        glass={{ frameSampling: false }}
      >
        <GrabQueue />
        <Vps />
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
    history: createMemoryHistory({ initialEntries: [`/${tenant}/${PRESET_C}/vps`] }),
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
  const flush = async () => {
    await act(async () => {
      await queueRef!.flush();
    });
  };
  await until(() =>
    expect(document.querySelectorAll('[data-vp] [data-value]').length).toBeGreaterThan(0),
  );
  return { ...served, mock, session, settle, until, flush, view };
}

const card = (vp: string) => document.querySelector<HTMLElement>(`article[data-vp="${vp}"]`)!;
const dv = (root: ParentNode, sel: string) =>
  root.querySelector<HTMLElement>(sel)?.dataset['value'];
const row = (domain: string) => document.querySelector<HTMLElement>(`li[data-domain="${domain}"]`)!;
const handles = (domain: string) => [
  ...row(domain).querySelectorAll<HTMLElement>('[role="slider"]'),
];

describe('AC1: controls', () => {
  it('g.vp_target_method segmented (Proportional / Equal / Manual) and g.chargeback_on toggle commit', async () => {
    const t = await mount();
    const group = await screen.findByRole('group', { name: 'Target method' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Proportional', 'Equal', 'Manual']);
    // The pressed option is the value tier 2 pushed.
    await t.until(() =>
      expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(
        buttons.map((_, i) => String(num(cell('g.vp_target_method')) === i + 1)),
      ),
    );

    fireEvent.click(within(group).getByRole('button', { name: 'Equal' }));
    const toggle = screen.getByRole('switch', { name: 'Chargeback' }) as HTMLInputElement;
    await t.until(() => expect(toggle.checked).toBe(num(cell('g.chargeback_on')) === 1));
    fireEvent.click(toggle);
    await t.flush();
    await waitFor(() => expect(t.posts.length).toBeGreaterThan(0));
    const changes = t.posts.flatMap((p) => p.changes) as { key: string; value: number }[];
    expect(changes).toContainEqual(
      expect.objectContaining({ key: 'g.vp_target_method', value: 2 }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ key: 'g.chargeback_on', value: toggle.checked ? 0 : 1 }),
    );
  });
});

describe('AC2: VP cards', () => {
  it('one card per vp member with outlay, bullet, net, bar, target, growth, gap equal to the fixture', async () => {
    await mount();
    expect(document.querySelectorAll('article[data-vp]')).toHaveLength(vpKeys.length);
    for (const vp of vpKeys) {
      const c = card(vp);
      const label = members['vp']!.find((m) => m.key === vp)!.label;
      expect(within(c).getByRole('heading', { name: label })).toBeTruthy();
      const values = [...c.querySelectorAll<HTMLElement>('[data-value]')].map((e) =>
        Number(e.dataset['value']),
      );
      for (const id of ['vp.outlay', 'vp.net', 'vp.bar', 'vp.target', 'vp.growth', 'vp.gap']) {
        expect(values).toContain(num(cell(id, vp)));
      }
      const bullet = c.querySelector<HTMLElement>('.gp-vps-bullet')!;
      expect(bullet.dataset['net']).toBe(String(num(cell('vp.net', vp))));
      expect(bullet.dataset['bar']).toBe(String(num(cell('vp.bar', vp))));
      expect(bullet.getAttribute('role')).toBe('img');
      // Gap chip in tier 2's sign: the fixture gaps are all short.
      expect(c.querySelector('.gp-chip')?.getAttribute('data-status')).toBe(
        num(cell('vp.gap', vp)) < 0 ? 'short' : 'clear',
      );
      expect(c.querySelector('.gp-chip-text')?.textContent).toContain(
        fmt.money(Math.abs(num(cell('vp.gap', vp)))),
      );
    }
  });

  it("'Shared owner' chip comes from org.ss_flag", async () => {
    await mount();
    expect(within(card(INFRA)).getByText('Shared owner')).toBeTruthy();
    for (const vp of others) expect(within(card(vp)).queryByText('Shared owner')).toBeNull();
  });
});

describe('AC3: who owns what', () => {
  it('rows from the vps.domain_outlay view; drag previews both cells at once, release commits, numbers glow', async () => {
    const t = await mount();
    await t.until(() => expect(handles(SHARED).length).toBe(vpKeys.length - 1));
    expect(document.querySelectorAll('li[data-domain]')).toHaveLength(memoLess.length);
    expect(dv(row(SHARED), '.gp-vps-row-outlay [data-value]')).toBe(String(OUTLAY[SHARED]));

    const h = handles(SHARED)[0]!;
    const before = [vpKeys[0]!, vpKeys[1]!].map((vp) =>
      num(cell('org.dom_share', `${SHARED},${vp}`)),
    );
    fireEvent.keyDown(h, { key: 'ArrowRight' });
    await t.settle();
    const preview = t.mock.sentOf('preview').at(-1)!;
    const sent = Object.fromEntries(preview.changes.map((c) => [`${c.var}[${c.member}]`, c.value]));
    // The whole row is one frame, the moved pair differs from the pushed values.
    expect(Object.keys(sent).sort()).toEqual(
      vpKeys.map((vp) => cell('org.dom_share', `${SHARED},${vp}`)).sort(),
    );
    expect(sent[cell('org.dom_share', `${SHARED},${vpKeys[0]!}`)]).toBeGreaterThan(before[0]!);
    expect(t.posts).toHaveLength(0); // previewing writes nothing

    fireEvent.keyUp(h, { key: 'ArrowRight' });
    await t.flush();
    await waitFor(() => expect(t.posts).toHaveLength(1));
    const changes = t.posts[0]!.changes as { key: string; member: string; value: number }[];
    expect(changes.map((c) => c.key)).toEqual(vpKeys.map(() => 'org.dom_share'));
    expect(changes.map((c) => c.member).sort()).toEqual(
      vpKeys.map((vp) => `${SHARED},${vp}`).sort(),
    );

    // Tier 2 pushes new numbers: the VP outlay and the domain outlay glow.
    expect(card(vpKeys[0]!).querySelector('[data-glow]')).toBeNull();
    await t.mock.replay([
      {
        v: WS_PROTOCOL_VERSION,
        type: 'delta',
        seq: null,
        cells: { [cell('vp.outlay', vpKeys[0]!)]: 1 },
      },
      {
        ...domainView,
        payload: {
          domains: [
            { key: SHARED, value: 1 },
            { key: SOLO, value: OUTLAY[SOLO]! },
          ],
        },
      },
    ]);
    await t.settle();
    expect(card(vpKeys[0]!).querySelector('[data-glow="true"]')).not.toBeNull();
    expect(row(SHARED).querySelector('[data-glow="true"]')).not.toBeNull();
    expect(row(SOLO).querySelector('[data-glow="true"]')).toBeNull();
  });
});

describe('AC4: chargeback and Every VP clears?', () => {
  it('usage key bar (vp.usage), metered override and pool.shared toggles', async () => {
    const t = await mount();
    const usage = Object.fromEntries(vpKeys.map((vp, i) => [cell('vp.usage', vp), 0.1 + i / 10]));
    await t.mock.replay([{ v: WS_PROTOCOL_VERSION, type: 'delta', seq: null, cells: usage }]);
    await t.until(() =>
      expect(screen.getByTestId('usage-key').children.length).toBe(vpKeys.length),
    );
    const segs = [...screen.getByTestId('usage-key').children] as HTMLElement[];
    expect(segs.map((s) => Number(s.dataset['value']))).toEqual(Object.values(usage));
    expect(segs[0]!.textContent).toBe(fmt.pct(Object.values(usage)[0]!));

    // pool toggles: value follows pool.shared; a click commits the opposite
    const pool = members['pool']!.find((p) => C.cells[cell('pool.shared', p.key as string)] === 1)!;
    const sw = screen.getByRole('switch', { name: `${pool.label} is shared` }) as HTMLInputElement;
    await t.until(() => expect(sw.checked).toBe(true));
    fireEvent.click(sw);
    await t.flush();
    await waitFor(() => expect(t.posts.length).toBeGreaterThan(0));
    expect(t.posts.flatMap((p) => p.changes)).toContainEqual(
      expect.objectContaining({ key: 'pool.shared', member: pool.key, value: 0 }),
    );

    // org.usage_override_on shows the per-VP override cells only when tier 2 says it is on
    expect(screen.queryByRole('list', { name: 'Metered usage keys' })).toBeNull();
    await t.mock.replay([
      {
        v: WS_PROTOCOL_VERSION,
        type: 'delta',
        seq: null,
        cells: { [cell('org.usage_override_on')]: 1 },
      },
    ]);
    await t.until(() =>
      expect(screen.getByRole('list', { name: 'Metered usage keys' })).toBeTruthy(),
    );
    expect(screen.getByRole('switch', { name: 'Use metered usage keys' })).toBeTruthy();
  });

  it('shows an empty state with a run action, then the VP-feasible result (net, binding)', async () => {
    const binding = vpKeys[1]!;
    const run = {
      ...solverRunFixtures.vp_feasible,
      result: {
        ...solverRunFixtures.vp_feasible.result!,
        binding: [{ constraint: `per_vp[${binding}]`, shadowPrice: 1 }],
      },
    };
    const t = await mount(run);
    const panel = screen.getByRole('region', { name: 'Every VP clears?' });
    expect(within(panel).queryByTestId('feasible-result')).toBeNull();
    const go = within(panel).getByRole('button', { name: /Find a plan/ });
    fireEvent.click(go);
    await waitFor(() => expect(within(panel).getByTestId('feasible-result')).toBeTruthy());
    expect(t.solverStarts).toEqual([
      expect.objectContaining({
        scenarioId: PRESET_C,
        spec: expect.objectContaining({ problem: 'vp_feasible' }),
      }),
    ]);
    const out = within(panel).getByTestId('feasible-result');
    const net = run.result!.metrics['res.net[]']!;
    expect(out.querySelector('strong')?.dataset['value']).toBe(String(net));
    expect(out.textContent).toContain(fmt.money(net));
    expect(out.textContent).toContain(
      `${members['vp']!.find((m) => m.key === binding)!.label} binding`,
    );
    expect(within(panel).getByRole('button', { name: 'Open in Path' })).toBeTruthy();
  });
});

describe('AC5: VR01 in tier 2 words, values from the session', () => {
  it('shows VR01 warnings exactly as sent, at the row they point at or above the rows', async () => {
    const t = await mount();
    await t.until(() => expect(handles(SHARED).length).toBeGreaterThan(0));
    const rowMsg = 'Application delivery shares add up to 95%, not 100%.';
    const panelMsg = 'Every domain row must add up to 100%.';
    await t.mock.replay([
      {
        v: WS_PROTOCOL_VERSION,
        type: 'warnings',
        seq: 100,
        violations: [
          {
            rule: 'VR01',
            cells: [cell('org.dom_share', `${SHARED},${vpKeys[0]!}`)],
            severity: 'warning',
            message: rowMsg,
          },
          { rule: 'VR01', cells: [], severity: 'error', message: panelMsg },
        ],
      },
    ]);
    await t.until(() => expect(screen.getByText(rowMsg)).toBeTruthy());
    expect(row(SHARED).textContent).toContain(rowMsg);
    expect(row(SOLO).textContent).not.toContain(rowMsg);
    const above = screen.getByText(panelMsg);
    expect(row(SHARED).contains(above)).toBe(false);
    expect(above.closest('[role="alert"]')).not.toBeNull();
    // and clears when tier 2 sends an empty list
    await t.mock.replay([{ v: WS_PROTOCOL_VERSION, type: 'warnings', seq: 101, violations: [] }]);
    await t.until(() => expect(screen.queryByText(rowMsg)).toBeNull());
  });

  it('the module computes nothing: no arithmetic helpers in its sources', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.tsx'));
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/Math\.|toFixed|toLocaleString|Intl\.|\.reduce\(/);
    }
  });
});

describe('G12: accessibility', () => {
  it('has no serious or critical axe violations', async () => {
    const t = await mount();
    await t.until(() => expect(handles(SHARED).length).toBeGreaterThan(0));
    const result = await axe.run(t.view.container, {
      rules: { 'color-contrast': { enabled: false } }, // jsdom has no layout or computed colours
    });
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
