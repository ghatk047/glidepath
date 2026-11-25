import type { z } from 'zod';
import { problemTypes } from '../problem';
import {
  SessionQuery,
  WS_PROTOCOL_VERSION,
  WS_SESSION_PATH,
  parseClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ClientMessageType,
  type ServerMessage,
} from '../ws';
import { specFixtures, type SnapshotMessageIn } from './specFixtures';

/**
 * A scripted stand-in for `WS /ws/session` (CON-02), for tier-1 tests before tier 2 is live.
 *
 * It replays, it never calculates: every value it sends comes from a `snapshot` fixture
 * (by default the generated golden presets), from a message the test emits, or from a
 * responder the test supplies. Its own answers are lookups only:
 * - `subscribe{cells}` → `snapshot` of those cells from the last committed values it was given
 *   (`null` for a cell it has no value for, as tier 2 does for an unset cell);
 * - `subscribeView` → the matching `views` fixture, if the test configured one;
 * - `cancelPreview{seq}` → `delta{seq}` with the committed values of the subscribed cells;
 * - `open{scenarioId}` → `snapshot` of the subscribed cells on that scenario, then the
 *   configured `views` fixtures of the subscribed views; an unknown scenario → `error` (404);
 * - `preview` → nothing, unless a `respond.preview` responder scripts the answer;
 * - a frame that fails `parseClientMessage` → `error{problem}`, like tier 2.
 * Committed values follow what the test emits: a `snapshot`, or a `delta` with `seq: null`
 * (a commit), replaces the cells it carries; a preview `delta` does not. An emitted
 * `changeset{forkedFrom}` whose `forkedFrom` is the open scenario moves the session to the
 * fork (the test emits it only for a commit this session caused), starting from the
 * preset's committed values.
 */

type ServerIn = z.input<typeof ServerMessage>;
type ServerOf<T extends ServerIn['type']> = Extract<ServerIn, { type: T }>;
type ClientOf<T extends ClientMessageType> = Extract<ClientMessage, { type: T }>;
type ViewMessageIn = ServerOf<'view'>;
type CellValue = number | null;

export const MOCK_SOCKET_STATE = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 } as const;

export interface MockSocketEventMap {
  open: { type: 'open' };
  message: { type: 'message'; data: string };
  close: { type: 'close'; code: number; reason: string; wasClean: boolean };
  error: { type: 'error' };
}
type Listener<K extends keyof MockSocketEventMap> = (event: MockSocketEventMap[K]) => void;

