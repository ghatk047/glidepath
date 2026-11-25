import type pg from 'pg';
import { createDb } from '../db';
import type { DbHandle } from '../db';
import type { DbOptions } from '../config';

/** One statement as node-postgres sent it: SQL text and bound values. */
export interface RecordedQuery {
  text: string;
  values: unknown[];
}

type QueryFn = (...args: unknown[]) => unknown;

/**
 * Records every statement sent over the pool's connections (after createDb's own wrapping), so tests
 * can check what SQL text reached the server and which values travelled as bind parameters.
 */
export function recordQueries(pool: pg.Pool): RecordedQuery[] {
  const log: RecordedQuery[] = [];
  pool.on('connect', (client) => {
    const inner = client.query.bind(client) as QueryFn;
    (client as unknown as { query: QueryFn }).query = (first, ...rest) => {
      if (typeof first === 'string') {
        log.push({ text: first, values: Array.isArray(rest[0]) ? (rest[0] as unknown[]) : [] });
      } else if (first && typeof first === 'object' && typeof (first as { text?: unknown }).text === 'string') {
        const q = first as { text: string; values?: unknown[] };
        log.push({ text: q.text, values: q.values ?? (Array.isArray(rest[0]) ? (rest[0] as unknown[]) : []) });
      }
      return inner(first, ...rest);
    };
  });
  return log;
}

/**
 * A pool on `database` whose connections run as glidepath_app, the runtime role (NOBYPASSRLS, only the
 * grants of 0002_rls.sql): `adminUrl` must be a superuser (pg-local), which may assume it. The role is a
 * startup option (`-c role=glidepath_app`), so no statement is added to the connection. Test support
 * only: the real app gets the role from its login (DATABASE_URL).
 */
export function createAppRoleDb(adminUrl: string, database: string, options: DbOptions = {}): DbHandle {
  const u = new URL(adminUrl);
  u.pathname = `/${database}`;
  u.searchParams.set('options', '-c role=glidepath_app');
  return createDb(u.toString(), options);
}
