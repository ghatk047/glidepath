import { sql } from 'drizzle-orm';
import type { Db } from './db';

/** Transaction handed to tenant-scoped work (Drizzle, RLS settings already applied). */
export type TenantTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * withTenant(db, tenantId, userId, fn) runs `fn` in one transaction that first sets `app.tenant_id` and
 * `app.user_id` for that transaction only (ADR-015, RLS). `set_config(..., is_local => true)` is
 * `SET LOCAL`: the settings vanish at COMMIT/ROLLBACK, so a pooled or transaction-pooled connection never
 * carries one tenant's context into the next request. If `fn` throws the transaction rolls back and the
 * error propagates.
 */
export function withTenant<T>(
  db: Db,
  tenantId: string,
  userId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${userId}, true)`,
    );
    return fn(tx);
  });
}
