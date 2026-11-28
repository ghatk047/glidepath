// SRC-06, SRC-08, SRC-09 acceptance: hand-built fixtures, plus the AA seed evaluated by the real engine.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileModel, findScenario, resolveInputs as engineInputs } from '@glidepath/engine';
import type { Member, TenantMembers } from '@glidepath/spec';
import { loadModelBundleFromDir, readTenantSeed } from '@glidepath/spec/node';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../test-support/schema-json';
import { SEED_DIR, SPEC_DIR } from '../test-support/seed-state';
import { engineCell } from '../views/read';
import type { ViewEvaluation } from '../views/types';
import {
  SourcingDataError,
  benchmarkGap,
  poolLeverSavings,
  readSourcingParams,
  renewalCalendar,
  sourcingLines,
  sourcingYears,
  vendorSpend,
} from './index';
import type { SourcingLine } from './index';

const near = (a: number, b: number, tol = 1e-9): void => {
  expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(Math.max(tol * Math.abs(b), tol));
};

// ---------------------------------------------------------------------------------- fixture builders

const line = (over: Partial<SourcingLine> & { id: string }): SourcingLine => ({
  label: over.id,
  pool: 'software',
  vendor: 'Acme',
  vendorKey: null,
  qty: 1,
  unit: 'seat',
  addr: 'addressable',
  inScope: true,
  memo: false,
  leverIds: [],
  amount: 1,
  outlay: 1,
  ...over,
});

const param = (id: string, value: number, min = -1e9, max = 1e9): Member => ({ id, label: id, value, min, max, step: 1, unit: '', group: 'g' });

const FIXTURE_MEMBERS: TenantMembers = {
  pool: [
    { id: 'labour', third_party: 0, order: 1 },
    { id: 'software', third_party: 1, order: 2 },
    { id: 'cloud', third_party: 1, order: 3 },
  ],
  vendor: [
    { id: 'acme', label: 'Acme Corp', preferred: 1 },
    { id: 'beta', label: 'Beta', preferred: 0 },
  ],
  iyear: [{ id: 'y1' }, { id: 'y2' }],
  year: [
    { id: 'y1', in: 'y1', prev: '' },
    { id: 'y2b', in: 'y2', prev: 'y1' },
  ],
  lever: [{ id: 'L1' }, { id: 'L2' }],
};

// ---------------------------------------------------------------------------------- SRC-06

