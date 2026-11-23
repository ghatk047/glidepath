import { Problem, problemTypes } from '@glidepath/api-contract';
import { generateSignedCookie } from 'hono/cookie';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app/app';
import { loadConfig } from '../app/config';
import { AUTH_SECRET, captureLogger } from '../app/testing/fixtures';
import { authFromConfig } from './auth';
import { CSRF_COOKIE, CSRF_HEADER } from './cookies';
import { csrfTokenFor, deriveKeys, sessionIdFor } from './crypto';
import { SESSION_TTL_HOURS } from './settings';
import { OWNER, PUBLIC_BASE_URL, appRoleUrl, cookiesOf, startAuthHarness } from './testing/harness';
import type { AuthHarness, Browser } from './testing/harness';

const SESSION = '__Host-gp_session';
const TTL_MS = SESSION_TTL_HOURS * 3_600_000;
const keys = deriveKeys(AUTH_SECRET);

let h: AuthHarness;
let local: AuthHarness;

beforeAll(async () => {
  [h, local] = await Promise.all([
    startAuthHarness(),
    startAuthHarness({ publicBaseUrl: 'http://localhost:5173' }),
  ]);
}, 120_000);

afterEach(() => h.clock.set(null));

afterAll(async () => {
  await h?.close();
  await local?.close();
});

const attrs = (setCookie: string) =>
  setCookie
    .split(';')
    .slice(1)
    .map((a) => a.trim());

/** The session secret inside a signed cookie value `<secret>.<signature>`. */
const secretOf = (b: Browser) => b.sessionValue.slice(0, b.sessionValue.lastIndexOf('.'));

const me = (cookie: string, app = h.app) => app.request('/api/me', { headers: { cookie } });

