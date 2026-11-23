import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { clientConfig } from '@glidepath/pg-local';
import pg from 'pg';

/**
 * Test support: a fresh database owned by a fresh NON-superuser role, as
 * `glidepath_owner` is on Neon. `adminUrl` must be a superuser URL (pg-local).
 */
export interface OwnedDatabase {
  /** URL of the owner role (stands in for DATABASE_URL_MIGRATE); keeps the sslmode of adminUrl. */
  url: string;
  role: string;
  database: string;
  drop(): Promise<void>;
}

export async function createOwnedDatabase(adminUrl: string): Promise<OwnedDatabase> {
  const suffix = randomBytes(4).toString('hex');
  const role = `gp_owner_${suffix}`;
  const database = `gp_db_${suffix}`;
  const admin = new pg.Client(clientConfig(adminUrl));
  await admin.connect();
  try {
    // glidepath_owner / glidepath_app (cluster-wide, idempotent): tier3-data/migrations/0002_rls.sql grants to them (DATA-02).
    await admin.query(readFileSync(new URL('../../../../tier3-data/postgres/init/01_roles.sql', import.meta.url), 'utf8'));
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'owner-pw'`);
    await admin.query(`CREATE DATABASE ${database} OWNER ${role}`);
  } finally {
    await admin.end();
  }
  const u = new URL(adminUrl);
  u.username = role;
  u.password = 'owner-pw';
  u.pathname = `/${database}`;
  return {
    url: u.toString(),
    role,
    database,
    async drop() {
      const a = new pg.Client(clientConfig(adminUrl));
      await a.connect();
      try {
        await a.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
        await a.query(`DROP ROLE IF EXISTS ${role}`);
      } finally {
        await a.end();
      }
    },
  };
}

/** Superuser-free connection helper for assertions. */
export async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client(clientConfig(url));
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
