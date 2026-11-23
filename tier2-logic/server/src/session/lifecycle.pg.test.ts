import { WS_PROTOCOL_VERSION } from '@glidepath/api-contract';
import type { ChangesetResult, Scenario, ServerMessage } from '@glidepath/api-contract';
import type { VariableDef } from '@glidepath/spec';
import { specBundle } from '@glidepath/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANA, MINE, presetId } from '../routes/read/testing/aa-db';
import { IDLE_CLOSE_CODE } from './hub';
import type { Session } from './session';
import { FakeClock } from './testing/fake-clock';
import { startSessionHarness } from './testing/harness';
import type { SessionHarness } from './testing/harness';
import { goldenCells } from './testing/seed';
import type { TestSocket } from './testing/ws-client';

/**
 * API-07 acceptance over real sockets and the real write path: pg-local with the seed tenant `aa`, cookie
 * auth, `POST /changesets` through the app (same origin + CSRF), the hub as the write routes' SessionHub,
 * and a fake clock for the idle limit.
 */

const v = WS_PROTOCOL_VERSION;
const IDLE_MS = 15 * 60_000;
const TARGET = 'g.target_net';
const C = presetId('C');

const clock = new FakeClock();
let h: SessionHarness;
let ana = '';
let target: VariableDef;
const opened: TestSocket[] = [];

const newest = (): Session => [...h.hub.sessions].at(-1)!;
async function openOn(scenario: string): Promise<{ socket: TestSocket; session: Session }> {
  const socket = await h.open({ cookie: ana, scenario });
  opened.push(socket);
  return { socket, session: newest() };
}
const post = (path: string, body: unknown) => h.request(ana, 'POST', path, body);
const setTarget = (value: number) => ({ target: 'variable', key: TARGET, member: '', value });
/** A grid value of the target other than `not`. */
const otherTarget = (not: number | null): number => (not === target.min ? target.min! + target.step! : target.min!);

async function commit(scenarioId: string, baseVersion: number, value: number): Promise<ChangesetResult> {
  const res = await post('/api/t/aa/changesets', { scenarioId, baseVersion, changes: [setTarget(value)] });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ChangesetResult;
}

async function freshCopy(): Promise<Scenario> {
  const res = await post('/api/t/aa/scenarios', { mode: 'copy', from: C });
  expect(res.status).toBe(201);
  return (await res.json()) as Scenario;
}

async function closed(socket: TestSocket, timeoutMs = 5_000): Promise<number> {
  const until = Date.now() + timeoutMs;
  while (socket.closeCode === null) {
    if (Date.now() > until) throw new Error('socket still open');
    await new Promise((r) => setTimeout(r, 10));
  }
  return socket.closeCode;
}

/** Nothing more arrives on `socket` within a short wait (frames are in flight for well under that). */
async function quiet(socket: TestSocket): Promise<void> {
  const before = socket.received.length;
  await new Promise((r) => setTimeout(r, 150));
  expect(socket.received.slice(before)).toEqual([]);
}

beforeAll(async () => {
  h = await startSessionHarness({ clock, idleMs: IDLE_MS });
  ana = await h.login('ana@example.test');
  const bundle = await specBundle();
  target = bundle.variables.find((x) => x.id === TARGET)!;
}, 180_000);

afterAll(async () => {
  for (const s of opened) await s.close();
  await h?.close();
});

