import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_MIN_INTERVAL_MS, WS_SESSION_PATH, toCellKey } from '@glidepath/api-contract';
import {
  coalescingFixture,
  createMockSession,
  frameErrorFixture,
  openFixture,
  presetSnapshot,
  scratchLifecycleFixtures,
  specFixtures,
  viewMessageFixtures,
  type MockSessionOptions,
  type MockSocket,
} from '@glidepath/api-contract/testing';
import {
  BACKOFF_INITIAL_MS,
  createSessionClient,
  selectCell,
  selectView,
  type SessionClientOptions,
} from './index';

const C = presetSnapshot('C');
const RATES = presetSnapshot('rates');
const NET = toCellKey('res.net');
const GAP = toCellKey('res.gap');
const TARGET = { var: 'g.target_net', member: '' } as const;
const SHARE = { var: 'g.ot_out_share', member: '' } as const;
/** The two `org.dom_share` cells a VP ownership drag moves together (CON-05 batched preview). */
const SHARES = coalescingFixture.sent[2]!.message as {
  changes: { var: string; member: string; value: number }[];
};
type PreviewFrame = { seq: number; changes: { var: string; member: string; value: number }[] };
/** The one cell of a single-cell preview frame, as `[value, seq]`. */
const single = (m: PreviewFrame) => {
  expect(m.changes).toHaveLength(1);
  return [m.changes[0]!.value, m.seq];
};
/** A preview frame as `{ 'var[member]': value }`, order-free. */
const cellsOf = (m: PreviewFrame) =>
  Object.fromEntries(m.changes.map((c) => [toCellKey(c.var, c.member), c.value]));
const rerun = (i: number) => {
  const { seq, cells } = coalescingFixture.reruns[i]!.answer;
  return {
    answer: { v: 1 as const, type: 'delta' as const, seq, cells: cells as Record<string, number> },
  };
};
const rerun1 = rerun(0);
const rerun2 = rerun(1);

/** Animation frames driven by the test: `run()` fires the callbacks requested so far. */
function manualFrames() {
  const queue: (() => void)[] = [];
  return {
    request: (cb: () => void) => void queue.push(cb),
    get pending() {
      return queue.length;
    },
    run() {
      for (const cb of queue.splice(0)) cb();
    },
  };
}

interface SetupOptions {
  mock?: MockSessionOptions;
  client?: Partial<SessionClientOptions>;
  /** How many upcoming connects should be refused (they go to a wrong path). */
  refuseNext?: number;
}

