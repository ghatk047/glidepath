import type { UserId } from '@glidepath/api-contract';
import type { Db } from '@glidepath/data-access';
import type { Context, MiddlewareHandler } from 'hono';
import type { Logger } from '../app/logger';
import type { AppEnv } from '../app/tenant';
import { CSRF_HEADER, clearSessionCookies, readSessionSecret, setSessionCookies } from './cookies';
import type { AuthKeys } from './crypto';
import {
  csrfTokenFor,
  deriveKeys,
  hashLinkToken,
  isSecretShape,
  newSecret,
  safeEqual,
  sessionIdFor,
} from './crypto';
import { allowedOrigin, crossSiteRefused, csrfRefused, isSafeMethod, isSameOrigin } from './guard';
import type { Mailer } from './mailer';
import { minutesToMs } from './settings';
import type { AuthSettings } from './settings';
import {
  consumeToken,
  countLiveTokens,
  deleteOtherTokens,
  deleteSession,
  deleteToken,
  findSession,
  findUserByEmail,
  insertSession,
  insertToken,
  lockAddress,
  pruneSessions,
  pruneTokens,
} from './store';
import type { Executor } from './store';

/**
 * Magic-link sign-in and cookie sessions (ADR-014, API-02).
 *
 * Request a link: the address is looked up in app_user (the app role cannot create users: sign-in is
 * for users a seed or an owner created). For a known address a token is stored as its hash and the
 * link is mailed through SMTP_URL. The answer is the same 202 for every address and is sent before
 * the lookup, so neither the body nor the timing tells whether an address has an account.
 *
 * Follow the link: the token is consumed in one UPDATE (single use, unexpired), the browser's previous
 * session is deleted and a new one created (rotation at sign-in: no session fixation), the address's
 * other links are voided, and the cookies are set.
 */

export interface AuthDeps {
  /** The app's database (app role; the auth tables are global, no RLS). */
  db: Db;
  settings: AuthSettings;
  /** Null when SMTP_URL is unset: requesting a link answers 503. */
  mailer: Mailer | null;
  /** Clock for expiry (tests move it). */
  now?: () => Date;
}

/** The session of the current request. */
export interface ActiveSession {
  /** auth_session.id (derived from the secret; never the secret). */
  readonly id: string;
  readonly userId: UserId;
  /** The CSRF token state-changing requests of this session must send. */
  readonly csrf: string;
}

/** Live (unconsumed, unexpired) links per address; further requests send nothing until one is used or expires. */
export const MAX_LIVE_LINKS_PER_ADDRESS = 5;
const MS_PER_SECOND = 1_000;

export interface AuthCore {
  readonly settings: AuthSettings;
  /** True when links can be sent: SMTP_URL and PUBLIC_BASE_URL are both set. */
  readonly canSendLinks: boolean;
  /** The request's session from its signed cookie (memoised per request), or null. */
  session(c: Context): Promise<ActiveSession | null>;
  /** `/api/*` middleware: same origin, then CSRF when a session is present, on state-changing requests. */
  readonly guard: MiddlewareHandler<AppEnv>;
  /** Queues the sign-in mail for `email` (never throws; failures are logged without the link). */
  requestLink(email: string, log: Logger): void;
  /** Consumes a link token and signs the browser in; false when the token is unknown, used or expired. */
  signIn(c: Context, token: string): Promise<boolean>;
  /**
   * Signs the browser in as the user `resolve` returns, inside one transaction with it: the browser's
   * previous session is deleted, a new one stored and the cookies set (rotation at sign-in). `resolve`
   * returning null rolls nothing forward and answers false. Shared by magic link and passkey (API-03).
   */
  startSession(c: Context, resolve: (tx: Executor) => Promise<string | null>): Promise<boolean>;
  /** Keys derived from AUTH_SECRET (cookie signatures). */
  readonly keys: AuthKeys;
  /** The auth clock. */
  now(): Date;
  /** Deletes the request's session and clears the cookies. */
  signOut(c: Context): Promise<void>;
  /** Resolves when every queued sign-in mail has been handled. */
  idle(): Promise<void>;
}

