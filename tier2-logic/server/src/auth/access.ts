import type { MembershipRole } from '@glidepath/api-contract';
import { listMyMemberships, withTenant, withUser } from '@glidepath/data-access';
import type { Db } from '@glidepath/data-access';
import type { Context, MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Config } from '../app/config';
import type { Logger } from '../app/logger';
import type { AppEnv } from '../app/tenant';
import { isSafeMethod } from './guard';
import type { AuthCore } from './service';
import { findUserById, joinTenant, provisionAccessUser } from './store';
import { tenantIdForSlug } from './tenant-ids';

/**
 * Sign-in through Cloudflare Access (OPS-09, ADR-014 addendum).
 *
 * The public demo runs behind a Cloudflare Tunnel whose hostname is an Access application: Cloudflare signs the
 * visitor in (one-time PIN to an address its policy allows) and adds `Cf-Access-Jwt-Assertion`, an RS256 JWT, to
 * every request it forwards. With CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD set, tier 2 verifies that JWT (signature
 * against the team's keys at `https://<team>/cdn-cgi/access/certs`, `iss` = the team domain, `aud` contains the AUD
 * tag, `exp` and `nbf`) and opens the usual cookie session for its `email`. The plain
 * `Cf-Access-Authenticated-User-Email` header is never read: only the signed token counts.
 *
 * - Only on GET/HEAD `/api/*` (the SPA's first `GET /api/me`): a state-changing request still needs the session's
 *   CSRF token, which it can only have after such a read.
 * - A missing or invalid JWT changes nothing: the request goes on to the existing sign-in (magic link, passkey,
 *   cookie session). With the two variables unset this middleware is not mounted at all.
 * - A cookie session for the same address is kept; one for another address is replaced (Access switched user).
 * - An address with no app_user gets one (manual migration 0006), and a user with no membership joins the tenants
 *   of ACCESS_AUTO_TENANTS with ACCESS_AUTO_ROLE, through `withTenant` (RLS applies). ACCESS_ALLOWED_DOMAINS, when
 *   set, re-checks the address domain after Access.
 * - Keys are fetched once and cached (`CERTS_CACHE_MAX_AGE_MS`); a token with an unknown key id triggers at most one
 *   refetch per `CERTS_COOLDOWN_MS`, so a flood of forged tokens cannot hammer Cloudflare.
 */

/** The request header Cloudflare Access adds (lower case, as Hono reads headers). */
export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';
/** Path of the team's signing keys (JWKS plus `public_certs`) under the team domain. */
export const ACCESS_CERTS_PATH = '/cdn-cgi/access/certs';
/** Operational limits of the key fetch, not business numbers. */
export const CERTS_CACHE_MAX_AGE_MS = 10 * 60_000;
export const CERTS_COOLDOWN_MS = 30_000;
export const CERTS_TIMEOUT_MS = 5_000;
/** Clock skew accepted on `exp` / `nbf`, seconds. */
export const ACCESS_CLOCK_TOLERANCE_SEC = 30;
/** Bound on the per-process session -> address memo. */
const SESSION_EMAIL_MEMO_MAX = 1_000;
const MAX_EMAIL_LENGTH = 254;
const EMAIL = /^[^@\s]+@([^@\s]+)$/;

export interface AccessSettings {
  /** `https://<team>.cloudflareaccess.com`: the expected `iss`. */
  readonly teamOrigin: string;
  /** The Access application's AUD tag: `aud` must contain it. */
  readonly aud: string;
  /** Where the signing keys are; `<teamOrigin>/cdn-cgi/access/certs` unless a test overrides it. */
  readonly certsUrl: string;
  /** Tenant slugs a user with no membership joins; empty: none. */
  readonly autoTenants: readonly string[];
  readonly autoRole: MembershipRole;
  /** Address domains accepted after Access, lower case; empty: any domain Access let through. */
  readonly allowedDomains: readonly string[];
}

export type AccessConfig = Pick<
  Config,
  'CF_ACCESS_TEAM_DOMAIN' | 'CF_ACCESS_AUD' | 'ACCESS_AUTO_TENANTS' | 'ACCESS_AUTO_ROLE' | 'ACCESS_ALLOWED_DOMAINS'
>;

/** Access settings from the config, or null when CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD are unset. */
export function accessSettingsFrom(config: AccessConfig, opts: { certsUrl?: string } = {}): AccessSettings | null {
  const team = config.CF_ACCESS_TEAM_DOMAIN;
  const aud = config.CF_ACCESS_AUD;
  if (!team || !aud) return null;
  return {
    teamOrigin: team,
    aud,
    certsUrl: opts.certsUrl ?? new URL(ACCESS_CERTS_PATH, team).toString(),
    autoTenants: config.ACCESS_AUTO_TENANTS,
    autoRole: config.ACCESS_AUTO_ROLE,
    allowedDomains: config.ACCESS_ALLOWED_DOMAINS,
  };
}

