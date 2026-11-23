import { TenantSlug, UserId, WS_PROTOCOL_VERSION, parseServerMessage, viewSchemas } from '@glidepath/api-contract';
import type { ScenarioId, ServerMessage } from '@glidepath/api-contract';
import { VIEWS } from '@glidepath/domain';
import type { CellKey as EngineCell } from '@glidepath/engine';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommitUpdate } from './session';
import { Session } from './session';
import type { ScenarioLoader, ScenarioState } from './loader';
import { SEED_TENANT, seedLoader } from './testing/seed';
import type { SeedLoader } from './testing/seed';

/**
 * API-12 on the session core (no socket or database): the seed tenant's presets through a ModelCache, a
 * manual scheduler, every outgoing frame checked against the contract (views included). Expected payloads
 * come from DOM-06 `VIEWS` on the evaluation the client should see.
 */

const v = WS_PROTOCOL_VERSION;
const user = UserId.parse('user-1');
const tenant = { tenantId: SEED_TENANT, slug: TenantSlug.parse('t1'), role: 'editor' as const };

let loader: SeedLoader;
let presetC: ScenarioState;
let presetD: ScenarioState;
let frames: ServerMessage[] = [];
let runs: (() => void)[] = [];
let session: Session;

const tick = () => {
  while (runs.length > 0) {
    const due = runs;
    runs = [];
    for (const run of due) run();
  }
};
const settle = () => new Promise((r) => setTimeout(r, 0));

function open(state: ScenarioState = presetC, withLoader: ScenarioLoader = loader): Session {
  frames = [];
  runs = [];
  return new Session({
    userId: user,
    tenant,
    state,
    loader: withLoader,
    schedule: (run) => void runs.push(run),
    send: (m) => {
      const parsed = parseServerMessage(JSON.parse(JSON.stringify(m)));
      if (!parsed.ok) throw new Error(`server frame breaks the contract: ${parsed.detail}`);
      frames.push(parsed.message);
    },
  });
}

type View = Extract<ServerMessage, { type: 'view' }>;
const views = (name?: string): View[] =>
  frames.filter((m): m is View => m.type === 'view' && (name === undefined || m.view === name));
const types = () => frames.map((m) => m.type);

/** The payload DOM-06 gives for `view` on `at`, through the contract's schema as the wire has it. */
function expected(view: keyof typeof VIEWS, at: ScenarioState['committed'], params: unknown = {}, state = presetC) {
  const fn = VIEWS[view] as (ev: unknown, m: unknown, p: unknown) => unknown;
  return JSON.parse(JSON.stringify(viewSchemas[view].payload.parse(fn(at, state.model.members, params))));
}

const TARGET = 'g.target_net';
const CONF = 'lev.conf';

beforeAll(async () => {
  loader = await seedLoader();
  presetC = (await loader.load({ tenantId: SEED_TENANT, userId: user }, 'C'))!;
  presetD = (await loader.load({ tenantId: SEED_TENANT, userId: user }, 'D'))!;
});

beforeEach(() => {
  session = open();
});

