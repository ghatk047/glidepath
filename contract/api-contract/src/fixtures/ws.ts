import type { z } from 'zod';
import type {
  ClientMessage,
  ClientMessageType,
  ServerMessage,
  ServerMessageType,
  SessionTimeline,
  ViewName,
} from '../ws';
import { changesetConflictFixture } from './core';

/**
 * Wire fixtures for `WS /ws/session` (JSON as sent over the socket). Tenant `zz` is fictional;
 * numbers here are test data only, not model results.
 */
type ClientIn = z.input<typeof ClientMessage>;
type ServerIn = z.input<typeof ServerMessage>;
type ClientOf<T extends ClientMessageType> = Extract<ClientIn, { type: T }>;
type ServerOf<T extends ServerMessageType> = Extract<ServerIn, { type: T }>;
type ViewMessageIn<V extends ViewName> = Extract<ServerOf<'view'>, { view: V }>;
type TimelineIn = z.input<typeof SessionTimeline>;

/** Two `org.dom_share` cells of one domain row: a VP ownership drag moves them together. */
const DA_COMMERCIAL = 'data_analytics,vp_commercial';
const DA_OPERATIONS = 'data_analytics,vp_operations';
const author = { id: 'u-1', name: 'Pat Owner' };

export const sessionQueryFixture = { tenant: 'zz', scenario: 'sc-preset-c' };

/** One fixture per client → server message type. */
export const clientMessageFixtures = {
  subscribe: { v: 1, type: 'subscribe', cells: ['res.net[]', 'res.gap[]', 'vp.net[ops]'] },
  unsubscribe: { v: 1, type: 'unsubscribe', cells: ['vp.net[ops]'] },
  subscribeView: { v: 1, type: 'subscribeView', view: 'baseline.groups', params: { by: 'vp' } },
  unsubscribeView: { v: 1, type: 'unsubscribeView', view: 'bridge', params: {} },
  preview: {
    v: 1,
    type: 'preview',
    seq: 7,
    changes: [
      { var: 'org.dom_share', member: DA_COMMERCIAL, value: 0.45 },
      { var: 'org.dom_share', member: DA_OPERATIONS, value: 0.25 },
    ],
  },
  cancelPreview: { v: 1, type: 'cancelPreview', seq: 8 },
  open: { v: 1, type: 'open', scenarioId: 'sc-preset-rates' },
} satisfies { [T in ClientMessageType]: ClientOf<T> };

/**
 * The CON-02 single-cell preview. Not a `ClientMessage`; `parseClientMessage` normalises it
 * to `normalisedLegacyPreviewFixture` for wire compatibility.
 */
export const legacyPreviewFixture = {
  v: 1,
  type: 'preview',
  var: 'g.target_net',
  member: '',
  value: 150,
  seq: 7,
};
export const normalisedLegacyPreviewFixture = {
  v: 1,
  type: 'preview',
  seq: 7,
  changes: [{ var: 'g.target_net', member: '', value: 150 }],
} satisfies ClientOf<'preview'>;

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
    changesetId: 'cs-9',
    origin: 'ui',
    author,
  },
  error: {
    v: 1,
    type: 'error',
    problem: {
      type: '/problems/bad-request',
      title: 'Unknown view',
      status: 400,
      detail: "View 'levers.weekly' does not exist. Use one of the listed views.",
    },
  },
} satisfies { [T in ServerMessageType]: ServerOf<T> };

/** A rejected frame (here a bad subscription, API-12) is answered with `error{problem}`. */
export const frameErrorFixture = serverMessageFixtures.error;
/** @deprecated CON-02 name, kept for importers; now an `error` message, not `warnings`. */
export const viewProblemFixture = frameErrorFixture;

const preview = (seq: number, changes: { var: string; member: string; value: number }[]) =>
  ({ v: 1, type: 'preview', seq, changes }) as const;