function setup(options: SetupOptions = {}) {
  const session = createMockSession({
    views: [viewMessageFixtures.bridge, viewMessageFixtures['baseline.groups']],
    ...options.mock,
  });
  const frames = manualFrames();
  const urls: string[] = [];
  /** Time (Date.now) of every preview frame the client wrote to a socket. */
  const previewTimes: number[] = [];
  let refuse = options.refuseNext ?? 0;
  const connect = (url: string): MockSocket => {
    urls.push(url);
    const target = refuse > 0 ? url.replace(WS_SESSION_PATH, '/refused') : url;
    if (refuse > 0) refuse -= 1;
    const socket = session.connect(target);
    const send = socket.send.bind(socket);
    socket.send = (data: string) => {
      if (JSON.parse(data).type === 'preview') previewTimes.push(Date.now());
      send(data);
    };
    return socket;
  };
  const client = createSessionClient({
    tenant: specFixtures.tenant,
    scenario: C.scenarioId,
    origin: 'ws://localhost:8080',
    connect,
    requestFrame: frames.request,
    random: () => 0,
    ...options.client,
  });
  /** Delivers everything in flight, then runs the animation frame that applies it. */
  const settle = async () => {
    await session.flush();
    frames.run();
  };
  const cell = (key: string) => selectCell(key)(client.store.getState());
  return {
    session,
    client,
    frames,
    urls,
    previewTimes,
    settle,
    cell,
    setRefuse: (n: number) => (refuse = n),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AC1: connects /ws/session?tenant&scenario; reference-counted subscribe/unsubscribe per cell and per view', () => {
  it('opens /ws/session with the tenant and scenario as query parameters', async () => {
    const { session, client, urls, settle } = setup();
    expect(client.store.getState().status).toBe('connecting');
    await settle();
    const url = new URL(urls[0]!);
    expect(url.origin).toBe('ws://localhost:8080');
    expect(url.pathname).toBe(WS_SESSION_PATH);
    expect(session.query).toEqual({ tenant: specFixtures.tenant, scenario: C.scenarioId });
    expect(session.refused).toEqual([]);
    expect(client.store.getState().status).toBe('open');
    client.close();
  });

  it('counts references per cell: one subscribe per new cell, unsubscribe when the last holder releases', async () => {
    const { session, client, settle, cell } = setup();
    await settle();
    const releaseA = client.subscribe([NET, GAP]);
    const releaseB = client.subscribe([NET]);
    await settle();
    expect(session.sentOf('subscribe').map((m) => m.cells)).toEqual([[NET, GAP]]);
    expect(cell(NET)).toEqual({ value: C.cells[NET], stale: false });
    expect(cell(GAP)).toEqual({ value: C.cells[GAP], stale: false });

    releaseA();
    releaseA(); // a release is idempotent
    await settle();
    expect(session.sentOf('unsubscribe').map((m) => m.cells)).toEqual([[GAP]]);
    expect([...session.subscribed]).toEqual([NET]);
    expect(cell(GAP)).toBeUndefined();
    expect(cell(NET)?.value).toBe(C.cells[NET]);

    releaseB();
    await settle();
    expect(session.sentOf('unsubscribe').map((m) => m.cells)).toEqual([[GAP], [NET]]);
    expect(session.subscribed.size).toBe(0);
    expect(cell(NET)).toBeUndefined();

    client.subscribe([NET]);
    await settle();
    expect(session.sentOf('subscribe').map((m) => m.cells)).toEqual([[NET, GAP], [NET]]);
    client.close();
  });

  it('counts references per view and params', async () => {
    const { session, client, settle } = setup();
    await settle();
    const byPool1 = client.subscribeView('baseline.groups', { by: 'pool' });
    const byPool2 = client.subscribeView('baseline.groups', { by: 'pool' });
    const byVp = client.subscribeView('baseline.groups', { by: 'vp' });
    await settle();
    expect(session.sentOf('subscribeView').map((m) => m.params)).toEqual([
      { by: 'pool' },
      { by: 'vp' },
    ]);
    const pool = selectView('baseline.groups', { by: 'pool' })(client.store.getState());
    expect(pool?.payload).toEqual(viewMessageFixtures['baseline.groups'].payload);
    expect(pool?.stale).toBe(false);
    // No fixture for `by: vp`: nothing arrives, so nothing is shown.
    expect(selectView('baseline.groups', { by: 'vp' })(client.store.getState())).toBeUndefined();

    byPool1();
    await settle();
    expect(session.sentOf('unsubscribeView')).toEqual([]);
    byPool2();
    byVp();
    await settle();
    expect(session.sentOf('unsubscribeView').map((m) => m.params)).toEqual([
      { by: 'pool' },
      { by: 'vp' },
    ]);
    expect(session.views).toEqual([]);
    expect(selectView('baseline.groups', { by: 'pool' })(client.store.getState())).toBeUndefined();
    client.close();
  });

  it('a release and re-subscribe in the same tick (React strict-mode remount) sends nothing and keeps the value', async () => {
    const { session, client, settle, cell } = setup();
    await settle();
    const release = client.subscribe([NET]);
    await settle();
    release();
    client.subscribe([NET]);
    await settle();
    expect(session.sentOf('subscribe')).toHaveLength(1);
    expect(session.sentOf('unsubscribe')).toHaveLength(0);
    expect(cell(NET)?.value).toBe(C.cells[NET]);
    client.close();
  });
});

