import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  PREVIEW_MIN_INTERVAL_MS,
  WS_PROTOCOL_VERSION,
  WS_SESSION_PATH,
  parseClientMessage,
  parseServerMessage,
  toCellKey,
  type ServerMessage,
  type ViewName,
  type ViewParams,
} from '@glidepath/api-contract';
import {
  applyMessages,
  initialSessionState,
  markStale,
  prune,
  viewKey,
  type SessionState,
  type SessionStatus,
} from './state';

/**
 * WebSocket session client (WEB-03): `WS /ws/session?tenant&scenario` (CON-02, 07 §3 and §5).
 *
 * - Subscriptions are reference-counted per cell and per view+params; changes made in one
 *   tick go out as one `subscribe` / `unsubscribe` (and one `subscribeView` / `unsubscribeView`
 *   per view) after the tick, so a remount does not churn the socket.
 * - Previews: at most one per `PREVIEW_MIN_INTERVAL_MS` per input cell, latest value wins;
 *   `seq` is one strictly increasing counter shared by `preview` and `cancelPreview`.
 * - Server frames are parsed with `parseServerMessage`, queued, and applied in one store
 *   update per animation frame by `applyMessages` (stale `seq` ignored).
 * - On a drop, values stay as received but flagged stale, status is `reconnecting`, and the
 *   client reconnects with exponential backoff, then resubscribes everything held.
 * The client never computes a value: everything in the store came from a server message.
 */

