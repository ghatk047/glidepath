import { describe, expect, it } from 'vitest';
import { loadConfig, ConfigError, DEFAULT_AUTH_LINK_TTL_MIN } from '../app/config';
import { secretsFrom } from '../app/logger';
import {
  csrfTokenFor,
  deriveKeys,
  hashLinkToken,
  isSecretShape,
  newSecret,
  safeEqual,
  sessionIdFor,
} from './crypto';
import { magicLinkMessage, senderFor } from './mailer';
import { SESSION_TTL_HOURS, authSettingsFrom } from './settings';

const A = 'auth-secret-a-0123456789abcdef';
const B = 'auth-secret-b-0123456789abcdef';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const base = {
  DATABASE_URL: 'postgresql://glidepath_app:pw12345@db.example:5432/glidepath',
  AUTH_SECRET: A,
};

describe('auth secrets and hashes', () => {
  it('newSecret: 256 random bits, base64url, never repeats', () => {
    const many = new Set(Array.from({ length: 200 }, () => newSecret()));
    expect(many.size).toBe(200);
    for (const s of many) expect(isSecretShape(s)).toBe(true);
    for (const bad of [
      '',
      'x',
      `${newSecret()}=`,
      newSecret().slice(1),
      `${newSecret().slice(1)}+`,
      42,
      null,
      undefined,
    ]) {
      expect(isSecretShape(bad)).toBe(false);
    }
  });

  it('token hashes and session ids are deterministic, keyed by AUTH_SECRET and never the secret itself', () => {
    const s = newSecret();
    const ka = deriveKeys(A);
    expect(hashLinkToken(ka, s)).toBe(hashLinkToken(deriveKeys(A), s));
    expect(hashLinkToken(ka, s)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLinkToken(ka, s)).not.toBe(hashLinkToken(deriveKeys(B), s));
    expect(sessionIdFor(ka, s)).toMatch(UUID);
    expect(sessionIdFor(ka, s)).toBe(sessionIdFor(deriveKeys(A), s));
    expect(sessionIdFor(ka, s)).not.toBe(sessionIdFor(deriveKeys(B), s));
    expect(sessionIdFor(ka, s)).not.toBe(sessionIdFor(ka, newSecret()));
    for (const derived of [hashLinkToken(ka, s), sessionIdFor(ka, s), csrfTokenFor(ka, s)])
      expect(derived).not.toContain(s);
  });

  it('each use has its own key: the CSRF token is not the token hash or the session id of the same secret', () => {
    const ka = deriveKeys(A);
    const s = newSecret();
    const csrfHex = Buffer.from(csrfTokenFor(ka, s), 'base64url').toString('hex');
    expect(csrfHex).not.toBe(hashLinkToken(ka, s));
    expect(sessionIdFor(ka, s).replace(/-/g, '')).not.toBe(hashLinkToken(ka, s).slice(0, 32));
    expect(Buffer.from(ka.cookie).equals(ka.csrf)).toBe(false);
    expect(csrfTokenFor(ka, s)).not.toBe(csrfTokenFor(ka, newSecret()));
  });

  it('safeEqual compares whole strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('auth settings from env', () => {
  it('SMTP_URL and AUTH_LINK_TTL_MIN: optional, validated, never echoed', () => {
    const c = loadConfig(base);
    expect(c.SMTP_URL).toBeUndefined();
    expect(c.AUTH_LINK_TTL_MIN).toBe(DEFAULT_AUTH_LINK_TTL_MIN);
    expect(
      loadConfig({ ...base, SMTP_URL: 'smtp://mail:1025', AUTH_LINK_TTL_MIN: '9' }),
    ).toMatchObject({
      SMTP_URL: 'smtp://mail:1025',
      AUTH_LINK_TTL_MIN: 9,
    });
    expect(loadConfig({ ...base, SMTP_URL: '' }).SMTP_URL).toBeUndefined();
    let err: ConfigError | undefined;
    try {
      loadConfig({ ...base, SMTP_URL: 'http://user:hunter22@mail', AUTH_LINK_TTL_MIN: '100000' });
    } catch (e) {
      err = e as ConfigError;
    }
    expect(err?.invalid.map((i) => i.name)).toEqual(['SMTP_URL', 'AUTH_LINK_TTL_MIN']);
    expect(err?.message).not.toContain('hunter22');
  });

  it('the SMTP password is scrubbed from logs', () => {
    expect(
      secretsFrom({ AUTH_SECRET: A, SMTP_URL: 'smtps://mailer:s3cr3t-pw@mail.example:465' }),
    ).toEqual(expect.arrayContaining(['smtps://mailer:s3cr3t-pw@mail.example:465', 's3cr3t-pw']));
  });

  it('cookies are Secure unless PUBLIC_BASE_URL is plain http', () => {
    const s = (url?: string) =>
      authSettingsFrom(loadConfig({ ...base, ...(url ? { PUBLIC_BASE_URL: url } : {}) }));
    expect(s('https://localhost')).toMatchObject({
      cookieSecure: true,
      publicOrigin: 'https://localhost',
    });
    expect(s()).toMatchObject({ cookieSecure: true, publicOrigin: null });
    expect(s('http://localhost:5173/app')).toMatchObject({
      cookieSecure: false,
      publicOrigin: 'http://localhost:5173',
    });
    expect(s().sessionTtlMs).toBe(SESSION_TTL_HOURS * 3_600_000);
    expect(s().linkTtlMin).toBe(DEFAULT_AUTH_LINK_TTL_MIN);
  });
});

describe('sign-in mail', () => {
  it('carries the link and its lifetime, from no-reply at the public host', () => {
    const m = magicLinkMessage({
      to: 'a@example.test',
      link: 'https://x.example.test/api/auth/callback?token=t',
      ttlMin: 15,
    });
    expect(m.subject).toBe('Your Glidepath sign-in link');
    expect(m.text).toContain('https://x.example.test/api/auth/callback?token=t');
    expect(m.text).toContain('expires in 15 minutes');
    expect(magicLinkMessage({ to: 'a@example.test', link: 'l', ttlMin: 1 }).text).toContain(
      'expires in 1 minute.',
    );
    expect(senderFor('https://glidepath.example.test')).toBe(
      'Glidepath <no-reply@glidepath.example.test>',
    );
    expect(senderFor(null)).toBe('Glidepath <no-reply@localhost>');
  });
});