describe('AC2: previews at most 1 per 33 ms per connection (CON-05: batched, latest wins per cell), seq increments; cancelPreview on Escape', () => {
  it('sends the first preview at once and the latest value after the interval, never faster', async () => {
    vi.useFakeTimers();
    const { session, client, settle, previewTimes } = setup();
    await settle();
    client.preview(TARGET.var, TARGET.member, 140);
    expect(session.sentOf('preview').map(single)).toEqual([[140, 1]]);
    expect(session.sentOf('preview')[0]?.changes).toEqual([{ ...TARGET, value: 140 }]);
    vi.advanceTimersByTime(5);
    client.preview(TARGET.var, TARGET.member, 141);
    vi.advanceTimersByTime(5);
    client.preview(TARGET.var, TARGET.member, 142);
    vi.advanceTimersByTime(Math.floor(PREVIEW_MIN_INTERVAL_MS) - 10);
    expect(session.sentOf('preview')).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(session.sentOf('preview').map(single)).toEqual([
      [140, 1],
      [142, 2],
    ]);

    // A 1 s drag with a pointer event every 4 ms.
    for (let t = 0; t < 1000; t += 4) {
      client.preview(TARGET.var, TARGET.member, 150 + t);
      vi.advanceTimersByTime(4);
    }
    vi.advanceTimersByTime(100);
    const sent = session.sentOf('preview');
    for (let i = 1; i < previewTimes.length; i += 1) {
      expect(previewTimes[i]! - previewTimes[i - 1]!).toBeGreaterThanOrEqual(
        PREVIEW_MIN_INTERVAL_MS,
      );
    }
    expect(single(sent.at(-1)!)[0]).toBe(150 + 996); // the latest value always goes out
    expect(sent.map((m) => m.seq)).toEqual(sent.map((_, i) => i + 1));
    client.close();
  });

  it('throttles per connection: another cell waits in the one pending slot, merged per cell, latest wins', async () => {
    vi.useFakeTimers();
    const { session, client, settle, previewTimes } = setup();
    await settle();
    client.preview(TARGET.var, TARGET.member, 140);
    client.preview(SHARE.var, SHARE.member, 0.4);
    client.preview(TARGET.var, TARGET.member, 141);
    client.preview(SHARE.var, SHARE.member, 0.5);
    expect(session.sentOf('preview').map(single)).toEqual([[140, 1]]); // the other cell waits
    vi.advanceTimersByTime(Math.ceil(PREVIEW_MIN_INTERVAL_MS) - 1);
    expect(session.sentOf('preview')).toHaveLength(1);
    vi.advanceTimersByTime(1);
    const [, merged] = session.sentOf('preview');
    expect(merged?.seq).toBe(2);
    expect(cellsOf(merged!)).toEqual({ 'g.target_net[]': 141, 'g.ot_out_share[]': 0.5 });
    expect(merged?.changes).toHaveLength(2); // one entry per cell

    // A 1 s drag moving two cells alternately, one pointer event every 4 ms.
    const latest: Record<string, number> = {};
    for (let t = 0; t < 1000; t += 4) {
      const c = t % 8 === 0 ? TARGET : SHARE;
      client.preview(c.var, c.member, 200 + t);
      latest[toCellKey(c.var, c.member)] = 200 + t;
      vi.advanceTimersByTime(4);
    }
    vi.advanceTimersByTime(100);
    const drag = session.sentOf('preview').slice(2);
    // 30/s across all cells: ≤ 31 frames in one second (one at each end), ≥ 33.3 ms apart.
    expect(drag.length).toBeLessThanOrEqual(Math.floor(1000 / PREVIEW_MIN_INTERVAL_MS) + 1);
    for (let i = 1; i < previewTimes.length; i += 1) {
      expect(previewTimes[i]! - previewTimes[i - 1]!).toBeGreaterThanOrEqual(
        PREVIEW_MIN_INTERVAL_MS,
      );
    }
    // Every frame carries both cells moved since the last one; the latest value of each goes out.
    for (const m of drag) expect(m.changes).toHaveLength(2);
    expect(Object.assign({}, ...drag.map(cellsOf))).toEqual(latest);
    const seqs = session.sentOf('preview').map((m) => m.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    client.close();
  });

  it('previewChanges sends cells that move together in one frame, never split', async () => {
    vi.useFakeTimers();
    const { session, client, settle } = setup();
    await settle();
    client.previewChanges(SHARES.changes);
    expect(session.sentOf('preview')).toEqual([
      { v: 1, type: 'preview', seq: 1, changes: SHARES.changes },
    ]);
    const [a, b] = SHARES.changes;
    client.previewChanges([
      { ...a!, value: 0.5 },
      { ...b!, value: 0.2 },
    ]);
    client.preview(TARGET.var, TARGET.member, 145);
    client.previewChanges([
      { ...a!, value: 0.55 },
      { ...b!, value: 0.15 },
    ]);
    vi.advanceTimersByTime(Math.ceil(PREVIEW_MIN_INTERVAL_MS));
    const sent = session.sentOf('preview');
    expect(sent).toHaveLength(2);
    expect(sent[1]?.seq).toBe(2);
    expect(cellsOf(sent[1]!)).toEqual({
      [toCellKey(a!.var, a!.member)]: 0.55,
      [toCellKey(b!.var, b!.member)]: 0.15,
      'g.target_net[]': 145,
    });
    client.close();
  });

  it('Escape drops the pending preview and sends cancelPreview with the next seq; the committed values come back', async () => {
    vi.useFakeTimers();
    const { session, client, settle, cell } = setup();
    await settle();
    client.subscribe([NET]);
    await settle();
    const keys = new EventTarget();
    const detach = client.cancelOnEscape(keys);

    keys.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(session.sentOf('cancelPreview')).toEqual([]); // nothing to cancel yet

    client.preview(TARGET.var, TARGET.member, 140);
    client.preview(TARGET.var, TARGET.member, 141); // held for the interval
    session.emit({ ...rerun1.answer });
    await settle();
    expect(cell(NET)?.value).toBe(rerun1.answer.cells['res.net[]']);

    keys.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }));
    expect(session.sentOf('cancelPreview')).toEqual([]);
    keys.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(session.sentOf('cancelPreview').map((m) => m.seq)).toEqual([2]);
    vi.advanceTimersByTime(100);
    expect(session.sentOf('preview').map((m) => single(m)[0])).toEqual([140]); // 141 was dropped
    await settle();
    expect(cell(NET)).toEqual({ value: C.cells[NET], stale: false });

    keys.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(session.sentOf('cancelPreview')).toHaveLength(1); // nothing previewed since

    detach();
    client.preview(TARGET.var, TARGET.member, 142);
    keys.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(session.sentOf('cancelPreview')).toHaveLength(1);
    expect(client.cancelPreview()).toBe(4);
    expect(session.sentOf('preview').map((m) => m.seq)).toEqual([1, 3]);
    client.close();
  });

  it('cancelPreview() has no "previewing" precondition (CON-05): it always sends with a fresh seq while connected', async () => {
    const { session, client, settle } = setup();
    expect(client.cancelPreview()).toBeNull(); // not connected yet: nothing to send it on
    await settle();
    expect(client.cancelPreview()).toBe(1);
    expect(client.cancelPreview()).toBe(2);
    expect(session.sentOf('cancelPreview')).toEqual([
      { v: 1, type: 'cancelPreview', seq: 1 },
      { v: 1, type: 'cancelPreview', seq: 2 },
    ]);
    client.close();
  });
});

