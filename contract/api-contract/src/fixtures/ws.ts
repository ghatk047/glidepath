import type { z } from 'zod';
import type {
  ClientMessage,
  ClientMessageType,
  ServerMessage,
  ServerMessageType,
  ViewName,
} from '../ws';

/**
 * Wire fixtures for `WS /ws/session` (JSON as sent over the socket). Tenant `zz` is fictional;
 * numbers here are test data only, not model results.
 */
type ClientIn = z.input<typeof ClientMessage>;
type ServerIn = z.input<typeof ServerMessage>;
type ClientOf<T extends ClientMessageType> = Extract<ClientIn, { type: T }>;
type ServerOf<T extends ServerMessageType> = Extract<ServerIn, { type: T }>;
type ViewMessageIn<V extends ViewName> = Extract<ServerOf<'view'>, { view: V }>;

export const sessionQueryFixture = { tenant: 'zz', scenario: 'sc-preset-c' };

/** One fixture per client → server message type. */
export const clientMessageFixtures = {
  subscribe: { v: 1, type: 'subscribe', cells: ['res.net[]', 'res.gap[]', 'vp.net[ops]'] },
  unsubscribe: { v: 1, type: 'unsubscribe', cells: ['vp.net[ops]'] },
  subscribeView: { v: 1, type: 'subscribeView', view: 'baseline.groups', params: { by: 'vp' } },
  unsubscribeView: { v: 1, type: 'unsubscribeView', view: 'bridge', params: {} },
  preview: { v: 1, type: 'preview', var: 'g.target_net', member: '', value: 150, seq: 7 },
  cancelPreview: { v: 1, type: 'cancelPreview', seq: 8 },
} satisfies { [T in ClientMessageType]: ClientOf<T> };

/** One `view` message per view name (payload shapes of ADR-021 view-models). */
export const viewMessageFixtures = {
  bridge: {
    v: 1,
    type: 'view',
    view: 'bridge',
    params: {},
    seq: null,
    payload: {
      steps: [
        { key: 'base', cell: 'base.total[]', value: 1000, from: 0, to: 1000 },
        { key: 'growth', cell: 'base.headwinds[]', value: 40, from: 1000, to: 1040 },
        { key: 'savings', cell: 'res.tot_iy[]', value: -130, from: 1040, to: 910 },
        { key: 'oneTime', cell: 'res.tot_ot_it[]', value: 20, from: 910, to: 930 },
        { key: 'outlay', cell: 'res.cy27_outlay[]', value: 930, from: 0, to: 930 },
      ],
      targetOutlay: 900,
      gap: 30,
    },
  },
  'baseline.groups': {
    v: 1,
    type: 'view',
    view: 'baseline.groups',
    params: { by: 'pool' },
    seq: null,
    payload: {
      total: 300,
      groups: [
        {
          key: 'infra',
          label: 'Infrastructure',
          value: 200,
          lines: [
            { key: 'ln-001', value: 120 },
            { key: 'ln-002', value: 80 },
          ],
        },
        { key: 'apps', label: 'Applications', value: 100, lines: [{ key: 'ln-003', value: 100 }] },
      ],
    },
  },
  'baseline.summary': {
    v: 1,
    type: 'view',
    view: 'baseline.summary',
    params: {},
    seq: null,
    payload: { lines: 3, linesInScope: 2 },
  },
  'levers.families': {
    v: 1,
    type: 'view',
    view: 'levers.families',
    params: {},
    seq: 12,
    payload: {
      total: 60,
      families: [
        { key: 'labour', label: 'Labour', value: 40, levers: ['L01', 'L02'] },
        { key: 'technology', label: 'Technology', value: 20, levers: ['L09'] },
      ],
    },
  },
  'levers.monthly': {
    v: 1,
    type: 'view',
    view: 'levers.monthly',
    params: {},
    seq: null,
    payload: {
      families: [{ key: 'technology', values: [0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 3, 3] }],
      levers: [{ key: 'L09', family: 'technology', values: [0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 3, 3] }],
    },
  },
  'levers.scale': {
    v: 1,
    type: 'view',
    view: 'levers.scale',
    params: {},
    seq: null,
    payload: { max: 45 },
  },
  'vps.domain_outlay': {
    v: 1,
    type: 'view',
    view: 'vps.domain_outlay',
    params: {},
    seq: null,
    payload: {
      domains: [
        { key: 'network', value: 70 },
        { key: 'data_analytics', value: 30 },
      ],
    },
  },
} satisfies { [V in ViewName]: ViewMessageIn<V> };

