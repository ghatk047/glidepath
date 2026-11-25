import type { Db } from '@glidepath/data-access';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { DEFAULT_ACCESS_AUTO_ROLE, DEFAULT_ACCESS_AUTO_TENANTS } from '../app/config';
import type { Config } from '../app/config';
import type { AppEnv, Authenticator, MembershipResolver } from '../app/tenant';
import { accessSettingsFrom, accessSignIn, createAccessVerifier } from './access';
import type { AccessConfig, AccessSettings } from './access';
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
  /**
   * Cloudflare Access sign-in (OPS-09): mount on `/api/*` before `guard`. Null unless CF_ACCESS_TEAM_DOMAIN and
   * CF_ACCESS_AUD are set.
   */
  readonly access: MiddlewareHandler<AppEnv> | null;
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
  /** Cloudflare Access settings (OPS-09); null or absent: no Access sign-in. */
  access?: AccessSettings | null;
}

export function createAuth(deps: CreateAuthDeps): Auth {
  const core = createAuthCore(deps);
  const access = deps.access
    ? accessSignIn({ core, db: deps.db, settings: deps.access, verifier: createAccessVerifier(deps.access, core.now) })
    : null;
  return {
    settings: deps.settings,
    routes: authRoutes(core, deps.db),
    guard: core.guard,
    access,
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
 * Auth from the app config: AUTH_SECRET, PUBLIC_BASE_URL, AUTH_LINK_TTL_MIN, SMTP_URL, and the CF_ACCESS_* /
 * ACCESS_* settings of OPS-09. `mailer` overrides the SMTP transport (tests); without SMTP_URL there is none and
 * link requests answer 503. `accessCertsUrl` replaces `https://<team>/cdn-cgi/access/certs` (tests only).
 */
export function authFromConfig(
  config: Pick<Config, 'AUTH_SECRET' | 'PUBLIC_BASE_URL' | 'AUTH_LINK_TTL_MIN' | 'SMTP_URL'> & Partial<AccessConfig>,
  deps: { db: Db; mailer?: Mailer | null; now?: () => Date; accessCertsUrl?: string },
): Auth {
  const settings = authSettingsFrom(config);
  const mailer =
    deps.mailer !== undefined
      ? deps.mailer
      : settings.smtpUrl
        ? smtpMailer(settings.smtpUrl, senderFor(settings.publicOrigin))
        : null;
  const access = accessSettingsFrom(
    {
      CF_ACCESS_TEAM_DOMAIN: config.CF_ACCESS_TEAM_DOMAIN,
      CF_ACCESS_AUD: config.CF_ACCESS_AUD,
      ACCESS_AUTO_TENANTS: config.ACCESS_AUTO_TENANTS ?? [DEFAULT_ACCESS_AUTO_TENANTS],
      ACCESS_AUTO_ROLE: config.ACCESS_AUTO_ROLE ?? DEFAULT_ACCESS_AUTO_ROLE,
      ACCESS_ALLOWED_DOMAINS: config.ACCESS_ALLOWED_DOMAINS ?? [],
    },
    deps.accessCertsUrl ? { certsUrl: deps.accessCertsUrl } : {},
  );
  return createAuth({ db: deps.db, settings, mailer, access, ...(deps.now ? { now: deps.now } : {}) });
}