describe('SRC-06 vendorSpend', () => {
  const lines: SourcingLine[] = [
    line({ id: 'a1', vendor: 'Acme', outlay: 40, leverIds: ['L2'], pool: 'software' }),
    line({ id: 'a2', vendor: 'Acme', outlay: 20, leverIds: ['L1'], pool: 'cloud', addr: 'locked' }),
    line({ id: 'b1', vendor: 'Beta', outlay: 30, leverIds: ['L1'], pool: 'software', addr: 'partly' }),
    line({ id: 'c1', vendor: 'Gamma', outlay: 10, pool: 'cloud' }),
    // not counted: internal pool, memo, out of scope
    line({ id: 'x1', vendor: 'Acme', outlay: 500, pool: 'labour' }),
    line({ id: 'x2', vendor: 'Beta', outlay: 500, memo: true }),
    line({ id: 'x3', vendor: 'Gamma', outlay: 500, inScope: false }),
  ];
  const contracts: Member[] = [{ id: 'c_acme', vendor_name: 'Acme', vendor: 'acme' }];
  const view = vendorSpend({ scenarioId: 's', lines, members: FIXTURE_MEMBERS, contracts });

  it('spend by vendor sums the in-scope, non-memo lines of third-party pools (test)', () => {
    expect(view.vendors.map((v) => [v.vendor, v.spend, v.lineCount])).toEqual([
      ['Acme', 60, 2],
      ['Beta', 30, 1],
      ['Gamma', 10, 1],
    ]);
    expect(view.totals.thirdPartySpend).toBe(100);
    expect(view.year).toBe('y1');
  });

  it('share, cumulative share, HHI and top-5 share on a hand-built fixture (test)', () => {
    expect(view.vendors.map((v) => v.share)).toEqual([0.6, 0.3, 0.1]);
    near(view.vendors[2]!.cumulativeShare, 1);
    near(view.vendors[1]!.cumulativeShare, 0.9);
    // 60^2 + 30^2 + 10^2
    near(view.totals.hhi, 4600);
    near(view.totals.top5Share, 1);
    expect(view.totals.vendorCount).toBe(3);
  });

  it('top-5 share leaves out the sixth vendor on', () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((v, i) => line({ id: v, vendor: v, outlay: 6 - i }));
    const v = vendorSpend({ scenarioId: 's', lines: six, members: FIXTURE_MEMBERS });
    near(v.totals.top5Share, 20 / 21);
  });

  it('each vendor lists the levers that touch its lines, and its pools (test)', () => {
    expect(view.vendors[0]!.levers).toEqual(['L1', 'L2']);
    expect(view.vendors[0]!.pools).toEqual(['software', 'cloud']);
    expect(view.vendors[2]!.levers).toEqual([]);
  });

  it('preferred: through the contract mapping or the vendor label; addressable share', () => {
    expect(view.vendors.map((v) => [v.vendorKey, v.preferred])).toEqual([
      ['acme', true],
      ['beta', false],
      [null, false],
    ]);
    near(view.totals.preferredShare, 0.6);
    near(view.vendors[0]!.addressableShare, 40 / 60);
    near(view.vendors[1]!.addressableShare, 1);
  });

  it('aggregate buckets keep their rows, last, and stay out of HHI, top-5 share and the vendor count', () => {
    const withBucket = [...lines, line({ id: 'v1', vendor: 'Various', outlay: 100, pool: 'software' })];
    const buckets: Member[] = [{ id: 'vb_various', label: 'Various (aggregate)', vendor_name: 'various', reason: 'many' }];
    const v = vendorSpend({ scenarioId: 's', lines: withBucket, members: FIXTURE_MEMBERS, contracts, buckets });
    expect(v.vendors.map((x) => x.vendor)).toEqual(['Acme', 'Beta', 'Gamma', 'Various']);
    expect(v.totals.thirdPartySpend).toBe(200);
    expect(v.vendors.map((x) => x.share)).toEqual([0.3, 0.15, 0.05, 0.5]);
    near(v.vendors[3]!.cumulativeShare, 1);
    expect(v.totals.vendorCount).toBe(3);
    // 30^2 + 15^2 + 5^2, the bucket's 50% left out
    near(v.totals.hhi, 1150);
    near(v.totals.top5Share, 0.5);
  });

  it('an empty cube has zero shares', () => {
    const v = vendorSpend({ scenarioId: 's', lines: [], members: FIXTURE_MEMBERS });
    expect(v.totals).toEqual({ thirdPartySpend: 0, hhi: 0, top5Share: 0, preferredShare: 0, vendorCount: 0 });
  });
});

// ---------------------------------------------------------------------------------- SRC-08

