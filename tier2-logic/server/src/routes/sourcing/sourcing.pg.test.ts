import { BenchmarkGap, PROBLEM_CONTENT_TYPE, RenewalCalendar, SourcingParams, UserId, VendorSpend, sourcingRoutes } from '@glidepath/api-contract';
import { aaSeed } from '@glidepath/testkit';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app/app';
import type { AppEnv } from '../../app/tenant';
import { captureLogger } from '../../app/testing/fixtures';
import { specBundleFromDir } from '../read/spec-source';
import { AA_ID, ANA, BOB, CAROL, MINE, ZZ_SCENARIO, asUser, presetId, startAaDatabase } from '../read/testing/aa-db';
import type { AaDatabase } from '../read/testing/aa-db';
import { seedAaSourcing } from './testing/sourcing-seed';
import type { SourcingSeedDims } from './testing/sourcing-seed';

/** SRC-07 acceptance on the seeded AA tenant (pg-local, app role, RLS on). */
let env: AaDatabase;
let app: Hono<AppEnv>;
let dims: SourcingSeedDims;

const ana = asUser(ANA);
const get = (path: string, who = ana) => app.request(path, { headers: who.headers });
const path = (route: keyof typeof sourcingRoutes, scenario?: string, tenant = 'aa') =>
  `${sourcingRoutes[route].path.replace(':tenant', tenant)}${scenario === undefined ? '' : `?scenario=${scenario}`}`;
const C = () => presetId('C');

async function body<T>(res: Response, schema: { parse: (v: unknown) => T }): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(200);
  return schema.parse(await res.json());
}

beforeAll(async () => {
  env = await startAaDatabase();
  dims = await seedAaSourcing(env.database.url, AA_ID, ANA);
  const { logger } = captureLogger();
  app = createApp({
    logger,
    db: env.app,
    authenticate: (c) => {
      const u = c.req.header('x-test-user');
      return u ? UserId.parse(u) : null;
    },
    membership: env.membership,
    specBundle: specBundleFromDir(),
  });
}, 180_000);

afterAll(() => env?.close());

describe('SRC-07 sourcing routes answer their contract schema for scenario C', () => {
  it('GET vendors: the spend cube reconciles to the third-party baseline of the seed', async () => {
    const v = await body(await get(path('sourcingVendors', C())), VendorSpend);
    const seed = await aaSeed();
    const thirdParty = new Set((seed.dimensionMembers.pool ?? []).filter((p) => p.third_party === 1).map((p) => p.id));
    const expected = (seed.dimensionMembers.line ?? [])
      .filter((l) => l.in_scope === 1 && l.memo === 0 && thirdParty.has(String(l.pool)))
      .reduce((s, l) => s + (Number(l.qty) * Number(l.unit_cost_usd)) / 1e6, 0);
    expect(Math.abs(v.totals.thirdPartySpend - expected)).toBeLessThan(1e-6);
    expect(v.scenarioId).toBe(C());
    expect(v.year).toBe('fy26');
    // the aggregate buckets (vendor_bucket) come last and are not counted as vendors
    expect(v.vendors.length).toBe(v.totals.vendorCount + dims.vendor_bucket.length);
    expect(v.vendors.slice(v.totals.vendorCount).map((x) => x.vendor).sort()).toEqual(dims.vendor_bucket.map((b) => String(b.vendor_name)).sort());
    expect(v.vendors.filter((x) => x.preferred).length).toBe(6);
    expect(v.vendors.find((x) => x.vendorKey === 'dxc')).toMatchObject({ preferred: true });
  });

  it('GET renewals: every contract, statuses counted, the window month by month', async () => {
    const r = await body(await get(path('sourcingRenewals', C())), RenewalCalendar);
    expect(r.asOf).toBe('2026-12-01');
    expect(r.planYear).toBe('fy27');
    expect(r.totals.contracts).toBe(dims.contract.length);
    expect(Object.values(r.totals.byStatus).reduce((a, b) => a + b, 0)).toBe(dims.contract.length);
    expect(r.byMonth).toHaveLength(24);
    expect(r.renewals.find((x) => x.contract === 'c_dxc_msa')).toMatchObject({ vendorKey: 'dxc', renewalMonth: '2027-09' });
    // auto-renew and past its notice deadline: renews unchanged, nothing captured
    expect(r.renewals.find((x) => x.contract === 'c_sap')).toMatchObject({ status: 'overdue', capture: 0 });
  });

  it('GET benchmarks: gaps against the median, headroom after the levers of scenario C', async () => {
    const b = await body(await get(path('sourcingBenchmarks', C())), BenchmarkGap);
    expect(b.rows.length).toBeGreaterThan(0);
    expect(b.rows.every((x) => x.percentile === 'median')).toBe(true);
    expect(Math.abs(b.totals.headroom - (b.totals.capturable - b.totals.leverSavings))).toBeLessThan(1e-9);
    expect(b.totals.leverSavings).toBeGreaterThan(0);
  });

  it('GET params: the sourcing_param members, with or without a scenario', async () => {
    const p = await body(await get(path('sourcingParams')), SourcingParams);
    expect(p.params.map((x) => x.key)).toEqual(dims.sourcing_param.map((m) => m.id));
    expect(p.params.find((x) => x.key === 'capture_pct')).toMatchObject({ value: 0.5, group: 'benchmarks', unit: '%' });
    const withScenario = await body(await get(path('sourcingParams', C())), SourcingParams);
    expect(withScenario).toEqual(p);
  });

  it('the levers of the scenario move the benchmark headroom; the spend cube does not move', async () => {
    const rates = await body(await get(path('sourcingBenchmarks', presetId('rates'))), BenchmarkGap);
    const c = await body(await get(path('sourcingBenchmarks', C())), BenchmarkGap);
    expect(rates.totals.opportunity).toBeCloseTo(c.totals.opportunity, 9);
    expect(rates.totals.leverSavings).not.toBeCloseTo(c.totals.leverSavings, 3);
  });
});

