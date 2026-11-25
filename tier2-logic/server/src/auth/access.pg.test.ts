import { MeResponse } from '@glidepath/api-contract';
import type { TestDatabase } from '@glidepath/testkit';
import { SignJWT, generateSecret } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedIds } from '../../../worker/src/seed/ids';
import { loadConfig } from '../app/config';
import { ACCESS_JWT_HEADER, CERTS_COOLDOWN_MS, accessSettingsFrom, createAccessVerifier } from './access';
import { CSRF_COOKIE, sessionCookieName } from './cookies';
import { AUD, TEAM_DOMAIN, TEAM_ORIGIN, startFakeAccess } from './testing/fake-access';
import type { FakeAccess } from './testing/fake-access';
import { DEMO, MODEL_VERSION, TENANT_A, cookiesOf, startAuthHarness } from './testing/harness';
import type { AuthHarness } from './testing/harness';
import { tenantIdForSlug } from './tenant-ids';

/**
 * OPS-09: sign-in by Cloudflare Access JWT. Tokens are signed here with a generated RSA key; the team's certs
 * endpoint is a local HTTP server in the Cloudflare format (testing/fake-access.ts). The database is a fresh
 * migrated one, the app connects as glidepath_app (RLS applies).
 */

const AA = { id: tenantIdForSlug('aa'), slug: 'aa', name: 'Auto tenant' } as const;

/** Adds a tenant `aa` with the seed's deterministic id, as the owner role (FORCE RLS). */
async function seedAa(db: TestDatabase): Promise<void> {
  await db.withClient(async (c) => {
    await c.query('begin');
    await c.query(`select set_config('app.tenant_id', $1, true)`, [AA.id]);
    await c.query(
      `insert into tenant (id, slug, name, currency, base_year, target_year, fiscal_calendar, ticker, model_version_id, status, created_at)
       values ($1, $2, $3, 'USD', 2026, 2027, 'calendar', null, $4, 'active', now())`,
      [AA.id, AA.slug, AA.name, MODEL_VERSION],
    );
    await c.query('commit');
  });
}

let fake: FakeAccess;
let h: AuthHarness;

beforeAll(async () => {
  fake = await startFakeAccess();
  h = await startAuthHarness({
    env: fake.env({ ACCESS_AUTO_TENANTS: 'aa,nosuch' }),
    accessCertsUrl: fake.certsUrl,
    seed: seedAa,
  });
}, 120_000);

afterAll(async () => {
  await h?.close();
  await fake?.close();
});

const withJwt = (token: string, extra: Record<string, string> = {}) => ({
  headers: { [ACCESS_JWT_HEADER]: token, ...extra },
});

/** GET /api/me with the headers; the response and the session cookie it set, if any. */
async function me(headers: Record<string, string>) {
  const res = await h.app.request('/api/me', { headers });
  const jar = cookiesOf(res);
  const session = jar.get(sessionCookieName(h.auth.settings))?.value;
  const csrf = jar.get(CSRF_COOKIE)?.value;
  const cookie = session && csrf ? `${sessionCookieName(h.auth.settings)}=${encodeURIComponent(session)}; ${CSRF_COOKIE}=${csrf}` : null;
  return { res, cookie, csrf };
}

