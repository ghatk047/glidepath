// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  BenchmarkGap,
  SourcingMembers,
  SourcingParams,
  VendorSpend,
  apiRoutes,
  type ChangesetRequest,
  type ConsolidationRequest,
} from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  presetSnapshot,
  sourcingRouteFixtures,
  specFixtures,
} from '@glidepath/api-contract/testing';
import { fmt } from '@glidepath/ui/format';
import { useCommit, type CommitQueue } from '../../commit';
import { DataProvider, createDataClient, createServerState } from '../../data';
import { GlobalLayout } from '../../global/shell';
import { createSessionClient } from '../../session';
import Sourcing from './index';

// Every value is read from the contract fixtures (or the variations below), never typed in the assertions.
const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const sfx = sourcingRouteFixtures;
const tenant = TenantSlug.parse(specFixtures.tenant);
const PRESET_C = ScenarioId.parse(presetSnapshot('C').scenarioId);

// An aggregate bucket served between named vendors: the screen must still list it last.
const BUCKET = {
  ...sfx.sourcingVendors.response.vendors[2]!,
  vendor: 'Various',
  vendorKey: null,
  aggregate: true,
  spend: 5,
  share: 0.05,
};
const VENDORS = VendorSpend.parse({
  ...sfx.sourcingVendors.response,
  vendors: [sfx.sourcingVendors.response.vendors[0]!, BUCKET, ...sfx.sourcingVendors.response.vendors.slice(1)],
});
// Levers that already go beyond the benchmark gap: negative headroom.
const NEGATIVE = { leverSavings: 70.4, headroom: -68.9 };
const BENCHMARKS = BenchmarkGap.parse({
  ...sfx.sourcingBenchmarks.response,
  totals: { ...sfx.sourcingBenchmarks.response.totals, ...NEGATIVE },
});
// Parameters in the seed's groups (one panel each).
const { params: PARAMS } = SourcingParams.parse({ params: [
  { key: 'act_now_days', label: 'Act-now window', group: 'renewals', value: 120, unit: 'days', min: 30, max: 365, step: 15, sort: 10 },
  { key: 'capture_pct', label: 'Capturable share', group: 'benchmarks', value: 0.5, unit: '%', min: 0, max: 1, step: 0.05, sort: 20 },
  { key: 'concentration_cap_pct', label: 'Concentration cap', group: 'consolidation', value: 0.35, unit: '%', min: 0.15, max: 0.6, step: 0.05, sort: 30 },
  { key: 'max_moves', label: 'Maximum moves', group: 'consolidation', value: 10, unit: 'moves', min: 1, max: 20, step: 1, sort: 40 },
] });

// Stored rows of the edited members: the contract fixture and a benchmark row for the first benchmarked line.
const CONTRACTS = sfx.sourcingMembers.response;
const BENCH_ROWS = SourcingMembers.parse({
  dim: 'benchmark',
  members: [
    {
      key: BENCHMARKS.rows[0]!.benchmark,
      label: BENCHMARKS.rows[0]!.label,
      attrs: { unit: BENCHMARKS.rows[0]!.unit, lines: [BENCHMARKS.rows[0]!.line], p25_usd: BENCHMARKS.rows[0]!.p25, median_usd: BENCHMARKS.rows[0]!.median, p75_usd: BENCHMARKS.rows[0]!.p75, source: 'test', confidence: 'M' },
      sort: 3,
      active: true,
    },
  ],
});

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

interface Served {
  posts: ChangesetRequest[];
  runs: ConsolidationRequest[];
  /** URLs of `GET /sourcing/params`. */
  paramReads: string[];
}

