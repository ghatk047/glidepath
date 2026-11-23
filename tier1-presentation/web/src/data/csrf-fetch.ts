import type { FetchLike } from '@glidepath/api-contract';

/**
 * Tier 2 signs a CSRF token into the readable `gp_csrf` cookie at sign-in and refuses every
 * state-changing `/api` call of a session that does not echo it in `x-csrf-token` (signed
 * double-submit, `tier2-logic/server/src/auth/cookies.ts`). Tier 1 may not import tier 2, so the
 * two names are repeated here; the E2E smoke (real stack, no test double) keeps them honest.
 */
export const CSRF_COOKIE = 'gp_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Value of the `gp_csrf` cookie in a `document.cookie` string, or `null` when it is not there. */
export function readCsrfCookie(cookieString: string): string | null {
  for (const part of cookieString.split(';')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at).trim() !== CSRF_COOKIE) continue;
    const raw = part.slice(at + 1).trim();
    try {
      return decodeURIComponent(raw) || null;
    } catch {
      return raw || null;
    }
  }
  return null;
}

const documentCookie = (): string =>
  (globalThis as { document?: { cookie?: string } }).document?.cookie ?? '';

/**
 * Wraps a `FetchLike` so POST, PUT, PATCH and DELETE carry `x-csrf-token` from the `gp_csrf`
 * cookie. Safe methods are left alone, as is a caller's own header. Without a cookie (signed
 * out) nothing is added and tier 2 answers 401 as before. The cookie is read per request: it
 * changes at sign-in and sign-out without a reload.
 */
export function withCsrfHeader(
  fetch: FetchLike,
  readCookie: () => string = documentCookie,
): FetchLike {
  return (url, init) => {
    if (SAFE_METHODS.has(init.method)) return fetch(url, init);
    if (Object.keys(init.headers).some((h) => h.toLowerCase() === CSRF_HEADER)) {
      return fetch(url, init);
    }
    const token = readCsrfCookie(readCookie());
    if (token === null) return fetch(url, init);
    return fetch(url, { ...init, headers: { ...init.headers, [CSRF_HEADER]: token } });
  };
}