describe('AC3: deltas applied in one batch per animation frame; stale seq ignored', () => {
  it('applies every message that arrived before a frame in one store update', async () => {
    const { session, client, frames, settle, cell } = setup();
    await settle();
    client.subscribe([NET, GAP]);
    client.subscribeView('bridge', {});
    await settle();
    const updates = vi.fn();
    const unsubscribe = client.store.subscribe(updates);

    session.emit({ v: 1, type: 'delta', seq: null, cells: { [NET]: 101 } });
    session.emit({ v: 1, type: 'delta', seq: null, cells: { [GAP]: -2 } });
    session.emit({ v: 1, type: 'delta', seq: null, cells: { [NET]: 103 } });
    session.emit(viewMessageFixtures.bridge);
    await session.flush();
    expect(updates).not.toHaveBeenCalled();
    expect(cell(NET)?.value).toBe(C.cells[NET]);
    expect(frames.pending).toBe(1);

    frames.run();
    expect(updates).toHaveBeenCalledTimes(1);
    expect(cell(NET)?.value).toBe(103);
    expect(cell(GAP)?.value).toBe(-2);
    unsubscribe();
    client.close();
  });

  it('ignores a delta, view or warnings whose seq is lower than the last applied, and anything older than a cancel', async () => {
    vi.useFakeTimers();
    const { session, client, settle, cell } = setup();
    await settle();
    client.subscribe([NET, GAP]);
    client.subscribeView('bridge', {});
    await settle();
    for (let i = 0; i < 5; i += 1) {
      client.preview(TARGET.var, TARGET.member, 140 + i);
      vi.advanceTimersByTime(Math.ceil(PREVIEW_MIN_INTERVAL_MS));
    }
    expect(session.sentOf('preview').map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);

    // Rerun answers out of order: seq 5 (it coalesced 2..5) then a late seq 1.
    expect(rerun2.answer.seq).toBe(5);
    session.emit({ ...rerun2.answer });
    await settle();
    session.emit({ ...rerun1.answer });
    session.emit({ ...viewMessageFixtures.bridge, seq: 1 });
    session.emit({ v: 1, type: 'warnings', seq: 1, violations: [] });
    await settle();
    expect(cell(GAP)?.value).toBe(rerun2.answer.cells['res.gap[]']);
    expect(rerun2.answer.cells['res.net[]']).toBeUndefined(); // seq 5 left res.net alone…
    expect(cell(NET)?.value).toBe(C.cells[NET]); // …and the late seq 1 (121) is ignored
    expect(cell(NET)?.value).not.toBe(rerun1.answer.cells['res.net[]']);
    expect(selectView('bridge', {})(client.store.getState())?.payload).toEqual(
      viewMessageFixtures.bridge.payload,
    ); // from the subscribe answer (seq null), not the stale seq 1
    expect(client.store.getState().warnings).toBeNull();

    // Same seq as the last applied still applies (delta, view and warnings of one rerun).
    session.emit({ v: 1, type: 'warnings', seq: 5, violations: [] });
    await settle();
    expect(client.store.getState().warnings?.seq).toBe(5);

    // seq null (a commit) always applies.
    session.emit({ v: 1, type: 'delta', seq: null, cells: { [NET]: 130 } });
    await settle();
    expect(cell(NET)?.value).toBe(130);

    // After cancelPreview (seq 6), a late answer to preview seq 5 is void.
    const cancelSeq = client.cancelPreview();
    expect(cancelSeq).toBe(6);
    session.emit({ v: 1, type: 'delta', seq: cancelSeq! - 1, cells: { [NET]: 999 } });
    await settle(); // the mock's own cancel answer (committed values) also lands here
    expect(cell(NET)?.value).not.toBe(999);
    expect(cell(NET)?.value).toBe(130);
    client.close();
  });
});

