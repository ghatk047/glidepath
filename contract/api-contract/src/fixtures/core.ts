import type { z } from 'zod';
import type { ChangesetConflict, ChangesetResult } from '../changeset';
import type { coreRoutes, CoreRouteId } from '../routes';

/**
 * One wire-format fixture per core route (JSON as sent over HTTP). Tenant `zz` and
 * "Fixture Air" are fictional; no airline marks. Numbers here are test data only.
 */
type Part<R, K extends string> = R extends Record<K, z.ZodType> ? z.input<R[K]> : never;
export type RouteFixture<R> = {
  [
    K in 'params' | 'query' | 'body' | 'response' as R extends Record<K, z.ZodType> ? K : never
  ]: Part<R, K>;
};
export type CoreRouteFixtures = { [Id in CoreRouteId]: RouteFixture<(typeof coreRoutes)[Id]> };

const tenant = 'zz';
const at = '2026-11-20T09:30:00.000Z';

const scenarioC = {
  id: 'sc-preset-c',
  key: 'C',
  label: 'Plan C',
  kind: 'preset',
  parentId: null,
  modelVersionId: 'mv-1',
  version: 3,
  editsCount: 0,
  locked: true,
  archived: false,
  createdBy: null,
  createdAt: at,
} as const;

const customC = {
  ...scenarioC,
  id: 'sc-custom-c',
  key: 'user-1',
  label: 'Custom (from Plan C)',
  kind: 'user',
  parentId: 'sc-preset-c',
  version: 0,
  locked: false,
  createdBy: 'u-1',
} as const;

const changesetResult = {
  changesetId: 'cs-9',
  scenarioId: 'sc-custom-c',
  version: 1,
  editsCount: 1,
  inputHash: 'sha256:9f2c',
  outputs: { 'res.net[]': 119.3, 'res.bar[]': 143, 'res.gap[]': -23.7 },
  warnings: [],
  forkedFrom: 'sc-preset-c',
} satisfies z.input<typeof ChangesetResult>;

