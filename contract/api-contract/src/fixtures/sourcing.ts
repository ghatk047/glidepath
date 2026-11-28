import type { planRoutes, PlanRouteId, sourcingRoutes, SourcingRouteId } from '../routes';
import type { RouteFixture } from './core';

/**
 * SRC-03 wire fixtures: one per sourcing and plan route. Tenant `zz`, its vendors and contracts are
 * fictional; numbers are test data only and reconcile within each fixture.
 */
export type SourcingRouteFixtures = {
  [Id in SourcingRouteId]: RouteFixture<(typeof sourcingRoutes)[Id]>;
};
export type PlanRouteFixtures = { [Id in PlanRouteId]: RouteFixture<(typeof planRoutes)[Id]> };

const tenant = 'zz';
const scenario = 'sc-preset-c';

export const sourcingRouteFixtures = {
  sourcingVendors: {
    params: { tenant },
    query: { scenario },
    response: {
      scenarioId: scenario,
      year: 'fy27b',
      vendors: [
        {
          vendor: 'Northwind Services',
          vendorKey: 'northwind',
          preferred: true,
          aggregate: false,
          spend: 60,
          share: 0.6,
          cumulativeShare: 0.6,
          lineCount: 4,
          pools: ['si_contingent'],
          levers: ['L01', 'L04'],
          addressableShare: 0.75,
        },
        {
          vendor: 'Contoso Cloud',
          vendorKey: 'contoso',
          preferred: true,
          aggregate: false,
          spend: 30,
          share: 0.3,
          cumulativeShare: 0.9,
          lineCount: 2,
          pools: ['cloud_hosting'],
          levers: ['L09'],
          addressableShare: 1,
        },
        {
          vendor: 'Tailspin Consulting',
          vendorKey: null,
          preferred: false,
          aggregate: false,
          spend: 10,
          share: 0.1,
          cumulativeShare: 1,
          lineCount: 1,
          pools: ['si_contingent'],
          levers: [],
          addressableShare: 0.5,
        },
      ],
      totals: {
        thirdPartySpend: 100,
        hhi: 4600,
        top5Share: 1,
        preferredShare: 0.9,
        vendorCount: 3,
      },
    },
  },
  sourcingRenewals: {
    params: { tenant },
    query: { scenario },
    response: {
      scenarioId: scenario,
      asOf: '2026-11-26',
      planYear: 'fy27',
      renewals: [
        {
          contract: 'ct_northwind_ams',
          vendor: 'Northwind Services',
          vendorKey: 'northwind',
          category: 'Application managed services',
          annualValue: 24,
          renewalMonth: '2027-03',
          noticeDeadline: '2026-12-01',
          daysToDeadline: 5,
          status: 'act_now',
          escalatorExposure: 0.72,
          targetCut: 0.08,
          capture: 1.44,
        },
        {
          contract: 'ct_contoso_iaas',
          vendor: 'Contoso Cloud',
          vendorKey: 'contoso',
          category: 'Cloud hosting',
          annualValue: 12,
          renewalMonth: '2027-09',
          noticeDeadline: '2027-06-01',
          daysToDeadline: 187,
          status: 'later',
          escalatorExposure: 0.36,
          targetCut: 0.1,
          capture: 0.4,
        },
      ],
      totals: {
        contracts: 2,
        annualValue: 36,
        escalatorExposure: 1.08,
        capture: 1.84,
        byStatus: { overdue: 0, act_now: 1, plan: 0, later: 1 },
      },
      byMonth: [
        { month: '2027-03', renewals: 1, annualValue: 24, capture: 1.44 },
        { month: '2027-09', renewals: 1, annualValue: 12, capture: 0.4 },
      ],
    },
  },
  sourcingBenchmarks: {
    params: { tenant },
    query: { scenario },
    response: {
      scenarioId: scenario,
      rows: [
        {
          benchmark: 'bm_service_desk',
          line: 'it_101',
          label: 'Service desk contacts',
          pool: 'si_contingent',
          unit: 'contact',
          qty: 1_000_000,
          unitCost: 14,
          p25: 9,
          median: 11,
          p75: 13,
          percentile: 'median',
          gapPerUnit: 3,
          opportunity: 3,
          capturable: 1.5,
        },
        {
          benchmark: 'bm_storage',
          line: 'it_202',
          label: 'Block storage',
          pool: 'cloud_hosting',
          unit: 'TB-month',
          qty: 20_000,
          unitCost: 18,
          p25: 20,
          median: 24,
          p75: 30,
          percentile: 'median',
          gapPerUnit: 0,
          opportunity: 0,
          capturable: 0,
        },
      ],
      totals: { opportunity: 3, capturable: 1.5, leverSavings: 1, headroom: 0.5 },
    },
  },
  sourcingParams: {
    params: { tenant },
    query: { scenario },
    response: {
      params: [
        {
          key: 'discount_rate',
          label: 'Discount rate',
          group: 'Business case',
          value: 0.1,
          unit: '%',
          min: 0,
          max: 0.25,
          step: 0.005,
          sort: 1,
        },
        {
          key: 'concentration_cap',
          label: 'Largest vendor share cap',
          group: 'Consolidation',
          value: 0.35,
          unit: '%',
          min: 0.1,
          max: 0.8,
          step: 0.05,
          sort: 2,
        },
      ],
    },
  },
  sourcingMembers: {
    params: { tenant },
    query: { dim: 'contract' },
    response: {
      dim: 'contract',
      members: [
        {
          key: 'ct_northwind_ams',
          label: 'Northwind application managed services',
          attrs: {
            vendor_name: 'Northwind Services',
            vendor: 'northwind',
            category: 'Application managed services',
            lines: ['it_101', 'it_102'],
            renewal_month: '2027-03',
            notice_days: 90,
            escalator_pct: 0.03,
            auto_renew: 1,
            target_cut_pct: 0.08,
            source: 'test',
            confidence: 'M',
          },
          sort: 1,
          active: true,
        },
      ],
    },
  },
  sourcingConsolidation: {
    params: { tenant },
    body: { scenarioId: scenario, params: { concentration_cap: 0.7 } },
    response: {
      scenarioId: scenario,
      moves: [
        {
          from: 'Tailspin Consulting',
          fromKey: null,
          to: 'Northwind Services',
          toKey: 'northwind',
          pool: 'consulting',
          spendMoved: 10,
          annualSaving: 1.2,
          oneTimeCost: 0.6,
          paybackMonths: 6,
          netBenefit: 4.2,
        },
      ],
      totals: {
        spendMoved: 10,
        annualSaving: 1.2,
        oneTimeCost: 0.6,
        paybackMonths: 6,
        vendorsBefore: 3,
        vendorsAfter: 2,
      },
      hhiBefore: 4600,
      hhiAfter: 5800,
      topVendorShareAfter: 0.7,
      binding: [{ param: 'concentration_cap', label: 'Largest vendor share cap', value: 0.7 }],
      params: { concentration_cap: 0.7, consolidation_discount: 0.12, min_vendors: 2 },
      exact: true,
    },
  },
} satisfies SourcingRouteFixtures;

export const planRouteFixtures = {
  planBusinessCase: {
    params: { tenant },
    query: { scenario },
    response: {
      scenarioId: scenario,
      discountRate: 0.1,
      years: ['fy27', 'fy28', 'fy29'],
      levers: [
        {
          lever: 'L01',
          label: 'Demand management',
          savings: { fy27: 6, fy28: 10, fy29: 10 },
          oneTime: 4,
          runRate: 10,
          npv: 17.6,
          paybackMonths: 8,
          irr: 2.1,
          roi: 5.5,
        },
        {
          lever: 'L02',
          label: 'Consulting spend control',
          savings: { fy27: 2, fy28: 2, fy29: 2 },
          oneTime: 0,
          runRate: 2,
          npv: 5,
          paybackMonths: 0,
          irr: null,
          roi: null,
        },
      ],
      totals: {
        savings: { fy27: 8, fy28: 12, fy29: 12 },
        oneTime: 4,
        runRate: 12,
        npv: 22.6,
        paybackMonths: 6,
        irr: 2.6,
        roi: 7,
      },
    },
  },
} satisfies PlanRouteFixtures;