function serve(opts: { refuse?: string } = {}): Served {
  const served: Served = { posts: [], runs: [], paramReads: [] };
  // What tier 2 holds: an accepted structural change on sourcing_param replaces the member's value.
  let held = PARAMS;
  server.use(
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, () =>
      HttpResponse.json({ tenants: [{ ...fx.tenants.response.tenants[0]!, slug: tenant }] }),
    ),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(specFixtures.bundle)),
    http.get(`${BASE}${apiRoutes.members.path}`, () => HttpResponse.json(specFixtures.members)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () =>
      HttpResponse.json({ scenarios: specFixtures.scenarios.scenarios }),
    ),
    http.get(`${BASE}${apiRoutes.scenarioInputs.path}`, ({ params }) =>
      HttpResponse.json({ scenarioId: String(params['id']), version: 0, inputs: [], overrides: [] }),
    ),
    http.get(`${BASE}${apiRoutes.scenarioCalc.path}`, ({ params }) =>
      HttpResponse.json({ ...fx.scenarioCalc.response, scenarioId: String(params['id']) }),
    ),
    http.get(`${BASE}${apiRoutes.changesetHistory.path}`, ({ params }) =>
      HttpResponse.json({ scenarioId: String(params['id']), changesets: [], nextCursor: null }),
    ),
    http.post(`${BASE}${apiRoutes.changesetApply.path}`, async ({ request }) => {
      const body = (await request.json()) as ChangesetRequest;
      served.posts.push(body);
      if (opts.refuse)
        return HttpResponse.json(
          { type: 'about:blank', title: 'Unprocessable', status: 422, detail: opts.refuse },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        );
      for (const c of body.changes)
        if (c.target === 'structural' && c.key === 'sourcing_param' && c.value) {
          const attrs = c.value['attrs'] as { value: number };
          held = held.map((p) => (p.key === c.member ? { ...p, value: attrs.value } : p));
        }
      return HttpResponse.json({
        ...fx.changesetApply.response,
        scenarioId: body.scenarioId,
        version: body.baseVersion + 1,
        forkedFrom: undefined,
      });
    }),
    http.get(`${BASE}${apiRoutes.sourcingVendors.path}`, () => HttpResponse.json(VENDORS)),
    http.get(`${BASE}${apiRoutes.sourcingRenewals.path}`, () =>
      HttpResponse.json(sfx.sourcingRenewals.response),
    ),
    http.get(`${BASE}${apiRoutes.sourcingBenchmarks.path}`, () => HttpResponse.json(BENCHMARKS)),
    http.get(`${BASE}${apiRoutes.sourcingParams.path}`, ({ request }) => {
      served.paramReads.push(request.url);
      return HttpResponse.json({ params: held });
    }),
    http.get(`${BASE}${apiRoutes.sourcingMembers.path}`, ({ request }) =>
      HttpResponse.json(new URL(request.url).searchParams.get('dim') === 'benchmark' ? BENCH_ROWS : CONTRACTS),
    ),
    http.post(`${BASE}${apiRoutes.sourcingConsolidation.path}`, async ({ request }) => {
      served.runs.push((await request.json()) as ConsolidationRequest);
      return HttpResponse.json(sfx.sourcingConsolidation.response);
    }),
  );
  return served;
}

let queueRef: CommitQueue | null = null;
function GrabQueue() {
  const q = useCommit();
  useEffect(() => {
    queueRef = q;
  }, [q]);
  return null;
}

async function mount(opts: { refuse?: string } = {}) {
  const served = serve(opts);
  const mock = createMockSession({ views: [] });
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
      <GlobalLayout tenant={tenant} scenarioId={PRESET_C} module="sourcing" session={session} glass={{ frameSampling: false }}>
        <GrabQueue />
        <Sourcing />
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
    history: createMemoryHistory({ initialEntries: [`/${tenant}/${PRESET_C}/sourcing`] }),
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
  await until(() => {
    expect(document.querySelectorAll('[data-vendor]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-move]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-param]').length).toBe(PARAMS.length);
  });
  return { ...served, settle, until, flush, view };
}

