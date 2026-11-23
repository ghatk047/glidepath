import type { ClientConfig, PoolConfig } from 'pg';

/**
 * Connection configuration. Everything about *where* and *how securely* to
 * connect comes from the URL (ADR-015): host, port, role, database and TLS
 * (`sslmode`). Moving to Neon changes URLs only.
 *
 * Pooler safety (Neon's transaction pooler / pgbouncer transaction mode):
 * no startup `options`, no session-level SET, no named prepared statements
 * unless explicitly enabled, no LISTEN/NOTIFY.
 */

export interface DbOptions {
  /** Maximum connections in the pool. Default {@link DEFAULT_POOL_MAX}. */
  poolMax?: number;
  /**
   * Allow named (server-side prepared) statements, e.g. Drizzle `.prepare('name')`.
   * Default false: names are dropped so statements are unnamed and pooler-safe.
   */
  preparedStatements?: boolean;
  /** Close idle connections after this many ms. Default {@link DEFAULT_IDLE_TIMEOUT_MS}. */
  idleTimeoutMs?: number;
  /** Fail a connection attempt after this many ms. Default {@link DEFAULT_CONNECT_TIMEOUT_MS}. */
  connectionTimeoutMs?: number;
}

export const DEFAULT_POOL_MAX = 10;
export const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export type ResolvedDbOptions = Required<DbOptions>;

function positiveInt(name: string, v: number): number {
  if (!Number.isInteger(v) || v < 1) throw new Error(`data-access: ${name} must be a positive integer, got ${String(v)}`);
  return v;
}

export function resolveDbOptions(opts: DbOptions = {}): ResolvedDbOptions {
  return {
    poolMax: positiveInt('poolMax', opts.poolMax ?? DEFAULT_POOL_MAX),
    preparedStatements: opts.preparedStatements ?? false,
    idleTimeoutMs: positiveInt('idleTimeoutMs', opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS),
    connectionTimeoutMs: positiveInt('connectionTimeoutMs', opts.connectionTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS),
  };
}

/**
 * Optional tuning from the environment, for callers (server, worker) that want
 * it: DB_POOL_MAX and DB_PREPARED_STATEMENTS (`true`/`1`). `createDb` itself
 * never reads the environment; it reads only the URL it is given.
 */
export function dbOptionsFromEnv(env: Record<string, string | undefined> = process.env): DbOptions {
  const out: DbOptions = {};
  if (env.DB_POOL_MAX !== undefined && env.DB_POOL_MAX !== '') out.poolMax = Number(env.DB_POOL_MAX);
  if (env.DB_PREPARED_STATEMENTS !== undefined && env.DB_PREPARED_STATEMENTS !== '') {
    out.preparedStatements = env.DB_PREPARED_STATEMENTS === 'true' || env.DB_PREPARED_STATEMENTS === '1';
  }
  return out;
}

export function requireUrl(name: string, url: string | undefined): string {
  if (typeof url !== 'string' || url.trim() === '') throw new Error(`data-access: ${name} is required`);
  try {
    const u = new URL(url);
    if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('not postgres');
  } catch {
    throw new Error(`data-access: ${name} must be a postgres:// or postgresql:// URL`);
  }
  return url;
}

/**
 * TLS from `sslmode` in the URL, with libpq semantics:
 * - absent, `disable`, `allow`: plain connection;
 * - `prefer`, `require`: TLS, certificate not verified (what libpq does; lets
 *   `require` work with a self-signed server such as `pg-local --ssl`);
 * - `verify-ca`, `verify-full`: TLS with certificate verification, left to
 *   node-postgres (`sslrootcert` in the URL is honoured).
 * node-postgres alone would treat `require` as `verify-full`.
 */
export function connectionConfig(url: string): Pick<ClientConfig, 'connectionString' | 'ssl'> {
  const u = new URL(url);
  const mode = u.searchParams.get('sslmode');
  switch (mode) {
    case null:
    case 'disable':
    case 'allow':
      u.searchParams.delete('sslmode');
      return { connectionString: u.toString() };
    case 'prefer':
    case 'require':
      u.searchParams.delete('sslmode');
      return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } };
    case 'verify-ca':
    case 'verify-full':
      return { connectionString: url };
    default:
      throw new Error(`data-access: unsupported sslmode "${mode}" in database URL`);
  }
}

/** Pure: the node-postgres pool configuration for a URL and options. */
export function poolConfig(url: string, opts: DbOptions = {}): PoolConfig {
  const o = resolveDbOptions(opts);
  return {
    ...connectionConfig(requireUrl('DATABASE_URL', url)),
    max: o.poolMax,
    idleTimeoutMillis: o.idleTimeoutMs,
    connectionTimeoutMillis: o.connectionTimeoutMs,
  };
}
