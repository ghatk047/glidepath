import { describe, expect, it } from 'vitest';
import { parseServerMessage, type ServerMessage } from '../index';
import {
  createMockSession,
  presetSnapshot,
  serverMessageFixtures,
  specFixtures,
  viewMessageFixtures,
  type MockSocket,
} from './index';

const C = presetSnapshot('C');
const D = presetSnapshot('D');
const urlFor = (scenario: string, tenant: string = specFixtures.tenant) =>
  `ws://localhost/ws/session?tenant=${tenant}&scenario=${scenario}`;

/** A tiny client: collects parsed server messages, as a tier-1 session client would. */
function listen(socket: MockSocket) {
  const received: ServerMessage[] = [];
  const events: string[] = [];
  socket.onopen = () => events.push('open');
  socket.addEventListener('message', (e) => {
    const parsed = parseServerMessage(e.data);
    if (!parsed.ok) throw new Error(parsed.detail);
    received.push(parsed.message);
  });
  socket.onclose = (e) => events.push(`close:${e.code}:${e.wasClean}`);
  socket.onerror = () => events.push('error');
  return { received, events };
}

async function open(scenario = C.scenarioId, options?: Parameters<typeof createMockSession>[0]) {
  const session = createMockSession(options);
  const socket = session.connect(urlFor(scenario));
  const io = listen(socket);
  await session.flush();
  return { session, socket, ...io };
}

const send = (socket: MockSocket, message: object) =>
  socket.send(JSON.stringify({ v: 1, ...message }));

