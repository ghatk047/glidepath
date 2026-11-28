import { BenchmarkGap, ConsolidationResult, PROBLEM_CONTENT_TYPE, RenewalCalendar, SourcingMembers, SourcingParams, UserId, VendorSpend, sourcingRoutes } from '@glidepath/api-contract';
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
const consolidation = (payload: unknown, who = ana, tenant = 'aa') =>
  app.request(path('sourcingConsolidation', undefined, tenant), {
    method: 'POST',
    headers: { ...who.headers, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

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
    // each with the member's sort (seeded in file order), so the whole row can be written back
    expect(p.params.map((x) => x.sort)).toEqual(dims.sourcing_param.map((_, i) => i + 1));
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

  it('POST consolidation: an unknown scenario and another tenant\'s scenario are the same 404, whatever the overrides', async () => {
    for (const id of ['00000000-0000-4000-8000-00000000dead', ZZ_SCENARIO]) {
      for (const params of [undefined, { concentration_cap_pct: 9 }]) {
        const res = await consolidation({ scenarioId: id, ...(params ? { params } : {}) });
        expect(res.status).toBe(404);
        expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
      }
    }
    expect((await consolidation({ scenarioId: C() }, asUser(CAROL))).status).toBe(404);
  });
});

/** SRC-07/SRC-10 acceptance: the consolidation optimizer over scenario C's spend cube. */
describe('SRC-10 POST consolidation', () => {
  it('answers its contract schema for scenario C, consistent with the spend cube and the parameters', async () => {
    const r = await body(await consolidation({ scenarioId: C() }), ConsolidationResult);
    const v = await body(await get(path('sourcingVendors', C())), VendorSpend);
    const param = (k: string) => Number(dims.sourcing_param.find((m) => m.id === k)!.value);
    expect(r.scenarioId).toBe(C());
    expect(r.hhiBefore).toBeCloseTo(v.totals.hhi, 9);
    expect(r.totals.vendorsBefore).toBe(v.totals.vendorCount);
    expect(r.params).toMatchObject({ rate_discount_pct: param('rate_discount_pct'), max_moves: param('max_moves'), horizon_years: param('horizon_years') });
    expect(r.moves.length).toBeGreaterThan(0);
    expect(r.moves.length).toBeLessThanOrEqual(param('max_moves'));
    const byName = new Map(v.vendors.map((x) => [x.vendor, x]));
    const scope = dims.consolidation_scope.map((m) => String(m.pool));
    expect(r.exact).toBe(true);
    for (const m of r.moves) {
      // only in the consolidation scope (services pools), never licences, cloud, hardware or telecom
      expect(scope).toContain(m.pool);
      expect(byName.get(m.from)!.pools).toContain(m.pool);
      expect(byName.get(m.to)!.pools).toContain(m.pool);
      expect(m.netBenefit).toBeGreaterThan(0);
      const from = byName.get(m.from)!;
      const to = byName.get(m.to)!;
      expect(from.preferred || from.aggregate).toBe(false);
      expect(to.preferred).toBe(true);
      expect(from.pools.some((p) => to.pools.includes(p))).toBe(true);
      expect(m.spendMoved).toBeLessThanOrEqual(from.spend + 1e-9);
      expect(m.annualSaving).toBeCloseTo(m.spendMoved * param('rate_discount_pct'), 9);
      expect(m.oneTimeCost).toBeCloseTo(m.spendMoved * param('transition_cost_pct'), 9);
      expect(m.paybackMonths).not.toBeNull();
    }
    expect(r.totals.spendMoved).toBeCloseTo(r.moves.reduce((s, m) => s + m.spendMoved, 0), 9);
    // no preferred vendor ends above the cap of the third-party total
    const after = new Map(v.vendors.map((x) => [x.vendor, x.spend]));
    for (const m of r.moves) {
      after.set(m.from, after.get(m.from)! - m.spendMoved);
      after.set(m.to, after.get(m.to)! + m.spendMoved);
    }
    for (const x of v.vendors.filter((y) => y.preferred)) expect(after.get(x.vendor)! / v.totals.thirdPartySpend).toBeLessThanOrEqual(param('concentration_cap_pct') + 1e-9);
    for (const b of r.binding) expect(b).toMatchObject({ label: String(dims.sourcing_param.find((m) => m.id === b.param)!.label), value: param(b.param) });
    process.stdout.write(
      `SRC-10 scenario C: ${JSON.stringify(
        {
          exact: r.exact,
          moves: r.moves.map((m) => `${m.from} -> ${m.to} in ${m.pool}: ${m.spendMoved.toFixed(3)} (net ${m.netBenefit.toFixed(3)}, saving ${m.annualSaving.toFixed(3)}, one-time ${m.oneTimeCost.toFixed(3)}, payback ${m.paybackMonths?.toFixed(1)} mo)`),
          totals: r.totals,
          hhi: [r.hhiBefore, r.hhiAfter],
          topVendorShareAfter: r.topVendorShareAfter,
          binding: r.binding,
        },
        null,
        1,
      )}\n`,
    );
  });

  it('overrides hold for the run only: fewer moves allowed gives fewer moves, and nothing is written', async () => {
    const one = await body(await consolidation({ scenarioId: C(), params: { max_moves: 1 } }), ConsolidationResult);
    expect(one.moves).toHaveLength(1);
    expect(one.params).toMatchObject({ max_moves: 1 });
    expect(one.binding.map((b) => b.param)).toContain('max_moves');
    const p = await body(await get(path('sourcingParams')), SourcingParams);
    expect(p.params.find((x) => x.key === 'max_moves')!.value).toBe(Number(dims.sourcing_param.find((m) => m.id === 'max_moves')!.value));
    const none = await body(await consolidation({ scenarioId: C(), params: { rate_discount_pct: 0 } }), ConsolidationResult);
    expect(none.moves).toEqual([]);
    expect(none.hhiAfter).toBeCloseTo(none.hhiBefore, 12);
  });

  it('an override outside its [min, max], of an unknown key or a fractional count is a 422 problem that names it', async () => {
    for (const [params, name] of [
      [{ concentration_cap_pct: 0.9 }, 'concentration_cap_pct'],
      [{ max_moves: 0 }, 'max_moves'],
      [{ min_vendor_count: 2.5 }, 'min_vendor_count'],
      [{ not_a_param: 1 }, 'not_a_param'],
    ] as const) {
      const res = await consolidation({ scenarioId: C(), params });
      expect(res.status, JSON.stringify(params)).toBe(422);
      expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
      expect(await res.text()).toMatch(name);
    }
  });

  it('a body that is not a ConsolidationRequest is a 422; no session is a 401', async () => {
    expect((await consolidation({ scenario: C() })).status).toBe(422);
    expect((await app.request(path('sourcingConsolidation'), { method: 'POST', body: JSON.stringify({ scenarioId: C() }) })).status).toBe(401);
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

describe('SRC-11 GET sourcing/members', () => {
  const members = (dim: string, who = ana, tenant = 'aa') => get(`${path('sourcingMembers', undefined, tenant)}?dim=${dim}`, who);

  it.each(['contract', 'benchmark'] as const)('%s: every stored row, whole, in member order', async (dim) => {
    const r = await body(await members(dim), SourcingMembers);
    expect(r.dim).toBe(dim);
    expect(r.members).toEqual(
      dims[dim].map((m, i) => {
        const { id, label, ...attrs } = m;
        return { key: id, label, attrs, sort: i + 1, active: true };
      }),
    );
  });

  it('a dimension that is not editable here is a 422 problem; another tenant sees only its own (none)', async () => {
    for (const dim of ['sourcing_param', 'vendor', '']) {
      const res = await members(dim);
      expect(res.status).toBe(422);
      expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    }
    expect((await get(`${path('sourcingMembers')}`)).status).toBe(422);
    const zz = await body(await members('contract', asUser(BOB), 'zz'), SourcingMembers);
    expect(zz.members).toEqual([]);
    expect((await members('contract', asUser(BOB))).status).toBe(404);
    expect((await members('contract', asUser(CAROL))).status).toBe(404);
    expect((await app.request(`${path('sourcingMembers')}?dim=contract`)).status).toBe(401);
  });

  it('a row read here and written back whole with a new target cut changes the renewal on the next call', async () => {
    const { members: rows } = await body(await members('contract'), SourcingMembers);
    const row = rows.find((m) => m.key === 'c_azure_macc')!;
    const before = await body(await get(path('sourcingRenewals', MINE)), RenewalCalendar);
    const old = before.renewals.find((x) => x.contract === row.key)!;
    const scenarios = (await (await get('/api/t/aa/scenarios')).json()) as { scenarios: { id: string; version: number }[] };
    const mine = scenarios.scenarios.find((s) => s.id === MINE)!;
    const { key, ...value } = row;
    const res = await app.request('/api/t/aa/changesets', {
      method: 'POST',
      headers: { ...ana.headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        scenarioId: MINE,
        baseVersion: mine.version,
        changes: [{ target: 'structural', key: 'contract', member: key, value: { ...value, attrs: { ...value.attrs, target_cut_pct: 0.12 } } }],
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const after = await body(await get(path('sourcingRenewals', MINE)), RenewalCalendar);
    expect(after.renewals.find((x) => x.contract === row.key)).toMatchObject({ ...old, targetCut: 0.12, capture: expect.any(Number) as number });
    const again = await body(await members('contract'), SourcingMembers);
    expect(again.members.find((m) => m.key === key)).toEqual({ ...row, attrs: { ...row.attrs, target_cut_pct: 0.12 } });
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

  it('POST consolidation: a parameter the optimizer needs, once removed, is a 422 problem that names it', async () => {
    const scenarios = (await (await get('/api/t/aa/scenarios')).json()) as { scenarios: { id: string; version: number }[] };
    const mine = scenarios.scenarios.find((s) => s.id === MINE)!;
    const i = dims.sourcing_param.findIndex((m) => m.id === 'max_moves');
    const { label, ...rest } = dims.sourcing_param[i]!;
    const attrs = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'id'));
    const res = await app.request('/api/t/aa/changesets', {
      method: 'POST',
      headers: { ...ana.headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        scenarioId: MINE,
        baseVersion: mine.version,
        changes: [{ target: 'structural', key: 'sourcing_param', member: 'max_moves', value: { label, attrs, sort: i + 1, active: false } }],
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const r = await consolidation({ scenarioId: C() });
    expect(r.status, await r.clone().text()).toBe(422);
    expect(r.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    expect(await r.text()).toMatch(/max_moves/);
  });
});