const target = (value: number) => [{ var: 'g.target_net', member: '', value }];
const shares = (commercial: number, operations: number) => [
  { var: 'org.dom_share', member: DA_COMMERCIAL, value: commercial },
  { var: 'org.dom_share', member: DA_OPERATIONS, value: operations },
];

/**
 * Coalescing walk-through (see `PREVIEW_MAX_PER_SECOND` and `Preview` in ../ws.ts).
 * `sent` is what the client sends, at most 30 previews per second per connection (across
 * all cells). Each entry of `reruns` is one server rerun: `pending` the seqs queued when it
 * starts, `applies` the cell values it applies (the latest seq per cell; the two
 * `org.dom_share` cells of a preview always together), `answer` the message it sends back.
 * `superseded` previews (every cell overwritten by a later queued one) are never answered.
 */
export const coalescingFixture = {
  sent: [
    { atMs: 0, message: preview(1, target(140)) },
    { atMs: 34, message: preview(2, target(141)) },
    { atMs: 68, message: preview(3, shares(0.4, 0.3)) },
    { atMs: 102, message: preview(4, target(142)) },
    { atMs: 136, message: preview(5, shares(0.45, 0.25)) },
    { atMs: 170, message: preview(6, target(143)) },
    { atMs: 190, message: { v: 1, type: 'cancelPreview', seq: 7 } },
  ],
  reruns: [
    {
      pending: [1],
      applies: { 'g.target_net[]': 140 },
      answer: { v: 1, type: 'delta', seq: 1, cells: { 'res.net[]': 121, 'res.gap[]': -19 } },
    },
    {
      pending: [2, 3, 4, 5],
      applies: {
        'g.target_net[]': 142,
        [`org.dom_share[${DA_COMMERCIAL}]`]: 0.45,
        [`org.dom_share[${DA_OPERATIONS}]`]: 0.25,
      },
      answer: {
        v: 1,
        type: 'delta',
        seq: 5,
        cells: { 'res.gap[]': -18, 'vp.net[vp_commercial]': -5.1, 'vp.net[vp_operations]': -9.4 },
      },
    },
    {
      pending: [6],
      applies: { 'g.target_net[]': 143 },
      answer: { v: 1, type: 'delta', seq: 6, cells: { 'res.gap[]': -17 } },
    },
    {
      pending: [7],
      applies: {},
      answer: {
        v: 1,
        type: 'delta',
        seq: 7,
        cells: {
          'res.net[]': 120,
          'res.gap[]': -20,
          'vp.net[vp_commercial]': -6,
          'vp.net[vp_operations]': -8.5,
        },
      },
    },
  ],
  superseded: [2, 3],
} satisfies {
  sent: { atMs: number; message: ClientOf<'preview'> | ClientOf<'cancelPreview'> }[];
  reruns: { pending: number[]; applies: Record<string, number>; answer: ServerOf<'delta'> }[];
  superseded: number[];
};

/**
 * Scenario switch: `open{scenarioId}` is answered by a `snapshot` of every subscribed cell
 * on the new scenario, then the subscribed views again (`seq: null`).
 */
export const openFixture = [
  { by: 'client', message: { v: 1, type: 'subscribe', cells: ['res.net[]', 'res.gap[]'] } },
  {
    by: 'server',
    message: {
      v: 1,
      type: 'snapshot',
      scenarioId: 'sc-preset-c',
      version: 3,
      cells: { 'res.net[]': 120, 'res.gap[]': -20 },
    },
  },
  { by: 'client', message: { v: 1, type: 'subscribeView', view: 'bridge', params: {} } },
  { by: 'server', message: viewMessageFixtures.bridge },
  { by: 'client', message: clientMessageFixtures.open },
  {
    by: 'server',
    message: {
      v: 1,
      type: 'snapshot',
      scenarioId: 'sc-preset-rates',
      version: 0,
      cells: { 'res.net[]': 8, 'res.gap[]': -132 },
    },
  },
  {
    by: 'server',
    message: {
      ...viewMessageFixtures.bridge,
      payload: { ...viewMessageFixtures.bridge.payload, gap: 142 },
    },
  },
] satisfies TimelineIn;