describe("AC4: on drop: values dim, 'reconnecting' state, backoff, resubscribe; never invents values", () => {
  it('keeps the last received values flagged stale, reconnects with backoff and resubscribes', async () => {
    vi.useFakeTimers();
    const { session, client, settle, cell, setRefuse } = setup();
    await settle();
    client.subscribe([NET]);
    client.subscribeView('bridge', {});
    await settle();
    session.emit({ v: 1, type: 'delta', seq: null, cells: { [NET]: 777 } });
    await settle();
    expect(session.connections).toBe(1);

    setRefuse(2); // the next two attempts fail
    session.drop();
    await settle();
    const down = client.store.getState();
    expect(down.status).toBe('reconnecting');
    expect(cell(NET)).toEqual({ value: 777, stale: true });
    expect(selectView('bridge', {})(down)?.stale).toBe(true);
    expect(selectView('bridge', {})(down)?.payload).toEqual(viewMessageFixtures.bridge.payload);

    // While down: no frames, no previews, no invented values for new subscriptions.
    const sentBefore = session.sent.length;
    client.preview(TARGET.var, TARGET.member, 140);
    client.subscribe([GAP]);
    await settle();
    expect(session.sent.length).toBe(sentBefore);
    expect(cell(GAP)).toBeUndefined();
    expect(cell(NET)).toEqual({ value: 777, stale: true });

    // Backoff: 1×, 2×, 4× the initial delay (random() = 0, so no jitter).
    vi.advanceTimersByTime(BACKOFF_INITIAL_MS - 1);
    await settle();
    expect(session.connections).toBe(1);
    vi.advanceTimersByTime(1);
    await settle();
    expect(session.connections).toBe(2); // refused
    expect(client.store.getState().status).toBe('reconnecting');
    vi.advanceTimersByTime(BACKOFF_INITIAL_MS * 2 - 1);
    await settle();
    expect(session.connections).toBe(2);
    vi.advanceTimersByTime(1);
    await settle();
    expect(session.connections).toBe(3); // refused
    vi.advanceTimersByTime(BACKOFF_INITIAL_MS * 4);
    await settle();
    expect(session.connections).toBe(4);

    // Restored: one subscribe for everything held, the view again, fresh values from the snapshot.
    const state = client.store.getState();
    expect(state.status).toBe('open');
    expect(session.sentOf('subscribe').at(-1)?.cells).toEqual([NET, GAP]);
    expect(session.views).toEqual([{ view: 'bridge', params: {} }]);
    expect(cell(NET)).toEqual({ value: 777, stale: false }); // the committed value tier 2 replays
    expect(cell(GAP)).toEqual({ value: C.cells[GAP], stale: false });
    expect(selectView('bridge', {})(state)?.stale).toBe(false);

    // A later drop starts the backoff from the initial delay again.
    session.drop();
    await settle();
    vi.advanceTimersByTime(BACKOFF_INITIAL_MS);
    await settle();
    expect(session.connections).toBe(5);
    expect(client.store.getState().status).toBe('open');
    client.close();
  });

  it('close() ends the session without reconnecting', async () => {
    vi.useFakeTimers();
    const { session, client, settle } = setup();
    await settle();
    client.close();
    await settle();
    vi.advanceTimersByTime(BACKOFF_INITIAL_MS * 100);
    await settle();
    expect(client.store.getState().status).toBe('closed');
    expect(session.connections).toBe(1);
  });

  it('ignores frames that fail parseServerMessage and reports them', async () => {
    const onProtocolError = vi.fn();
    const { session, client, settle, cell } = setup({ client: { onProtocolError } });
    await settle();
    client.subscribe([NET]);
    await settle();
    session.socket!.onmessage!({
      type: 'message',
      data: '{"v":1,"type":"delta","seq":null,"cells":{"res.net[]":"12"}}',
    });
    await settle();
    expect(onProtocolError).toHaveBeenCalledTimes(1);
    expect(cell(NET)?.value).toBe(C.cells[NET]);
    client.close();
  });
});

