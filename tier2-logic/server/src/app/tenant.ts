import { TenantSlug } from '@glidepath/api-contract';
import type { MembershipRole, TenantId, UserId } from '@glidepath/api-contract';
import { withTenant as dataAccessWithTenant } from '@glidepath/data-access';
import type { Db, TenantTx } from '@glidepath/data-access';
import type { Context, MiddlewareHandler } from 'hono';
import type { Logger } from './logger';
import { ApiError } from './problem';

/** Transaction handed to tenant-scoped handlers (Drizzle, RLS settings already applied). */
export type { TenantTx };

/**
 * `withTenant(tenantId, userId, fn)` runs `fn` in one transaction that first sets `app.tenant_id` and
 * `app.user_id` with SET LOCAL semantics (ADR-015). {@link bindWithTenant} binds data-access's
 * `withTenant(db, ...)` to the app's database; tests may substitute their own through `AppDeps.withTenant`.
 */
export type WithTenant = <T>(
  tenantId: TenantId,
  userId: UserId,
  fn: (tx: TenantTx) => Promise<T>,
) => Promise<T>;

/** The caller's standing in one tenant. */
export interface TenantMembership {
  tenantId: TenantId;
  slug: TenantSlug;
  role: MembershipRole;
}

/** Resolves a user's membership of the tenant named in the path; `null` when there is none. */
export type MembershipResolver = (
  userId: UserId,
  tenant: TenantSlug,
) => Promise<TenantMembership | null>;

/** Identifies the caller of a request; `null` when unauthenticated. Replaced by cookie auth in API-02. */
export type Authenticator = (c: Context) => Promise<UserId | null> | UserId | null;

/** What tenant-scoped handlers read from the Hono context. */
export interface TenantContext extends TenantMembership {
  userId: UserId;
  tx: TenantTx;
}

export interface AppEnv {
  Variables: { tenant: TenantContext; requestId: string; log: Logger };
}

/** Stub until DATA-05 provides the memberships repository: nobody is a member of anything. */
export const noMemberships: MembershipResolver = () => Promise.resolve(null);

/** Stub until API-02 provides sessions: nobody is authenticated. */
export const noAuthentication: Authenticator = () => null;

/** Fixed membership table, for tests and local wiring before DATA-05. */
export function staticMemberships(
  rows: readonly { userId: UserId; tenantId: TenantId; slug: TenantSlug; role: MembershipRole }[],
): MembershipResolver {
  return (userId, tenant) => {
    const row = rows.find((r) => r.userId === userId && r.slug === tenant);
    return Promise.resolve(row ? { tenantId: row.tenantId, slug: row.slug, role: row.role } : null);
  };
}

/** data-access `withTenant` bound to one database. */
export function bindWithTenant(db: Db): WithTenant {
  return (tenantId, userId, fn) => dataAccessWithTenant(db, tenantId, userId, fn);
}

/** Thrown inside the transaction after an error response was produced, to roll it back. */
class Rollback extends Error {
  constructor() {
    super('rollback');
    this.name = 'Rollback';
  }
}

export interface TenantMiddlewareDeps {
  authenticate: Authenticator;
  membership: MembershipResolver;
  withTenant: WithTenant;
}

/**
 * Mount on `/api/t/:tenant/*`. Authenticates (401 problem), resolves membership (404 problem when the
 * caller is not a member, so a tenant's existence is not revealed), then runs the rest of the request
 * inside `withTenant`; handlers read `c.get('tenant')` and use `.tx` for every query. A request that
 * ends in an error rolls the transaction back.
 */
export function tenantMiddleware(deps: TenantMiddlewareDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const userId = await deps.authenticate(c);
    if (userId === null) throw ApiError.unauthenticated();

    const slugResult = TenantSlug.safeParse(c.req.param('tenant'));
    const membership = slugResult.success ? await deps.membership(userId, slugResult.data) : null;
    if (!membership) throw ApiError.notFound('No such tenant, or you are not a member of it.');

    try {
      await deps.withTenant(membership.tenantId, userId, async (tx) => {
        c.set('tenant', { ...membership, userId, tx });
        await next();
        // Hono turns handler errors into a response instead of rethrowing: roll back explicitly.
        if (c.error) throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  };
}