describe('session cookie HttpOnly, Secure, SameSite=Lax, signed with AUTH_SECRET, rotated at login', () => {
  it('sets __Host-gp_session with HttpOnly, Secure, SameSite=Lax, Path=/ and the session lifetime', async () => {
    const b = await h.login(OWNER.email);
    const session = b.setCookies.find((c) => c.startsWith(`${SESSION}=`)) ?? '';
    expect(attrs(session)).toEqual(
      expect.arrayContaining([
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        'Path=/',
        `Max-Age=${TTL_MS / 1000}`,
      ]),
    );
    expect(session).not.toMatch(/Domain=/i);
  });

  it('sets the CSRF cookie readable by the SPA (not HttpOnly), Secure, SameSite=Lax, bound to the session', async () => {
    const b = await h.login(OWNER.email);
    const csrf = b.setCookies.find((c) => c.startsWith(`${CSRF_COOKIE}=`)) ?? '';
    expect(attrs(csrf)).toEqual(expect.arrayContaining(['Secure', 'SameSite=Lax', 'Path=/']));
    expect(attrs(csrf)).not.toContain('HttpOnly');
    expect(b.csrf).toBe(csrfTokenFor(keys, secretOf(b)));
  });

  it('is signed with AUTH_SECRET: tampered, unsigned or foreign-signed cookies are refused', async () => {
    const b = await h.login(OWNER.email);
    const secret = secretOf(b);
    const sig = b.sessionValue.slice(secret.length + 1);
    const asCookie = (v: string) => `${SESSION}=${encodeURIComponent(v)}`;
    const flip = (s: string, i: number) =>
      s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);

    expect((await me(asCookie(b.sessionValue))).status).toBe(200);
    for (const forged of [
      `${flip(secret, 5)}.${sig}`,
      `${secret}.${flip(sig, 5)}`,
      secret,
      `${secret}.`,
      '',
    ]) {
      const res = await me(asCookie(forged));
      expect(res.status, forged).toBe(401);
      expect(Problem.parse(await res.json()).type).toBe(problemTypes.unauthenticated);
    }

    const signedWith = async (key: Uint8Array) =>
      (await generateSignedCookie('gp_session', secret, key, { prefix: 'host', path: '/' })).split(
        ';',
      )[0] ?? '';
    expect(
      (await me(await signedWith(deriveKeys('another-auth-secret-0123456789').cookie))).status,
    ).toBe(401);
    // Re-signing the same secret with AUTH_SECRET's key is accepted: the signature is keyed by AUTH_SECRET.
    expect((await me(await signedWith(keys.cookie))).status).toBe(200);

    // A server with another AUTH_SECRET refuses the cookie.
    const other = loadConfig({
      DATABASE_URL: appRoleUrl(h.test),
      AUTH_SECRET: 'another-auth-secret-0123456789',
      PUBLIC_BASE_URL,
    });
    const otherApp = createApp({
      logger: captureLogger().logger,
      db: h.db,
      auth: authFromConfig(other, { db: h.db.db, mailer: null }),
    });
    expect((await me(asCookie(b.sessionValue), otherApp)).status).toBe(401);
  });

  it('keeps only the derived session id in auth_session, never the cookie secret', async () => {
    const b = await h.login(OWNER.email);
    const secret = secretOf(b);
    const rows = (
      await h.test.query<{ id: string; j: string }>(
        'select id::text as id, row_to_json(s)::text as j from auth_session s',
      )
    ).rows;
    expect(rows.map((r) => r.id)).toContain(sessionIdFor(keys, secret));
    for (const r of rows) expect(r.j).not.toContain(secret);
  });

  it('rotates at sign-in: new session and CSRF token, the old session is deleted and its cookie refused', async () => {
    const a = await h.login(OWNER.email);
    const b = await h.login(OWNER.email, a); // the same browser signs in again, sending a's cookies
    expect(secretOf(b)).not.toBe(secretOf(a));
    expect(b.csrf).not.toBe(a.csrf);
    expect((await me(a.cookie)).status).toBe(401);
    expect((await me(b.cookie)).status).toBe(200);
    const ids = (
      await h.test.query<{ id: string }>('select id::text as id from auth_session')
    ).rows.map((r) => r.id);
    expect(ids).not.toContain(sessionIdFor(keys, secretOf(a)));
    expect(ids).toContain(sessionIdFor(keys, secretOf(b)));
  });

  it('a sign-in on another device leaves this session alone', async () => {
    const laptop = await h.login(OWNER.email);
    const phone = await h.login(OWNER.email);
    expect((await me(laptop.cookie)).status).toBe(200);
    expect((await me(phone.cookie)).status).toBe(200);
  });

  it(`ends ${SESSION_TTL_HOURS} hours after sign-in`, async () => {
    const t0 = new Date(Math.floor(Date.now() / 1000) * 1000);
    h.clock.set(t0);
    const b = await h.login(OWNER.email);
    h.clock.set(new Date(t0.getTime() + TTL_MS - 1_000));
    expect((await me(b.cookie)).status).toBe(200);
    h.clock.set(new Date(t0.getTime() + TTL_MS));
    expect((await me(b.cookie)).status).toBe(401);
  });

  it('logout deletes the session and clears both cookies', async () => {
    const b = await h.login(OWNER.email);
    const res = await h.app.request('/api/auth/logout', { method: 'POST', headers: h.headers(b) });
    expect(res.status).toBe(204);
    const jar = cookiesOf(res);
    expect(jar.get(SESSION)?.value).toBe('');
    expect(jar.get(SESSION)?.attrs).toContain('Max-Age=0');
    expect(jar.get(CSRF_COOKIE)?.value).toBe('');
    expect((await me(b.cookie)).status).toBe(401);
    expect(
      (
        await h.test.query('select 1 from auth_session where id = $1', [
          sessionIdFor(keys, secretOf(b)),
        ])
      ).rowCount,
    ).toBe(0);
  });

  it('with a plain-http PUBLIC_BASE_URL (local http) the cookies are not Secure and the session still works', async () => {
    const b = await local.login(OWNER.email);
    const session = b.setCookies.find((c) => c.startsWith('gp_session=')) ?? '';
    expect(attrs(session)).toEqual(expect.arrayContaining(['HttpOnly', 'SameSite=Lax', 'Path=/']));
    expect(attrs(session)).not.toContain('Secure');
    expect(b.setCookies.some((c) => c.startsWith('__Host-'))).toBe(false);
    expect((await me(b.cookie, local.app)).status).toBe(200);
    const res = await local.app.request('/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', cookie: b.cookie, [CSRF_HEADER]: b.csrf },
    });
    expect(res.status).toBe(204);
  });
});