describe('SRC-08 renewalCalendar', () => {
  const params = readSourcingParams([
    param('asof_year', 2026),
    param('asof_month', 12),
    param('window_months', 24),
    param('act_now_days', 120),
  ]);
  const lines = [line({ id: 'l1', outlay: 10 }), line({ id: 'l2', outlay: 2 })];
  const contract = (id: string, over: Record<string, unknown>): Member => ({
    id,
    label: id,
    vendor_name: 'Acme',
    vendor: null,
    category: 'Software',
    lines: ['l1', 'l2'],
    term_months: 36,
    notice_days: 90,
    escalator_pct: 0.05,
    auto_renew: 0,
    target_cut_pct: 0.1,
    ...over,
  } as Member);
  const contracts = [
    contract('c_overdue', { renewal_month: '2027-02', notice_days: 90 }), // deadline 2026-11-03
    contract('c_actnow', { renewal_month: '2027-03', notice_days: 60 }), // deadline 2026-12-31
    contract('c_plan', { renewal_month: '2027-10' }), // deadline 2027-07-03, renewal in window
    contract('c_later', { renewal_month: '2029-01' }), // outside the 24-month window
    contract('c_rolled', { renewal_month: '2026-06', auto_renew: 1, term_months: 24 }), // renewed: next 2028-06
    contract('c_lapsed', { renewal_month: '2026-09', auto_renew: 0 }), // past, no auto-renew: overdue
    contract('c_missed', { renewal_month: '2027-02', notice_days: 90, auto_renew: 1 }), // auto-renew, notice missed
  ];
  const view = renewalCalendar({
    scenarioId: 's',
    contracts,
    lines,
    vendors: FIXTURE_MEMBERS['vendor']!,
    params,
    planYear: { key: 'fy27', calendarYear: 2027 },
  });
  const row = (id: string) => view.renewals.find((r) => r.contract === id)!;

  it('lists renewals with notice deadline, days to deadline and status (test)', () => {
    expect(view.asOf).toBe('2026-12-01');
    expect(view.planYear).toBe('fy27');
    expect([row('c_overdue').noticeDeadline, row('c_overdue').daysToDeadline, row('c_overdue').status]).toEqual(['2026-11-03', -28, 'overdue']);
    expect([row('c_actnow').noticeDeadline, row('c_actnow').daysToDeadline, row('c_actnow').status]).toEqual(['2026-12-31', 30, 'act_now']);
    expect([row('c_plan').noticeDeadline, row('c_plan').status]).toEqual(['2027-07-03', 'plan']);
    expect(row('c_later').status).toBe('later');
    expect(view.totals.byStatus).toEqual({ overdue: 3, act_now: 1, plan: 2, later: 1 });
    // sorted by notice deadline
    const deadlines = view.renewals.map((r) => r.noticeDeadline);
    expect(deadlines).toEqual([...deadlines].sort());
  });

  it('a past renewal rolls forward by its term when the contract auto-renews; otherwise it stays, overdue', () => {
    expect([row('c_rolled').renewalMonth, row('c_rolled').status]).toEqual(['2028-06', 'plan']);
    expect([row('c_lapsed').renewalMonth, row('c_lapsed').status]).toEqual(['2026-09', 'overdue']);
  });

  it('escalator exposure and in-year capture of a negotiated cut on a fixture (test)', () => {
    // annual value 12; escalator 5%; cut 10%
    expect(row('c_plan').annualValue).toBe(12);
    near(row('c_plan').escalatorExposure, 0.6);
    // renews 2027-10: Oct, Nov, Dec of the plan year = 3 months
    near(row('c_plan').capture, (12 * 0.1 * 3) / 12);
    // renews 2027-02: 11 months
    near(row('c_overdue').capture, (12 * 0.1 * 11) / 12);
    // before the plan year: the whole year; after it: nothing
    near(row('c_lapsed').capture, 1.2);
    expect(row('c_later').capture).toBe(0);
    expect(row('c_rolled').capture).toBe(0);
    near(view.totals.capture, view.renewals.reduce((s, r) => s + r.capture, 0));
    near(view.totals.escalatorExposure, 7 * 0.6);
    // an auto-renew contract past its notice deadline renews unchanged: no capture; one that does not auto-renew keeps it
    expect([row('c_missed').status, row('c_missed').capture]).toEqual(['overdue', 0]);
    expect(row('c_overdue').capture).toBeGreaterThan(0);
  });

  it('byMonth covers every month of the window, months without renewals included', () => {
    expect(view.byMonth).toHaveLength(24);
    expect(view.byMonth[0]!.month).toBe('2026-12');
    expect(view.byMonth[23]!.month).toBe('2028-11');
    const feb = view.byMonth.find((m) => m.month === '2027-02')!;
    expect([feb.renewals, feb.annualValue]).toEqual([2, 24]);
    expect(view.byMonth.find((m) => m.month === '2027-01')!.renewals).toBe(0);
  });

  it('a missing parameter is an error that names it', () => {
    const run = () =>
      renewalCalendar({ scenarioId: 's', contracts, lines, vendors: [], params: readSourcingParams([]), planYear: { key: 'fy27', calendarYear: 2027 } });
    expect(run).toThrow(SourcingDataError);
    expect(run).toThrow(/asof_year/);
  });
});

// ---------------------------------------------------------------------------------- SRC-09

