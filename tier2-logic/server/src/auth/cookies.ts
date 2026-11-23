import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setCookie, setSignedCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import type { AuthKeys } from './crypto';
import type { AuthSettings } from './settings';

/**
 * The two cookies of a signed-in browser.
 *
 * - Session: HttpOnly, SameSite=Lax, Path=/, Secure (unless PUBLIC_BASE_URL is plain http), value
 *   `<session secret>.<HMAC-SHA256 signature>` keyed from AUTH_SECRET (Hono signed cookie). With
 *   Secure it carries the `__Host-` prefix, so no other host or path can set or shadow it.
 * - CSRF: the session's CSRF token, readable by the SPA (not HttpOnly), which echoes it in the
 *   `x-csrf-token` header of every state-changing request (signed double-submit: the server
 *   recomputes it from the session, so a planted cookie is useless).
 */

export const SESSION_COOKIE = 'gp_session';
export const CSRF_COOKIE = 'gp_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const prefix = (s: AuthSettings): CookieOptions['prefix'] => (s.cookieSecure ? 'host' : undefined);

/** The session cookie's name on the wire (`__Host-gp_session`, or `gp_session` on plain http). */
export const sessionCookieName = (s: AuthSettings): string =>
  s.cookieSecure ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;

function base(s: AuthSettings, maxAgeSec: number): CookieOptions {
  return { path: '/', sameSite: 'Lax', secure: s.cookieSecure, maxAge: maxAgeSec };
}

export async function setSessionCookies(
  c: Context,
  s: AuthSettings,
  keys: AuthKeys,
  session: { secret: string; csrf: string; maxAgeSec: number },
): Promise<void> {
  await setSignedCookie(c, SESSION_COOKIE, session.secret, keys.cookie, {
    ...base(s, session.maxAgeSec),
    httpOnly: true,
    prefix: prefix(s),
  });
  setCookie(c, CSRF_COOKIE, session.csrf, { ...base(s, session.maxAgeSec), httpOnly: false });
}

export function clearSessionCookies(c: Context, s: AuthSettings): void {
  deleteCookie(c, SESSION_COOKIE, { ...base(s, 0), httpOnly: true, prefix: prefix(s) });
  deleteCookie(c, CSRF_COOKIE, { ...base(s, 0), httpOnly: false });
}

/** The session secret of a correctly signed session cookie, or null (absent, unsigned or tampered). */
export async function readSessionSecret(
  c: Context,
  s: AuthSettings,
  keys: AuthKeys,
): Promise<string | null> {
  const value = await getSignedCookie(c, keys.cookie, SESSION_COOKIE, prefix(s));
  return typeof value === 'string' && value !== '' ? value : null;
}