/** Socket surface the client uses; the browser `WebSocket` and the contract's mock satisfy it. */
export interface SessionSocket {
  readonly readyState: number;
  // Handler params are `never` so any socket's own event types fit; the client's handlers
  // only read `data` from message events.
  onopen: ((event: never) => void) | null;
  onmessage: ((event: never) => void) | null;
  onclose: ((event: never) => void) | null;
  onerror: ((event: never) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const SOCKET_OPEN = 1;
const NORMAL_CLOSURE = 1000;

/** Reconnect delay before the first retry; doubles per failed attempt up to `BACKOFF_MAX_MS`. */
export const BACKOFF_INITIAL_MS = 250;
export const BACKOFF_MAX_MS = 8000;
/** Up to this fraction is added at random to each delay, so clients do not retry in step. */
export const BACKOFF_JITTER = 0.25;
/** Frame fallback where `requestAnimationFrame` is missing (tests, workers). */
const FALLBACK_FRAME_MS = 16;

export interface SessionClientOptions {
  tenant: string;
  scenario: string;
  /** Origin of the session socket, e.g. `ws://localhost:8080`; default: this page's origin as ws(s). */
  origin?: string;
  /** Socket factory; default `new WebSocket(url)`. Tests pass `createMockSession().connect`. */
  connect?: (url: string) => SessionSocket;
  /** Schedules the batch apply; default `requestAnimationFrame`. */
  requestFrame?: (cb: () => void) => void;
  /** Clock for the preview throttle; default `Date.now`. */
  now?: () => number;
  /** Jitter source for the backoff; default `Math.random`. */
  random?: () => number;
  backoff?: { initialMs?: number; maxMs?: number; jitter?: number };
  /** A frame that failed the contract (received) or a message the client refused to send. */
  onProtocolError?: (detail: string) => void;
}

export interface SessionClient {
  /** Cell map, view map, status: the view state tier 1 renders. */
  readonly store: StoreApi<SessionState>;
  /** Hold cells (`CellKey`s like `res.net[]`); returns the release (idempotent). */
  subscribe(cells: readonly string[]): () => void;
  /** Hold a view with its params; returns the release (idempotent). */
  subscribeView<V extends ViewName>(view: V, params: ViewParams<V>): () => void;
  /** Try `value` for input cell `variable[member]` (drag). Throttled per cell, latest wins. */
  preview(variable: string, member: string, value: number): void;
  /**
   * Void the scratch copy: drops pending previews and sends `cancelPreview` with a fresh seq.
   * Returns that seq, or `null` when nothing was previewed since the last cancel.
   */
  cancelPreview(): number | null;
  /** Cancels the preview on Escape keydown on `target` (default `window`); returns the detach. */
  cancelOnEscape(target?: EventTarget): () => void;
  /** Ends the session: closes the socket, stops reconnecting. */
  close(): void;
}

type ClientFrame = Record<string, unknown> & { type: string };
type ViewSub = { view: ViewName; params: object; count: number };
interface PreviewSlot {
  lastSentAt: number;
  pending: { variable: string; member: string; value: number } | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const defaultOrigin = () => {
  const loc = (globalThis as { location?: { protocol: string; host: string } }).location;
  if (!loc) throw new Error('session client: pass `origin` outside a browser');
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}`;
};

const defaultFrame = (cb: () => void) => {
  if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(cb);
  else setTimeout(cb, FALLBACK_FRAME_MS);
};

/** `WS /ws/session` URL for a tenant and scenario. */
export function sessionUrl(origin: string, tenant: string, scenario: string): string {
  const url = new URL(WS_SESSION_PATH, origin);
  url.searchParams.set('tenant', tenant);
  url.searchParams.set('scenario', scenario);
  return url.toString();
}

/** One place that builds the preview frame (CON-05 will batch `changes[]`). */
const previewFrame = (variable: string, member: string, value: number, seq: number) => ({
  v: WS_PROTOCOL_VERSION,
  type: 'preview',
  var: variable,
  member,
  value,
  seq,
});

export function createSessionClient(options: SessionClientOptions): SessionClient {
  const url = sessionUrl(options.origin ?? defaultOrigin(), options.tenant, options.scenario);
  const connect = options.connect ?? ((u: string) => new WebSocket(u) as unknown as SessionSocket);
  const requestFrame = options.requestFrame ?? defaultFrame;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const initialMs = options.backoff?.initialMs ?? BACKOFF_INITIAL_MS;
  const maxMs = options.backoff?.maxMs ?? BACKOFF_MAX_MS;
  const jitter = options.backoff?.jitter ?? BACKOFF_JITTER;

  const store = createStore<SessionState>()(() => initialSessionState());

  // What the app holds, and what the current connection has been told.
  const cellRefs = new Map<string, number>();
  const viewRefs = new Map<string, ViewSub>();
  let sentCells = new Set<string>();
  let sentViews = new Map<string, ViewSub>();

  let socket: SessionSocket | null = null;
  let closed = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  let seq = 0;
  let lastSeq = 0;
  let floorSeq = 0;
  let previewing = false;
  const slots = new Map<string, PreviewSlot>();

  let queue: ServerMessage[] = [];
  let frameRequested = false;

  const hasCell = (k: string) => cellRefs.has(k);
  const hasView = (k: string) => viewRefs.has(k);
  const isOpen = () => socket !== null && socket.readyState === SOCKET_OPEN;
  const setStatus = (status: SessionStatus) => {
    if (store.getState().status !== status) store.setState({ status });
  };

  const send = (frame: ClientFrame): boolean => {
    if (!socket || !isOpen()) return false;
    const parsed = parseClientMessage(frame);
    if (!parsed.ok) {
      options.onProtocolError?.(`not sent: ${parsed.detail}`);
      return false;
    }
    socket.send(JSON.stringify(frame));
    return true;
  };

  // ---- subscriptions -------------------------------------------------------------------

  let syncQueued = false;
  const queueSync = () => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(sync);
  };

  /** Brings the server's push set in line with what is held, and drops released entries. */
  function sync() {
    syncQueued = false;
    if (closed) return;
    store.setState((s) => prune(s, hasCell, hasView));
    if (!isOpen()) return;
    const v = WS_PROTOCOL_VERSION;
    const gone = [...sentCells].filter((c) => !cellRefs.has(c));
    const added = [...cellRefs.keys()].filter((c) => !sentCells.has(c));
    if (gone.length && send({ v, type: 'unsubscribe', cells: gone })) {
      for (const c of gone) sentCells.delete(c);
    }
    if (added.length && send({ v, type: 'subscribe', cells: added })) {
      for (const c of added) sentCells.add(c);
    }
    for (const [key, sub] of sentViews) {
      if (viewRefs.has(key)) continue;
      if (send({ v, type: 'unsubscribeView', view: sub.view, params: sub.params })) {
        sentViews.delete(key);
      }
    }
    for (const [key, sub] of viewRefs) {
      if (sentViews.has(key)) continue;
      if (send({ v, type: 'subscribeView', view: sub.view, params: sub.params })) {
        sentViews.set(key, sub);
      }
    }
  }

  function subscribe(cells: readonly string[]) {
    const held = [...new Set(cells)];
    for (const c of held) cellRefs.set(c, (cellRefs.get(c) ?? 0) + 1);
    queueSync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const c of held) {
        const n = (cellRefs.get(c) ?? 0) - 1;
        if (n > 0) cellRefs.set(c, n);
        else cellRefs.delete(c);
      }
      queueSync();
    };
  }

  function subscribeView<V extends ViewName>(view: V, params: ViewParams<V>) {
    const key = viewKey(view, params);
    const sub = viewRefs.get(key) ?? { view, params, count: 0 };
    sub.count += 1;
    viewRefs.set(key, sub);
    queueSync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      sub.count -= 1;
      if (sub.count <= 0 && viewRefs.get(key) === sub) viewRefs.delete(key);
      queueSync();
    };
  }

  // ---- previews ------------------------------------------------------------------------

  const nextSeq = () => (seq += 1);

  const sendPreview = (slot: PreviewSlot, variable: string, member: string, value: number) => {
    if (send(previewFrame(variable, member, value, seq + 1))) {
      nextSeq();
      slot.lastSentAt = now();
      previewing = true;
    }
  };

  function preview(variable: string, member: string, value: number) {
    if (closed || !isOpen()) return; // a preview cannot wait for a connection
    const key = toCellKey(variable, member);
    let slot = slots.get(key);
    if (!slot) {
      slot = { lastSentAt: Number.NEGATIVE_INFINITY, pending: null, timer: null };
      slots.set(key, slot);
    }
    const s = slot;
    if (s.timer === null && now() - s.lastSentAt >= PREVIEW_MIN_INTERVAL_MS) {
      sendPreview(s, variable, member, value);
      return;
    }
    s.pending = { variable, member, value };
    previewing = true;
    if (s.timer !== null) return;
    const wait = Math.max(0, Math.ceil(s.lastSentAt + PREVIEW_MIN_INTERVAL_MS - now()));
    s.timer = setTimeout(() => {
      s.timer = null;
      const p = s.pending;
      s.pending = null;
      if (p) sendPreview(s, p.variable, p.member, p.value);
    }, wait);
  }

  const dropPendingPreviews = () => {
    for (const slot of slots.values()) {
      if (slot.timer !== null) clearTimeout(slot.timer);
      slot.timer = null;
      slot.pending = null;
    }
  };

  function cancelPreview(): number | null {
    dropPendingPreviews();
    if (!previewing) return null;
    previewing = false;
    if (!send({ v: WS_PROTOCOL_VERSION, type: 'cancelPreview', seq: seq + 1 })) return null;
    floorSeq = nextSeq();
    return floorSeq;
  }

  function cancelOnEscape(target: EventTarget = globalThis as unknown as EventTarget) {
    const onKey = (e: Event) => {
      if ((e as KeyboardEvent).key === 'Escape' && previewing) cancelPreview();
    };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }

  // ---- inbound: one batch per animation frame ------------------------------------------

  function applyQueued() {
    frameRequested = false;
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    const result = applyMessages(store.getState(), batch, { lastSeq, floorSeq, hasCell, hasView });
    lastSeq = result.lastSeq;
    store.setState(result.state, true);
  }

  /** The one entry point for server frames. */
  function receive(data: unknown) {
    const parsed = parseServerMessage(data);
    if (!parsed.ok) {
      options.onProtocolError?.(parsed.detail);
      return;
    }
    queue.push(parsed.message);
    if (!frameRequested) {
      frameRequested = true;
      requestFrame(applyQueued);
    }
  }

  // ---- connection ----------------------------------------------------------------------

  function open() {
    reconnectTimer = null;
    if (closed) return;
    const s = connect(url);
    socket = s;
    sentCells = new Set();
    sentViews = new Map();
    s.onopen = (() => {
      if (s !== socket) return;
      attempt = 0;
      setStatus('open');
      sync();
    }) as SessionSocket['onopen'];
    s.onmessage = ((e: { data: unknown }) => {
      if (s === socket) receive(e.data);
    }) as SessionSocket['onmessage'];
    s.onclose = (() => {
      if (s === socket) dropped();
    }) as SessionSocket['onclose'];
    s.onerror = null; // a close event always follows
  }

  function dropped() {
    socket = null;
    dropPendingPreviews();
    previewing = false;
    applyQueued(); // what tier 2 sent before the drop still lands, then everything dims
    if (closed) return;
    store.setState((st) => markStale(st, 'reconnecting'), true);
    const base = Math.min(maxMs, initialMs * 2 ** attempt);
    attempt += 1;
    reconnectTimer = setTimeout(open, Math.round(base * (1 + jitter * random())));
  }

  function close() {
    if (closed) return;
    closed = true;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    dropPendingPreviews();
    const s = socket;
    socket = null;
    s?.close(NORMAL_CLOSURE);
    applyQueued();
    store.setState((st) => markStale(st, 'closed'), true);
  }

  open();

  return { store, subscribe, subscribeView, preview, cancelPreview, cancelOnEscape, close };
}
