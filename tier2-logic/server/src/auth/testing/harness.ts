import { createDb } from '@glidepath/data-access';
import type { DbHandle } from '@glidepath/data-access';
import { fictitiousUsers, insertFictitiousUsers, withTestDatabase } from '@glidepath/testkit';
import type { TestDatabase } from '@glidepath/testkit';
import type { Hono } from 'hono';
import { createApp } from '../../app/app';
import { loadConfig } from '../../app/config';
import type { AppEnv } from '../../app/tenant';
import { AUTH_SECRET, captureLogger } from '../../app/testing/fixtures';
import { authFromConfig } from '../auth';
import type { Auth } from '../auth';
import { CSRF_COOKIE, CSRF_HEADER, sessionCookieName } from '../cookies';
import type { Mailer } from '../mailer';
import { startSmtpSink } from './smtp-sink';
import type { SmtpSink, SunkMail } from './smtp-sink';

/**
 * Test support for the auth tests: a fresh migrated database (testkit, ADR-016) with two tenants and
 * fictitious users (`@example.test`), the app connected as glidepath_app (RLS applies), a local SMTP
 * sink as SMTP_URL, and helpers that sign a user in through the real magic-link flow.
 */

const id = (suffix: string): string => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

export const MODEL_VERSION = id('a1');
export const TENANT_A = { id: id('1a'), slug: 'ta', name: 'Tenant A' } as const;
export const TENANT_B = { id: id('1b'), slug: 'tb', name: 'Tenant B' } as const;

const fu = (role: string) => {
  const u = fictitiousUsers.find((x) => x.role === role);
  if (!u) throw new Error(`testkit has no fictitious ${role}`);
  return { id: u.id, email: u.email, name: u.name };
};

export const OWNER = fu('owner');
export const EDITOR = fu('editor');
export const VIEWER = fu('viewer');
export const ADVISOR = fu('advisor');
/** Stands in for the DEMO_USER_EMAIL user DATA-08 seeds: an app_user with an owner membership. */
export const DEMO = { id: id('de'), email: 'demo@example.test', name: 'Demo User' } as const;
/** An account with no membership. */
export const NOBODY = {
  id: id('0b'),
  email: 'nobody@example.test',
  name: 'No Membership',
} as const;

/** Who belongs where: editor is also a viewer of B, nobody belongs nowhere. */
export const MEMBERSHIPS = [
  { user: OWNER.id, tenant: TENANT_A, role: 'owner' },
  { user: EDITOR.id, tenant: TENANT_A, role: 'editor' },
  { user: VIEWER.id, tenant: TENANT_A, role: 'viewer' },
  { user: ADVISOR.id, tenant: TENANT_A, role: 'advisor' },
  { user: DEMO.id, tenant: TENANT_A, role: 'owner' },
  { user: EDITOR.id, tenant: TENANT_B, role: 'viewer' },
] as const;

export const PUBLIC_BASE_URL = 'https://glidepath.example.test';

/** Seeds model_version, both tenants, the users and their memberships, as the owner role (FORCE RLS). */
export async function seedAuthFixture(db: TestDatabase): Promise<void> {
  await insertFictitiousUsers(db.url);
  await db.withClient(async (c) => {
    for (const u of [DEMO, NOBODY]) {
      await c.query('insert into app_user (id, email, name) values ($1, $2, $3)', [
        u.id,
        u.email,
        u.name,
      ]);
    }
    await c.query(
      `insert into model_version (id, semver, status, notes, created_at) values ($1, '1.0.0', 'published', 'auth tests', now())`,
      [MODEL_VERSION],
    );
    for (const [t, extra] of [
      [TENANT_A, { currency: 'USD', ticker: null, status: 'active' }],
      [TENANT_B, { currency: 'EUR', ticker: 'TB', status: 'setup' }],
    ] as const) {
      await c.query('begin');
      await c.query(`select set_config('app.tenant_id', $1, true)`, [t.id]);
      await c.query(
        `insert into tenant (id, slug, name, currency, base_year, target_year, fiscal_calendar, ticker, model_version_id, status, created_at)
         values ($1, $2, $3, $4, 2026, 2027, 'calendar', $5, $6, $7, now())`,
        [t.id, t.slug, t.name, extra.currency, extra.ticker, MODEL_VERSION, extra.status],
      );
      for (const m of MEMBERSHIPS.filter((x) => x.tenant.id === t.id)) {
        await c.query(
          'insert into tenant_membership (tenant_id, user_id, role) values ($1, $2, $3)',
          [t.id, m.user, m.role],
        );
      }
      await c.query('commit');
    }
  });
}

/** The fresh database as glidepath_app (NOBYPASSRLS): a superuser login that assumes the role at startup. */
export function appRoleUrl(test: TestDatabase): string {
  const u = new URL(test.adminUrl);
  u.pathname = `/${test.database}`;
  u.searchParams.set('options', '-c role=glidepath_app');
  return u.toString();
}

/** A browser after sign-in: the Cookie header it sends, and the CSRF token it echoes. */
export interface Browser {
  cookie: string;
  csrf: string;
  /** The session cookie's raw value (`<secret>.<signature>`). */
  sessionValue: string;
  /** The Set-Cookie headers of the callback answer. */
  setCookies: string[];
}

export interface HarnessOptions {
  /** PUBLIC_BASE_URL; null leaves it unset. Default {@link PUBLIC_BASE_URL}. */
  publicBaseUrl?: string | null;
  linkTtlMin?: number;
  /** false leaves SMTP_URL unset. */
  smtp?: boolean;
  mailer?: Mailer | null;
  /** Extra routes, mounted before the first request (Hono builds its router then). */
  routes?: (app: Hono<AppEnv>) => void;
}

