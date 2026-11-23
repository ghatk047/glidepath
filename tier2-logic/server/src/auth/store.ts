import { sql } from '@glidepath/data-access';
import type { Db } from '@glidepath/data-access';

/**
 * SQL for the global auth tables (tier3-data/migrations/manual/0002_auth_tables.sql: auth_token,
 * auth_session; DATA-11) and the app_user lookup by e-mail. These tables have no tenant_id and no RLS
 * (a user signs in before choosing a tenant); the app role's grants are the whole access rule, so
 * these statements run on the app's `Db` outside withTenant / withUser.
 *
 * Every statement is a data-access `sql` template: values travel as bind parameters only. Only hashes
 * are written: `token_hash` (crypto.hashLinkToken) and the session id (crypto.sessionIdFor).
 * Timestamps come from the caller's clock so expiry is testable; `created_at` keeps the DB default.
 */

/** Anything that runs a statement: the app `Db` or one of its transactions. */
export type Executor = Pick<Db, 'execute'>;

export interface UserRef {
  readonly id: string;
  readonly email: string;
}

export interface ConsumedToken {
  readonly id: string;
  readonly email: string;
  readonly userId: string | null;
}

export interface SessionRow {
  readonly userId: string;
  readonly expiresAt: Date;
}

/** app_user by e-mail (citext: case-insensitive). */
export async function findUserByEmail(ex: Executor, email: string): Promise<UserRef | null> {
  const r = await ex.execute<{ id: string; email: string }>(
    sql`select id, email::text as email from app_user where email = ${email}`,
  );
  return r.rows[0] ?? null;
}

/**
 * Serialises link requests for one address until the end of the transaction (transaction-scoped
 * advisory lock: pooler safe), so the live-link limit holds under concurrent requests.
 */
export async function lockAddress(ex: Executor, email: string): Promise<void> {
  await ex.execute(sql`select pg_advisory_xact_lock(hashtextextended(lower(${email}), 0))`);
}

/** Drops the address's tokens that can no longer be used (consumed or expired). */
export async function pruneTokens(ex: Executor, email: string, now: Date): Promise<void> {
  await ex.execute(
    sql`delete from auth_token where email = ${email} and (consumed_at is not null or expires_at <= ${now})`,
  );
}

/** Unconsumed, unexpired links of the address. */
export async function countLiveTokens(ex: Executor, email: string, now: Date): Promise<number> {
  const r = await ex.execute<{ n: number }>(
    sql`select count(*)::int as n from auth_token where email = ${email} and consumed_at is null and expires_at > ${now}`,
  );
  return r.rows[0]?.n ?? 0;
}

export async function insertToken(
  ex: Executor,
  t: { tokenHash: string; email: string; userId: string; expiresAt: Date },
): Promise<void> {
  await ex.execute(
    sql`insert into auth_token (token_hash, email, user_id, expires_at) values (${t.tokenHash}, ${t.email}, ${t.userId}, ${t.expiresAt})`,
  );
}

export async function deleteToken(ex: Executor, tokenHash: string): Promise<void> {
  await ex.execute(sql`delete from auth_token where token_hash = ${tokenHash}`);
}

/**
 * Single use: marks the token consumed if it is unconsumed and unexpired, in one statement, and
 * returns it; otherwise null. Two concurrent callbacks with one token cannot both succeed.
 */
export async function consumeToken(
  ex: Executor,
  tokenHash: string,
  now: Date,
): Promise<ConsumedToken | null> {
  const r = await ex.execute<{ id: string; email: string; user_id: string | null }>(
    sql`update auth_token set consumed_at = ${now}
        where token_hash = ${tokenHash} and consumed_at is null and expires_at > ${now}
        returning id, email::text as email, user_id`,
  );
  const row = r.rows[0];
  return row ? { id: row.id, email: row.email, userId: row.user_id } : null;
}

/** After a sign-in: the address's other links are void. */
export async function deleteOtherTokens(
  ex: Executor,
  email: string,
  keepId: string,
): Promise<void> {
  await ex.execute(sql`delete from auth_token where email = ${email} and id <> ${keepId}`);
}

export async function insertSession(
  ex: Executor,
  s: { id: string; userId: string; expiresAt: Date },
): Promise<void> {
  await ex.execute(
    sql`insert into auth_session (id, user_id, expires_at) values (${s.id}, ${s.userId}, ${s.expiresAt})`,
  );
}

/** The unexpired session with this id, or null. */
export async function findSession(ex: Executor, id: string, now: Date): Promise<SessionRow | null> {
  const r = await ex.execute<{ user_id: string; expires_at: Date }>(
    sql`select user_id, expires_at from auth_session where id = ${id} and expires_at > ${now}`,
  );
  const row = r.rows[0];
  return row ? { userId: row.user_id, expiresAt: new Date(row.expires_at) } : null;
}

export async function deleteSession(ex: Executor, id: string): Promise<void> {
  await ex.execute(sql`delete from auth_session where id = ${id}`);
}

/** Drops the user's expired sessions (housekeeping at sign-in). */
export async function pruneSessions(ex: Executor, userId: string, now: Date): Promise<void> {
  await ex.execute(
    sql`delete from auth_session where user_id = ${userId} and expires_at <= ${now}`,
  );
}
