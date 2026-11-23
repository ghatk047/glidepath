import type { AddressInfo } from 'node:net';
import { WS_SESSION_PATH } from '@glidepath/api-contract';
import type { DbHandle } from '@glidepath/data-access';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { createApp } from '../../app/app';
import { loadConfig } from '../../app/config';
import { bindWithTenant } from '../../app/tenant';
import { AUTH_SECRET, captureLogger } from '../../app/testing/fixtures';
import { authFromConfig } from '../../auth/auth';
import type { Auth } from '../../auth/auth';
import { CSRF_COOKIE, CSRF_HEADER, sessionCookieName } from '../../auth/cookies';
import { allowedOrigin } from '../../auth/guard';
import type { Mailer } from '../../auth/mailer';
import { startAaDatabase } from '../../routes/read/testing/aa-db';
import type { AaDatabase } from '../../routes/read/testing/aa-db';
import { specBundleFromDir } from '../../routes/read/spec-source';
import { createSessionHub } from '../hub';
import type { SessionHub } from '../hub';
import type { Clock } from '../clock';
import { dbScenarioLoader } from '../loader';
import { ModelCache } from '../model-cache';
import { openSocket } from './ws-client';
import type { Opened, Refused } from './ws-client';

/**
 * Test support for `WS /ws/session` on pg-local: the seed tenant's database of the read-route tests
 * (`routes/read/testing/aa-db.ts`: model version, tenant `aa` with its presets, tenant `zz`; the app
 * connects as `glidepath_app`, RLS applies), real cookie auth (API-02, sign-in links caught by an
 * in-memory mailer), the session hub with the DB loader and a ModelCache, all served on a loopback port.
 * Every statement the app's pool runs is recorded (`queries`), from the first connection on.
 */

export const PUBLIC_BASE_URL = 'https://glidepath.example.test';
export const ORIGIN = new URL(PUBLIC_BASE_URL).origin;

/** Statements the app's pool sent, and client checkouts. */
export interface QuerySpy {
  readonly statements: readonly string[];
  readonly checkouts: number;
}

/** Records every statement of every client of `pool`; install before the pool's first connection. */
export function spyQueries(pool: DbHandle['pool']): QuerySpy {
  const statements: string[] = [];
  let checkouts = 0;
  pool.on('connect', (client) => {
    const query = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as { query: unknown }).query = (...args: unknown[]) => {
      const q = args[0] as string | { text?: string };
      statements.push(typeof q === 'string' ? q : (q?.text ?? String(q)));
      return query(...args);
    };
  });
  pool.on('acquire', () => {
    checkouts += 1;
  });
  return {
    statements,
    get checkouts() {
      return checkouts;
    },
  };
}

export interface ConnectOptions {
  cookie?: string;
  /** `Origin` header; null sends none. Default {@link ORIGIN}. */
  origin?: string | null;
  tenant?: string;
  scenario?: string;
  /** Replaces the whole query string. */
  query?: string;
}

export interface SessionHarness {
  aa: AaDatabase;
  auth: Auth;
  hub: SessionHub;
  models: ModelCache;
  queries: QuerySpy;
  lines: string[];
  /** `http://127.0.0.1:<port>` */
  base: string;
  /** Signs `email` in through the magic link; returns the browser's Cookie header. */
  login(email: string): Promise<string>;
  connect(opts: ConnectOptions): Promise<Opened | Refused>;
  /** Like `connect`, failing unless the handshake succeeds. */
  open(opts: ConnectOptions): Promise<Opened['socket']>;
  /** A state-changing request as the signed-in browser sends it (same origin, CSRF header), through the app. */
  request(cookie: string, method: string, path: string, body?: unknown): Promise<Response>;
  close(): Promise<void>;
}

export interface SessionHarnessOptions {
  /** The hub's clock (idle close, rerun cap). */
  clock?: Clock;
  /** The hub's idle limit in ms. */
  idleMs?: number;
}

export async function startSessionHarness(options: SessionHarnessOptions = {}): Promise<SessionHarness> {
  const aa = await startAaDatabase();
  const queries = spyQueries(aa.app.pool);
  const links: string[] = [];
  const mailer: Mailer = {
    sendMagicLink: async (m) => void links.push(m.link),
    close: () => undefined,
  };
  const config = loadConfig({
    DATABASE_URL: 'postgres://unused@127.0.0.1:1/unused',
    AUTH_SECRET,
    PUBLIC_BASE_URL,
  });
  const auth = authFromConfig(config, { db: aa.app.db, mailer });
  const { logger, lines } = captureLogger([AUTH_SECRET]);
  const specBundle = specBundleFromDir();
  const models = new ModelCache();
  const hub = createSessionHub({
    logger,
    authenticate: auth.authenticate,
    membership: auth.membership,
    allowedOrigin: (url) => allowedOrigin(auth.settings, url),
    loader: dbScenarioLoader({ withTenant: bindWithTenant(aa.app.db), specBundle, models }),
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }),
  });
  const app = createApp({ logger, db: aa.app, auth, specBundle, sessions: hub });
  const server = await new Promise<ServerType>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(s));
    s.once('error', reject);
  });
  hub.listen(server, app.fetch);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const sessionName = sessionCookieName(auth.settings);

  const login = async (email: string): Promise<string> => {
    const before = links.length;
    const res = await app.request('/api/auth/magic-link', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (res.status !== 202) throw new Error(`magic-link answered ${res.status}`);
    await auth.idle();
    const link = links[before];
    if (!link) throw new Error(`no sign-in link for ${email}`);
    const u = new URL(link);
    const cb = await app.request(`${u.pathname}${u.search}`);
    const jar = new Map(
      cb.headers.getSetCookie().map((sc) => {
        const pair = sc.split(';')[0] ?? '';
        const i = pair.indexOf('=');
        return [pair.slice(0, i).trim(), pair.slice(i + 1).trim()] as const;
      }),
    );
    const session = jar.get(sessionName);
    if (cb.status !== 303 || !session) throw new Error(`sign-in failed for ${email}: ${cb.status}`);
    return `${sessionName}=${session}; ${CSRF_COOKIE}=${jar.get(CSRF_COOKIE) ?? ''}`;
  };

  const connect = (opts: ConnectOptions) => {
    const query =
      opts.query ??
      new URLSearchParams({ tenant: opts.tenant ?? 'aa', ...(opts.scenario ? { scenario: opts.scenario } : {}) }).toString();
    const headers: Record<string, string> = {};
    const origin = opts.origin === undefined ? ORIGIN : opts.origin;
    if (origin !== null) headers.origin = origin;
    if (opts.cookie) headers.cookie = opts.cookie;
    return openSocket(`ws://127.0.0.1:${port}${WS_SESSION_PATH}?${query}`, headers);
  };

  return {
    aa,
    auth,
    hub,
    models,
    queries,
    lines,
    base,
    login,
    connect,
    request(cookie, method, path, body) {
      const csrf = new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`).exec(cookie)?.[1] ?? '';
      return Promise.resolve(
        app.request(path, {
          method,
          headers: { cookie, origin: ORIGIN, [CSRF_HEADER]: decodeURIComponent(csrf), 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    },
    async open(opts) {
      const r = await connect(opts);
      if (!r.ok) throw new Error(`handshake refused: ${r.status} ${r.body}`);
      return r.socket;
    },
    async close() {
      await hub.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        if ('closeAllConnections' in server) server.closeAllConnections();
      });
      await auth.close();
      await aa.close();
    },
  };
}