describe('subscribeView → view', () => {
  it('bridge: a view after the snapshot, then after every rerun, cancel and commit that changes it', async () => {
    const targetDef = loader.bundle.variables.find((x) => x.id === TARGET)!;
    session.receive({ v, type: 'subscribe', cells: ['res.net[]'] });
    session.receive({ v, type: 'subscribeView', view: 'bridge', params: {} });
    await settle();
    expect(types()).toEqual(['snapshot', 'view']);
    expect(views()[0]).toMatchObject({ view: 'bridge', params: {}, seq: null });
    expect(views()[0]!.payload).toEqual(expected('bridge', presetC.committed));

    // A preview of the target moves the dashed target line and the gap: view{seq} after delta{seq}.
    frames.length = 0;
    const moved = targetDef.min! === presetC.committed.get(TARGET) ? targetDef.min! + targetDef.step! : targetDef.min!;
    session.receive({ v, type: 'preview', seq: 1, changes: [{ var: TARGET, member: '', value: moved }] });
    tick();
    expect(types().slice(0, 2)).toEqual(['delta', 'view']);
    expect(views()[0]).toMatchObject({ view: 'bridge', seq: 1 });
    expect(views()[0]!.payload).toEqual(expected('bridge', session.current));
    expect(views()[0]!.payload).not.toEqual(expected('bridge', presetC.committed));

    // A second preview that leaves the bridge alone (a cell it does not read) pushes no view.
    frames.length = 0;
    const lever = presetC.model.members.lever![0]!.id;
    const before = session.current.get(`${CONF}[${lever}]`);
    session.receive({ v, type: 'preview', seq: 2, changes: [{ var: CONF, member: lever, value: before }] });
    tick();
    expect(views()).toHaveLength(0);

    // cancelPreview goes back to the committed bridge.
    frames.length = 0;
    session.receive({ v, type: 'cancelPreview', seq: 3 });
    expect(types().slice(0, 2)).toEqual(['delta', 'view']);
    expect(views()[0]).toMatchObject({ seq: 3 });
    expect(views()[0]!.payload).toEqual(expected('bridge', presetC.committed));

    // A commit of the target: delta{null}, then view{null}.
    frames.length = 0;
    const committedTo = presetC.model.model.rerun(presetC.committed, [{ target: 'variable', cell: TARGET, value: moved }]);
    await session.applyCommit(commitOf(presetC, committedTo));
    expect(types()).toEqual(['changeset', 'delta', 'view']);
    expect(views()[0]).toMatchObject({ seq: null });
    expect(views()[0]!.payload).toEqual(expected('bridge', committedTo));
  });

  it('baseline.groups: a view after the snapshot and after the rerun and commit that move ownership', async () => {
    const domain = presetC.model.members.domain![0]!.id;
    const vps = presetC.model.members.vp!.map((m) => m.id);
    const split = vps.map((vp, i) => ({ var: 'org.dom_share', member: `${domain},${vp}`, value: i === 0 ? 0.25 : i === 1 ? 0.75 : 0 }));

    session.receive({ v, type: 'subscribe', cells: ['res.net[]'] });
    session.receive({ v, type: 'subscribeView', view: 'baseline.groups', params: { by: 'vp' } });
    await settle();
    expect(types()).toEqual(['snapshot', 'view']);
    expect(views()[0]).toMatchObject({ view: 'baseline.groups', params: { by: 'vp' }, seq: null });
    expect(views()[0]!.payload).toEqual(expected('baseline.groups', presetC.committed, { by: 'vp' }));

    frames.length = 0;
    session.receive({ v, type: 'preview', seq: 1, changes: split });
    tick();
    expect(types().slice(0, 2)).toEqual(['delta', 'view']);
    expect(views()[0]).toMatchObject({ seq: 1 });
    const payload = views()[0]!.payload;
    expect(payload).toEqual(expected('baseline.groups', session.current, { by: 'vp' }));
    expect(payload).not.toEqual(expected('baseline.groups', presetC.committed, { by: 'vp' }));

    // The same ownership committed: the scratch is rebased; view{null} for the new committed state, and
    // the rebase's view{S} only when what the client shows differs.
    frames.length = 0;
    const committedTo = presetC.model.model.rerun(
      presetC.committed,
      split.map((c) => ({ target: 'variable' as const, cell: `${c.var}[${c.member}]` as EngineCell, value: c.value })),
    );
    await session.applyCommit(commitOf(presetC, committedTo));
    expect(types().slice(0, 3)).toEqual(['changeset', 'delta', 'view']);
    expect(views()[0]).toMatchObject({ seq: null });
    expect(views()[0]!.payload).toEqual(expected('baseline.groups', committedTo, { by: 'vp' }));
    // Scratch and committed agree, and the client already shows the committed payload: nothing more.
    expect(views()).toHaveLength(1);
  });

  it('two subscriptions of one view with different params are independent; unsubscribeView stops the pushes', async () => {
    session.receive({ v, type: 'subscribeView', view: 'baseline.groups', params: { by: 'pool' } });
    session.receive({ v, type: 'subscribeView', view: 'baseline.groups', params: { by: 'domain' } });
    await settle();
    expect(views().map((m) => m.params)).toEqual([{ by: 'pool' }, { by: 'domain' }]);

    session.receive({ v, type: 'unsubscribeView', view: 'baseline.groups', params: { by: 'pool' } });
    session.receive({ v, type: 'unsubscribeView', view: 'bridge', params: {} }); // never subscribed: no-op
    frames.length = 0;
    const lever = presetC.model.members.lever![0]!.id;
    session.receive({ v, type: 'preview', seq: 1, changes: [{ var: 'lev.on', member: lever, value: session.current.get(`lev.on[${lever}]`) === 1 ? 0 : 1 }] });
    tick();
    expect(views('baseline.groups').every((m) => (m.params as { by: string }).by === 'domain')).toBe(true);
    expect(frames.filter((m) => m.type === 'error')).toHaveLength(0);
  });

  it('every view of the contract is served with a payload its schema accepts', async () => {
    const all = [
      ['bridge', {}],
      ['baseline.groups', { by: 'pool' }],
      ['baseline.summary', {}],
      ['levers.families', {}],
      ['levers.monthly', {}],
      ['levers.scale', {}],
      ['vps.domain_outlay', {}],
    ] as const;
    for (const [view, params] of all) session.receive({ v, type: 'subscribeView', view, params });
    await settle();
    expect(frames.filter((m) => m.type === 'error')).toEqual([]);
    expect(views().map((m) => m.view)).toEqual(all.map(([n]) => n));
    // levers.scale reads preset D, not the session's scenario.
    expect(views('levers.scale')[0]!.payload).toEqual(expected('levers.scale', presetD.committed));
  });

  it('open re-sends every subscribed view after the snapshot, for the new scenario', async () => {
    session.receive({ v, type: 'subscribe', cells: ['res.net[]'] });
    session.receive({ v, type: 'subscribeView', view: 'bridge', params: {} });
    await settle();
    frames.length = 0;
    session.receive({ v, type: 'open', scenarioId: 'D' });
    await settle();
    expect(types()).toEqual(['snapshot', 'view']);
    expect(views()[0]).toMatchObject({ seq: null });
    expect(views()[0]!.payload).toEqual(expected('bridge', presetD.committed));
  });
});

