import type { Db } from '@glidepath/data-access';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { Config } from '../app/config';
import type { AppEnv, Authenticator, MembershipResolver } from '../app/tenant';
import { senderFor, smtpMailer } from './mailer';
import type { Mailer } from './mailer';
import { dbMemberships } from './memberships';
import { authRoutes } from './routes';
import { createAuthCore } from './service';
import type { ActiveSession } from './service';
import { authSettingsFrom } from './settings';
import type { AuthSettings } from './settings';

/** Everything the app mounts for sign-in, sessions, CSRF and memberships (API-02). */
export interface Auth {
  readonly settings: AuthSettings;
  /**
   * `POST /api/auth/magic-link`, `GET /api/auth/callback`, `POST /api/auth/logout`, `GET /api/me`,
   * `GET /api/tenants`, and `POST /api/auth/passkey/{register,login}/{options,verify}` (API-03).
   */
  readonly routes: Hono<AppEnv>;
  /** Mount on `/api/*` before every route: same origin + CSRF on state-changing requests. */
  readonly guard: MiddlewareHandler<AppEnv>;
  /** Cookie session -> user id, for the tenant middleware (and the WS handshake, API-06). */
  readonly authenticate: Authenticator;
  /** Membership of `/api/t/:tenant` from tenant_membership (DATA-05 `withUser` + `findMyMembership`). */
  readonly membership: MembershipResolver;
  session(c: Context): Promise<ActiveSession | null>;
  /** Resolves when every queued sign-in mail has been handled. */
  idle(): Promise<void>;
  /** Waits for queued mail, then closes the SMTP transport. */
  close(): Promise<void>;
}

export interface CreateAuthDeps {
  db: Db;
  settings: AuthSettings;
  mailer: Mailer | null;
  now?: () => Date;
}

export function createAuth(deps: CreateAuthDeps): Auth {
  const core = createAuthCore(deps);
  return {
    settings: deps.settings,
    routes: authRoutes(core, deps.db),
    guard: core.guard,
    authenticate: async (c) => (await core.session(c))?.userId ?? null,
    membership: dbMemberships(deps.db),
    session: core.session,
    idle: core.idle,
    async close() {
      await core.idle();
      deps.mailer?.close();
    },
  };
}

/**
 * Auth from the app config: AUTH_SECRET, PUBLIC_BASE_URL, AUTH_LINK_TTL_MIN, SMTP_URL. `mailer`
 * overrides the SMTP transport (tests); without SMTP_URL there is none and link requests answer 503.
 */
export function authFromConfig(
  config: Pick<Config, 'AUTH_SECRET' | 'PUBLIC_BASE_URL' | 'AUTH_LINK_TTL_MIN' | 'SMTP_URL'>,
  deps: { db: Db; mailer?: Mailer | null; now?: () => Date },
): Auth {
  const settings = authSettingsFrom(config);
  const mailer =
    deps.mailer !== undefined
      ? deps.mailer
      : settings.smtpUrl
        ? smtpMailer(settings.smtpUrl, senderFor(settings.publicOrigin))
        : null;
  return createAuth({ db: deps.db, settings, mailer, ...(deps.now ? { now: deps.now } : {}) });
}