describe('SRC-09 benchmarkGap', () => {
  const params = (pct: number) => readSourcingParams([param('target_percentile', pct), param('capture_pct', 0.5)]);
  const lines = [
    // unit cost 120 000 $ per FTE
    line({ id: 'h1', pool: 'labour', qty: 10, amount: 1.2, outlay: 1.2 }),
    // unit cost 90 000: below the median
    line({ id: 'h2', pool: 'labour', qty: 10, amount: 0.9, outlay: 0.9 }),
    // unit cost 1 000 per seat
    line({ id: 's1', pool: 'software', qty: 500, amount: 0.5, outlay: 0.5 }),
    line({ id: 'memo', pool: 'software', qty: 5, amount: 1, memo: true }),
    // software line with no benchmark: carries 3/4 of the pool's lever saving
    line({ id: 's2', pool: 'software', qty: 1, amount: 1.5, outlay: 1.5 }),
  ];
  const benchmarks: Member[] = [
    { id: 'b_fte', unit: 'FTE', lines: ['h1', 'h2', 'missing'], p25_usd: 90_000, median_usd: 100_000, p75_usd: 115_000 },
    { id: 'b_seat', unit: 'seat', lines: ['s1', 'memo'], p25_usd: 600, median_usd: 800, p75_usd: 1_100 },
  ];
  const savings = new Map([
    ['labour', 0.05],
    ['software', 0.02],
    ['cloud', 9],
  ]);
  const view = benchmarkGap({ scenarioId: 's', benchmarks, lines, params: params(50), leverSavingsByPool: savings });
  const row = (id: string) => view.rows.find((r) => r.line === id)!;

  it('each benchmarked line shows unit cost vs the chosen percentile, gap per unit and opportunity in $M (test)', () => {
    near(row('h1').unitCost, 120_000);
    expect(row('h1').percentile).toBe('median');
    near(row('h1').gapPerUnit, 20_000);
    near(row('h1').opportunity, 0.2);
    near(row('h1').capturable, 0.1);
    near(row('s1').opportunity, (200 * 500) / 1e6);
    expect(view.rows.map((r) => r.line)).toEqual(['h1', 's1', 'h2']); // by opportunity; memo and missing lines left out
  });

  it('lines already at or below the benchmark contribute zero (test)', () => {
    expect(row('h2').gapPerUnit).toBe(0);
    expect(row('h2').opportunity).toBe(0);
    const p75 = benchmarkGap({ scenarioId: 's', benchmarks, lines, params: params(75), leverSavingsByPool: savings });
    near(p75.rows.find((r) => r.line === 's1')!.opportunity, 0);
    near(p75.totals.opportunity, (5_000 * 10) / 1e6);
  });

  it('headroom = capturable minus the lever savings allocated to the benchmarked lines by outlay in their pool (test)', () => {
    near(view.totals.opportunity, 0.3);
    near(view.totals.capturable, 0.15);
    // labour: h1 and h2 are the whole pool -> 0.05; software: s1 is 0.5 of 2.0 outlay -> 0.25 x 0.02; cloud: no line
    near(view.totals.leverSavings, 0.05 + 0.005);
    near(view.totals.headroom, 0.15 - 0.055);
  });

  it('a percentile outside 25 / 50 / 75 is refused', () => {
    expect(() => benchmarkGap({ scenarioId: 's', benchmarks, lines, params: params(60), leverSavingsByPool: savings })).toThrow(SourcingDataError);
  });

  it('poolLeverSavings sums lev.eff over the levers, signed', () => {
    const cells = new Map([
      [engineCell('lev.eff', 'L1,software'), 3],
      [engineCell('lev.eff', 'L2,software'), -1],
      [engineCell('lev.eff', 'L2,cloud'), 2],
    ]);
    const ev: ViewEvaluation = { get: (c) => cells.get(c) ?? 0, has: (c) => cells.has(c) };
    const out = poolLeverSavings(ev, FIXTURE_MEMBERS);
    expect([out.get('software'), out.get('cloud'), out.get('labour')]).toEqual([2, 2, 0]);
  });
});

// ---------------------------------------------------------------------------------- AA seed, real engine

