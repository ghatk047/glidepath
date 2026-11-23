import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POOL_MAX,
  connectionConfig,
  dbOptionsFromEnv,
  poolConfig,
  resolveDbOptions,
} from './config';
import { createDb } from './db';

const URL_PLAIN = 'postgres://glidepath_app:pw@db.example:6543/glidepath';

afterEach(() => vi.unstubAllEnvs());

describe('createDb config (pooler safe)', () => {
  it('reads only the URL it is given: DATABASE_URL and PG* env do not leak in', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://env-user:env-pw@env-host:1/envdb');
    vi.stubEnv('PGHOST', 'pg-env-host');
    vi.stubEnv('PGUSER', 'pg-env-user');
    vi.stubEnv('DB_POOL_MAX', '99');
    const h = createDb(URL_PLAIN);
    try {
      const o = h.pool.options as { connectionString?: string; max?: number };
      expect(o.connectionString).toBe(URL_PLAIN);
      expect(o.max).toBe(10);
    } finally {
      await h.close();
    }
  });

  it('rejects a missing or non-postgres URL', () => {
    expect(() => poolConfig('')).toThrow(/DATABASE_URL is required/);
    expect(() => poolConfig('mysql://x/y')).toThrow(/postgres/);
  });

  it('TLS follows sslmode in the URL', () => {
    expect(connectionConfig(URL_PLAIN).ssl).toBeUndefined();
    expect(connectionConfig(`${URL_PLAIN}?sslmode=disable`).ssl).toBeUndefined();
    // libpq semantics: require = encrypted, certificate not verified (works with self-signed pg-local)
    const req = connectionConfig(`${URL_PLAIN}?sslmode=require`);
    expect(req.ssl).toEqual({ rejectUnauthorized: false });
    expect(req.connectionString).not.toContain('sslmode');
    // verify modes are left to node-postgres (verified)
    expect(connectionConfig(`${URL_PLAIN}?sslmode=verify-full`).connectionString).toContain('sslmode=verify-full');
    expect(connectionConfig(`${URL_PLAIN}?sslmode=verify-full`).ssl).toBeUndefined();
    expect(() => connectionConfig(`${URL_PLAIN}?sslmode=bogus`)).toThrow(/sslmode/);
  });

  it('pool size is configurable (default 10) and validated', () => {
    expect(poolConfig(URL_PLAIN).max).toBe(DEFAULT_POOL_MAX);
    expect(poolConfig(URL_PLAIN, { poolMax: 3 }).max).toBe(3);
    expect(() => poolConfig(URL_PLAIN, { poolMax: 0 })).toThrow(/poolMax/);
    expect(() => poolConfig(URL_PLAIN, { poolMax: 2.5 })).toThrow(/poolMax/);
    expect(dbOptionsFromEnv({ DB_POOL_MAX: '4', DB_PREPARED_STATEMENTS: '1' })).toEqual({
      poolMax: 4,
      preparedStatements: true,
    });
    expect(dbOptionsFromEnv({})).toEqual({});
  });

  it('prepared statements are off by default', () => {
    expect(resolveDbOptions().preparedStatements).toBe(false);
    expect(resolveDbOptions({ preparedStatements: true }).preparedStatements).toBe(true);
  });

  it('sets no session state through connection settings', () => {
    const cfg = poolConfig(`${URL_PLAIN}?sslmode=require`) as Record<string, unknown>;
    for (const k of ['options', 'statement_timeout', 'query_timeout', 'idle_in_transaction_session_timeout', 'application_name']) {
      expect(cfg[k]).toBeUndefined();
    }
  });

  it('no source file uses session-level SET (only SET LOCAL / set_config(..., true))', () => {
    const dir = __dirname_src();
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f === 'schema.ts') continue;
      const text = readFileSync(join(dir, f), 'utf8');
      if (/\bSET\s+(?!LOCAL\b)(SESSION\s+)?[a-z_.]+\s*(=|TO\b)/i.test(text)) offenders.push(f);
      if (/pg_advisory_lock\b|LISTEN\s|NOTIFY\s/.test(text)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

function __dirname_src(): string {
  return new URL('.', import.meta.url).pathname;
}