describe('SRC-07 scenarios and tenants', () => {
  const live = ['sourcingVendors', 'sourcingRenewals', 'sourcingBenchmarks'] as const;

  it.each(live)('%s: an unknown scenario and another tenant\'s scenario are the same 404 problem', async (route) => {
    for (const id of ['00000000-0000-4000-8000-00000000dead', ZZ_SCENARIO]) {
      const res = await get(path(route, id));
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    }
    const params = await get(path('sourcingParams', ZZ_SCENARIO));
    expect(params.status).toBe(404);
  });

  it('a non-member and a member of another tenant get 404; no session gets 401', async () => {
    expect((await get(path('sourcingVendors', C()), asUser(BOB))).status).toBe(404);
    expect((await get(path('sourcingVendors', C()), asUser(CAROL))).status).toBe(404);
    expect((await app.request(path('sourcingVendors', C()))).status).toBe(401);
  });

  it('a tenant without sourcing members gets no parameters', async () => {
    const p = await body(await get(path('sourcingParams', undefined, 'zz'), asUser(BOB)), SourcingParams);
    expect(p.params).toEqual([]);
  });

  it('POST consolidation still answers 501 (SRC-10)', async () => {
    const res = await app.request(path('sourcingConsolidation'), {
      method: 'POST',
      headers: { ...ana.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: C() }),
    });
    expect(res.status).toBe(501);
  });
});

describe('SRC-07 reference tenant numbers (scenario C), for the record', () => {
  it('prints the headline numbers', async () => {
    const v = await body(await get(path('sourcingVendors', C())), VendorSpend);
    const r = await body(await get(path('sourcingRenewals', C())), RenewalCalendar);
    const b = await body(await get(path('sourcingBenchmarks', C())), BenchmarkGap);
    const summary = {
      vendors: { ...v.totals, top5: v.vendors.slice(0, 5).map((x) => `${x.vendor} ${x.spend.toFixed(2)} (${(x.share * 100).toFixed(1)}%)`) },
      renewals: { ...r.totals, overdue: r.renewals.filter((x) => x.status === 'overdue').map((x) => x.contract) },
      benchmarks: b.totals,
    };
    process.stdout.write(`SRC-07 scenario C: ${JSON.stringify(summary, null, 1)}\n`);
    expect(v.totals.vendorCount).toBeGreaterThan(0);
  });
});

describe('SRC-07 edits', () => {
  it('an edit to a contract member changes the renewals answer on the next call', async () => {
    const before = await body(await get(path('sourcingRenewals', MINE)), RenewalCalendar);
    const sap = dims.contract.findIndex((m) => m.id === 'c_ibm_services');
    const { label, ...rest } = dims.contract[sap]!;
    const attrs = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'id'));
    // a contract that does not auto-renew, overdue: it still captures its cut in the plan year
    expect(before.renewals.find((x) => x.contract === 'c_ibm_services')).toMatchObject({ renewalMonth: '2027-03', status: 'overdue' });

    const scenarios = (await (await get('/api/t/aa/scenarios')).json()) as { scenarios: { id: string; version: number }[] };
    const mine = scenarios.scenarios.find((s) => s.id === MINE)!;
    const res = await app.request('/api/t/aa/changesets', {
      method: 'POST',
      headers: { ...ana.headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        scenarioId: MINE,
        baseVersion: mine.version,
        changes: [{ target: 'structural', key: 'contract', member: 'c_ibm_services', value: { label, attrs: { ...attrs, renewal_month: '2029-03' }, sort: sap + 1, active: true } }],
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const after = await body(await get(path('sourcingRenewals', MINE)), RenewalCalendar);
    const row = after.renewals.find((x) => x.contract === 'c_ibm_services')!;
    expect(row).toMatchObject({ renewalMonth: '2029-03', status: 'later', capture: 0 });
    expect(after.totals.byStatus.overdue).toBe(before.totals.byStatus.overdue - 1);
    expect(after.totals.capture).toBeLessThan(before.totals.capture);
  });

  it('a parameter the views cannot use is a 422 problem that names it, not a 500', async () => {
    const scenarios = (await (await get('/api/t/aa/scenarios')).json()) as { scenarios: { id: string; version: number }[] };
    const mine = scenarios.scenarios.find((s) => s.id === MINE)!;
    const i = dims.sourcing_param.findIndex((m) => m.id === 'target_percentile');
    const { label, ...rest } = dims.sourcing_param[i]!;
    const attrs = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'id'));
    const res = await app.request('/api/t/aa/changesets', {
      method: 'POST',
      headers: { ...ana.headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        scenarioId: MINE,
        baseVersion: mine.version,
        changes: [{ target: 'structural', key: 'sourcing_param', member: 'target_percentile', value: { label, attrs: { ...attrs, value: 60 }, sort: i + 1, active: true } }],
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const b = await get(path('sourcingBenchmarks', C()));
    expect(b.status).toBe(422);
    expect(b.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    expect(await b.text()).toMatch(/target_percentile/);
  });
});