describe('reference seed (preset C)', async () => {
  const [bundle, seed] = await Promise.all([loadModelBundleFromDir(SPEC_DIR), readTenantSeed(SEED_DIR)]);
  const members: TenantMembers = seed.dimensionMembers;
  const model = compileModel(bundle, members);
  const { values, overrides } = engineInputs(bundle, seed.variableValues, findScenario(seed.scenarios, 'C'));
  const ev = model.evaluate(values, overrides);
  const sourcing = JSON.parse(readFileSync(resolve(repoRoot, 'tier3-data/seed/aa/sourcing.json'), 'utf8')) as {
    dimensions: Record<'contract' | 'benchmark' | 'sourcing_param' | 'vendor_bucket', Member[]>;
  };
  // Seed lines carry the vendor name as `vendor` (line_item.vendor_text in the database).
  const rows = new Map((members['line'] ?? []).map((l) => [l.id, { vendor_text: l['vendor'], vendor_key: null, qty: l['qty'], unit: l['unit'] }]));
  const lines = sourcingLines(members, rows, ev);
  const params = readSourcingParams(sourcing.dimensions.sourcing_param);
  const thirdParty = (members['pool'] ?? []).filter((p) => p['third_party'] === 1).map((p) => p.id);

  it('line outlay is qty x unit cost on the seed for in-scope, non-memo lines', () => {
    for (const l of members['line'] ?? []) {
      const s = lines.find((x) => x.id === l.id)!;
      const expected = l['in_scope'] === 1 && l['memo'] === 0 ? ((l['qty'] as number) * (l['unit_cost_usd'] as number)) / 1e6 : 0;
      near(s.outlay, expected, 1e-9);
    }
  });

  it('spend reconciles to the third-party baseline: the sum of base.pool_outlay over third-party pools (test)', () => {
    const view = vendorSpend({ scenarioId: 'C', lines, members, contracts: sourcing.dimensions.contract });
    const baseline = thirdParty.reduce((s, p) => s + ev.get(engineCell('base.pool_outlay', p)), 0);
    near(view.totals.thirdPartySpend, baseline, 1e-9);
    near(view.vendors.reduce((s, v) => s + v.spend, 0), baseline, 1e-9);
    expect(view.year).toBe('fy26');
    expect(sourcingYears(members)).toEqual({ baseYear: 'fy26', planYear: 'fy27' });
    // the seeded aggregate buckets come last and leave the vendor count
    const b = vendorSpend({ scenarioId: 'C', lines, members, contracts: sourcing.dimensions.contract, buckets: sourcing.dimensions.vendor_bucket });
    expect(b.vendors.slice(b.totals.vendorCount).map((v) => v.vendor).sort()).toEqual(['Long-tail SI', 'Various', 'Various firms']);
    expect(b.totals.vendorCount).toBe(view.totals.vendorCount - 3);
    expect(b.totals.hhi).toBeLessThan(view.totals.hhi);
    near(b.totals.thirdPartySpend, baseline, 1e-9);
    // the six preferred SIs are matched
    expect(view.vendors.filter((v) => v.preferred).map((v) => v.vendorKey).sort()).toEqual(['coforge', 'cognizant', 'dxc', 'ibm', 'infosys', 'si6']);
  });

  it('renewals and benchmarks run on the seeded contracts, benchmarks and parameters', () => {
    const cal = renewalCalendar({
      scenarioId: 'C',
      contracts: sourcing.dimensions.contract,
      lines,
      vendors: members['vendor'] ?? [],
      params,
      planYear: { key: 'fy27', calendarYear: 2027 },
    });
    expect(cal.totals.contracts).toBe(sourcing.dimensions.contract.length);
    expect(cal.byMonth).toHaveLength(24);
    const gap = benchmarkGap({
      scenarioId: 'C',
      benchmarks: sourcing.dimensions.benchmark,
      lines,
      params,
      leverSavingsByPool: poolLeverSavings(ev, members),
    });
    expect(gap.rows.length).toBeGreaterThan(0);
    // seed unit cost recovered from line.amount / qty
    for (const r of gap.rows) {
      const m = (members['line'] ?? []).find((l) => l.id === r.line)!;
      near(r.unitCost, m['unit_cost_usd'] as number, 1e-9);
    }
    // lev.eff sums to lev.rr over pools (lev.rr_check = 0), so the pool savings add up to the run-rate total
    const all = [...poolLeverSavings(ev, members).values()].reduce((s, x) => s + x, 0);
    const rr = (members['lever'] ?? []).reduce((s, l) => s + ev.get(engineCell('lev.rr', l.id)), 0);
    near(all, rr, 1e-9);
  });
});
