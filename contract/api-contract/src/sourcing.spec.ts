import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  AppModule,
  BenchmarkGap,
  BusinessCase,
  ConsolidationRequest,
  ConsolidationResult,
  ProblemId,
  RenewalCalendar,
  RenewalStatus,
  SolverResult,
  SolverSpec,
  SourcingParam,
  SourcingMembers,
  SourcingParams,
  VendorSpend,
  WavePlanParams,
  apiRoutes,
  planRoutes,
  quickProblems,
  sourcingRoutes,
  type RouteDef,
} from './index';
import { planRouteFixtures, sourcingRouteFixtures } from './fixtures/sourcing';
import { solverProblemFixtures } from './fixtures/jobs';

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const ok = (schema: z.ZodType, value: unknown): boolean => schema.safeParse(value).success;
const expectParses = (schema: z.ZodType, value: unknown, label: string): void => {
  const r = schema.safeParse(value);
  expect(r.success, `${label}: ${JSON.stringify(r.error?.issues.slice(0, 3))}`).toBe(true);
  expect(roundTrip(r.data), label).toEqual(roundTrip(value));
};

const fx = sourcingRouteFixtures;

describe('sourcing.spec: SRC-03 sourcing and plan routes', () => {
  it('covers exactly the sourcing and plan routes, all in apiRoutes', () => {
    const table = [...Object.values(sourcingRoutes), ...Object.values(planRoutes)]
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(table).toEqual(
      [
        'GET /api/t/:tenant/sourcing/vendors',
        'GET /api/t/:tenant/sourcing/renewals',
        'GET /api/t/:tenant/sourcing/benchmarks',
        'GET /api/t/:tenant/sourcing/params',
        'GET /api/t/:tenant/sourcing/members',
        'POST /api/t/:tenant/sourcing/consolidation',
        'GET /api/t/:tenant/plan/business-case',
      ].sort(),
    );
    for (const id of [...Object.keys(sourcingRoutes), ...Object.keys(planRoutes)]) {
      expect(apiRoutes).toHaveProperty(id);
    }
    expect(Object.keys(fx).sort()).toEqual(Object.keys(sourcingRoutes).sort());
    expect(Object.keys(planRouteFixtures)).toEqual(Object.keys(planRoutes));
  });

  it('wires the response schemas named in SRC-03', () => {
    expect(sourcingRoutes.sourcingVendors.response).toBe(VendorSpend);
    expect(sourcingRoutes.sourcingRenewals.response).toBe(RenewalCalendar);
    expect(sourcingRoutes.sourcingBenchmarks.response).toBe(BenchmarkGap);
    expect(sourcingRoutes.sourcingParams.response).toBe(SourcingParams);
    expect(sourcingRoutes.sourcingMembers.response).toBe(SourcingMembers);
    expect(sourcingRoutes.sourcingConsolidation.body).toBe(ConsolidationRequest);
    expect(sourcingRoutes.sourcingConsolidation.response).toBe(ConsolidationResult);
    expect(planRoutes.planBusinessCase.response).toBe(BusinessCase);
  });

  const parts = ['params', 'query', 'body', 'response'] as const;
  const all = { ...sourcingRouteFixtures, ...planRouteFixtures };
  const routes = { ...sourcingRoutes, ...planRoutes } as Record<string, RouteDef>;
  for (const [id, fixture] of Object.entries(all)) {
    it(`round-trips the ${id} fixture`, () => {
      const route = routes[id]!;
      const f = fixture as Partial<Record<(typeof parts)[number], unknown>>;
      for (const part of parts) {
        const schema = route[part] as z.ZodType | undefined;
        if (!schema) {
          expect(f[part], `${id}.${part}`).toBeUndefined();
          continue;
        }
        expectParses(schema, f[part], `${id}.${part}`);
      }
    });
  }

  it('reads take ?scenario= (required, except the params read)', () => {
    for (const id of ['sourcingVendors', 'sourcingRenewals', 'sourcingBenchmarks'] as const) {
      expect(ok(sourcingRoutes[id].query, {}), id).toBe(false);
    }
    expect(ok(planRoutes.planBusinessCase.query, {})).toBe(false);
    expect(ok(sourcingRoutes.sourcingParams.query, {})).toBe(true);
  });
});

