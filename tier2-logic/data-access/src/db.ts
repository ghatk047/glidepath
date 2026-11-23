import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { poolConfig, resolveDbOptions } from './config';
import type { DbOptions } from './config';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  /** Drizzle database over the pool. Use `db.transaction` for tenant-scoped work (SET LOCAL only). */
  db: Db;
  pool: pg.Pool;
  /** Drains and closes the pool. */
  close(): Promise<void>;
}

type QueryFn = (...args: unknown[]) => unknown;

/** Removes the `name` of a query config so the statement is not prepared server-side. */
function dropStatementName(arg: unknown): unknown {
  if (arg && typeof arg === 'object' && typeof (arg as { name?: unknown }).name === 'string') {
    const rest = { ...(arg as Record<string, unknown>) };
    delete rest.name;
    return rest;
  }
  return arg;
}

/**
 * createDb(DATABASE_URL): a pooled Drizzle client. Reads only the URL it is
 * given (TLS from `sslmode`); sets no session state, so it is safe behind a
 * transaction pooler. Named prepared statements are off unless
 * `preparedStatements: true`.
 */
export function createDb(databaseUrl: string, options: DbOptions = {}): DbHandle {
  const resolved = resolveDbOptions(options);
  const pool = new pg.Pool(poolConfig(databaseUrl, options));
  // An idle client dropped by the server (pooler restart, Neon scale to zero) must not crash the process.
  pool.on('error', () => undefined);
  if (!resolved.preparedStatements) {
    pool.on('connect', (client) => {
      const original = client.query.bind(client) as QueryFn;
      (client as unknown as { query: QueryFn }).query = (first, ...rest) => original(dropStatementName(first), ...rest);
    });
  }
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
