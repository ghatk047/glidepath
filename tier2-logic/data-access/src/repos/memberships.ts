import { and, asc, eq, sql } from 'drizzle-orm';
import { app_user, tenant, tenant_membership } from '../schema';
import { anyScope, tenantScope, userScope } from '../scope';
import type { TenantTx, UserTx } from '../tenant';
import { iso, isUuid } from './rows';

export type MembershipRole = (typeof tenant_membership.$inferSelect)['role'];

/** A tenant row (schema.json tables.tenant). */
export interface TenantRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly currency: string;
  readonly base_year: number;
  readonly target_year: number;
  readonly fiscal_calendar: string;
  readonly ticker: string | null;
  readonly model_version_id: string;
  readonly status: 'setup' | 'active' | 'archived';
  readonly created_at: string;
}

/** A tenant the user belongs to, with the user's role in it. */
export interface UserMembership {
  readonly tenant: TenantRow;
  readonly role: MembershipRole;
}

/** A member of the current tenant. */
export interface TenantMemberRow {
  readonly user_id: string;
  readonly email: string;
  readonly name: string;
  readonly role: MembershipRole;
}

/** app_user (global). */
export interface AppUserRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

const toTenant = (t: typeof tenant.$inferSelect): TenantRow => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  currency: t.currency,
  base_year: t.base_year,
  target_year: t.target_year,
  fiscal_calendar: t.fiscal_calendar,
  ticker: t.ticker,
  model_version_id: t.model_version_id,
  status: t.status,
  created_at: iso(t.created_at),
});

/** The current tenant's row, or null. */
export async function getTenant(tx: TenantTx): Promise<TenantRow | null> {
  const { tenantId } = tenantScope(tx, 'getTenant');
  const [t] = await tx.select().from(tenant).where(eq(tenant.id, tenantId));
  return t ? toTenant(t) : null;
}

/** Members of the current tenant with their roles, by email. */
export async function listTenantMembers(tx: TenantTx): Promise<TenantMemberRow[]> {
  const { tenantId } = tenantScope(tx, 'listTenantMembers');
  return tx
    .select({ user_id: tenant_membership.user_id, email: app_user.email, name: app_user.name, role: tenant_membership.role })
    .from(tenant_membership)
    .innerJoin(app_user, eq(app_user.id, tenant_membership.user_id))
    .where(eq(tenant_membership.tenant_id, tenantId))
    .orderBy(sql`${app_user.email} collate "C"`);
}

function memberships(tx: UserTx, userId: string, slug?: string) {
  return tx
    .select({ tenant, role: tenant_membership.role })
    .from(tenant_membership)
    .innerJoin(tenant, eq(tenant.id, tenant_membership.tenant_id))
    .where(and(eq(tenant_membership.user_id, userId), slug === undefined ? undefined : eq(tenant.slug, slug)))
    .orderBy(sql`${tenant.slug} collate "C"`, asc(tenant.id));
}

/**
 * The tenants the user of `withUser` belongs to, with their role in each, by slug: `/api/me`,
 * `/api/tenants`. Runs before a tenant is chosen (RLS policies own_memberships, own_tenants).
 */
export async function listMyMemberships(tx: UserTx): Promise<UserMembership[]> {
  const { userId } = userScope(tx, 'listMyMemberships');
  if (!isUuid(userId)) return [];
  const rows = await memberships(tx, userId);
  return rows.map((r) => ({ tenant: toTenant(r.tenant), role: r.role }));
}

/**
 * The membership of the user of `withUser` in the tenant with this slug, or null: what the tenant
 * middleware resolves for `/api/t/:tenant/*` before it opens `withTenant`.
 */
export async function findMyMembership(tx: UserTx, slug: string): Promise<UserMembership | null> {
  const { userId } = userScope(tx, 'findMyMembership');
  if (!isUuid(userId) || typeof slug !== 'string' || slug === '') return null;
  const [r] = await memberships(tx, userId, slug);
  return r ? { tenant: toTenant(r.tenant), role: r.role } : null;
}

/** The app_user of the current transaction's app.user_id (tenant or user scope), or null. */
export async function getCurrentUser(tx: TenantTx | UserTx): Promise<AppUserRow | null> {
  const { userId } = anyScope(tx, 'getCurrentUser');
  if (!isUuid(userId)) return null;
  const [u] = await tx.select().from(app_user).where(eq(app_user.id, userId));
  return u ? { id: u.id, email: u.email, name: u.name } : null;
}
