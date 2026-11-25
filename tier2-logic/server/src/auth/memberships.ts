import type {
  MeResponse,
  ModelVersionId,
  TenantId,
  TenantSlug,
  TenantsResponse,
  UserId,
} from '@glidepath/api-contract';
import {
  findMyMembership,
  getCurrentUser,
  listMyMemberships,
  withUser,
} from '@glidepath/data-access';
import type { Db, UserMembership } from '@glidepath/data-access';
import type { MembershipResolver } from '../app/tenant';

/**
 * Roles come from tenant_membership (ADR-014), read with DATA-05's `withUser` repositories: RLS
 * (own_memberships, own_tenants) shows a user only their own memberships and tenants, so neither
 * answer can name another user's tenant.
 */

/** The tenant middleware's membership lookup for `/api/t/:tenant/*`. */
export function dbMemberships(db: Db): MembershipResolver {
  return (userId, slug) =>
    withUser(db, userId, async (tx) => {
      const m = await findMyMembership(tx, slug);
      return m
        ? { tenantId: m.tenant.id as TenantId, slug: m.tenant.slug as TenantSlug, role: m.role }
        : null;
    });
}

const toMembership = (m: UserMembership): MeResponse['memberships'][number] => ({
  tenantId: m.tenant.id as TenantId,
  tenantSlug: m.tenant.slug as TenantSlug,
  tenantName: m.tenant.name,
  role: m.role,
});

const toTenant = (m: UserMembership): TenantsResponse['tenants'][number] => ({
  id: m.tenant.id as TenantId,
  slug: m.tenant.slug as TenantSlug,
  name: m.tenant.name,
  currency: m.tenant.currency,
  baseYear: m.tenant.base_year,
  targetYear: m.tenant.target_year,
  fiscalCalendar: m.tenant.fiscal_calendar,
  ticker: m.tenant.ticker,
  status: m.tenant.status,
  modelVersionId: m.tenant.model_version_id as ModelVersionId,
  role: m.role,
});

/** `GET /api/me`: the user and their memberships with roles; null when the user no longer exists. */
export function loadMe(db: Db, userId: UserId): Promise<MeResponse | null> {
  return withUser(db, userId, async (tx) => {
    const user = await getCurrentUser(tx);
    if (!user) return null;
    const memberships = await listMyMemberships(tx);
    return {
      user: { id: user.id as UserId, email: user.email, name: user.name },
      memberships: memberships.map(toMembership),
    };
  });
}

/** `GET /api/tenants`: only the tenants the user belongs to, with their role in each. */
export function loadTenants(db: Db, userId: UserId): Promise<TenantsResponse> {
  return withUser(db, userId, async (tx) => ({
    tenants: (await listMyMemberships(tx)).map(toTenant),
  }));
}