describe('createMockSession() replays snapshot/delta/view/job messages for tier-1 tests', () => {
  it('opens asynchronously like a WebSocket on /ws/session?tenant&scenario', async () => {
    const session = createMockSession();
    const socket = session.connect(urlFor(C.scenarioId));
    const { events } = listen(socket);
    expect(socket.readyState).toBe(socket.CONNECTING);
    expect(() => socket.send('{}')).toThrow(/InvalidStateError/);
    await session.flush();
    expect(socket.readyState).toBe(socket.OPEN);
    expect(events).toEqual(['open']);
    expect(session.query).toEqual({ tenant: specFixtures.tenant, scenario: C.scenarioId });
  });

  it('answers subscribe with a snapshot of the generated golden values (null when unknown)', async () => {
    const { session, socket, received } = await open();
    send(socket, {
      type: 'subscribe',
      cells: ['res.net[]', 'res.gap[]', 'g.target_net[]', 'x.y[]'],
    });
    await session.flush();
    expect(received).toEqual([
      {
        v: 1,
        type: 'snapshot',
        scenarioId: C.scenarioId,
        version: C.version,
        cells: {
          'res.net[]': C.cells['res.net[]'],
          'res.gap[]': C.cells['res.gap[]'],
          'g.target_net[]': C.cells['g.target_net[]'],
          'x.y[]': null,
        },
      },
    ]);
    expect([...session.subscribed]).toEqual(['res.net[]', 'res.gap[]', 'g.target_net[]', 'x.y[]']);
    send(socket, { type: 'unsubscribe', cells: ['x.y[]'] });
    expect(session.subscribed.has('x.y[]')).toBe(false);
    expect(session.sentOf('subscribe')).toHaveLength(1);
  });

  it('replays delta, view and job messages in order to onmessage and listeners', async () => {
    const { session, received } = await open();
    const script = [
      serverMessageFixtures.delta,
      viewMessageFixtures['levers.families'],
      { ...serverMessageFixtures.job, progress: 0.4 },
      { ...serverMessageFixtures.job, status: 'done' as const, progress: 1, note: null },
    ];
    await session.replay(script);
    expect(received.map((m) => m.type)).toEqual(['delta', 'view', 'job', 'job']);
    expect(received).toEqual(
      script.map((m) => (parseServerMessage(m) as { message: unknown }).message),
    );
  });

  it('answers subscribeView with a configured view fixture; nothing otherwise', async () => {
    const view = viewMessageFixtures['baseline.groups'];
    const { session, socket, received } = await open(C.scenarioId, { views: [view] });
    send(socket, { type: 'subscribeView', view: 'baseline.groups', params: { by: 'pool' } });
    send(socket, { type: 'subscribeView', view: 'baseline.groups', params: { by: 'vp' } });
    send(socket, { type: 'subscribeView', view: 'bridge', params: {} });
    await session.flush();
    expect(received).toEqual([view]);
    expect(session.views).toHaveLength(3);
    send(socket, { type: 'unsubscribeView', view: 'bridge', params: {} });
    expect(session.views.map((v) => v.view)).toEqual(['baseline.groups', 'baseline.groups']);
  });

  it('previews are answered only by a scripted responder (the mock never calculates)', async () => {
    const plain = await open();
    send(plain.socket, { type: 'preview', var: 'g.target_net', member: '', value: 150, seq: 1 });
    await plain.session.flush();
    expect(plain.received).toEqual([]);
    // The CON-02 single-cell form is normalised to changes[1], as tier 2's parser does.
    expect(plain.session.sentOf('preview')[0]).toEqual({
      v: 1,
      type: 'preview',
      seq: 1,
      changes: [{ var: 'g.target_net', member: '', value: 150 }],
    });

    // A test scripts the tier-2 answer, here a value from another golden preset.
    const scripted = await open(C.scenarioId, {
      respond: {
        preview: (m) => [
          { v: 1, type: 'delta', seq: m.seq, cells: { 'res.net[]': D.cells['res.net[]']! } },
        ],
      },
    });
    send(scripted.socket, {
      type: 'preview',
      seq: 7,
      changes: [{ var: 'g.target_net', member: '', value: 150 }],
    });
    await scripted.session.flush();
    expect(scripted.received).toEqual([
      { v: 1, type: 'delta', seq: 7, cells: { 'res.net[]': D.cells['res.net[]'] } },
    ]);
  });

  it('cancelPreview gets the committed values of the subscribed cells; commits update them', async () => {
    const { session, socket, received } = await open();
    send(socket, { type: 'subscribe', cells: ['res.net[]'] });
    await session.replay([
      { v: 1, type: 'delta', seq: 3, cells: { 'res.net[]': D.cells['res.net[]']! } }, // preview
    ]);
    send(socket, { type: 'cancelPreview', seq: 4 });
    await session.flush();
    expect(received.at(-1)).toEqual({
      v: 1,
      type: 'delta',
      seq: 4,
      cells: { 'res.net[]': C.cells['res.net[]'] },
    });

    await session.replay([
      { v: 1, type: 'changeset', scenarioId: C.scenarioId, version: 1, editsCount: 1 },
      { v: 1, type: 'delta', seq: null, cells: { 'res.net[]': D.cells['res.net[]']! } }, // commit
    ]);
    send(socket, { type: 'subscribe', cells: ['res.net[]'] });
    await session.flush();
    expect(received.at(-1)).toMatchObject({
      type: 'snapshot',
      version: 1,
      cells: { 'res.net[]': D.cells['res.net[]'] },
    });
  });

  it('answers a bad frame with error{problem}, like tier 2, and keeps the session open', async () => {
    const { session, socket, received } = await open();
    socket.send('not json');
    send(socket, { type: 'subscribeView', view: 'levers.weekly', params: {} });
    await session.flush();
    expect(received).toHaveLength(2);
    for (const m of received) {
      expect(m).toMatchObject({ type: 'error', problem: { status: 400 } });
    }
    expect(session.rejected).toHaveLength(2);
    expect(socket.readyState).toBe(socket.OPEN);
  });

  it('open{scenarioId} switches scenario: snapshot of the subscribed cells, then the subscribed views', async () => {
    const view = viewMessageFixtures.bridge;
    const { session, socket, received } = await open(C.scenarioId, { views: [view] });
    send(socket, { type: 'subscribe', cells: ['res.net[]'] });
    send(socket, { type: 'subscribeView', view: 'bridge', params: {} });
    await session.flush();
    received.length = 0;
    send(socket, { type: 'open', scenarioId: D.scenarioId });
    await session.flush();
    expect(received).toEqual([
      {
        v: 1,
        type: 'snapshot',
        scenarioId: D.scenarioId,
        version: D.version,
        cells: { 'res.net[]': D.cells['res.net[]'] },
      },
      view,
    ]);
    expect(session.scenarioId).toBe(D.scenarioId);
    expect(session.query?.scenario).toBe(C.scenarioId);

    send(socket, { type: 'open', scenarioId: 'sc-nope' });
    await session.flush();
    expect(received.at(-1)).toMatchObject({ type: 'error', problem: { status: 404 } });
    expect(session.scenarioId).toBe(D.scenarioId);
  });

  it('follows changeset{forkedFrom} of its own commit onto the fork', async () => {
    const { session, socket, received } = await open();
    send(socket, { type: 'subscribe', cells: ['res.net[]', 'res.gap[]'] });
    await session.replay([
      {
        v: 1,
        type: 'changeset',
        scenarioId: 'sc-custom-1',
        version: 1,
        editsCount: 1,
        forkedFrom: C.scenarioId,
        changesetId: 'cs-1',
        origin: 'ui',
        author: { id: 'u-1', name: 'Pat Owner' },
      },
      { v: 1, type: 'delta', seq: null, cells: { 'res.net[]': D.cells['res.net[]']! } },
    ]);
    expect(session.scenarioId).toBe('sc-custom-1');
    send(socket, { type: 'cancelPreview', seq: 2 });
    await session.flush();
    expect(received.at(-1)).toEqual({
      v: 1,
      type: 'delta',
      seq: 2,
      cells: { 'res.net[]': D.cells['res.net[]'], 'res.gap[]': C.cells['res.gap[]'] },
    });
    // The preset keeps its own values.
    send(socket, { type: 'open', scenarioId: C.scenarioId });
    await session.flush();
    expect(received.at(-1)).toMatchObject({
      type: 'snapshot',
      scenarioId: C.scenarioId,
      cells: { 'res.net[]': C.cells['res.net[]'] },
    });
  });

  it('refuses a wrong path, tenant or unknown scenario like a failed upgrade (error, 1006)', async () => {
    const session = createMockSession();
    for (const url of [
      'ws://localhost/ws/other?tenant=x&scenario=y',
      urlFor(C.scenarioId, 'zz-not-a-tenant'),
      urlFor('sc-nope'),
    ]) {
      const socket = session.connect(url);
      const { events } = listen(socket);
      await session.flush();
      expect(events).toEqual(['error', 'close:1006:false']);
      expect(socket.readyState).toBe(socket.CLOSED);
    }
    expect(session.refused).toHaveLength(3);
    expect(() => session.emit(serverMessageFixtures.job)).toThrow(/no open connection/);
  });

  it('drop() closes uncleanly; a reconnect starts fresh and can open another preset', async () => {
    const { session, socket, events } = await open();
    send(socket, { type: 'subscribe', cells: ['res.net[]'] });
    session.drop();
    await session.flush();
    expect(events).toEqual(['open', 'close:1006:false']);

    const again = session.connect(urlFor(D.scenarioId));
    const io = listen(again);
    await session.flush();
    expect(session.connections).toBe(2);
    expect(session.subscribed.size).toBe(0);
    send(again, { type: 'subscribe', cells: ['res.net[]'] });
    await session.flush();
    expect(io.received).toEqual([
      {
        v: 1,
        type: 'snapshot',
        scenarioId: D.scenarioId,
        version: D.version,
        cells: { 'res.net[]': D.cells['res.net[]'] },
      },
    ]);
  });

  it('close() from the client is clean and stops delivery', async () => {
    const { session, socket, events, received } = await open();
    socket.close();
    expect(socket.readyState).toBe(socket.CLOSING);
    await session.flush();
    expect(events).toEqual(['open', 'close:1000:true']);
    expect(() => session.emit(serverMessageFixtures.job)).toThrow();
    expect(received).toEqual([]);
  });

  it('rejects a server message that breaks the protocol (test bug, not a silent pass)', async () => {
    const { session } = await open();
    expect(() => session.emit({ ...serverMessageFixtures.job, progress: 2 })).toThrow(/invalid/);
  });

  it('a throwing client handler surfaces on flush() without stalling later events', async () => {
    const { session, socket, received } = await open();
    let first = true;
    socket.addEventListener('message', () => {
      if (first) {
        first = false;
        throw new Error('handler bug');
      }
    });
    session.emit(serverMessageFixtures.job);
    await expect(session.flush()).rejects.toThrow('handler bug');
    await session.replay([serverMessageFixtures.job]);
    expect(received).toHaveLength(2);
  });

  it('accepts custom snapshots and tenant', async () => {
    const session = createMockSession({
      tenant: 'zz',
      snapshots: [serverMessageFixtures.snapshot],
    });
    const socket = session.connect(urlFor(serverMessageFixtures.snapshot.scenarioId, 'zz'));
    const { received } = listen(socket);
    await session.flush();
    send(socket, { type: 'subscribe', cells: ['res.net[]'] });
    await session.flush();
    expect(received[0]).toMatchObject({ cells: { 'res.net[]': 120 } });
  });
});