/** The subset of the browser `WebSocket` a session client uses. */
export interface MockSocket {
  readonly url: string;
  readonly readyState: 0 | 1 | 2 | 3;
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSING: 2;
  readonly CLOSED: 3;
  onopen: Listener<'open'> | null;
  onmessage: Listener<'message'> | null;
  onclose: Listener<'close'> | null;
  onerror: Listener<'error'> | null;
  addEventListener<K extends keyof MockSocketEventMap>(type: K, listener: Listener<K>): void;
  removeEventListener<K extends keyof MockSocketEventMap>(type: K, listener: Listener<K>): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** What a responder sees besides the message. */
export interface MockSessionContext {
  /** Scenario the current connection is on (follows `open` and forks). */
  readonly scenarioId: string;
  /** Cells the current connection subscribes to. */
  readonly subscribed: ReadonlySet<string>;
  /** Last committed value of each cell (`null` when the session has none). */
  committed(cells: Iterable<string>): Record<string, CellValue>;
}

/** Scripts the answer to one client message type; returns the server messages to send. */
export type MockResponder<T extends ClientMessageType> = (
  message: ClientOf<T>,
  context: MockSessionContext,
) => readonly ServerIn[] | void;

export interface MockSessionOptions {
  /** Tenant slug the session accepts (default: the generated fixtures' tenant). */
  tenant?: string;
  /** One `snapshot` per scenario the session can open (default: every generated preset). */
  snapshots?: readonly SnapshotMessageIn[];
  /** `view` messages answered on `subscribeView` with the same view and params (default none). */
  views?: readonly ViewMessageIn[];
  /** Replace the default answer for a client message type. */
  respond?: { [T in ClientMessageType]?: MockResponder<T> };
}

export interface MockSession {
  /** WebSocket factory: hand it to the session client in place of `new WebSocket(url)`. */
  readonly connect: (url: string) => MockSocket;
  /** The latest socket `connect` returned (one connection at a time). */
  readonly socket: MockSocket | null;
  /** How many times `connect` was called. */
  readonly connections: number;
  /** Query of the latest accepted connection. */
  readonly query: SessionQuery | null;
  /** Scenario the current connection is on now (the query's, then `open` / fork). */
  readonly scenarioId: string | null;
  /** Every client frame that parsed, in order, across connections. */
  readonly sent: readonly ClientMessage[];
  /** One-line reasons for client frames that did not parse. */
  readonly rejected: readonly string[];
  /** One-line reasons for refused connections (bad path, tenant or scenario). */
  readonly refused: readonly string[];
  /** Cells the current connection subscribes to. */
  readonly subscribed: ReadonlySet<string>;
  /** Views the current connection subscribes to. */
  readonly views: readonly { view: string; params: Record<string, unknown> }[];
  /** Client messages of one type, in order. */
  sentOf<T extends ClientMessageType>(type: T): ClientOf<T>[];
  /** Push one server message (checked with `parseServerMessage`) to the open socket. */
  emit(message: ServerIn): void;
  /** Push several messages in order and wait until they are delivered. */
  replay(messages: readonly ServerIn[]): Promise<void>;
  /** The server drops the connection (default 1006, unclean). */
  drop(code?: number, reason?: string): void;
  /**
   * Resolves once every queued event has been delivered; rejects with the first error a
   * client handler threw meanwhile (delivery of the other events goes on).
   */
  flush(): Promise<void>;
}

interface ScenarioState {
  version: number;
  cells: Map<string, CellValue>;
}

const canonical = (params: Record<string, unknown>): string =>
  JSON.stringify(params, Object.keys(params).sort());

const frameError = (type: string, title: string, status: number, detail: string): ServerIn => ({
  v: WS_PROTOCOL_VERSION,
  type: 'error',
  problem: { type, title, status, detail },
});

/** Creates a mock `WS /ws/session` (see the module comment for what it answers). */
export function createMockSession(options: MockSessionOptions = {}): MockSession {
  const tenant = options.tenant ?? specFixtures.tenant;
  const scenarios = new Map<string, ScenarioState>();
  for (const s of options.snapshots ?? Object.values(specFixtures.snapshots)) {
    const parsed = parseServerMessage(s);
    if (!parsed.ok || parsed.message.type !== 'snapshot') {
      throw new TypeError(
        `mock session: bad snapshot fixture (${parsed.ok ? 'not a snapshot' : parsed.detail})`,
      );
    }
    const { scenarioId, version, cells } = parsed.message;
    scenarios.set(scenarioId, { version, cells: new Map(Object.entries(cells)) });
  }
  const views = (options.views ?? []).map((m) => {
    const parsed = parseServerMessage(m);
    if (!parsed.ok) throw new TypeError(`mock session: bad view fixture (${parsed.detail})`);
    return m;
  });

  let chain: Promise<void> = Promise.resolve();
  /** Errors thrown by the client's handlers during delivery; `flush()` rethrows the first. */
  const failures: unknown[] = [];
  const enqueue = (step: () => void) => {
    chain = chain.then(() => {
      try {
        step();
      } catch (e) {
        failures.push(e);
      }
    });
  };

  let socket: MockSocketImpl | null = null;
  let connections = 0;
  let query: SessionQuery | null = null;
  let current: string | null = null;
  const sent: ClientMessage[] = [];
  const rejected: string[] = [];
  const refused: string[] = [];
  let subscribed = new Set<string>();
  let viewSubs: { view: string; params: Record<string, unknown> }[] = [];

  const state = (): ScenarioState => {
    const s = current && scenarios.get(current);
    if (!s) throw new Error('mock session: no open scenario');
    return s;
  };
  const committed = (cells: Iterable<string>): Record<string, CellValue> => {
    const s = state();
    const out: Record<string, CellValue> = {};
    for (const c of cells) out[c] = s.cells.get(c) ?? null;
    return out;
  };
  const context: MockSessionContext = {
    get scenarioId() {
      if (!current) throw new Error('mock session: no open scenario');
      return current;
    },
    get subscribed() {
      return subscribed;
    },
    committed,
  };

  /** Bookkeeping of committed values from what the test pushes; no derivation. */
  const record = (m: ServerMessage) => {
    if (m.type === 'snapshot') {
      const s = scenarios.get(m.scenarioId) ?? { version: m.version, cells: new Map() };
      s.version = m.version;
      for (const [k, v] of Object.entries(m.cells)) s.cells.set(k, v);
      scenarios.set(m.scenarioId, s);
    } else if (m.type === 'delta' && m.seq === null && current) {
      const s = scenarios.get(current);
      if (s) for (const [k, v] of Object.entries(m.cells)) s.cells.set(k, v);
    } else if (m.type === 'changeset') {
      if (m.forkedFrom !== undefined && m.forkedFrom === current) {
        const from = scenarios.get(m.forkedFrom);
        if (!scenarios.has(m.scenarioId)) {
          scenarios.set(m.scenarioId, { version: m.version, cells: new Map(from?.cells) });
        }
        current = m.scenarioId;
      }
      const s = scenarios.get(m.scenarioId);
      if (s) s.version = m.version;
    }
  };

  const send = (target: MockSocketImpl, message: ServerIn) => {
    const parsed = parseServerMessage(message);
    if (!parsed.ok) throw new TypeError(`mock session: invalid server message (${parsed.detail})`);
    record(parsed.message);
    const data = JSON.stringify(message);
    enqueue(() => {
      if (target.readyState === MOCK_SOCKET_STATE.OPEN)
        target.dispatch('message', { type: 'message', data });
    });
  };

  const defaults: { [T in ClientMessageType]?: MockResponder<T> } = {
    subscribe: (m, ctx) => {
      const s = state();
      return [
        {
          v: WS_PROTOCOL_VERSION,
          type: 'snapshot',
          scenarioId: ctx.scenarioId,
          version: s.version,
          cells: ctx.committed(m.cells),
        },
      ];
    },
    subscribeView: (m) =>
      views.filter((v) => v.view === m.view && canonical(v.params) === canonical(m.params)),
    cancelPreview: (m, ctx) => [
      { v: WS_PROTOCOL_VERSION, type: 'delta', seq: m.seq, cells: ctx.committed(ctx.subscribed) },
    ],
    open: (m, ctx) => {
      if (ctx.scenarioId !== m.scenarioId) {
        return [
          frameError(
            problemTypes.notFound,
            'Unknown scenario',
            404,
            `Scenario ${m.scenarioId} does not exist. Pick one from the scenario bar.`,
          ),
        ];
      }
      const snapshot: ServerIn = {
        v: WS_PROTOCOL_VERSION,
        type: 'snapshot',
        scenarioId: m.scenarioId,
        version: state().version,
        cells: ctx.committed(ctx.subscribed),
      };
      const resent = viewSubs.flatMap((sub) =>
        views.filter((v) => v.view === sub.view && canonical(v.params) === canonical(sub.params)),
      );
      return [snapshot, ...resent];
    },
  };

  const receive = (target: MockSocketImpl, data: unknown) => {
    const parsed = parseClientMessage(data);
    if (!parsed.ok) {
      rejected.push(parsed.detail);
      send(target, frameError(problemTypes.badRequest, 'Bad frame', 400, parsed.detail));
      return;
    }
    const m = parsed.message;
    sent.push(m);
    if (m.type === 'subscribe') for (const c of m.cells) subscribed.add(c);
    if (m.type === 'unsubscribe') for (const c of m.cells) subscribed.delete(c);
    if (m.type === 'open' && scenarios.has(m.scenarioId)) current = m.scenarioId;
    if (m.type === 'subscribeView') viewSubs.push({ view: m.view, params: m.params });
    if (m.type === 'unsubscribeView') {
      const key = canonical(m.params);
      viewSubs = viewSubs.filter((v) => !(v.view === m.view && canonical(v.params) === key));
    }
    const responder = (options.respond?.[m.type] ?? defaults[m.type]) as
      MockResponder<typeof m.type> | undefined;
    for (const out of responder?.(m as never, context) ?? []) send(target, out);
  };

  class MockSocketImpl implements MockSocket {
    readonly CONNECTING = 0 as const;
    readonly OPEN = 1 as const;
    readonly CLOSING = 2 as const;
    readonly CLOSED = 3 as const;
    readyState: 0 | 1 | 2 | 3 = MOCK_SOCKET_STATE.CONNECTING;
    onopen: Listener<'open'> | null = null;
    onmessage: Listener<'message'> | null = null;
    onclose: Listener<'close'> | null = null;
    onerror: Listener<'error'> | null = null;
    private listeners = new Map<string, Set<(e: never) => void>>();

    constructor(readonly url: string) {}

    addEventListener<K extends keyof MockSocketEventMap>(type: K, listener: Listener<K>) {
      const set = this.listeners.get(type) ?? new Set();
      set.add(listener as (e: never) => void);
      this.listeners.set(type, set);
    }
    removeEventListener<K extends keyof MockSocketEventMap>(type: K, listener: Listener<K>) {
      this.listeners.get(type)?.delete(listener as (e: never) => void);
    }
    dispatch<K extends keyof MockSocketEventMap>(type: K, event: MockSocketEventMap[K]) {
      const own = (this as unknown as Record<string, Listener<K> | null>)[`on${type}`];
      own?.(event);
      for (const l of this.listeners.get(type) ?? []) (l as Listener<K>)(event);
    }
    send(data: string) {
      if (this.readyState === MOCK_SOCKET_STATE.CONNECTING) {
        throw new Error('InvalidStateError: send() before the socket is open');
      }
      if (this.readyState !== MOCK_SOCKET_STATE.OPEN || this !== socket) return;
      receive(this, data);
    }
    close(code = 1000, reason = '') {
      if (this.readyState >= MOCK_SOCKET_STATE.CLOSING) return;
      this.readyState = MOCK_SOCKET_STATE.CLOSING;
      enqueue(() => this.closed(code, reason, true));
    }
    closed(code: number, reason: string, wasClean: boolean) {
      if (this.readyState === MOCK_SOCKET_STATE.CLOSED) return;
      this.readyState = MOCK_SOCKET_STATE.CLOSED;
      this.dispatch('close', { type: 'close', code, reason, wasClean });
    }
  }

  const refuse = (s: MockSocketImpl, why: string) => {
    refused.push(why);
    enqueue(() => {
      s.readyState = MOCK_SOCKET_STATE.CLOSED;
      s.dispatch('error', { type: 'error' });
      s.dispatch('close', { type: 'close', code: 1006, reason: '', wasClean: false });
    });
  };

  const connect = (url: string): MockSocket => {
    const s = new MockSocketImpl(url);
    socket = s;
    connections += 1;
    subscribed = new Set();
    viewSubs = [];
    query = null;
    current = null;

    const u = new URL(url, 'ws://mock.session');
    if (u.pathname !== WS_SESSION_PATH) {
      refuse(s, `path ${u.pathname} is not ${WS_SESSION_PATH}`);
      return s;
    }
    const q = SessionQuery.safeParse(Object.fromEntries(u.searchParams));
    if (!q.success) refuse(s, 'query needs tenant and scenario');
    else if (q.data.tenant !== tenant) refuse(s, `tenant ${q.data.tenant} is not ${tenant}`);
    else if (!scenarios.has(q.data.scenario)) {
      refuse(s, `no snapshot for scenario ${q.data.scenario}`);
    } else {
      query = q.data;
      current = q.data.scenario;
      enqueue(() => {
        if (s.readyState !== MOCK_SOCKET_STATE.CONNECTING) return;
        s.readyState = MOCK_SOCKET_STATE.OPEN;
        s.dispatch('open', { type: 'open' });
      });
    }
    return s;
  };

  const flush = async () => {
    let seen: Promise<void>;
    do {
      seen = chain;
      await seen;
    } while (seen !== chain);
    if (failures.length) throw failures.splice(0)[0];
  };

  return {
    connect,
    get socket() {
      return socket;
    },
    get connections() {
      return connections;
    },
    get query() {
      return query;
    },
    get scenarioId() {
      return current;
    },
    sent,
    rejected,
    refused,
    get subscribed() {
      return subscribed;
    },
    get views() {
      return viewSubs;
    },
    sentOf: <T extends ClientMessageType>(type: T) =>
      sent.filter((m): m is ClientOf<T> => m.type === type),
    emit(message) {
      if (!socket || socket.readyState >= MOCK_SOCKET_STATE.CLOSING || !query) {
        throw new Error('mock session: no open connection to emit on');
      }
      send(socket, message);
    },
    async replay(messages) {
      for (const m of messages) this.emit(m);
      await flush();
    },
    drop(code = 1006, reason = '') {
      const s = socket;
      if (!s) throw new Error('mock session: nothing to drop');
      enqueue(() => s.closed(code, reason, false));
    },
    flush,
  };
}