/** Why a token was refused, for the log (never the token or its claims). */
export class AccessTokenError extends Error {
  constructor(readonly reason: string) {
    super(`Access JWT refused: ${reason}`);
    this.name = 'AccessTokenError';
  }
}

export interface AccessVerifier {
  /** The verified address of `token`; throws {@link AccessTokenError} otherwise. */
  verify(token: string): Promise<string>;
}

export function createAccessVerifier(
  settings: Pick<AccessSettings, 'teamOrigin' | 'aud' | 'certsUrl'>,
  now: () => Date = () => new Date(),
): AccessVerifier {
  const keys = createRemoteJWKSet(new URL(settings.certsUrl), {
    cacheMaxAge: CERTS_CACHE_MAX_AGE_MS,
    cooldownDuration: CERTS_COOLDOWN_MS,
    timeoutDuration: CERTS_TIMEOUT_MS,
  });
  return {
    async verify(token) {
      let payload: Record<string, unknown>;
      try {
        ({ payload } = await jwtVerify(token, keys, {
          algorithms: ['RS256'],
          issuer: settings.teamOrigin,
          audience: settings.aud,
          requiredClaims: ['exp'],
          clockTolerance: ACCESS_CLOCK_TOLERANCE_SEC,
          currentDate: now(),
        }));
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        throw new AccessTokenError(typeof code === 'string' ? code : 'invalid');
      }
      const email = payload.email;
      if (typeof email !== 'string' || email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email))
        throw new AccessTokenError('no email claim');
      return email.trim();
    },
  };
}

/** True when `allowed` is empty or names the address's domain (exactly, case-insensitive). */
export function domainAllowed(email: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  const domain = EMAIL.exec(email)?.[1]?.toLowerCase();
  return domain !== undefined && allowed.includes(domain);
}

export interface AccessSignInDeps {
  core: AuthCore;
  db: Db;
  settings: AccessSettings;
  verifier: AccessVerifier;
}

/**
 * The user of a verified address: created when new, and given the auto memberships when they have none. Each step
 * is idempotent, so two first requests racing end with one user and one membership per tenant.
 */
async function resolveAccessUser(deps: AccessSignInDeps, email: string, log: Logger): Promise<string> {
  const { db, settings } = deps;
  const userId = await provisionAccessUser(db, email);
  if (settings.autoTenants.length === 0) return userId;
  const existing = await withUser(db, userId, (tx) => listMyMemberships(tx));
  if (existing.length > 0) return userId;
  for (const slug of settings.autoTenants) {
    const joined = await withTenant(db, tenantIdForSlug(slug), userId, (tx) =>
      joinTenant(tx, { slug, userId, role: settings.autoRole }),
    );
    if (joined) log.info('access sign-in: membership added', { tenant: slug, role: settings.autoRole });
    else log.warn('access sign-in: ACCESS_AUTO_TENANTS names a tenant that does not exist', { tenant: slug });
  }
  return userId;
}

/** `/api/*` middleware, mounted before the CSRF guard when Access is configured. */
export function accessSignIn(deps: AccessSignInDeps): MiddlewareHandler<AppEnv> {
  const { core, db, settings, verifier } = deps;
  // session id -> address of its user (saves a lookup per request; a session's user never changes).
  const emails = new Map<string, string>();

  async function sessionEmail(id: string, userId: string): Promise<string | null> {
    const memo = emails.get(id);
    if (memo !== undefined) return memo;
    const user = await findUserById(db, userId);
    if (!user) return null;
    if (emails.size >= SESSION_EMAIL_MEMO_MAX) emails.clear();
    emails.set(id, user.email);
    return user.email;
  }

  async function signIn(c: Context<AppEnv>, email: string): Promise<void> {
    const current = await core.session(c);
    if (current) {
      const had = await sessionEmail(current.id, current.userId);
      if (had !== null && had.toLowerCase() === email.toLowerCase()) return;
    }
    const log = c.get('log');
    const userId = await resolveAccessUser(deps, email, log);
    const ok = await core.startSession(c, async () => userId);
    if (ok) log.info('access sign-in: session started');
  }

  return async (c, next) => {
    const token = c.req.header(ACCESS_JWT_HEADER);
    if (token && isSafeMethod(c.req.method)) {
      const log = c.get('log');
      try {
        const email = await verifier.verify(token);
        if (domainAllowed(email, settings.allowedDomains)) await signIn(c, email);
        else log.warn('access sign-in refused: address domain not in ACCESS_ALLOWED_DOMAINS');
      } catch (err) {
        // Fall back to the existing sign-in; the reason only (no token, no claims, no address).
        if (err instanceof AccessTokenError) log.warn('access sign-in refused', { reason: err.reason });
        else log.error('access sign-in failed', { err });
      }
    }
    await next();
  };
}