describe('CON-05: open(scenarioId) switches the scenario on the same connection', () => {
  const openStep = openFixture.find((s) => s.by === 'client' && s.message.type === 'open')!;
  const resentBridge = {
    ...viewMessageFixtures.bridge,
    payload: { ...viewMessageFixtures.bridge.payload, gap: 142 },
  };

  it('sends open, keeps subscriptions, ignores the old scenario until its snapshot, then applies the snapshot and the re-sent views', async () => {
    vi.useFakeTimers();
    let opens = 0;
    const { session, client, frames, settle, cell, urls } = setup({
      mock: {
        respond: {
          // The first open is answered by the test, step by step; later ones like tier 2.
          open: (m, ctx) =>
            opens++ === 0
              ? []
              : [
                  {
                    v: 1,
                    type: 'snapshot',
                    scenarioId: m.scenarioId,
                    version: C.version,
                    cells: ctx.committed(ctx.subscribed),
                  },
                ],
        },
      },
    });
    await settle();
    client.subscribe([NET, GAP]);
    client.subscribeView('bridge', {});
    await settle();
    session.emit({
      v: 1,
      type: 'changeset',
      scenarioId: C.scenarioId,
      version: C.version,
      editsCount: 2,
    });
    await settle();
    expect(client.store.getState().editsCount).toBe(2);
    client.preview(TARGET.var, TARGET.member, 140); // seq 1
    client.preview(TARGET.var, TARGET.member, 141); // pending
    session.emit({ v: 1, type: 'warnings', seq: 1, violations: [] });
    await settle();
    expect(client.store.getState().warnings?.seq).toBe(1);

    client.open(RATES.scenarioId);
    expect(session.sentOf('open')).toEqual([{ ...openStep.message, scenarioId: RATES.scenarioId }]);
    expect(client.store.getState().opening).toBe(RATES.scenarioId);
    const bridgeBefore = selectView('bridge', {})(client.store.getState());

    // Old-scenario frames still in flight when the open landed: ignored until the snapshot.
    session.emit({ v: 1, type: 'delta', seq: null, cells: { [NET]: 999 } });
    session.emit({
      ...viewMessageFixtures.bridge,
      payload: { ...viewMessageFixtures.bridge.payload, gap: 1 },
    });
    session.emit({ v: 1, type: 'warnings', seq: null, violations: [] });
    session.emit({ v: 1, type: 'delta', seq: 1, cells: { [GAP]: -1 } });
    session.emit({
      v: 1,
      type: 'changeset',
      scenarioId: C.scenarioId,
      version: C.version,
      editsCount: 9,
    });
    // A snapshot of another scenario (e.g. an earlier open's) does not end the switch either.
    const A = presetSnapshot('A');
    session.emit({
      v: 1,
      type: 'snapshot',
      scenarioId: A.scenarioId,
      version: A.version,
      cells: { [NET]: 998 },
    });
    await settle();
    const gated = client.store.getState();
    expect(gated.opening).toBe(RATES.scenarioId);
    expect(gated.scenarioId).toBe(C.scenarioId);
    expect(cell(NET)).toEqual({ value: C.cells[NET], stale: false });
    expect(cell(GAP)).toEqual({ value: C.cells[GAP], stale: false });
    expect(selectView('bridge', {})(gated)).toBe(bridgeBefore);
    expect(gated.warnings?.seq).toBe(1);
    expect(gated.editsCount).toBe(2);

    // The answer: snapshot of every subscribed cell, then the views again (seq null).
    session.emit({
      v: 1,
      type: 'snapshot',
      scenarioId: RATES.scenarioId,
      version: RATES.version,
      cells: { [NET]: RATES.cells[NET]!, [GAP]: RATES.cells[GAP]! },
    });
    session.emit(resentBridge);
    await session.flush();
    expect(frames.pending).toBe(1);
    frames.run();

    const s = client.store.getState();
    expect(s.opening).toBeNull();
    expect(s.scenarioId).toBe(RATES.scenarioId);
    expect(s.version).toBe(RATES.version);
    expect(s.editsCount).toBeNull(); // the in-flight changeset of the old scenario was ignored
    expect(s.changeset).toBeNull();
    expect(s.warnings).toBeNull(); // the old scratch's warnings are gone
    expect(cell(NET)).toEqual({ value: RATES.cells[NET], stale: false });
    expect(cell(GAP)).toEqual({ value: RATES.cells[GAP], stale: false });
    expect(RATES.cells[NET]).not.toBe(C.cells[NET]);
    expect(selectView('bridge', {})(s)).toEqual({
      view: 'bridge',
      params: {},
      payload: resentBridge.payload,
      stale: false,
    });
    // Subscriptions were kept: nothing re-sent.
    expect(session.sentOf('subscribe')).toHaveLength(1);
    expect(session.sentOf('subscribeView')).toHaveLength(1);
    expect([...session.subscribed]).toEqual([NET, GAP]);

    // The pending preview was dropped and answers to pre-open previews are void (seq floor).
    vi.advanceTimersByTime(100);
    expect(session.sentOf('preview').map((m) => m.seq)).toEqual([1]);
    session.emit({ v: 1, type: 'delta', seq: 1, cells: { [NET]: 555 } });
    await settle();
    expect(cell(NET)?.value).toBe(RATES.cells[NET]);
    // Nothing previewed since the open: Escape has nothing to cancel.
    const keys = new EventTarget();
    client.cancelOnEscape(keys);
    keys.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(session.sentOf('cancelPreview')).toEqual([]);
    // A preview on the new scenario carries the next seq and its answer applies.
    client.preview(TARGET.var, TARGET.member, 150);
    expect(session.sentOf('preview').map((m) => m.seq)).toEqual([1, 2]);
    session.emit({ v: 1, type: 'delta', seq: 2, cells: { [NET]: 160 } });
    await settle();
    expect(cell(NET)?.value).toBe(160);

    // A reconnect goes back to the scenario the session is on, not the first one.
    session.drop();
    await settle();
    // An open asked for while down goes out as soon as the next connection is up.
    client.open(C.scenarioId);
    vi.advanceTimersByTime(BACKOFF_INITIAL_MS);
    await settle();
    expect(new URL(urls.at(-1)!).searchParams.get('scenario')).toBe(RATES.scenarioId);
    expect(session.sentOf('open').map((m) => m.scenarioId)).toEqual([
      RATES.scenarioId,
      C.scenarioId,
    ]);
    const back = client.store.getState();
    expect(back.status).toBe('open');
    expect(back.opening).toBeNull();
    expect(back.scenarioId).toBe(C.scenarioId);
    expect(cell(NET)).toEqual({ value: C.cells[NET], stale: false });
    client.close();
  });

  it('an unknown scenario is answered with error: lastError holds the problem and the session stays where it was', async () => {
    const { client, session, settle, cell } = setup();
    await settle();
    client.subscribe([NET]);
    await settle();
    client.open('sc-unknown');
    expect(client.store.getState().opening).toBe('sc-unknown');
    await settle();
    const s = client.store.getState();
    expect(s.opening).toBeNull();
    expect(s.lastError?.status).toBe(404);
    expect(s.lastError?.detail).toContain('sc-unknown');
    expect(s.scenarioId).toBe(C.scenarioId);
    expect(cell(NET)).toEqual({ value: C.cells[NET], stale: false });
    // The session is still on its scenario: its frames apply again.
    session.emit({ v: 1, type: 'delta', seq: null, cells: { [NET]: 131 } });
    await settle();
    expect(cell(NET)?.value).toBe(131);
    client.close();
  });
});