export interface AuthHarness {
  app: Hono<AppEnv>;
  auth: Auth;
  db: DbHandle;
  test: TestDatabase;
  sink: SmtpSink;
  lines: string[];
  origin: string;
  /** The clock auth uses; `set(null)` returns to real time. */
  clock: { set(d: Date | null): void; now(): Date };
  /** POST /api/auth/magic-link as the SPA would (same origin, plus the CSRF token of `browser`). */
  requestLink(email: string, browser?: Browser): Promise<Response>;
  /** Requests a link for `email`, waits for its mail and returns the link and the mail. */
  mailLink(email: string, browser?: Browser): Promise<{ link: URL; token: string; mail: SunkMail }>;
  /** Opens a callback URL (path + query) as a browser carrying `browser`'s cookies. */
  follow(link: URL | string, browser?: Browser): Promise<Response>;
  /** The full flow: request, mail, follow; returns the signed-in browser. */
  login(email: string, browser?: Browser): Promise<Browser>;
  /** Headers of a same-origin request from `browser` (Cookie, Origin, x-csrf-token). */
  headers(browser?: Browser, extra?: Record<string, string>): Record<string, string>;
  close(): Promise<void>;
}

const LINK = /https?:\/\/[^\s]+\/api\/auth\/callback\?token=[A-Za-z0-9_-]+/;

/** Cookie name -> value from a response's Set-Cookie headers (deleted cookies map to ''). */
export function cookiesOf(res: Response): Map<string, { value: string; attrs: string }> {
  const out = new Map<string, { value: string; attrs: string }>();
  for (const sc of res.headers.getSetCookie()) {
    const [pair = '', ...attrs] = sc.split(';');
    const i = pair.indexOf('=');
    out.set(pair.slice(0, i).trim(), {
      value: decodeURIComponent(pair.slice(i + 1).trim()),
      attrs: attrs.join(';'),
    });
  }
  return out;
}

export async function startAuthHarness(opts: HarnessOptions = {}): Promise<AuthHarness> {
  const test = await withTestDatabase({ seed: seedAuthFixture });
  const sink = await startSmtpSink();
  const db = createDb(appRoleUrl(test));
  const publicBaseUrl = opts.publicBaseUrl === undefined ? PUBLIC_BASE_URL : opts.publicBaseUrl;
  const config = loadConfig({
    DATABASE_URL: appRoleUrl(test),
    AUTH_SECRET,
    ...(publicBaseUrl ? { PUBLIC_BASE_URL: publicBaseUrl } : {}),
    ...(opts.smtp === false ? {} : { SMTP_URL: sink.url }),
    ...(opts.linkTtlMin ? { AUTH_LINK_TTL_MIN: String(opts.linkTtlMin) } : {}),
  });
  let fixed: Date | null = null;
  const clock = { set: (d: Date | null) => void (fixed = d), now: () => fixed ?? new Date() };
  const auth = authFromConfig(config, {
    db: db.db,
    now: clock.now,
    ...(opts.mailer !== undefined ? { mailer: opts.mailer } : {}),
  });
  const { logger, lines } = captureLogger([AUTH_SECRET, appRoleUrl(test)]);
  const app = createApp({ logger, db, auth });
  opts.routes?.(app);
  const origin = publicBaseUrl ? new URL(publicBaseUrl).origin : 'http://localhost';
  const sessionName = sessionCookieName(auth.settings);

  const headers = (
    browser?: Browser,
    extra: Record<string, string> = {},
  ): Record<string, string> => ({
    origin,
    ...(browser ? { cookie: browser.cookie, [CSRF_HEADER]: browser.csrf } : {}),
    ...extra,
  });

  const requestLink = async (email: string, browser?: Browser): Promise<Response> =>
    app.request('/api/auth/magic-link', {
      method: 'POST',
      headers: headers(browser, { 'content-type': 'application/json' }),
      body: JSON.stringify({ email }),
    });

  const mailLink = async (email: string, browser?: Browser) => {
    const before = sink.countTo(email);
    const res = await requestLink(email, browser);
    if (res.status !== 202)
      throw new Error(`magic-link answered ${res.status}: ${await res.text()}`);
    const mail = await sink.waitFor(email, { after: before });
    const m = LINK.exec(mail.text);
    if (!m) throw new Error(`no sign-in link in the mail:\n${mail.text}`);
    const link = new URL(m[0]);
    return { link, token: link.searchParams.get('token') ?? '', mail };
  };

  const follow = async (link: URL | string, browser?: Browser): Promise<Response> => {
    const u = typeof link === 'string' ? new URL(link, origin) : link;
    return app.request(`${u.pathname}${u.search}`, {
      headers: browser ? { cookie: browser.cookie } : {},
    });
  };

  const login = async (email: string, browser?: Browser): Promise<Browser> => {
    const { link } = await mailLink(email, browser);
    const res = await follow(link, browser);
    const jar = cookiesOf(res);
    const session = jar.get(sessionName)?.value;
    const csrf = jar.get(CSRF_COOKIE)?.value;
    if (res.status !== 303 || !session || !csrf)
      throw new Error(`sign-in failed: ${res.status} ${res.headers.get('location')}`);
    return {
      cookie: `${sessionName}=${encodeURIComponent(session)}; ${CSRF_COOKIE}=${csrf}`,
      csrf,
      sessionValue: session,
      setCookies: res.headers.getSetCookie(),
    };
  };

  return {
    app,
    auth,
    db,
    test,
    sink,
    lines,
    origin,
    clock,
    requestLink,
    mailLink,
    follow,
    login,
    headers,
    async close() {
      await auth.close();
      await db.close();
      await sink.close();
      await test.close();
    },
  };
}