export const coreRouteFixtures = {
  me: {
    response: {
      user: { id: 'u-1', email: 'owner@example.com', name: 'Pat Owner' },
      memberships: [
        { tenantId: 't-zz', tenantSlug: tenant, tenantName: 'Fixture Air', role: 'owner' },
      ],
    },
  },
  tenants: {
    response: {
      tenants: [
        {
          id: 't-zz',
          slug: tenant,
          name: 'Fixture Air',
          currency: 'USD',
          baseYear: 2026,
          targetYear: 2027,
          fiscalCalendar: 'calendar',
          ticker: null,
          status: 'active',
          modelVersionId: 'mv-1',
          role: 'owner',
        },
      ],
    },
  },
  bundle: {
    params: { tenant },
    response: {
      modelVersion: { id: 'mv-1', semver: '1.0.0' },
      variables: [
        {
          id: 'g.target_net',
          label: 'Net savings target',
          unit: '$M',
          type: 'number',
          kind: 'decision',
          dims: [],
          min: 0,
          max: 300,
          step: 0.5,
          group: 'Target & governance',
          layer: 'target',
          role: 'driver',
          ui: { control: 'slider', hero: true },
          source: 'user',
          confidence: 'H',
          note: '',
          scenarioVaries: true,
        },
      ],
      nodes: [
        {
          id: 'res.net',
          label: 'Net in-year saving',
          unit: '$M',
          dims: [],
          layer: 'results',
          output: true,
          overridable: true,
        },
      ],
      dimensions: [{ id: 'vp', label: 'Org unit (VP)', scope: 'tenant', attributes: ['label'] }],
    },
  },
  members: {
    params: { tenant },
    response: {
      membersHash: 'sha256:members-1',
      dimensions: {
        vp: [{ key: 'cio', label: 'CIO', attrs: {}, sort: 1, active: true }],
        line: [
          {
            key: 'it_001',
            label: 'Mainframe hosting',
            attrs: { pool: 'infra', domain: 'core_ops', in_scope: true },
            sort: null,
            active: true,
          },
        ],
      },
    },
  },
  scenarios: {
    params: { tenant },
    response: { scenarios: [scenarioC, customC] },
  },
  scenarioCreate: {
    params: { tenant },
    body: {
      mode: 'blend',
      parts: [
        { scenarioId: 'sc-preset-c', weight: 0.5 },
        { scenarioId: 'sc-preset-d', weight: 0.5 },
      ],
    },
    response: {
      ...customC,
      id: 'sc-blend-1',
      key: 'blend-1',
      label: 'Blend C/D',
      kind: 'blend',
      parentId: null,
    },
  },
  scenarioPatch: {
    params: { tenant, id: 'sc-custom-c' },
    body: { label: 'Board case', locked: true },
    response: { ...customC, label: 'Board case', locked: true },
  },
  scenarioInputs: {
    params: { tenant, id: 'sc-custom-c' },
    response: {
      scenarioId: 'sc-custom-c',
      version: 1,
      inputs: [
        {
          var: 'g.target_net',
          member: '',
          value: 150,
          from: 'scenario',
          fromScenarioId: 'sc-custom-c',
          confidence: null,
          note: null,
        },
        {
          var: 'hc.rate',
          member: 'pilots,fy27',
          value: 0.031,
          from: 'tenant',
          fromScenarioId: null,
          confidence: 'M',
          note: 'Contract step-up',
        },
      ],
      overrides: [
        {
          node: 'base.pool_outlay',
          member: 'si',
          value: 118,
          reason: 'Finance says SI pool is 118',
        },
      ],
    },
  },
  changesetApply: {
    params: { tenant },
    body: {
      scenarioId: 'sc-preset-c',
      baseVersion: 3,
      changes: [
        { target: 'variable', key: 'g.target_net', member: '', value: 150, note: 'Board ask' },
      ],
    },
    response: changesetResult,
  },
  changesetRevert: {
    params: { tenant, id: 'cs-9' },
    body: { baseVersion: 1 },
    response: {
      changesetId: 'cs-10',
      scenarioId: 'sc-custom-c',
      version: 2,
      editsCount: 0,
      inputHash: 'sha256:1a7e',
      outputs: { 'res.net[]': 112.1 },
      warnings: [],
      reverts: 'cs-9',
    },
  },
  changesetHistory: {
    params: { tenant, id: 'sc-custom-c' },
    query: { limit: 20 },
    response: {
      scenarioId: 'sc-custom-c',
      changesets: [
        {
          id: 'cs-9',
          scenarioId: 'sc-custom-c',
          origin: 'ui',
          status: 'applied',
          baseVersion: 0,
          editsCount: 1,
          createdBy: 'u-1',
          createdByName: 'Pat Owner',
          createdAt: at,
          revertsId: null,
          summary: 'Net savings target 143 → 150',
          changes: [
            {
              seq: 0,
              target: 'variable',
              key: 'g.target_net',
              member: '',
              op: 'update',
              oldValue: 143,
              newValue: 150,
              note: 'Board ask',
            },
          ],
        },
      ],
      nextCursor: null,
    },
  },
  scenarioCalc: {
    params: { tenant, id: 'sc-custom-c' },
    response: {
      scenarioId: 'sc-custom-c',
      scenarioVersion: 1,
      modelVersionId: 'mv-1',
      inputHash: 'sha256:9f2c',
      ms: 31,
      createdAt: at,
      stale: false,
      outputs: { 'res.net[]': 119.3, 'vp.net[cio]': 41.2 },
    },
  },
  nodeExplain: {
    params: { tenant, cell: 'res.net[]' },
    query: { scenario: 'sc-custom-c' },
    response: {
      cell: 'res.net[]',
      node: 'res.net',
      member: '',
      label: 'Net in-year saving',
      unit: '$M',
      value: 119.3,
      expression: 'res.tot_iy - res.tot_ot_it',
      words: 'In-year savings minus one-time cost carried in IT',
      override: null,
      upstream: [
        {
          cell: 'res.tot_iy[]',
          kind: 'node',
          label: 'In-year savings',
          unit: '$M',
          value: 138.8,
          depth: 1,
        },
        {
          cell: 'res.tot_ot_it[]',
          kind: 'node',
          label: 'One-time in IT',
          unit: '$M',
          value: 19.6,
          depth: 1,
        },
      ],
      drivers: [
        { cell: 'lev.L10.shelf[]', label: 'Shelfware cut', unit: '%', value: 0.3, impact: 12.4 },
      ],
    },
  },
  search: {
    params: { tenant },
    query: { q: 'cloud', limit: 9 },
    response: {
      q: 'cloud',
      results: [
        {
          kind: 'lever',
          id: 'L09',
          label: 'Application rationalisation',
          unit: '$M',
          group: 'Technology',
          module: 'levers',
          hint: null,
        },
        {
          kind: 'screen',
          id: 'market',
          label: 'Market',
          unit: null,
          group: null,
          module: 'market',
          hint: 'Share price and fuel',
        },
      ],
    },
  },
} satisfies CoreRouteFixtures;

/**
 * 409 of `POST /changesets` (and revert): nothing was applied; tier 1 re-sends its pending
 * edits on `serverVersion` (04 §4). The `detail` says so in the UI's words.
 */
export const changesetConflictFixture = {
  type: '/problems/version-conflict',
  title: 'Scenario changed',
  status: 409,
  detail:
    'Someone else changed this scenario first. Your edits are being re-sent on the new version.',
  serverVersion: 9,
  changesSince: [
    {
      changesetId: 'cs-8',
      seq: 0,
      target: 'variable',
      key: 'hc.us',
      member: '',
      op: 'update',
      oldValue: 9000,
      newValue: 9100,
    },
  ],
} satisfies z.input<typeof ChangesetConflict>;
