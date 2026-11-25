import { MeResponse, Problem, problemTypes } from '@glidepath/api-contract';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import type { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app/app';
import { loadConfig } from '../app/config';
import type { AppEnv } from '../app/tenant';
import { AUTH_SECRET, captureLogger } from '../app/testing/fixtures';
import { authFromConfig } from './auth';
import { CSRF_COOKIE, passkeyCookieName, sessionCookieName } from './cookies';
import { PASSKEY_CHALLENGE_TTL_MIN, userHandleFor } from './passkey';
import { PasskeyRegistered, PasskeySignedIn } from './routes';
import {
  DEMO,
  EDITOR,
  OWNER,
  PUBLIC_BASE_URL,
  VIEWER,
  appRoleUrl,
  cookiesOf,
  startAuthHarness,
} from './testing/harness';
import type { AuthHarness, Browser } from './testing/harness';
import { VirtualAuthenticator } from './testing/virtual-authenticator';
import type { CeremonyOverrides } from './testing/virtual-authenticator';

/** PUBLIC_BASE_URL's host name: the relying party every passkey must be bound to. */
const RP_ID = new URL(PUBLIC_BASE_URL).hostname;
const MS_PER_MIN = 60_000;

let h: AuthHarness;
let PASSKEY: string;
let SESSION: string;

beforeAll(async () => {
  h = await startAuthHarness();
  PASSKEY = passkeyCookieName(h.auth.settings);
  SESSION = sessionCookieName(h.auth.settings);
}, 120_000);

afterEach(() => h.clock.set(null));

afterAll(async () => {
  await h?.close();
});

/** A browser's cookie jar for one ceremony: the signed-in cookies (if any) plus the challenge cookie. */
interface Jar {
  browser?: Browser;
  passkey?: string;
}

const cookieHeader = (jar: Jar): string =>
  [jar.browser?.cookie, jar.passkey ? `${PASSKEY}=${encodeURIComponent(jar.passkey)}` : undefined]
    .filter(Boolean)
    .join('; ');

async function post(
  path: string,
  jar: Jar,
  body?: unknown,
  app: Hono<AppEnv> = h.app,
): Promise<Response> {
  const cookie = cookieHeader(jar);
  return app.request(path, {
    method: 'POST',
    headers: h.headers(jar.browser, {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** POST .../options and keep the challenge cookie it sets. */
async function options<T>(
  kind: 'register' | 'login',
  jar: Jar,
  app: Hono<AppEnv> = h.app,
): Promise<T> {
  const res = await post(`/api/auth/passkey/${kind}/options`, jar, undefined, app);
  if (res.status !== 200)
    throw new Error(`${kind}/options answered ${res.status}: ${await res.text()}`);
  jar.passkey = cookiesOf(res).get(PASSKEY)?.value;
  return (await res.json()) as T;
}

/** Registers a new passkey on `auth` for the signed-in `browser`; returns its credential id. */
async function registerPasskey(
  auth: VirtualAuthenticator,
  browser: Browser,
  label?: string,
): Promise<string> {
  const jar: Jar = { browser };
  const opts = await options<PublicKeyCredentialCreationOptionsJSON>('register', jar);
  const res = await post('/api/auth/passkey/register/verify', jar, {
    response: auth.create(opts),
    ...(label ? { label } : {}),
  });
  if (res.status !== 201)
    throw new Error(`register/verify answered ${res.status}: ${await res.text()}`);
  return PasskeyRegistered.parse(await res.json()).credentialId;
}

/** A full passkey sign-in from a browser with no cookies; returns the verify answer. */
async function passkeyLogin(
  auth: VirtualAuthenticator,
  o: CeremonyOverrides = {},
  jar: Jar = {},
): Promise<Response> {
  const opts = await options<PublicKeyCredentialRequestOptionsJSON>('login', jar);
  return post('/api/auth/passkey/login/verify', jar, { response: auth.get(opts, o) });
}

/** The browser a sign-in answer leaves behind (session + CSRF cookies). */
function browserFrom(res: Response): Browser {
  const jar = cookiesOf(res);
  const session = jar.get(SESSION)?.value ?? '';
  const csrf = jar.get(CSRF_COOKIE)?.value ?? '';
  return {
    cookie: `${SESSION}=${encodeURIComponent(session)}; ${CSRF_COOKIE}=${csrf}`,
    csrf,
    sessionValue: session,
    setCookies: res.headers.getSetCookie(),
  };
}

const meOf = async (browser: Browser): Promise<MeResponse | null> => {
  const res = await h.app.request('/api/me', { headers: { cookie: browser.cookie } });
  return res.status === 200 ? MeResponse.parse(await res.json()) : null;
};

const passkeyRow = async (credentialId: string) =>
  (
    await h.test.query<{
      user_id: string;
      public_key: Buffer;
      sign_count: string;
      transports: string[] | null;
      label: string | null;
      last_used_at: Date | null;
    }>(
      'select user_id, public_key, sign_count, transports, label, last_used_at from passkey where credential_id = $1',
      [credentialId],
    )
  ).rows[0];

const expectRefused = async (res: Response, status = 401): Promise<void> => {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toContain('application/problem+json');
  expect(cookiesOf(res).get(SESSION)).toBeUndefined();
};

describe('register and authenticate a passkey with RP id from PUBLIC_BASE_URL; credentials in passkey table (test with a virtual authenticator)', () => {
  it('register and authenticate a passkey with RP id from PUBLIC_BASE_URL; credentials in passkey table (test with a virtual authenticator)', async () => {
    const authenticator = new VirtualAuthenticator(h.origin);
    const owner = await h.login(OWNER.email);

    // Registration: the signed-in owner adds a passkey; the RP is PUBLIC_BASE_URL's host.
    const jar: Jar = { browser: owner };
    const create = await options<PublicKeyCredentialCreationOptionsJSON>('register', jar);
    expect(create.rp).toEqual({ id: RP_ID, name: 'Glidepath' });
    expect(create.user.name).toBe(OWNER.email);
    expect(create.user.id).toBe(Buffer.from(userHandleFor(OWNER.id)).toString('base64url'));
    expect(create.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    });
    expect(create.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(jar.passkey).toBeTruthy();
    const reg = await post('/api/auth/passkey/register/verify', jar, {
      response: authenticator.create(create),
      label: 'Laptop',
    });
    expect(reg.status).toBe(201);
    const { credentialId } = PasskeyRegistered.parse(await reg.json());

    // Stored in the passkey table: the owner's credential, COSE public key, counter, transports, label.
    const row = await passkeyRow(credentialId);
    expect(row?.user_id).toBe(OWNER.id);
    expect(row?.public_key.length).toBeGreaterThan(64);
    expect(Number(row?.sign_count)).toBe(0);
    expect(row?.transports).toEqual(['internal', 'hybrid']);
    expect(row?.label).toBe('Laptop');
    expect(row?.last_used_at).toBeNull();

    // Authentication from a browser with no cookies: discoverable, RP id from PUBLIC_BASE_URL.
    const signInJar: Jar = {};
    const get = await options<PublicKeyCredentialRequestOptionsJSON>('login', signInJar);
    expect(get.rpId).toBe(RP_ID);
    expect(get.userVerification).toBe('required');
    expect(get.allowCredentials ?? []).toEqual([]);
    const res = await post('/api/auth/passkey/login/verify', signInJar, {
      response: authenticator.get(get),
    });
    expect(res.status).toBe(200);
    expect(PasskeySignedIn.parse(await res.json())).toEqual({ status: 'signed-in' });
    expect(res.headers.get('cache-control')).toBe('no-store');

    // The same cookies as a magic-link sign-in, and the session belongs to the passkey's owner.
    const browser = browserFrom(res);
    expect(browser.sessionValue).not.toBe('');
    expect((await meOf(browser))?.user.id).toBe(OWNER.id);
    const used = await passkeyRow(credentialId);
    expect(Number(used?.sign_count)).toBe(1);
    expect(used?.last_used_at).not.toBeNull();
  });

  it('the RP id follows PUBLIC_BASE_URL: another base URL is another relying party', async () => {
    const authenticator = new VirtualAuthenticator(h.origin);
    await registerPasskey(authenticator, await h.login(VIEWER.email));
    const otherBase = 'https://other.example.test:8443';
    const config = loadConfig({
      DATABASE_URL: appRoleUrl(h.test),
      AUTH_SECRET,
      PUBLIC_BASE_URL: otherBase,
    });
    const other = createApp({
      logger: captureLogger().logger,
      db: h.db,
      auth: authFromConfig(config, { db: h.db.db, mailer: null }),
    });
    const jar: Jar = {};
    const res = await other.request('/api/auth/passkey/login/options', {
      method: 'POST',
      headers: { origin: new URL(otherBase).origin },
    });
    expect(res.status).toBe(200);
    const get = (await res.json()) as PublicKeyCredentialRequestOptionsJSON;
    expect(get.rpId).toBe('other.example.test');
    jar.passkey = cookiesOf(res).get(PASSKEY)?.value;

    // The viewer's passkey is bound to the first RP: it cannot sign in on the other one.
    const assertion = authenticator.get(get, { rpId: RP_ID, origin: new URL(otherBase).origin });
    const verify = await other.request('/api/auth/passkey/login/verify', {
      method: 'POST',
      headers: {
        origin: new URL(otherBase).origin,
        'content-type': 'application/json',
        cookie: cookieHeader(jar),
      },
      body: JSON.stringify({ response: assertion }),
    });
    await expectRefused(verify);
  });

  it('refuses assertions from another origin or RP id, for another challenge, without user verification, tampered, or unknown', async () => {
    const authenticator = new VirtualAuthenticator(h.origin);
    const credentialId = await registerPasskey(authenticator, await h.login(EDITOR.email));
    const cases: CeremonyOverrides[] = [
      { origin: 'https://glidepath.example.test.evil.test' },
      { rpId: 'evil.test', credentialId },
      { challenge: 'A'.repeat(43) },
      { userVerified: false },
    ];
    for (const o of cases) await expectRefused(await passkeyLogin(authenticator, o));

    // A forged signature.
    const jar: Jar = {};
    const get = await options<PublicKeyCredentialRequestOptionsJSON>('login', jar);
    const forged = authenticator.get(get);
    forged.response.signature = Buffer.from('not a signature').toString('base64url');
    await expectRefused(await post('/api/auth/passkey/login/verify', jar, { response: forged }));

    // A credential the server never registered.
    const stranger = new VirtualAuthenticator(h.origin);
    stranger.create({
      rp: { id: RP_ID, name: 'x' },
      user: { id: 'AAAA', name: 'x', displayName: 'x' },
      challenge: 'AAAA',
      pubKeyCredParams: [],
    });
    await expectRefused(await passkeyLogin(stranger));

    // None of the refusals moved the counter or the last use.
    const row = await passkeyRow(credentialId);
    expect(Number(row?.sign_count)).toBe(0);
    expect(row?.last_used_at).toBeNull();
  });

  it('a challenge is single use, bound to the browser that asked for it, and expires', async () => {
    // A synced passkey keeps its counter at 0, so only the single-use challenge stops a replay.
    const authenticator = new VirtualAuthenticator(h.origin, { counter: false });
    await registerPasskey(authenticator, await h.login(EDITOR.email));

    // Replaying a verified sign-in (same challenge cookie, same assertion) is refused.
    const jar: Jar = {};
    const get = await options<PublicKeyCredentialRequestOptionsJSON>('login', jar);
    const assertion = authenticator.get(get);
    expect(
      (await post('/api/auth/passkey/login/verify', jar, { response: assertion })).status,
    ).toBe(200);
    await expectRefused(await post('/api/auth/passkey/login/verify', jar, { response: assertion }));

    // Without the challenge cookie (another browser), or with a forged one, nothing is verified.
    const get2 = await options<PublicKeyCredentialRequestOptionsJSON>('login', {});
    await expectRefused(
      await post('/api/auth/passkey/login/verify', {}, { response: authenticator.get(get2) }),
    );
    const get3Jar: Jar = {};
    const get3 = await options<PublicKeyCredentialRequestOptionsJSON>('login', get3Jar);
    const forgedJar: Jar = { passkey: `login.${get3.challenge}.${Date.now() + MS_PER_MIN}..bad` };
    await expectRefused(
      await post('/api/auth/passkey/login/verify', forgedJar, {
        response: authenticator.get(get3),
      }),
    );

    // After PASSKEY_CHALLENGE_TTL_MIN the challenge is void.
    const t0 = new Date();
    h.clock.set(t0);
    const lateJar: Jar = {};
    const late = await options<PublicKeyCredentialRequestOptionsJSON>('login', lateJar);
    h.clock.set(new Date(t0.getTime() + PASSKEY_CHALLENGE_TTL_MIN * MS_PER_MIN));
    await expectRefused(
      await post('/api/auth/passkey/login/verify', lateJar, { response: authenticator.get(late) }),
    );
  });

  it('the challenge cookie is HttpOnly, Secure, SameSite=Strict and scoped to /api/auth/passkey', async () => {
    const res = await post('/api/auth/passkey/login/options', {});
    const sc = res.headers.getSetCookie().find((c) => c.startsWith(`${PASSKEY}=`)) ?? '';
    expect(PASSKEY).toBe('__Secure-gp_passkey');
    const attrs = sc.split(';').map((a) => a.trim());
    expect(attrs).toEqual(
      expect.arrayContaining([
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
        'Path=/api/auth/passkey',
        `Max-Age=${PASSKEY_CHALLENGE_TTL_MIN * 60}`,
      ]),
    );
  });

  it('registering needs a session, its CSRF token and the public origin; a passkey is registered once', async () => {
    const authenticator = new VirtualAuthenticator(h.origin);
    // No session: 401.
    const anon = await post('/api/auth/passkey/register/options', {});
    expect(anon.status).toBe(401);
    expect(Problem.parse(await anon.json()).type).toBe(problemTypes.unauthenticated);

    const owner = await h.login(OWNER.email);
    // Session but no CSRF token: 403 (guard).
    const noCsrf = await h.app.request('/api/auth/passkey/register/options', {
      method: 'POST',
      headers: { origin: h.origin, cookie: owner.cookie },
    });
    expect(noCsrf.status).toBe(403);
    // Cross-site: 403 (guard).
    const crossSite = await h.app.request('/api/auth/passkey/login/options', {
      method: 'POST',
      headers: { origin: 'https://evil.test' },
    });
    expect(crossSite.status).toBe(403);

    // A registration made on another origin is refused and stores nothing.
    const before = Number(
      (await h.test.query('select count(*) as n from passkey where user_id = $1', [OWNER.id]))
        .rows[0]?.n,
    );
    const jar: Jar = { browser: owner };
    const create = await options<PublicKeyCredentialCreationOptionsJSON>('register', jar);
    await expectRefused(
      await post('/api/auth/passkey/register/verify', jar, {
        response: authenticator.create(create, { origin: 'https://evil.test' }),
      }),
      400,
    );

    // A registration challenge cannot be used to sign in, nor a sign-in challenge to register.
    const loginJar: Jar = { browser: owner };
    const get = await options<PublicKeyCredentialRequestOptionsJSON>('login', loginJar);
    await expectRefused(
      await post('/api/auth/passkey/register/verify', loginJar, {
        response: new VirtualAuthenticator(h.origin).create({
          ...create,
          challenge: get.challenge,
        }),
      }),
      400,
    );
    expect(
      Number(
        (await h.test.query('select count(*) as n from passkey where user_id = $1', [OWNER.id]))
          .rows[0]?.n,
      ),
    ).toBe(before);

    // Registered once: the next options exclude it.
    const id = await registerPasskey(authenticator, owner);
    const again = await options<PublicKeyCredentialCreationOptionsJSON>('register', {
      browser: owner,
    });
    expect(again.excludeCredentials?.map((c) => c.id)).toContain(id);

    // A malformed body is a 422.
    const bad = await post('/api/auth/passkey/login/verify', {}, { response: { id: 'x' } });
    expect(bad.status).toBe(422);
  });

  it('without PUBLIC_BASE_URL there is no relying party: 503 problem', async () => {
    const config = loadConfig({ DATABASE_URL: appRoleUrl(h.test), AUTH_SECRET });
    const app = createApp({
      logger: captureLogger().logger,
      db: h.db,
      auth: authFromConfig(config, { db: h.db.db, mailer: null }),
    });
    const res = await app.request('/api/auth/passkey/login/options', {
      method: 'POST',
      headers: { origin: 'http://localhost' },
    });
    expect(res.status).toBe(503);
    expect(Problem.parse(await res.json()).detail).toContain('sign-in link');
  });
});

describe('magic link remains the fallback (test)', () => {
  it('magic link remains the fallback (test)', async () => {
    // The owner has a passkey, then loses the authenticator: a passkey sign-in fails with a 401 that
    // points at the sign-in link, and the magic link still signs them in.
    const lost = new VirtualAuthenticator(h.origin);
    await registerPasskey(lost, await h.login(OWNER.email), 'Lost phone');
    const replacement = new VirtualAuthenticator(h.origin);
    replacement.create({
      rp: { id: RP_ID, name: 'x' },
      user: {
        id: Buffer.from(userHandleFor(OWNER.id)).toString('base64url'),
        name: 'x',
        displayName: 'x',
      },
      challenge: 'AAAA',
      pubKeyCredParams: [],
    });
    const failed = await passkeyLogin(replacement);
    await expectRefused(failed);
    expect(Problem.parse(await failed.json()).detail).toContain('sign-in link');

    const viaLink = await h.login(OWNER.email);
    expect((await meOf(viaLink))?.user.id).toBe(OWNER.id);

    // The magic-link routes are unchanged by passkeys: a link still works after a passkey sign-in.
    const ok = await passkeyLogin(lost);
    expect(ok.status).toBe(200);
    const again = await h.login(OWNER.email, browserFrom(ok));
    expect((await meOf(again))?.user.id).toBe(OWNER.id);
  });

  it('a user without any passkey signs in by magic link as before', async () => {
    const count = Number(
      (await h.test.query('select count(*) as n from passkey where user_id = $1', [DEMO.id]))
        .rows[0]?.n,
    );
    expect(count).toBe(0);
    const b = await h.login(DEMO.email);
    expect((await meOf(b))?.user.id).toBe(DEMO.id);
  });
});