describe('unknown view or params', () => {
  it('is a problem on the wire (`error{problem}`, as CON-02 words it), the session stays open and keeps its views', async () => {
    session.receive({ v, type: 'subscribeView', view: 'bridge', params: {} });
    await settle();
    frames.length = 0;
    session.receive({ v, type: 'subscribeView', view: 'no.such.view', params: {} });
    session.receive({ v, type: 'subscribeView', view: 'baseline.groups', params: { by: 'planet' } });
    session.receive({ v, type: 'subscribeView', view: 'baseline.groups', params: {} });
    session.receive({ v, type: 'subscribeView', view: 'bridge', params: { by: 'pool' } });
    await settle();
    expect(frames.map((m) => m.type)).toEqual(['error', 'error', 'error', 'error']);
    for (const m of frames) {
      expect(m).toMatchObject({ type: 'error', problem: { status: 400 } });
    }
    expect(views()).toHaveLength(0);
    expect(session.isClosed).toBe(false);
    expect(session.counters.rejected).toBe(4);

    // Still alive: the earlier subscription keeps pushing.
    const lever = presetC.model.members.lever![0]!.id;
    session.receive({ v, type: 'preview', seq: 1, changes: [{ var: 'lev.on', member: lever, value: session.current.get(`lev.on[${lever}]`) === 1 ? 0 : 1 }] });
    tick();
    expect(frames.some((m) => m.type === 'delta')).toBe(true);
  });

  it('levers.scale without a scale preset is a 404 `error`, the session stays open', async () => {
    const noD: ScenarioLoader = { load: async (scope, id) => (id === 'D' ? null : loader.load(scope, id)) };
    session = open(presetC, noD);
    session.receive({ v, type: 'subscribeView', view: 'levers.scale', params: {} });
    await settle();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: 'error', problem: { status: 404 } });
    expect(session.isClosed).toBe(false);
  });
});

/** The commit notice a session gets: `state` is the scenario one version on with `committed` values. */
function commitOf(from: ScenarioState, committed: ScenarioState['committed']): CommitUpdate {
  return {
    on: from.scenarioId,
    state: { scenarioId: from.scenarioId as ScenarioId, version: from.version + 1, model: from.model, committed },
    message: {
      v,
      type: 'changeset',
      scenarioId: from.scenarioId as ScenarioId,
      version: from.version + 1,
      editsCount: 1,
    } as CommitUpdate['message'],
  };
}