describe('Access JWT sign-in (verified against the fake certs endpoint)', () => {
  it('a valid JWT signs a new address in, creates the user and joins ACCESS_AUTO_TENANTS as editor', async () => {
    const email = 'new.person@gmail.com';
    const { res, cookie } = await me({ [ACCESS_JWT_HEADER]: await fake.sign(email) });
    expect(res.status).toBe(200);
    const body = MeResponse.parse(await res.json());
    expect(body.user.email).toBe(email);
    expect(body.memberships.map((m) => [m.tenantSlug, m.role])).toEqual([['aa', 'editor']]);
    // A cookie session like after a magic link: later requests need no JWT.
    expect(cookie).not.toBeNull();
    const again = await h.app.request('/api/me', { headers: { cookie: cookie! } });
    expect(again.status).toBe(200);
    // A tenant named in ACCESS_AUTO_TENANTS that does not exist is skipped with a warning.
    expect(h.lines.join('\n')).toMatch(/ACCESS_AUTO_TENANTS names a tenant that does not exist/);
  });

  it('a second request with the same JWT and its cookie keeps the session (no new cookie)', async () => {
    const token = await fake.sign('same.person@infosys.com');
    const first = await me({ [ACCESS_JWT_HEADER]: token });
    expect(first.cookie).not.toBeNull();
    const second = await me({ [ACCESS_JWT_HEADER]: token, cookie: first.cookie! });
    expect(second.res.status).toBe(200);
    expect(second.cookie).toBeNull();
  });

  it('an existing user with a membership signs in as themselves; no membership is added', async () => {
    const { res } = await me({ [ACCESS_JWT_HEADER]: await fake.sign(DEMO.email.toUpperCase()) });
    expect(res.status).toBe(200);
    const body = MeResponse.parse(await res.json());
    expect(body.user).toEqual(DEMO);
    expect(body.memberships.map((m) => [m.tenantSlug, m.role])).toEqual([[TENANT_A.slug, 'owner']]);
  });

  it('a JWT for another address replaces the cookie session (Access switched user)', async () => {
    const a = await me({ [ACCESS_JWT_HEADER]: await fake.sign('first@gmail.com') });
    const b = await me({ [ACCESS_JWT_HEADER]: await fake.sign('second@gmail.com'), cookie: a.cookie! });
    expect(b.res.status).toBe(200);
    expect(MeResponse.parse(await b.res.json()).user.email).toBe('second@gmail.com');
    expect(b.cookie).not.toBeNull();
    // The old session is gone (rotation at sign-in).
    expect((await h.app.request('/api/me', { headers: { cookie: a.cookie! } })).status).toBe(401);
  });

  it('the state-changing requests still need the CSRF token: a JWT on a POST opens no session', async () => {
    const token = await fake.sign('poster@gmail.com');
    const res = await h.app.request('/api/auth/logout', {
      method: 'POST',
      headers: { [ACCESS_JWT_HEADER]: token, origin: h.origin },
    });
    expect(cookiesOf(res).get(sessionCookieName(h.auth.settings))?.value ?? '').toBe('');
  });
});

describe('invalid or missing JWT falls back to the existing sign-in', () => {
  const cases: [string, () => Promise<string>][] = [
    ['wrong aud', () => fake.sign('x@gmail.com', { claims: { aud: ['someone-else'] } })],
    ['wrong iss', () => fake.sign('x@gmail.com', { claims: { iss: 'https://evil.cloudflareaccess.com' } })],
    ['expired', () => fake.sign('x@gmail.com', { expiresIn: -3_600 })],
    ['not yet valid (nbf)', () => fake.sign('x@gmail.com', { notBefore: 3_600 })],
    ['no exp', () => fake.sign('x@gmail.com', { claims: { exp: undefined } })],
    ['signed by a key the team does not publish', () => fake.sign('x@gmail.com', { foreignKey: true })],
    ['no email claim', () => fake.sign(undefined)],
    ['HS256 instead of RS256', async () =>
      new SignJWT({ email: 'x@gmail.com', iss: TEAM_ORIGIN, aud: [AUD] })
        .setProtectedHeader({ alg: 'HS256', kid: 'kid-current' })
        .setExpirationTime('1h')
        .sign(await generateSecret('HS256'))],
    ['unsigned (alg none)', async () => {
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      return `${b64({ alg: 'none', kid: 'kid-current' })}.${b64({ email: 'x@gmail.com', iss: TEAM_ORIGIN, aud: [AUD], exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
    }],
    ['garbage', async () => 'not-a-jwt'],
  ];

  it.each(cases)('%s: not signed in, no session cookie, the token is not logged', async (_name, make) => {
    const token = await make();
    const { res, cookie } = await me({ [ACCESS_JWT_HEADER]: token });
    expect(res.status).toBe(401);
    expect(cookie).toBeNull();
    expect(h.lines.join('\n')).not.toContain(token);
  });

  it('the existing magic-link sign-in still works next to an invalid JWT', async () => {
    const browser = await h.login(DEMO.email);
    const bad = await fake.sign(DEMO.email, { claims: { aud: ['someone-else'] } });
    const res = await h.app.request('/api/me', withJwt(bad, { cookie: browser.cookie }));
    expect(res.status).toBe(200);
    expect(MeResponse.parse(await res.json()).user).toEqual(DEMO);
  });

  it('never trusts the plain Cf-Access-Authenticated-User-Email header', async () => {
    const res = await h.app.request('/api/me', {
      headers: { 'cf-access-authenticated-user-email': DEMO.email },
    });
    expect(res.status).toBe(401);
  });

  it('logs no valid token either', async () => {
    const token = await fake.sign('logged@gmail.com');
    await me({ [ACCESS_JWT_HEADER]: token });
    expect(h.lines.join('\n')).not.toContain(token);
  });
});

describe('certs: derived from the team domain, fetched once and rate limited', () => {
  it('derives https://<team>/cdn-cgi/access/certs and the issuer from CF_ACCESS_TEAM_DOMAIN', () => {
    for (const v of [TEAM_DOMAIN, `https://${TEAM_DOMAIN}`, `https://${TEAM_DOMAIN.toUpperCase()}/`]) {
      const s = accessSettingsFrom(loadConfig({ DATABASE_URL: 'postgres://x@h/db', AUTH_SECRET: 'a'.repeat(20), CF_ACCESS_TEAM_DOMAIN: v, CF_ACCESS_AUD: AUD }));
      expect(s?.teamOrigin).toBe(TEAM_ORIGIN);
      expect(s?.certsUrl).toBe(`${TEAM_ORIGIN}/cdn-cgi/access/certs`);
    }
  });

  it('caches the keys: many sign-ins, one fetch; unknown key ids refetch at most once per cooldown', async () => {
    const local = await startFakeAccess();
    try {
      const now = new Date();
      const v = createAccessVerifier({ teamOrigin: TEAM_ORIGIN, aud: AUD, certsUrl: local.certsUrl }, () => now);
      for (let i = 0; i < 5; i++) await expect(v.verify(await local.sign(`u${i}@gmail.com`))).resolves.toBe(`u${i}@gmail.com`);
      expect(local.fetches()).toBe(1);
      // A flood of tokens naming an unknown key id: at most one more fetch in the cooldown window.
      for (let i = 0; i < 20; i++) await expect(v.verify(await local.sign('x@gmail.com', { kid: `forged-${i}` }))).rejects.toThrow();
      expect(local.fetches()).toBeLessThanOrEqual(2);
      expect(CERTS_COOLDOWN_MS).toBeGreaterThan(0);
    } finally {
      await local.close();
    }
  });
});