const subscribe = (cells: string[]) =>
  ({ by: 'client', message: { v: 1, type: 'subscribe', cells } }) as const;
const snapshot = (scenarioId: string, version: number, cells: Record<string, number>) =>
  ({ by: 'server', message: { v: 1, type: 'snapshot', scenarioId, version, cells } }) as const;
const delta = (seq: number | null, cells: Record<string, number>) =>
  ({ by: 'server', message: { v: 1, type: 'delta', seq, cells } }) as const;
const cancel = (seq: number) =>
  ({ by: 'client', message: { v: 1, type: 'cancelPreview', seq } }) as const;
const sent = (seq: number, changes: { var: string; member: string; value: number }[]) =>
  ({ by: 'client', message: preview(seq, changes) }) as const;
const changeset = (
  version: number,
  editsCount: number,
  changesetId: string,
  by: { id: string; name: string } = author,
) =>
  ({
    by: 'server',
    message: {
      v: 1,
      type: 'changeset',
      scenarioId: 'sc-custom-c',
      version,
      editsCount,
      changesetId,
      origin: 'ui',
      author: by,
    },
  }) as const;
const variable = (key: string, member: string, value: number) =>
  ({ target: 'variable', key, member, value }) as const;

const VPS = ['vp.net[vp_commercial]', 'vp.net[vp_operations]'];
const HEADLINE = ['res.net[]', 'res.gap[]'];
const VR01 = {
  rule: 'VR01' as const,
  cells: [`org.dom_share[${DA_COMMERCIAL}]`],
  severity: 'error' as const,
  message: 'Data & analytics ownership adds up to 110%. Make it 100%.',
};

/**
 * Scratch lifecycle around a commit (see `SessionStep` in ../ws.ts), one timeline each:
 * - `commit`: drag two ownership cells, release, commit; the preview rebases; cancel after
 *   the POST resolved.
 * - `conflict`: another user commits mid-drag (rebase), the POST gets 409, tier 1 re-sends
 *   its edits on `serverVersion`, then cancels.
 * - `fork`: the first edit on locked preset C forks `sc-custom-c`; the session follows.
 * - `rejected`: a one-cell ownership change breaks VR01; the POST gets 422; tier 1 cancels
 *   and the numbers and warnings go back to the committed state.
 */