const panel = (id: string) => screen.getByTestId(`sourcing-${id}`);
const kpi = (root: HTMLElement, id: string) => root.querySelector(`[data-kpi="${id}"] dd`)?.textContent;

describe('SRC-11 layout', () => {
  it('four panels in a 2x2 grid, each with a tour anchor', async () => {
    await mount();
    const grid = screen.getByTestId('sourcing-grid');
    for (const id of ['vendors', 'renewals', 'benchmarks', 'consolidation']) {
      const p = within(grid).getByTestId(`sourcing-${id}`);
      expect(p.getAttribute('data-tour')).toBe(`sourcing-${id}`);
    }
  });
});

describe('F5 vendor spend', () => {
  it('KPI tiles and rows are tier 2 values; aggregate buckets come last, muted, with a note', async () => {
    await mount();
    const p = panel('vendors');
    const t = VENDORS.totals;
    expect(kpi(p, 'spend')).toBe(fmt.money(t.thirdPartySpend));
    expect(kpi(p, 'hhi')).toBe(fmt.fte(t.hhi));
    expect(kpi(p, 'top5')).toBe(fmt.pct(t.top5Share));
    expect(kpi(p, 'preferred')).toBe(fmt.pct(t.preferredShare));
    const rows = [...p.querySelectorAll<HTMLElement>('[data-vendor]')];
    const named = VENDORS.vendors.filter((v) => !v.aggregate);
    expect(rows.map((r) => r.dataset['vendor'])).toEqual([
      ...named.map((v) => v.vendorKey ?? v.vendor),
      BUCKET.vendor,
    ]);
    const last = rows.at(-1)!;
    expect(last.hasAttribute('data-muted')).toBe(true);
    expect(last.hasAttribute('data-aggregate')).toBe(true);
    expect(rows.slice(0, -1).every((r) => !r.hasAttribute('data-muted'))).toBe(true);
    expect(within(p).getByText(/left out of HHI/)).toBeTruthy();
    // Values as tier 2 sent them, formatted only.
    expect(rows[0]!.textContent).toContain(fmt.money(named[0]!.spend));
    expect(within(rows[0]!).getByText('pref')).toBeTruthy();
    for (const l of named[0]!.levers) expect(within(rows[0]!).getByText(l)).toBeTruthy();
  });
});

describe('F6 renewal calendar', () => {
  it('status counts, one timeline bar per month of the window, act-now first', async () => {
    await mount();
    const p = panel('renewals');
    const r = sfx.sourcingRenewals.response;
    for (const [s, n] of Object.entries(r.totals.byStatus))
      expect(p.querySelector(`[data-status-count="${s}"]`)?.textContent).toBe(String(n));
    expect(p.querySelectorAll('[data-month]')).toHaveLength(r.byMonth.length);
    const rows = [...p.querySelectorAll<HTMLElement>('li[data-contract]')];
    expect(rows[0]!.dataset['status']).toBe('act_now');
    expect(rows).toHaveLength(r.renewals.length);
    expect(kpi(p, 'capture')).toBe(fmt.money(r.totals.capture));
    const first = r.renewals.find((x) => x.status === 'act_now')!;
    expect(rows[0]!.textContent).toContain(fmt.money(first.capture));
  });
});

describe('F7 should-cost benchmarks', () => {
  it('negative headroom reads as levers going beyond the gap, never as a negative number', async () => {
    await mount();
    const p = panel('benchmarks');
    const h = within(p).getByTestId('sourcing-headroom');
    expect(h.textContent).toBe(`Levers already go ${fmt.money(68.9)} beyond the benchmark gap`);
    expect(h.dataset['sign']).toBe('beyond');
    expect(kpi(p, 'levers')).toBe(fmt.money(NEGATIVE.leverSavings));
  });

  it('each row has a p25-p75 range bar with the unit cost marker, from tier 2 values', async () => {
    await mount();
    const p = panel('benchmarks');
    const rows = BENCHMARKS.rows;
    const bars = [...p.querySelectorAll<HTMLElement>('.gp-src-range')];
    expect(bars).toHaveLength(rows.length);
    bars.forEach((b, i) => {
      expect(b.style.getPropertyValue('--p25')).toBe(String(rows[i]!.p25));
      expect(b.style.getPropertyValue('--p75')).toBe(String(rows[i]!.p75));
      expect(b.style.getPropertyValue('--cost')).toBe(String(rows[i]!.unitCost));
      expect(b.hasAttribute('data-over')).toBe(rows[i]!.gapPerUnit > 0);
    });
  });
});