export function createAuthCore(deps: AuthDeps): AuthCore {
  const { db, settings, mailer } = deps;
  const clock = deps.now ?? (() => new Date());
  const keys = deriveKeys(settings.secret);
  const sessions = new WeakMap<Request, Promise<ActiveSession | null>>();
  const pending = new Set<Promise<void>>();
  const publicOrigin = settings.publicOrigin;

  async function lookup(c: Context): Promise<ActiveSession | null> {
    const secret = await readSessionSecret(c, settings, keys);
    if (!isSecretShape(secret)) return null;
    const id = sessionIdFor(keys, secret);
    const row = await findSession(db, id, clock());
    return row ? { id, userId: row.userId as UserId, csrf: csrfTokenFor(keys, secret) } : null;
  }

  function session(c: Context): Promise<ActiveSession | null> {
    let found = sessions.get(c.req.raw);
    if (!found) {
      found = lookup(c);
      sessions.set(c.req.raw, found);
    }
    return found;
  }

  const guard: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!isSafeMethod(c.req.method)) {
      if (!isSameOrigin(c.req.raw.headers, allowedOrigin(settings, c.req.url)))
        throw crossSiteRefused();
      const s = await session(c);
      if (s) {
        const sent = c.req.header(CSRF_HEADER);
        if (sent === undefined || !safeEqual(sent, s.csrf)) throw csrfRefused();
      }
    }
    await next();
  };

  async function sendLink(email: string, log: Logger): Promise<void> {
    if (!mailer || !publicOrigin) return;
    const now = clock();
    const user = await findUserByEmail(db, email);
    if (!user) {
      log.info('sign-in link requested for an address with no account');
      return;
    }
    const token = newSecret();
    const tokenHash = hashLinkToken(keys, token);
    const expiresAt = new Date(now.getTime() + minutesToMs(settings.linkTtlMin));
    const stored = await db.transaction(async (tx) => {
      await lockAddress(tx, user.email);
      await pruneTokens(tx, user.email, now);
      if ((await countLiveTokens(tx, user.email, now)) >= MAX_LIVE_LINKS_PER_ADDRESS) return false;
      await insertToken(tx, { tokenHash, email: user.email, userId: user.id, expiresAt });
      return true;
    });
    if (!stored) {
      log.warn('sign-in link not sent: the address already has the maximum of live links');
      return;
    }
    const link = new URL('/api/auth/callback', publicOrigin);
    link.searchParams.set('token', token);
    try {
      await mailer.sendMagicLink({
        to: user.email,
        link: link.toString(),
        ttlMin: settings.linkTtlMin,
      });
    } catch (err) {
      await deleteToken(db, tokenHash).catch(() => undefined);
      throw err;
    }
    log.info('sign-in link sent');
  }

  async function startSession(
    c: Context,
    resolve: (tx: Executor) => Promise<string | null>,
  ): Promise<boolean> {
    const now = clock();
    const previous = await session(c);
    const secret = newSecret();
    const id = sessionIdFor(keys, secret);
    const userId = await db.transaction(async (tx) => {
      const user = await resolve(tx);
      if (user === null) return null;
      if (previous) await deleteSession(tx, previous.id);
      await pruneSessions(tx, user, now);
      await insertSession(tx, {
        id,
        userId: user,
        expiresAt: new Date(now.getTime() + settings.sessionTtlMs),
      });
      return user;
    });
    if (userId === null) return false;
    const csrf = csrfTokenFor(keys, secret);
    await setSessionCookies(c, settings, keys, {
      secret,
      csrf,
      maxAgeSec: Math.floor(settings.sessionTtlMs / MS_PER_SECOND),
    });
    // The rest of this request sees the new session (OPS-09: an Access sign-in answers the same request signed in).
    sessions.set(c.req.raw, Promise.resolve({ id, userId: userId as UserId, csrf }));
    return true;
  }

  return {
    settings,
    canSendLinks: mailer !== null && publicOrigin !== null,
    session,
    guard,
    requestLink(email, log) {
      const job = sendLink(email, log).catch((err: unknown) =>
        log.error('sign-in link not sent', { err }),
      );
      pending.add(job);
      void job.finally(() => pending.delete(job));
    },
    async signIn(c, token) {
      if (!isSecretShape(token)) return false;
      const now = clock();
      return startSession(c, async (tx) => {
        const consumed = await consumeToken(tx, hashLinkToken(keys, token), now);
        if (!consumed?.userId) return null;
        await deleteOtherTokens(tx, consumed.email, consumed.id);
        return consumed.userId;
      });
    },
    startSession,
    keys,
    now: clock,
    async signOut(c) {
      const s = await session(c);
      if (s) await deleteSession(db, s.id);
      clearSessionCookies(c, settings);
    },
    async idle() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}