describe('commit broadcast', () => {
  it('after POST /changesets every session on that scenario receives changeset + delta (two clients); others nothing', async () => {
    const cells = [`${TARGET}[]`, 'res.target[]', 'res.gap[]'];
    const one = await openOn(MINE);
    const two = await openOn(MINE);
    const other = await openOn(C);
    for (const c of [one, two, other]) {
      c.socket.send({ v, type: 'subscribe', cells });
      await c.socket.expect('snapshot');
    }
    const version = one.session.scenario.version;
    const value = otherTarget(one.session.scenario.committed.get(TARGET));

    const result = await commit(MINE, version, value);
    expect(result.version).toBe(version + 1);
    for (const c of [one, two]) {
      const cs = await c.socket.expect('changeset');
      expect(cs).toEqual({
        v,
        type: 'changeset',
        scenarioId: MINE,
        version: version + 1,
        editsCount: result.editsCount,
        changesetId: result.changesetId,
        origin: 'ui',
        author: { id: ANA, name: expect.any(String) },
      });
      const delta = await c.socket.expect('delta');
      expect(delta.seq).toBeNull();
      expect(delta.cells[`${TARGET}[]` as never]).toBe(value);
      // The session adopted the committed state as tier 3 holds it: same values the POST answered.
      expect(c.session.scenario.version).toBe(version + 1);
      expect(delta.cells['res.target[]' as never]).toBe(c.session.scenario.committed.get('res.target'));
      expect(result.outputs['res.target[]' as never]).toBe(c.session.scenario.committed.get('res.target'));
    }
    await quiet(other.socket);
    for (const c of [one, two, other]) await c.socket.close();
  });

  it('a live preview is rebased onto the commit: delta{null}, then delta{S}; cancelPreview returns to the new committed values', async () => {
    const s = await freshCopy();
    const mine = await openOn(s.id);
    const watcher = await openOn(s.id);
    for (const c of [mine, watcher]) {
      c.socket.send({ v, type: 'subscribe', cells: [`${TARGET}[]`, 'res.target[]'] });
      await c.socket.expect('snapshot');
    }
    const committed = mine.session.scenario.committed.get(TARGET);
    const dragged = otherTarget(committed);
    mine.socket.send({ v, type: 'preview', seq: 1, changes: [{ var: TARGET, member: '', value: dragged }] });
    await mine.socket.until((m) => m.type === 'delta' && m.seq === 1);

    // The drag is released: the client POSTs the previewed value; every session hears of it before the answer.
    const result = await commit(s.id, s.version, dragged);
    const mineFrames = await mine.socket.until((m) => m.type === 'delta' && m.seq === 1);
    const steps = mineFrames.filter((m) => m.type !== 'warnings').map((m) => [m.type, 'seq' in m ? m.seq : undefined]);
    expect(steps).toEqual([['changeset', undefined], ['delta', null], ['delta', 1]]);
    const [, , rebase] = mineFrames.filter((m) => m.type !== 'warnings') as Extract<ServerMessage, { type: 'delta' }>[];
    expect(rebase!.cells).toEqual({}); // the scratch is exactly the committed state now
    expect(await watcher.socket.expect('changeset')).toMatchObject({ version: result.version });
    expect((await watcher.socket.expect('delta')).cells[`${TARGET}[]` as never]).toBe(dragged);

    mine.socket.send({ v, type: 'cancelPreview', seq: 2 });
    const back = await mine.socket.until((m) => m.type === 'delta' && m.seq === 2);
    expect(back.at(-1)).toMatchObject({ cells: {} }); // nothing snaps back
    expect(mine.session.current).toBe(mine.session.scenario.committed);
    for (const c of [mine, watcher]) await c.socket.close();
  });

  it('the first edit of a locked preset forks it and the author’s session follows the fork', async () => {
    const { socket, session } = await openOn(C);
    socket.send({ v, type: 'subscribe', cells: [`${TARGET}[]`] });
    await socket.expect('snapshot');
    const value = otherTarget(session.scenario.committed.get(TARGET));
    const result = await commit(C, session.scenario.version, value);
    expect(result.forkedFrom).toBe(C);
    expect(await socket.expect('changeset')).toMatchObject({ scenarioId: result.scenarioId, forkedFrom: C, version: result.version });
    expect(await socket.expect('delta')).toEqual({ v, type: 'delta', seq: null, cells: { [`${TARGET}[]`]: value } });
    expect(session.scenarioId).toBe(result.scenarioId);
    await socket.close();
  });
});

describe('scenario switch', () => {
  it('re-targets the session and sends a fresh snapshot: commits on the new scenario reach it, on the old one not', async () => {
    const fresh = await freshCopy();
    const { socket, session } = await openOn(MINE);
    socket.send({ v, type: 'subscribe', cells: [`${TARGET}[]`, 'res.target[]'] });
    await socket.expect('snapshot');

    socket.send({ v, type: 'open', scenarioId: fresh.id });
    const snap = await socket.expect('snapshot');
    expect(snap).toMatchObject({ scenarioId: fresh.id, version: fresh.version });
    expect(Object.keys(snap.cells).sort()).toEqual([`${TARGET}[]`, 'res.target[]']);
    expect(snap.cells[`${TARGET}[]` as never]).toBe(session.scenario.committed.get(TARGET));
    expect(session.scenarioId).toBe(fresh.id);

    await commit(MINE, await mineVersion(), target.max!); // the old scenario: not this session's any more
    const value = otherTarget(session.scenario.committed.get(TARGET));
    const r = await commit(fresh.id, fresh.version, value);
    // The next frame is the new scenario's changeset: nothing of the old scenario came before it.
    expect(await socket.expect('changeset')).toMatchObject({ scenarioId: fresh.id, version: r.version });
    expect((await socket.expect('delta')).cells[`${TARGET}[]` as never]).toBe(value);
    await socket.close();
  });
});

async function mineVersion(): Promise<number> {
  const res = await h.request(ana, 'GET', `/api/t/aa/scenarios/${MINE}/inputs`);
  return ((await res.json()) as { version: number }).version;
}

describe('idle close and reconnect', () => {
  it('closes a session idle for SESSION_IDLE_MIN; reconnect rebuilds it from tier 3 with identical values (fake clock)', async () => {
    const cells = [...goldenCells('C').keys()];
    const first = await openOn(MINE);
    first.socket.send({ v, type: 'subscribe', cells });
    const before = await first.socket.expect('snapshot');

    // Activity re-arms the limit: half-way a frame comes in, so the first check finds the session busy.
    clock.advance(IDLE_MS / 2);
    first.socket.send({ v, type: 'subscribe', cells: ['res.net[]'] });
    await first.socket.expect('snapshot');
    clock.advance(IDLE_MS / 2);
    expect(first.socket.closeCode).toBeNull();
    expect(h.hub.sessions.has(first.session)).toBe(true);

    clock.advance(IDLE_MS / 2); // SESSION_IDLE_MIN since the last frame
    expect(await closed(first.socket)).toBe(IDLE_CLOSE_CODE);
    expect(first.session.isClosed).toBe(true);
    expect(h.hub.sessions.has(first.session)).toBe(false);

    // Reconnect: the handshake reads the scenario from tier 3 again and the values are the same.
    const statements = h.queries.statements.length;
    const again = await openOn(MINE);
    expect(h.queries.statements.length).toBeGreaterThan(statements);
    expect(again.session).not.toBe(first.session);
    again.socket.send({ v, type: 'subscribe', cells });
    const after = await again.socket.expect('snapshot');
    expect(after.scenarioId).toBe(before.scenarioId);
    expect(after.version).toBe(before.version);
    expect(after.cells).toEqual(before.cells);
    await again.socket.close();
  });
});
