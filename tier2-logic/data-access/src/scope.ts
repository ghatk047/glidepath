/**
 * Which transactions are inside `withTenant` / `withUser` right now (DATA-05).
 *
 * `withTenant` registers the transaction it hands to its callback for exactly as long as the callback
 * runs; repositories look their transaction up here before issuing any SQL and throw
 * {@link TenantScopeError} for anything else: the plain `Db`, a transaction opened with
 * `db.transaction` directly, or a transaction kept after its `withTenant` returned. So no repository
 * can run without `app.tenant_id` / `app.user_id` set by SET LOCAL in its own transaction.
 */

/** Inside `withTenant`: RLS shows the rows of `tenantId`. */
export interface TenantScope {
  readonly kind: 'tenant';
  readonly tenantId: string;
  readonly userId: string;
}

/** Inside `withUser`: no tenant chosen yet; RLS shows the user's own memberships and tenants. */
export interface UserScope {
  readonly kind: 'user';
  readonly userId: string;
}

export type Scope = TenantScope | UserScope;

/** A repository was called without the transaction of a live `withTenant` (or `withUser`). */
export class TenantScopeError extends Error {
  readonly code = 'TENANT_SCOPE';
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

const live = new WeakMap<object, Scope>();

/** Drizzle's `tx.transaction(fn, config?)`, which opens a savepoint inside a transaction. */
type OpenSavepoint = (inner: (sp: object) => Promise<unknown>, ...rest: unknown[]) => Promise<unknown>;

/**
 * Runs `fn` with `tx` registered under `scope`. A savepoint opened inside (`tx.transaction(...)`) is
 * registered under the same scope while its callback runs, since the SET LOCAL settings hold in it too.
 */
export async function runScoped<Tx extends object, T>(tx: Tx, scope: Scope, fn: () => Promise<T>): Promise<T> {
  live.set(tx, scope);
  const t = tx as unknown as { transaction?: OpenSavepoint };
  if (typeof t.transaction === 'function') {
    const open = t.transaction.bind(tx);
    t.transaction = (inner, ...rest) => {
      if (live.get(tx) !== scope) {
        return Promise.reject(new TenantScopeError('data-access: savepoint on a transaction whose withTenant has ended'));
      }
      return open((sp) => runScoped(sp, scope, () => inner(sp)), ...rest);
    };
  }
  try {
    return await fn();
  } finally {
    live.delete(tx);
  }
}

const describe = (what: string, need: string): string =>
  `data-access: ${what} must run inside ${need}, on the transaction it hands to its callback ` +
  '(app.tenant_id / app.user_id are set per transaction, ADR-015)';

/** The tenant scope of `tx`; throws unless `tx` is the transaction of a running `withTenant`. */
export function tenantScope(tx: unknown, what: string): TenantScope {
  const s = typeof tx === 'object' && tx !== null ? live.get(tx) : undefined;
  if (s?.kind !== 'tenant') throw new TenantScopeError(describe(what, 'withTenant(db, tenantId, userId, fn)'));
  return s;
}

/** The user scope of `tx`; throws unless `tx` is the transaction of a running `withUser`. */
export function userScope(tx: unknown, what: string): UserScope {
  const s = typeof tx === 'object' && tx !== null ? live.get(tx) : undefined;
  if (s?.kind !== 'user') throw new TenantScopeError(describe(what, 'withUser(db, userId, fn)'));
  return s;
}

/** The scope of `tx`, tenant or user; throws outside both. */
export function anyScope(tx: unknown, what: string): Scope {
  const s = typeof tx === 'object' && tx !== null ? live.get(tx) : undefined;
  if (!s) throw new TenantScopeError(describe(what, 'withTenant or withUser'));
  return s;
}