describe('CON-05: error{problem} is handled by the one dispatcher', () => {
  it('lands in store.lastError in the next frame batch; values and warnings are untouched', async () => {
    const { session, client, frames, settle, cell } = setup();
    await settle();
    client.subscribe([NET]);
    await settle();
    const before = client.store.getState();
    session.emit(frameErrorFixture);
    await session.flush();
    expect(client.store.getState().lastError).toBeNull(); // applied with the frame, like the rest
    frames.run();
    const s = client.store.getState();
    expect(s.lastError).toEqual(frameErrorFixture.problem);
    expect(s.cells).toBe(before.cells);
    expect(s.warnings).toBeNull();
    expect(s.status).toBe('open');
    expect(cell(NET)?.value).toBe(C.cells[NET]);
    client.close();
  });
});

describe('CON-05: equal seq applies (rebase), lower seq is ignored', () => {
  it('a rebase answer with the last applied seq after a commit is applied, an older one is not', async () => {
    vi.useFakeTimers();
    const { session, client, settle, cell } = setup();
    await settle();
    client.subscribe([NET, GAP]);
    await settle();
    client.preview(TARGET.var, TARGET.member, 140); // seq 1
    session.emit({ v: 1, type: 'delta', seq: 1, cells: { [GAP]: -30 } });
    await settle();
    // Another user commits: changeset, delta{seq: null}, then the rebase delta{seq: 1}.
    const version = C.version + 1;
    session.emit({ v: 1, type: 'changeset', scenarioId: C.scenarioId, version, editsCount: 4 });
    session.emit({ v: 1, type: 'delta', seq: null, cells: { [NET]: 121, [GAP]: -22 } });
    session.emit({ v: 1, type: 'delta', seq: 1, cells: { [GAP]: -29 } });
    await settle();
    expect(cell(NET)?.value).toBe(121);
    expect(cell(GAP)?.value).toBe(-29);
    expect(client.store.getState().version).toBe(version);
    expect(client.store.getState().editsCount).toBe(4);

    vi.advanceTimersByTime(Math.ceil(PREVIEW_MIN_INTERVAL_MS));
    client.preview(TARGET.var, TARGET.member, 141); // seq 2
    expect(session.sentOf('preview').map((m) => m.seq)).toEqual([1, 2]);
    session.emit({ v: 1, type: 'delta', seq: 2, cells: { [GAP]: -28 } });
    await settle();
    session.emit({ v: 1, type: 'delta', seq: 1, cells: { [GAP]: -29 } });
    await settle();
    expect(cell(GAP)?.value).toBe(-28);
    client.close();
  });
});

