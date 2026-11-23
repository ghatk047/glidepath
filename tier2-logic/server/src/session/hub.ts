import { STATUS_CODES } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { SessionQuery, WS_SESSION_PATH } from '@glidepath/api-contract';
import type { UserId } from '@glidepath/api-contract';
import type { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import { DEFAULT_SESSION_IDLE_MIN } from '../app/config';
import type { Logger } from '../app/logger';
import { ApiError, problemResponse } from '../app/problem';
import type { AppEnv, Authenticator, MembershipResolver } from '../app/tenant';
import { crossSiteRefused, isSameOrigin } from '../auth/guard';
import type { SessionHub as CommitListener } from '../routes/write/hub';
import { broadcastChange } from './broadcast';
import { systemClock } from './clock';
import type { Clock, Timer } from './clock';
import type { ScenarioLoader, ScenarioState } from './loader';
import { Session } from './session';
import type { SessionMembership } from './session';

/**
 * `WS /ws/session?tenant&scenario` (03 §2, ADR-004, CON-02): the handshake and the open connections.
 *
 * Handshake. The node server's `upgrade` event runs the request through the app (`fetch`), where
 * `GET /ws/session` checks, before any socket exists: same origin (`Origin` = PUBLIC_BASE_URL's origin, as
 * the `/api/*` guard; SameSite cookies do not stop cross-site sockets) → 403; the session cookie (the app's
 * authenticator, API-02) → 401; `tenant` and `scenario` in the query → 400; membership of the tenant →
 * 404; the scenario loaded through the loader (one `withTenant` transaction, compiled model from the
 * ModelCache) → 404 when it is not one of the tenant's. Only then is the connection upgraded and a
 * `Session(user, tenant, scenario)` attached; every refusal is the problem JSON answer over plain HTTP.
 * A non-upgrade `GET /ws/session` answers 426.
 *
 * Every member may preview (previews write nothing); commits keep their REST role guard.
 *
 * Lifecycle (API-07). The hub is also the write routes' `SessionHub`: after a changeset or revert committed,
 * `changeApplied` broadcasts it to the sessions on the scenario (`broadcastChange`) before the POST is
 * answered. A session whose client sent no frame for `idleMs` (`SESSION_IDLE_MIN`, ADR-022) is closed with
 * {@link IDLE_CLOSE_CODE}; the client reconnects and the handshake rebuilds it from tier 3.
 */

/** Close code of an idle session (application range): the client may reconnect at once. */
export const IDLE_CLOSE_CODE = 4000;
export const IDLE_CLOSE_REASON = 'session idle';
const MS_PER_MIN = 60_000;

/** Largest client frame accepted (a subscribe of every cell of a model fits easily). */
export const MAX_FRAME_BYTES = 1024 * 1024;
/** How long `close()` waits for clients to acknowledge the going-away close before cutting them. */
export const CLOSE_GRACE_MS = 500;
const GOING_AWAY = 1001;

/** The env key under which the upgrade listener hands the handshake route its result slot. */
const HANDSHAKE = Symbol('glidepath.ws.handshake');

interface Accepted {
  readonly userId: UserId;
  readonly tenant: SessionMembership;
  readonly state: ScenarioState;
}

interface HandshakeSlot {
  accepted?: Accepted;
}

/** The app's fetch: `app.fetch(request, env)`. */
export type AppFetch = (request: Request, env?: Record<PropertyKey, unknown>) => Response | Promise<Response>;

/** The node HTTP server (only its `upgrade` event is used). */
export interface UpgradeSource {
  on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
}

export interface SessionHubDeps {
  logger: Logger;
  /** Builds sessions' scenario state from tier 3 (`dbScenarioLoader`). */
  loader: ScenarioLoader;
  /** The cookie session (API-02 `auth.authenticate`). */
  authenticate: Authenticator;
  /** Membership of the tenant in the query (API-02 `auth.membership`). */
  membership: MembershipResolver;
  /** Origin the handshake must come from (`allowedOrigin(auth.settings, url)`); absent: not checked. */
  allowedOrigin?: (requestUrl: string) => string;
  /** Runs each session's preview queue; default `setImmediate`. */
  schedule?: (run: () => void) => void;
  /** Idle limit in ms (`SESSION_IDLE_MIN` × 60 000); default `DEFAULT_SESSION_IDLE_MIN` minutes. */
  idleMs?: number;
  /** Time for idle close and the rerun cap; default the system clock. */
  clock?: Clock;
}

export interface SessionHub extends CommitListener {
  /** Mounts the handshake route `GET /ws/session` on the app. */
  route(app: Hono<AppEnv>): void;
  /** Accepts WebSocket upgrades on `server`, running each handshake through `fetch` (the app). */
  listen(server: UpgradeSource, fetch: AppFetch): void;
  /** Sessions open now. */
  readonly sessions: ReadonlySet<Session>;
  /** Closes every connection (1001) and stops accepting new ones. */
  close(): Promise<void>;
}

const statusLine = (status: number): string => `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}\r\n`;

/** Writes `res` as a plain HTTP answer on the raw socket and closes it. */
async function refuse(socket: Duplex, res: Response): Promise<void> {
  const body = Buffer.from(await res.arrayBuffer());
  let head = statusLine(res.status);
  res.headers.forEach((value, name) => {
    if (name !== 'content-length' && name !== 'connection' && name !== 'transfer-encoding') head += `${name}: ${value}\r\n`;
  });
  head += `content-length: ${body.length}\r\nconnection: close\r\n\r\n`;
  if (!socket.writable) return void socket.destroy();
  socket.end(Buffer.concat([Buffer.from(head, 'latin1'), body]));
}

/** The upgrade request as a fetch `Request` (method, URL from Host, headers). */
function toRequest(req: IncomingMessage): Request {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else if (value !== undefined) headers.set(name, value);
  }
  return new Request(url, { method: req.method ?? 'GET', headers });
}