export const scratchLifecycleFixtures = {
  commit: [
    subscribe(VPS),
    snapshot('sc-custom-c', 4, { 'vp.net[vp_commercial]': -6, 'vp.net[vp_operations]': -8.5 }),
    sent(1, shares(0.45, 0.25)),
    delta(1, { 'vp.net[vp_commercial]': -5.1, 'vp.net[vp_operations]': -9.4 }),
    {
      by: 'post',
      request: {
        scenarioId: 'sc-custom-c',
        baseVersion: 4,
        clientRequestId: 'rq-7f3a',
        changes: [
          variable('org.dom_share', DA_COMMERCIAL, 0.45),
          variable('org.dom_share', DA_OPERATIONS, 0.25),
        ],
      },
    },
    changeset(5, 3, 'cs-12'),
    delta(null, { 'vp.net[vp_commercial]': -5.1, 'vp.net[vp_operations]': -9.4 }),
    delta(1, {}),
    {
      by: 'postResolved',
      result: {
        changesetId: 'cs-12',
        scenarioId: 'sc-custom-c',
        version: 5,
        editsCount: 3,
        inputHash: 'sha256:77aa',
        outputs: { 'res.net[]': 119.3 },
        warnings: [],
      },
    },
    cancel(2),
    delta(2, {}),
  ],
  conflict: [
    subscribe(HEADLINE),
    snapshot('sc-custom-c', 5, { 'res.net[]': 119.3, 'res.gap[]': -23.7 }),
    sent(1, target(150)),
    delta(1, { 'res.gap[]': -30.7 }),
    {
      by: 'post',
      request: {
        scenarioId: 'sc-custom-c',
        baseVersion: 5,
        clientRequestId: 'rq-1',
        changes: [variable('g.target_net', '', 150)],
      },
    },
    changeset(6, 4, 'cs-13', { id: 'u-2', name: 'Sam Analyst' }),
    delta(null, { 'res.net[]': 121, 'res.gap[]': -22 }),
    delta(1, { 'res.gap[]': -29 }),
    {
      by: 'postFailed',
      problem: {
        ...changesetConflictFixture,
        serverVersion: 6,
        changesSince: changesetConflictFixture.changesSince.map((c) => ({
          ...c,
          changesetId: 'cs-13',
        })),
      },
    },
    {
      by: 'post',
      request: {
        scenarioId: 'sc-custom-c',
        baseVersion: 6,
        clientRequestId: 'rq-2',
        changes: [variable('g.target_net', '', 150)],
      },
    },
    changeset(7, 5, 'cs-14'),
    delta(null, { 'res.gap[]': -29 }),
    delta(1, {}),
    {
      by: 'postResolved',
      result: {
        changesetId: 'cs-14',
        scenarioId: 'sc-custom-c',
        version: 7,
        editsCount: 5,
        inputHash: 'sha256:5e0d',
        outputs: { 'res.net[]': 121, 'res.gap[]': -29 },
        warnings: [],
      },
    },
    cancel(2),
    delta(2, {}),
  ],
  fork: [
    subscribe(HEADLINE),
    snapshot('sc-preset-c', 3, { 'res.net[]': 120, 'res.gap[]': -20 }),
    sent(1, target(150)),
    delta(1, { 'res.gap[]': -27 }),
    {
      by: 'post',
      request: {
        scenarioId: 'sc-preset-c',
        baseVersion: 3,
        clientRequestId: 'rq-9',
        changes: [variable('g.target_net', '', 150)],
      },
    },
    { by: 'server', message: serverMessageFixtures.changeset },
    delta(null, { 'res.gap[]': -27 }),
    delta(1, {}),
    {
      by: 'postResolved',
      result: {
        changesetId: 'cs-9',
        scenarioId: 'sc-custom-c',
        version: 1,
        editsCount: 1,
        inputHash: 'sha256:9f2c',
        outputs: { 'res.net[]': 120, 'res.gap[]': -27 },
        warnings: [],
        forkedFrom: 'sc-preset-c',
      },
    },
    cancel(2),
    delta(2, {}),
  ],
  rejected: [
    subscribe(VPS),
    snapshot('sc-custom-c', 5, { 'vp.net[vp_commercial]': -5.1, 'vp.net[vp_operations]': -9.4 }),
    sent(1, [{ var: 'org.dom_share', member: DA_COMMERCIAL, value: 0.55 }]),
    delta(1, { 'vp.net[vp_commercial]': -4.2 }),
    { by: 'server', message: { v: 1, type: 'warnings', seq: 1, violations: [VR01] } },
    {
      by: 'post',
      request: {
        scenarioId: 'sc-custom-c',
        baseVersion: 5,
        clientRequestId: 'rq-3',
        changes: [variable('org.dom_share', DA_COMMERCIAL, 0.55)],
      },
    },
    {
      by: 'postFailed',
      problem: {
        type: '/problems/validation',
        title: 'Rule broken',
        status: 422,
        detail: VR01.message,
        violations: [VR01],
      },
    },
    cancel(2),
    delta(2, { 'vp.net[vp_commercial]': -5.1 }),
    { by: 'server', message: { v: 1, type: 'warnings', seq: 2, violations: [] } },
  ],
} satisfies Record<'commit' | 'conflict' | 'fork' | 'rejected', TimelineIn>;