describe('F8 vendor consolidation', () => {
  it('runs on load; moves, HHI before/after and binding constraints are tier 2 values', async () => {
    const t = await mount();
    expect(t.runs).toEqual([{ scenarioId: PRESET_C }]);
    const p = panel('consolidation');
    const c = sfx.sourcingConsolidation.response;
    expect(p.querySelector('[data-hhi="before"]')?.textContent).toBe(fmt.fte(c.hhiBefore));
    expect(p.querySelector('[data-hhi="after"]')?.textContent).toBe(fmt.fte(c.hhiAfter));
    expect(p.querySelectorAll('[data-move]')).toHaveLength(c.moves.length);
    expect(p.querySelector('[data-move="0"]')?.textContent).toContain(fmt.money(c.moves[0]!.netBenefit));
    for (const b of c.binding) expect(p.querySelector(`[data-binding="${b.param}"]`)).toBeTruthy();
    expect(kpi(p, 'saving')).toBe(fmt.money(c.totals.annualSaving));
  });
});

describe('parameter edits', () => {
  it('a stepper commits the whole sourcing_param row as a structural change; the views read again and consolidation re-runs', async () => {
    const t = await mount();
    const p = panel('consolidation');
    const cap = PARAMS.find((x) => x.key === 'concentration_cap_pct')!;
    const reads = t.paramReads.length;
    fireEvent.click(within(p).getByRole('button', { name: `Increase ${cap.label}` }));
    // The stepper holds the typed value until tier 2 answers.
    expect(within(p).getByRole('textbox', { name: cap.label })).toHaveProperty('value', fmt.pct(0.4, { digits: 0 }));
    await t.flush();
    await t.until(() => expect(t.posts).toHaveLength(1));
    expect(t.posts[0]!.changes).toEqual([
      {
        target: 'structural',
        key: 'sourcing_param',
        member: cap.key,
        value: {
          label: cap.label,
          attrs: { value: 0.4, unit: cap.unit, min: cap.min, max: cap.max, step: cap.step, group: cap.group },
          sort: cap.sort,
          active: true,
        },
      },
    ]);
    await t.until(() => {
      expect(t.runs).toHaveLength(2);
      expect(t.paramReads.length).toBeGreaterThan(reads);
    });
    // Tier 2's new value stays on the stepper (no snap back to the old one).
    expect(within(p).getByRole('textbox', { name: cap.label })).toHaveProperty('value', fmt.pct(0.4, { digits: 0 }));
    expect(p.querySelector(`[data-param="${cap.key}"]`)?.hasAttribute('data-pending')).toBe(false);
  });

  it('a burst of clicks posts the last value once and reads again once', async () => {
    const t = await mount();
    const p = panel('consolidation');
    const moves = PARAMS.find((x) => x.key === 'max_moves')!;
    const more = within(p).getByRole('button', { name: `Increase ${moves.label}` });
    fireEvent.click(more);
    fireEvent.click(more);
    fireEvent.click(more);
    await t.flush();
    await t.until(() => expect(t.runs).toHaveLength(2));
    await t.settle();
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0]!.changes).toHaveLength(1);
    expect((t.posts[0]!.changes[0]!.value as { attrs: { value: number } }).attrs.value).toBe(moves.value + 3);
    expect(t.runs).toHaveLength(2);
  });

  it("a refused edit shows tier 2's line and the stepper falls back to tier 2's value", async () => {
    const detail = 'sourcing_param[max_moves]: value 11 is outside [1, 10]';
    const t = await mount({ refuse: detail });
    const p = panel('consolidation');
    const moves = PARAMS.find((x) => x.key === 'max_moves')!;
    fireEvent.click(within(p).getByRole('button', { name: `Increase ${moves.label}` }));
    await t.flush();
    await t.until(() => expect(within(p).getByRole('alert').textContent).toBe(detail));
    expect(within(p).getByRole('textbox', { name: moves.label })).toHaveProperty('value', String(moves.value));
    expect(t.runs).toHaveLength(1);
  });

  it('each panel shows its own group of parameters', async () => {
    await mount();
    const keys = (id: string) => [...panel(id).querySelectorAll<HTMLElement>('[data-param]')].map((e) => e.dataset['param']);
    expect(keys('renewals')).toEqual(['act_now_days']);
    expect(keys('benchmarks')).toEqual(['capture_pct']);
    expect(keys('consolidation')).toEqual(['concentration_cap_pct', 'max_moves']);
    expect(keys('vendors')).toEqual([]);
  });
});