/** One fixture per server → client message type. */
export const serverMessageFixtures = {
  snapshot: {
    v: 1,
    type: 'snapshot',
    scenarioId: 'sc-preset-c',
    version: 3,
    cells: { 'res.net[]': 120, 'res.gap[]': -20, 'vp.net[ops]': null },
  },
  delta: { v: 1, type: 'delta', seq: 7, cells: { 'res.net[]': 126, 'res.gap[]': -14 } },
  view: viewMessageFixtures.bridge,
  warnings: {
    v: 1,
    type: 'warnings',
    seq: 7,
    violations: [
      {
        rule: 'VR04',
        cells: ['g.target_net[]'],
        severity: 'warning',
        message: 'Net target is above the registry maximum.',
      },
    ],
  },
  job: {
    v: 1,
    type: 'job',
    id: 'job-1',
    status: 'running',
    progress: 0.4,
    note: 'Searching 1,024 combinations',
  },
  changeset: {
    v: 1,
    type: 'changeset',
    scenarioId: 'sc-custom-c',
    version: 1,
    editsCount: 1,
    forkedFrom: 'sc-preset-c',
  },
} satisfies { [T in ServerMessageType]: ServerOf<T> };

/** `warnings` without a preview: a bad subscription answered with a problem (API-12). */
export const viewProblemFixture = {
  v: 1,
  type: 'warnings',
  seq: null,
  violations: [],
  problem: {
    type: '/problems/bad-request',
    title: 'Unknown view',
    status: 400,
    detail: "View 'levers.weekly' does not exist. Use one of the listed views.",
  },
} satisfies ServerOf<'warnings'>;

/**
 * Coalescing walk-through (see `PREVIEW_MAX_PER_SECOND` and `Preview` in ../ws.ts).
 * `sent` is what the client sends, at most 30 previews per second per cell. Each entry of
 * `reruns` is one server rerun: `pending` the seqs queued when it starts, `applies` the
 * previews it applies (the latest seq per cell), `answer` the message it sends back.
 * `superseded` previews are dropped and never answered.
 */
export const coalescingFixture = {
  sent: [
    {
      atMs: 0,
      message: { v: 1, type: 'preview', var: 'g.target_net', member: '', value: 140, seq: 1 },
    },
    {
      atMs: 34,
      message: { v: 1, type: 'preview', var: 'g.target_net', member: '', value: 141, seq: 2 },
    },
    {
      atMs: 50,
      message: { v: 1, type: 'preview', var: 'g.ot_out_share', member: '', value: 0.4, seq: 3 },
    },
    {
      atMs: 68,
      message: { v: 1, type: 'preview', var: 'g.target_net', member: '', value: 142, seq: 4 },
    },
    {
      atMs: 102,
      message: { v: 1, type: 'preview', var: 'g.target_net', member: '', value: 143, seq: 5 },
    },
    { atMs: 140, message: { v: 1, type: 'cancelPreview', seq: 6 } },
  ],
  reruns: [
    {
      pending: [1],
      applies: { 'g.target_net[]': 140 },
      answer: { v: 1, type: 'delta', seq: 1, cells: { 'res.net[]': 121, 'res.gap[]': -19 } },
    },
    {
      pending: [2, 3, 4],
      applies: { 'g.target_net[]': 142, 'g.ot_out_share[]': 0.4 },
      answer: { v: 1, type: 'delta', seq: 4, cells: { 'res.net[]': 124, 'res.gap[]': -18 } },
    },
    {
      pending: [5],
      applies: { 'g.target_net[]': 143 },
      answer: { v: 1, type: 'delta', seq: 5, cells: { 'res.gap[]': -17 } },
    },
    {
      pending: [6],
      applies: {},
      answer: { v: 1, type: 'delta', seq: 6, cells: { 'res.net[]': 120, 'res.gap[]': -20 } },
    },
  ],
  superseded: [2],
} satisfies {
  sent: { atMs: number; message: ClientOf<'preview'> | ClientOf<'cancelPreview'> }[];
  reruns: { pending: number[]; applies: Record<string, number>; answer: ServerOf<'delta'> }[];
  superseded: number[];
};