describe('ACCESS_ALLOWED_DOMAINS and ACCESS_AUTO_ROLE', () => {
  let fake2: FakeAccess;
  let h2: AuthHarness;
  beforeAll(async () => {
    fake2 = await startFakeAccess();
    h2 = await startAuthHarness({
      env: fake2.env({ ACCESS_ALLOWED_DOMAINS: 'gmail.com, Infosys.com', ACCESS_AUTO_ROLE: 'viewer' }),
      accessCertsUrl: fake2.certsUrl,
      seed: seedAa,
    });
  }, 120_000);
  afterAll(async () => {
    await h2?.close();
    await fake2?.close();
  });

  it('re-checks the domain after Access: gmail.com and infosys.com in, others out', async () => {
    const ok = await h2.app.request('/api/me', withJwt(await fake2.sign('someone@infosys.com')));
    expect(ok.status).toBe(200);
    expect(MeResponse.parse(await ok.json()).memberships.map((m) => [m.tenantSlug, m.role])).toEqual([['aa', 'viewer']]);
    const out = await h2.app.request('/api/me', withJwt(await fake2.sign('someone@example.org')));
    expect(out.status).toBe(401);
    const sub = await h2.app.request('/api/me', withJwt(await fake2.sign('someone@mail.gmail.com.evil.test')));
    expect(sub.status).toBe(401);
  });
});

describe('with CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD unset nothing changes', () => {
  let fake3: FakeAccess;
  let h3: AuthHarness;
  beforeAll(async () => {
    fake3 = await startFakeAccess();
    h3 = await startAuthHarness({ accessCertsUrl: fake3.certsUrl });
  }, 120_000);
  afterAll(async () => {
    await h3?.close();
    await fake3?.close();
  });

  it('a perfectly valid JWT is ignored: no session, no certs fetch, no Access middleware', async () => {
    expect(h3.auth.access).toBeNull();
    const res = await h3.app.request('/api/me', withJwt(await fake3.sign(DEMO.email)));
    expect(res.status).toBe(401);
    expect(fake3.fetches()).toBe(0);
  });

  it('one of the two without the other is a startup error naming the missing one', () => {
    const base = { DATABASE_URL: 'postgres://x@h/db', AUTH_SECRET: 'a'.repeat(20) };
    expect(() => loadConfig({ ...base, CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN })).toThrow(/missing environment variables: CF_ACCESS_AUD/);
    expect(() => loadConfig({ ...base, CF_ACCESS_AUD: AUD })).toThrow(/missing environment variables: CF_ACCESS_TEAM_DOMAIN/);
  });
});

describe('tenant ids', () => {
  it('derives the same tenant id as the seed (worker seedIds.tenant)', () => {
    for (const slug of ['aa', 'ua', 'as']) expect(tenantIdForSlug(slug)).toBe(seedIds.tenant(slug));
  });
});