type LifecycleName = keyof typeof scratchLifecycleFixtures;
type LifecycleStep = (typeof scratchLifecycleFixtures)[LifecycleName][number];
type Outcome = { ok: boolean; value: unknown };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('CON-05: scratch lifecycle around a commit (scratchLifecycleFixtures)', () => {
  it.each(Object.keys(scratchLifecycleFixtures) as LifecycleName[])(
    '%s: scratch kept while the POST is in flight, changeset before its delta, rebase applied, cancelPreview once the POST settled',
    async (name) => {
      const steps = scratchLifecycleFixtures[name] as readonly LifecycleStep[];
      const opening = steps[1];
      if (opening?.by !== 'server' || opening.message.type !== 'snapshot') {
        throw new Error(`${name}: expected subscribe then snapshot`);
      }
      const first = opening.message;
      const { session, client, settle, cell } = setup({
        mock: { snapshots: [first], views: [] },
        client: { scenario: first.scenarioId },
      });
      await settle();
      const committed: Record<string, number | null> = { ...first.cells };
      const state = () => client.store.getState();
      let commit: ReturnType<typeof deferred<unknown>> | null = null;
      let outcome: Promise<Outcome> | null = null;
      let expected: Outcome | null = null;

      for (const [i, step] of steps.entries()) {
        switch (step.by) {
          case 'client': {
            const m = step.message;
            if (m.type === 'subscribe') {
              client.subscribe(m.cells);
              await settle();
              expect(session.sentOf('subscribe').at(-1)).toEqual(m);
            } else if (m.type === 'preview') {
              client.previewChanges(m.changes);
              expect(session.sentOf('preview').at(-1)).toEqual(m);
            } else if (m.type === 'cancelPreview') {
              // Sent by settleCommit once the commit settled, not by the test.
              expect(outcome).not.toBeNull();
              expect(await outcome).toEqual(expected); // settleCommit passes the outcome through
              await settle(); // the mock's answer: committed values of the subscribed cells
              expect(session.sentOf('cancelPreview')).toEqual([m]);
              for (const [k, v] of Object.entries(committed)) expect(cell(k)?.value).toBe(v);
            }
            break;
          }
          case 'server': {
            const m = step.message;
            if (m.type === 'snapshot') {
              await settle(); // the mock answered the subscribe with this snapshot
              expect(state().scenarioId).toBe(m.scenarioId);
              expect(state().version).toBe(m.version);
              for (const [k, v] of Object.entries(m.cells)) expect(cell(k)?.value).toBe(v);
              break;
            }
            session.emit(m);
            await settle();
            if (m.type === 'changeset') {
              expect(state().scenarioId).toBe(m.scenarioId); // a fork is followed
              expect(state().version).toBe(m.version);
              expect(state().editsCount).toBe(m.editsCount);
              expect(state().changeset).toEqual(m);
            } else if (m.type === 'delta') {
              if (m.seq === null) Object.assign(committed, m.cells);
              // Every delta applies here, including the rebase with the scratch's seq again.
              for (const [k, v] of Object.entries(m.cells)) expect(cell(k)?.value).toBe(v);
            } else if (m.type === 'warnings') {
              expect(state().warnings).toEqual(m);
            }
            break;
          }
          case 'post':
            expect(step.request.scenarioId).toBe(state().scenarioId);
            expect(step.request.baseVersion).toBe(state().version);
            if (!commit) {
              const d = deferred<unknown>();
              commit = d;
              outcome = client.settleCommit(d.promise).then(
                (value) => ({ ok: true, value }),
                (value: unknown) => ({ ok: false, value }),
              );
            }
            break;
          case 'postResolved':
            expected = { ok: true, value: step.result };
            commit!.resolve(step.result);
            break;
          case 'postFailed':
            if (steps[i + 1]?.by === 'post') break; // 409: tier 1 re-sends first; not settled yet
            expected = { ok: false, value: step.problem };
            commit!.reject(step.problem);
            break;
        }
        // The scratch stays until the commit settled: no cancelPreview before that.
        if (expected === null) expect(session.sentOf('cancelPreview')).toEqual([]);
      }
      expect(session.sentOf('cancelPreview')).toHaveLength(1);
      client.close();
    },
  );
});