describe('member edits', () => {
  it("a renewal row's target cut and notice days commit the whole contract row", async () => {
    const t = await mount();
    const p = panel('renewals');
    const row = CONTRACTS.members[0]!;
    const renewal = sfx.sourcingRenewals.response.renewals.find((r) => r.contract === row.key)!;
    fireEvent.click(within(p).getByRole('button', { name: new RegExp(`^Edit terms of ${renewal.vendor}`) }));
    await t.until(() => expect(p.querySelector(`[data-member="${row.key}"]`)).toBeTruthy());
    fireEvent.click(within(p).getByRole('button', { name: 'Increase Target cut' }));
    fireEvent.change(within(p).getByRole('textbox', { name: 'Notice days' }), { target: { value: '120' } });
    fireEvent.blur(within(p).getByRole('textbox', { name: 'Notice days' }));
    await t.flush();
    await t.until(() => expect(t.posts).toHaveLength(1));
    // One row, both edits (latest wins per member in the queue), every other attribute carried over.
    expect(t.posts[0]!.changes).toEqual([
      {
        target: 'structural',
        key: 'contract',
        member: row.key,
        value: { label: row.label, attrs: { ...row.attrs, target_cut_pct: 0.09, notice_days: 120 }, sort: row.sort, active: row.active },
      },
    ]);
    await t.until(() => expect(t.runs).toHaveLength(2));
  });

  it("a benchmark's p25, median and p75 commit the whole benchmark row", async () => {
    const t = await mount();
    const p = panel('benchmarks');
    const row = BENCH_ROWS.members[0]!;
    fireEvent.click(within(p).getByRole('button', { name: new RegExp(`^Edit benchmark of ${row.label}`) }));
    await t.until(() => expect(p.querySelector(`[data-member="${row.key}"]`)).toBeTruthy());
    const median = within(p).getByRole('textbox', { name: 'Median' });
    fireEvent.change(median, { target: { value: '12' } });
    fireEvent.blur(median);
    await t.flush();
    await t.until(() => expect(t.posts).toHaveLength(1));
    expect(t.posts[0]!.changes).toEqual([
      {
        target: 'structural',
        key: 'benchmark',
        member: row.key,
        value: { label: row.label, attrs: { ...row.attrs, median_usd: 12 }, sort: row.sort, active: row.active },
      },
    ]);
  });
});

describe('G1: no arithmetic in tier 1', () => {
  it('module sources hold no maths on business numbers', () => {
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
    const result = await axe.run(t.view.container, {
      rules: { 'color-contrast': { enabled: false } }, // jsdom has no layout or computed colours
    });
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
