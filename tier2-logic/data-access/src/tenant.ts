import { sql } from 'drizzle-orm';
import type { Db } from './db';
import { runScoped } from './scope';
import type { Scope } from './scope';

/** Transaction handed to tenant-scoped work (Drizzle, RLS settings already applied). */
export type TenantTx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Transaction handed to `withUser` work: the same Drizzle transaction, with no tenant set. */
export type UserTx = TenantTx;

/** A TypeError for a missing id, or null. Ids are not parsed here: the casts in the RLS policies do that. */
function badId(name: string, value: unknown): TypeError | null {
  return typeof value === 'string' && value.trim() !== ''
    ? null
    : new TypeError(`data-access: ${name} must be a non-empty string`);
}

function scoped<T>(db: Db, scope: Scope, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  const tenantId = scope.kind === 'tenant' ? scope.tenantId : '';
  return db.transaction(async (tx) => {
    // First statement of the transaction. set_config(..., is_local => true) is SET LOCAL with bound values.
    await tx.execute(
      sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${scope.userId}, true)`,
    );
    return runScoped(tx, scope, () => fn(tx));
  });
}

/**
 * withTenant(db, tenantId, userId, fn) runs `fn` in one transaction that first sets `app.tenant_id` and
 * `app.user_id` for that transaction only (ADR-015, RLS). `set_config(..., is_local => true)` is
 * `SET LOCAL`: the settings vanish at COMMIT/ROLLBACK, so a pooled or transaction-pooled connection never
 * carries one tenant's context into the next request. If `fn` throws the transaction rolls back and the
 * error propagates. The read repositories accept only the transaction handed to `fn`, and only while
 * `fn` runs (savepoints opened from it included); anything else throws `TenantScopeError`.
 * The contract's `withTenant(tenantId, userId, fn)` is this function bound to the app's `Db`.
 */
export function withTenant<T>(
  db: Db,
  tenantId: string,
  userId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const bad = badId('tenantId', tenantId) ?? badId('userId', userId);
  if (bad) return Promise.reject(bad);
  return scoped(db, { kind: 'tenant', tenantId, userId }, fn);
}

/**
 * withUser(db, userId, fn): like `withTenant` before a tenant is chosen. Sets `app.user_id` and clears
 * `app.tenant_id` for the transaction, so RLS shows only the user's own memberships and tenants
 * (0002_rls.sql `own_memberships`, `own_tenants`). For login, `/api/me`, `/api/tenants` and resolving
 * the membership of `/api/t/:tenant`; tenant data needs `withTenant`.
 */
export function withUser<T>(db: Db, userId: string, fn: (tx: UserTx) => Promise<T>): Promise<T> {
  const bad = badId('userId', userId);
  if (bad) return Promise.reject(bad);
  return scoped(db, { kind: 'user', userId }, fn);
}