describe('sourcing.spec: schema rules', () => {
  it('shares are fractions and HHI is on 0..10 000', () => {
    const v = fx.sourcingVendors.response;
    expect(ok(VendorSpend, { ...v, totals: { ...v.totals, hhi: 10_001 } })).toBe(false);
    const row = v.vendors[0]!;
    expect(ok(VendorSpend, { ...v, vendors: [{ ...row, share: 1.2 }] })).toBe(false);
    expect(ok(VendorSpend, { ...v, vendors: [{ ...row, vendorKey: null, preferred: false }] })).toBe(true);
  });

  it('renewal status is overdue | act_now | plan | later; months are YYYY-MM, deadlines ISO dates', () => {
    expect([...RenewalStatus.options]).toEqual(['overdue', 'act_now', 'plan', 'later']);
    const r = fx.sourcingRenewals.response;
    const row = r.renewals[0]!;
    expect(ok(RenewalCalendar, { ...r, renewals: [{ ...row, status: 'soon' }] })).toBe(false);
    expect(ok(RenewalCalendar, { ...r, renewals: [{ ...row, renewalMonth: '2027-13' }] })).toBe(false);
    expect(ok(RenewalCalendar, { ...r, renewals: [{ ...row, noticeDeadline: '1 Dec 2026' }] })).toBe(false);
    // a passed deadline is a negative day count
    expect(ok(RenewalCalendar, { ...r, renewals: [{ ...row, daysToDeadline: -3, status: 'overdue' }] })).toBe(true);
  });

  it('a benchmark gap is never negative', () => {
    const b = fx.sourcingBenchmarks.response;
    expect(ok(BenchmarkGap, { ...b, rows: [{ ...b.rows[0]!, gapPerUnit: -1 }] })).toBe(false);
    expect(ok(BenchmarkGap, { ...b, rows: [{ ...b.rows[0]!, percentile: 'p90' }] })).toBe(false);
  });

  it('a sourcing parameter value lies in [min, max]', () => {
    const p = fx.sourcingParams.response.params[0]!;
    expect(ok(SourcingParam, p)).toBe(true);
    expect(ok(SourcingParam, { ...p, value: p.max + 1 })).toBe(false);
    expect(ok(SourcingParam, { ...p, step: 0 })).toBe(false);
    expect(ok(SourcingParam, { ...p, unit: '' })).toBe(true);
  });

  it('consolidation params are optional overrides; payback may be null (never repays)', () => {
    expect(ok(ConsolidationRequest, { scenarioId: 'sc-1' })).toBe(true);
    expect(ok(ConsolidationRequest, { scenarioId: 'sc-1', params: { concentration_cap: 'x' } })).toBe(false);
    const c = fx.sourcingConsolidation.response;
    expect(ok(ConsolidationResult, { ...c, moves: [{ ...c.moves[0]!, paybackMonths: null }] })).toBe(true);
    // every move names its pool and its net benefit; the result says whether the plan is proven optimal
    const without = <T extends object>(o: T, k: keyof T): object => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));
    expect(ok(ConsolidationResult, { ...c, moves: [without(c.moves[0]!, 'pool')] })).toBe(false);
    expect(ok(ConsolidationResult, { ...c, moves: [without(c.moves[0]!, 'netBenefit')] })).toBe(false);
    expect(ok(ConsolidationResult, without(c, 'exact'))).toBe(false);
  });

  it('business case: payback, IRR and ROI are nullable; the horizon is not empty', () => {
    const bc = planRouteFixtures.planBusinessCase.response;
    const noOneTime = bc.levers[1]!;
    expect([noOneTime.paybackMonths, noOneTime.irr, noOneTime.roi]).toEqual([0, null, null]);
    expect(ok(BusinessCase, { ...bc, years: [] })).toBe(false);
  });
});

describe('sourcing.spec: modules and the wave_plan problem', () => {
  it('AppModule has 11 options with sourcing and plan after path', () => {
    const m = [...AppModule.options];
    expect(m).toHaveLength(11);
    expect(m.slice(m.indexOf('path'), m.indexOf('path') + 3)).toEqual(['path', 'sourcing', 'plan']);
  });

  it('ProblemId includes wave_plan with params and detail schemas; it is a worker job, not quick', () => {
    expect(ProblemId.options).toContain('wave_plan');
    expect((quickProblems as readonly string[]).includes('wave_plan')).toBe(false);
    const w = solverProblemFixtures.wave_plan;
    expectParses(SolverSpec, w.spec, 'wave_plan.spec');
    expectParses(SolverResult, w.result, 'wave_plan.result');
    expect(ok(WavePlanParams, {})).toBe(true);
    expect(ok(WavePlanParams, { window: { from: 9, to: 3 } })).toBe(false);
    expect(ok(WavePlanParams, { window: { from: 0, to: 3 } })).toBe(false);
    expect(ok(WavePlanParams, { objective: 'max_net' })).toBe(false);
    expect(ok(WavePlanParams, { maxLaunchesPerQuarter: 0 })).toBe(false);
    const detail = w.result.detail;
    expect(ok(SolverResult, { ...w.result, detail: { ...detail, quarters: [{ ...detail.quarters[0], quarter: 5 }] } })).toBe(false);
  });
});