export function createSessionHub(deps: SessionHubDeps): SessionHub {
  const { logger } = deps;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const sessions = new Set<Session>();
  const sockets = new Set<WebSocket>();
  const clock = deps.clock ?? systemClock;
  const idleMs = Math.max(1, deps.idleMs ?? DEFAULT_SESSION_IDLE_MIN * MS_PER_MIN);
  const idleTimers = new Set<Timer>();
  let closing = false;
  let nextId = 0;

  function attach(ws: WebSocket, accepted: Accepted): void {
    nextId += 1;
    const log = logger.child({ ws: nextId });
    sockets.add(ws);
    const session = new Session({
      clock,
      userId: accepted.userId,
      tenant: accepted.tenant,
      state: accepted.state,
      loader: deps.loader,
      send: (message) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
      },
      logger: log,
      ...(deps.schedule ? { schedule: deps.schedule } : {}),
    });
    sessions.add(session);
    log.info('session opened', { tenant: accepted.tenant.slug, scenario: accepted.state.scenarioId });
    // Idle close: one timer per session, re-armed for the rest of the limit while the client is active.
    let idle: Timer | null = null;
    const arm = (ms: number) => {
      const t = clock.after(ms, () => {
        idleTimers.delete(t);
        idle = null;
        if (session.isClosed) return;
        const quiet = clock.now() - session.lastActivity;
        if (quiet < idleMs) return arm(idleMs - quiet);
        log.info('session idle, closing', { scenario: session.scenarioId, idleMs });
        session.close();
        ws.close(IDLE_CLOSE_CODE, IDLE_CLOSE_REASON);
      });
      idle = t;
      idleTimers.add(t);
    };
    arm(idleMs);
    ws.on('message', (data: RawData) => session.receive(data.toString()));
    ws.on('error', (err) => log.warn('session socket error', { err }));
    ws.on('close', (code) => {
      if (idle) {
        idle.cancel();
        idleTimers.delete(idle);
      }
      session.close();
      sessions.delete(session);
      sockets.delete(ws);
      log.info('session closed', { code });
    });
  }

  async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, fetch: AppFetch): Promise<void> {
    socket.on('error', () => socket.destroy()); // a client that goes away mid-handshake
    let res: Response;
    const slot: HandshakeSlot = {};
    const path = (req.url ?? '/').split('?')[0];
    if (closing) {
      res = problemResponse({ status: 503, title: 'Service unavailable', detail: 'The server is restarting. Reconnect in a moment.' });
    } else if (path !== WS_SESSION_PATH) {
      res = problemResponse({ status: 404, title: 'Not found', detail: `WebSockets are served on ${WS_SESSION_PATH} only.` });
    } else if (req.method !== 'GET' || (req.headers.upgrade ?? '').toLowerCase() !== 'websocket') {
      res = problemResponse({ status: 400, title: 'Bad request', detail: 'Open the session with a WebSocket GET.' });
    } else {
      try {
        res = await fetch(toRequest(req), { incoming: req, [HANDSHAKE]: slot });
      } catch (err) {
        logger.error('session handshake failed', { err });
        res = problemResponse({ status: 500, title: 'Internal error', detail: 'The session could not be opened. Try again.' });
      }
    }
    const accepted = slot.accepted;
    if (!accepted || closing) {
      await refuse(socket, res);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attach(ws, accepted));
  }

  return {
    sessions,
    async changeApplied(notice) {
      await broadcastChange(sessions, notice, deps.loader, logger);
    },
    scenarioChanged(notice) {
      // No WS message carries the scenario list (clients refetch it over REST); the open sessions keep their
      // scenario: a rename, lock or archive changes no value.
      logger.debug('scenario changed', { scenario: notice.scenario.id, change: notice.change });
    },
    route(app) {
      app.get(WS_SESSION_PATH, async (c) => {
        const env = c.env as Record<PropertyKey, unknown> | undefined;
        const slot = env?.[HANDSHAKE] as HandshakeSlot | undefined;
        if (!slot) {
          return problemResponse(
            { status: 426, title: 'Upgrade required', detail: 'Open /ws/session as a WebSocket.' },
            c.req.path,
            { upgrade: 'websocket' },
          );
        }
        if (deps.allowedOrigin && !isSameOrigin(c.req.raw.headers, deps.allowedOrigin(c.req.url))) {
          throw crossSiteRefused();
        }
        const userId = await deps.authenticate(c);
        if (userId === null) throw ApiError.unauthenticated();
        const query = SessionQuery.safeParse(c.req.query());
        if (!query.success) throw ApiError.badRequest('Open /ws/session?tenant=<slug>&scenario=<id>.');
        const tenant = await deps.membership(userId, query.data.tenant);
        if (!tenant) throw ApiError.notFound('No such tenant, or you are not a member of it.');
        const state = await deps.loader.load({ tenantId: tenant.tenantId, userId }, query.data.scenario);
        if (!state) throw ApiError.notFound('No such scenario in this tenant. Check the scenario id.');
        slot.accepted = { userId, tenant, state };
        return c.body(null, 204);
      });
    },
    listen(server, fetch) {
      server.on('upgrade', (req, socket, head) => {
        upgrade(req, socket, head, fetch).catch((err: unknown) => {
          logger.error('session upgrade failed', { err });
          socket.destroy();
        });
      });
    },
    async close() {
      closing = true;
      for (const t of idleTimers) t.cancel();
      idleTimers.clear();
      const open = [...sockets];
      await Promise.race([
        Promise.all(
          open.map(
            (ws) =>
              new Promise<void>((resolve) => {
                if (ws.readyState === ws.CLOSED) return resolve();
                ws.once('close', () => resolve());
                ws.close(GOING_AWAY, 'server shutting down');
              }),
          ),
        ),
        new Promise((resolve) => setTimeout(resolve, CLOSE_GRACE_MS).unref()),
      ]);
      for (const ws of sockets) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
