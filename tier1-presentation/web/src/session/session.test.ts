import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_MIN_INTERVAL_MS, WS_SESSION_PATH, toCellKey } from '@glidepath/api-contract';
import {
  coalescingFixture,
  createMockSession,
  presetSnapshot,
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
const NET = toCellKey('res.net');
const GAP = toCellKey('res.gap');
const TARGET = { var: 'g.target_net', member: '' } as const;
const SHARE = { var: 'g.ot_out_share', member: '' } as const;
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

describe('AC2: previews at most 1 per 33 ms per cell, latest wins, seq increments; cancelPreview on Escape', () => {
  it('sends the first preview at once and the latest value after the interval, never faster', async () => {
    vi.useFakeTimers();
    const { session, client, settle, previewTimes } = setup();
    await settle();
    client.preview(TARGET.var, TARGET.member, 140);
    expect(session.sentOf('preview').map((m) => [m.value, m.seq])).toEqual([[140, 1]]);
    vi.advanceTimersByTime(5);
    client.preview(TARGET.var, TARGET.member, 141);
    vi.advanceTimersByTime(5);
    client.preview(TARGET.var, TARGET.member, 142);
    vi.advanceTimersByTime(Math.floor(PREVIEW_MIN_INTERVAL_MS) - 10);
    expect(session.sentOf('preview')).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(session.sentOf('preview').map((m) => [m.value, m.seq])).toEqual([
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
    expect(sent.at(-1)?.value).toBe(150 + 996); // the latest value always goes out
    expect(sent.map((m) => m.seq)).toEqual(sent.map((_, i) => i + 1));
    client.close();
  });

  it('throttles per cell: another cell is not held back', async () => {
    vi.useFakeTimers();
    const { session, client, settle } = setup();
    await settle();
    client.preview(TARGET.var, TARGET.member, 140);
    client.preview(SHARE.var, SHARE.member, 0.4);
    client.preview(TARGET.var, TARGET.member, 141);
    expect(session.sentOf('preview').map((m) => [m.var, m.value, m.seq])).toEqual([
      [TARGET.var, 140, 1],
      [SHARE.var, 0.4, 2],
    ]);
    vi.advanceTimersByTime(Math.ceil(PREVIEW_MIN_INTERVAL_MS));
    expect(session.sentOf('preview').map((m) => [m.var, m.value, m.seq])).toEqual([
      [TARGET.var, 140, 1],
      [SHARE.var, 0.4, 2],
      [TARGET.var, 141, 3],
    ]);
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
    expect(session.sentOf('preview').map((m) => m.value)).toEqual([140]); // 141 was dropped
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

    // Rerun answers out of order: seq 4 then a late seq 1.
    session.emit({ ...rerun2.answer });
    await settle();
    session.emit({ ...rerun1.answer });
    session.emit({ ...viewMessageFixtures.bridge, seq: 1 });
    session.emit({ v: 1, type: 'warnings', seq: 1, violations: [] });
    await settle();
    expect(cell(NET)?.value).toBe(rerun2.answer.cells['res.net[]']);
    expect(cell(GAP)?.value).toBe(rerun2.answer.cells['res.gap[]']);
    expect(selectView('bridge', {})(client.store.getState())?.payload).toEqual(
      viewMessageFixtures.bridge.payload,
    ); // from the subscribe answer (seq null), not the stale seq 1
    expect(client.store.getState().warnings).toBeNull();

    // Same seq as the last applied still applies (delta, view and warnings of one rerun).
    session.emit({ v: 1, type: 'warnings', seq: 4, violations: [] });
    await settle();
    expect(client.store.getState().warnings?.seq).toBe(4);

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
