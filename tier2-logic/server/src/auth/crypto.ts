import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Key material and bearer secrets for sign-in (ADR-014). Nothing here is stored as is:
 *
 * - A magic-link token is 32 random bytes; `auth_token.token_hash` keeps only its HMAC.
 * - A session secret is 32 random bytes carried in the signed session cookie; `auth_session.id` is a
 *   uuid derived from its HMAC, so the database never holds a value that opens a session.
 * - The CSRF token is the HMAC of the session secret: bound to the session, rotated with it, and it
 *   reveals nothing about the secret.
 *
 * Every key is derived from AUTH_SECRET with HKDF under its own label, so no two uses share a key.
 */

/** Random bytes in a token or session secret (256 bits). */
export const SECRET_BYTES = 32;
/** base64url without padding of {@link SECRET_BYTES} bytes. */
const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const KEY_BYTES = 32;
const HKDF_SALT = 'glidepath/auth';

export interface AuthKeys {
  /** HMAC-SHA256 key of the session cookie signature (Hono signed cookies). */
  readonly cookie: Uint8Array;
  readonly csrf: Buffer;
  readonly linkToken: Buffer;
  readonly sessionId: Buffer;
  /** HMAC-SHA256 key of the passkey challenge cookie signature (API-03). */
  readonly passkeyChallenge: Uint8Array;
}

export function deriveKeys(authSecret: string): AuthKeys {
  const key = (label: string) =>
    Buffer.from(hkdfSync('sha256', authSecret, HKDF_SALT, label, KEY_BYTES));
  return {
    cookie: new Uint8Array(key('session-cookie')),
    csrf: key('csrf-token'),
    linkToken: key('magic-link-token'),
    sessionId: key('session-id'),
    passkeyChallenge: new Uint8Array(key('passkey-challenge')),
  };
}

const hmac = (key: Buffer, value: string): Buffer =>
  createHmac('sha256', key).update(value, 'utf8').digest();

/** A fresh magic-link token or session secret: 32 random bytes, base64url. */
export function newSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

/** True for a string shaped like {@link newSecret}'s output (checked before any hashing or SQL). */
export function isSecretShape(value: unknown): value is string {
  return typeof value === 'string' && SECRET_SHAPE.test(value);
}

/** `auth_token.token_hash` of a magic-link token (hex HMAC-SHA256). */
export function hashLinkToken(keys: AuthKeys, token: string): string {
  return hmac(keys.linkToken, token).toString('hex');
}

/** `auth_session.id` of a session secret: the first 16 bytes of its HMAC, formatted as a v4-shaped uuid. */
export function sessionIdFor(keys: AuthKeys, secret: string): string {
  const b = hmac(keys.sessionId, secret).subarray(0, 16);
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The CSRF token of a session (base64url HMAC of its secret). */
export function csrfTokenFor(keys: AuthKeys, secret: string): string {
  return hmac(keys.csrf, secret).toString('base64url');
}

/** Constant-time string comparison (length is not secret). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}
