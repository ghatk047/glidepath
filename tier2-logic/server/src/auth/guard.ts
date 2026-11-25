import type { MembershipRole } from '@glidepath/api-contract';
import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../app/problem';
import type { AppEnv } from '../app/tenant';
import type { AuthSettings } from './settings';

/**
 * Request guards (API-02).
 *
 * - Same origin: a state-changing request (any method but GET, HEAD, OPTIONS) must carry
 *   `Origin` equal to PUBLIC_BASE_URL's origin; without `Origin`, only `Sec-Fetch-Site: same-origin`
 *   passes. Everything else gets 403 before any handler runs.
 * - CSRF (service.ts): a state-changing request that carries a live session must also send the
 *   session's CSRF token in `x-csrf-token`.
 * - Roles (`tenantWriteGuard`, `requireRole`): owner and editor may change a tenant; viewer and
 *   advisor are read-only. Deny by default: every state-changing `/api/t/:tenant/*` route needs a
 *   write role unless a later item opts a route in deliberately.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const isSafeMethod = (method: string): boolean => SAFE_METHODS.has(method.toUpperCase());

/** PUBLIC_BASE_URL's origin; without it (local runs), the request's own origin. */
export function allowedOrigin(
  settings: Pick<AuthSettings, 'publicOrigin'>,
  requestUrl: string,
): string {
  return settings.publicOrigin ?? new URL(requestUrl).origin;
}

/**
 * True when the browser says the request comes from `allowed`. Also for the WebSocket handshake
 * (API-06), where SameSite cookies alone do not stop cross-site sockets.
 */
export function isSameOrigin(
  headers: { get(name: string): string | null },
  allowed: string,
): boolean {
  const origin = headers.get('origin');
  if (origin !== null) return origin === allowed;
  return headers.get('sec-fetch-site') === 'same-origin';
}

export const crossSiteRefused = (): ApiError =>
  ApiError.forbidden('Cross-site request refused. Use Glidepath from its own address.');

export const csrfRefused = (): ApiError =>
  ApiError.forbidden('Missing or invalid CSRF token. Reload the page and try again.');

/** Roles that may change a tenant's data (tenant_membership.role, verbatim). */
export const WRITE_ROLES: readonly MembershipRole[] = ['owner', 'editor'];

/** Mount after the tenant middleware: answers 403 unless the caller's role is one of `roles`. */
export function requireRole(...roles: MembershipRole[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const role = c.get('tenant')?.role;
    if (role === undefined || !roles.includes(role)) {
      throw ApiError.forbidden(
        `This needs the ${roles.join(' or ')} role in this tenant. Ask a tenant owner for access.`,
      );
    }
    await next();
  };
}

/** Mount on `/api/t/:tenant/*` after the tenant middleware: state-changing requests need a write role. */
export function tenantWriteGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!isSafeMethod(c.req.method)) {
      const role = c.get('tenant')?.role;
      if (role === undefined || !WRITE_ROLES.includes(role)) {
        throw ApiError.forbidden(
          'Your role in this tenant is read-only. Ask a tenant owner for editor access.',
        );
      }
    }
    await next();
  };
}
