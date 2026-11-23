import { Problem, problemTypes } from '@glidepath/api-contract';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app/app';
import { loadConfig } from '../app/config';
import { AUTH_SECRET, captureLogger } from '../app/testing/fixtures';
import { authFromConfig } from './auth';
import { deriveKeys, hashLinkToken } from './crypto';
import { INVALID_LINK_REDIRECT, SIGNED_IN_REDIRECT } from './routes';
import { MAX_LIVE_LINKS_PER_ADDRESS } from './service';
import {
  EDITOR,
  NOBODY,
  OWNER,
  PUBLIC_BASE_URL,
  appRoleUrl,
  cookiesOf,
  startAuthHarness,
} from './testing/harness';
import type { AuthHarness } from './testing/harness';

/** Not the default (15), so the test proves the value comes from AUTH_LINK_TTL_MIN. */
const TTL_MIN = 7;
const MS_PER_MIN = 60_000;
const keys = deriveKeys(AUTH_SECRET);
const hash = (token: string) => hashLinkToken(keys, token);
/** Every token this file saw: none may reach a log line. */
const seen: string[] = [];

let h: AuthHarness;

beforeAll(async () => {
  h = await startAuthHarness({ linkTtlMin: TTL_MIN });
}, 120_000);

afterEach(() => h.clock.set(null));

afterAll(async () => {
  await h?.close();
});

const mailLink = async (email: string) => {
  const r = await h.mailLink(email);
  seen.push(r.token);
  return r;
};

const unconsumedFor = async (email: string): Promise<number> =>
  Number(
    (
      await h.test.query(
        'select count(*) as n from auth_token where email = $1 and consumed_at is null',
        [email],
      )
    ).rows[0]?.n,
  );

describe('magic link sent via SMTP_URL (mailpit locally); token hashed in auth_token, single use, expiry from AUTH_LINK_TTL_MIN', () => {
  it('mails the link through SMTP_URL to the address; the link points at PUBLIC_BASE_URL', async () => {
    const res = await h.requestLink(OWNER.email);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'accepted' });

    const mail = await h.sink.waitFor(OWNER.email);
    expect(mail.to).toEqual([OWNER.email]);
    expect(mail.from).toBe('no-reply@glidepath.example.test');
    expect(mail.headers.subject).toBe('Your Glidepath sign-in link');
    expect(mail.text).toContain(`expires in ${TTL_MIN} minutes`);
    const link = new URL(/https:\/\/\S+/.exec(mail.text)?.[0] ?? '');
    expect(link.origin).toBe(PUBLIC_BASE_URL);
    expect(link.pathname).toBe('/api/auth/callback');
    expect(link.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    seen.push(link.searchParams.get('token') ?? '');
  });

  it('stores only a keyed hash of the token in auth_token, never the token', async () => {
    const { token } = await mailLink(OWNER.email);
    const rows = (
      await h.test.query<{ j: string; token_hash: string; user_id: string }>(
        'select row_to_json(t)::text as j, token_hash, user_id from auth_token t',
      )
    ).rows;
    const mine = rows.filter((r) => r.token_hash === hash(token));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.user_id).toBe(OWNER.id);
    expect(hash(token)).not.toBe(token);
    for (const r of rows) expect(r.j).not.toContain(token);
  });

  it('a link signs in once; the second use is refused', async () => {
    const { link } = await mailLink(OWNER.email);
    // A link checker's HEAD does not use the token up.
    const head = await h.app.request(`${link.pathname}${link.search}`, { method: 'HEAD' });
    expect(head.status).toBe(204);
    expect(head.headers.getSetCookie()).toEqual([]);

    const first = await h.follow(link);
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toBe(SIGNED_IN_REDIRECT);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.headers.get('referrer-policy')).toBe('no-referrer');
    expect(cookiesOf(first).size).toBe(2);

    const second = await h.follow(link);
    expect(second.status).toBe(303);
    expect(second.headers.get('location')).toBe(INVALID_LINK_REDIRECT);
    expect(second.headers.getSetCookie()).toEqual([]);
  });

  it('signing in voids the address’s other links', async () => {
    const a = await mailLink(OWNER.email);
    const b = await mailLink(OWNER.email);
    expect((await h.follow(b.link)).headers.get('location')).toBe(SIGNED_IN_REDIRECT);
    expect((await h.follow(a.link)).headers.get('location')).toBe(INVALID_LINK_REDIRECT);
    expect(await unconsumedFor(OWNER.email)).toBe(0);
  });

  it('expires AUTH_LINK_TTL_MIN minutes after it was issued', async () => {
    const t0 = new Date(Math.floor(Date.now() / 1000) * 1000);
    h.clock.set(t0);
    const a = await mailLink(OWNER.email);
    const row = (
      await h.test.query<{ expires_at: Date }>(
        'select expires_at from auth_token where token_hash = $1',
        [hash(a.token)],
      )
    ).rows[0];
    expect(new Date(row?.expires_at ?? 0).getTime() - t0.getTime()).toBe(TTL_MIN * MS_PER_MIN);

    h.clock.set(new Date(t0.getTime() + TTL_MIN * MS_PER_MIN));
    expect((await h.follow(a.link)).headers.get('location')).toBe(INVALID_LINK_REDIRECT);

    h.clock.set(t0);
    const b = await mailLink(OWNER.email);
    h.clock.set(new Date(t0.getTime() + TTL_MIN * MS_PER_MIN - 1_000));
    expect((await h.follow(b.link)).headers.get('location')).toBe(SIGNED_IN_REDIRECT);
  });

  it('a malformed or unknown token is refused without a cookie', async () => {
    for (const q of [
      '',
      '?token=',
      '?token=short',
      `?token=${'A'.repeat(43)}`,
      `?token=${'A'.repeat(42)}%27`,
    ]) {
      const res = await h.follow(`/api/auth/callback${q}`);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(INVALID_LINK_REDIRECT);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it('an address with no account gets the same 202, and no mail and no token', async () => {
    const stranger = 'stranger@example.test';
    const res = await h.requestLink(stranger);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'accepted' });
    await h.auth.idle();
    expect(h.sink.countTo(stranger)).toBe(0);
    expect(
      Number(
        (await h.test.query('select count(*) as n from auth_token where email = $1', [stranger]))
          .rows[0]?.n,
      ),
    ).toBe(0);
  });

  it('matches the address case-insensitively and mails the stored address', async () => {
    const before = h.sink.countTo(NOBODY.email);
    expect((await h.requestLink(NOBODY.email.toUpperCase())).status).toBe(202);
    const mail = await h.sink.waitFor(NOBODY.email, { after: before });
    expect(mail.to).toEqual([NOBODY.email]);
  });

  it(`keeps at most ${MAX_LIVE_LINKS_PER_ADDRESS} live links per address`, async () => {
    const before = h.sink.countTo(EDITOR.email);
    for (let i = 0; i <= MAX_LIVE_LINKS_PER_ADDRESS; i++)
      expect((await h.requestLink(EDITOR.email)).status).toBe(202);
    await h.auth.idle();
    expect(h.sink.countTo(EDITOR.email) - before).toBe(MAX_LIVE_LINKS_PER_ADDRESS);
    expect(await unconsumedFor(EDITOR.email)).toBe(MAX_LIVE_LINKS_PER_ADDRESS);
  });

  it('a failed delivery leaves no usable token and is logged without the link', async () => {
    expect(await unconsumedFor(OWNER.email)).toBe(0);
    h.sink.failNext();
    expect((await h.requestLink(OWNER.email)).status).toBe(202);
    await h.auth.idle();
    expect(await unconsumedFor(OWNER.email)).toBe(0);
    const line = h.lines
      .map((l) => JSON.parse(l) as { msg: string; level: string })
      .find((l) => l.msg === 'sign-in link not sent');
    expect(line?.level).toBe('error');
  });

  it('a malformed request is a problem: 422 for a bad address, 400 for bad JSON', async () => {
    const bad = await h.requestLink('not-an-address');
    expect(bad.status).toBe(422);
    expect(Problem.parse(await bad.json()).type).toBe(problemTypes.validation);
    const junk = await h.app.request('/api/auth/magic-link', {
      method: 'POST',
      headers: h.headers(undefined, { 'content-type': 'application/json' }),
      body: '{"email":',
    });
    expect(junk.status).toBe(400);
  });

  it('without SMTP_URL or PUBLIC_BASE_URL a link cannot be sent: 503 problem for every address', async () => {
    for (const env of [{ PUBLIC_BASE_URL }, { SMTP_URL: h.sink.url }]) {
      const config = loadConfig({ DATABASE_URL: appRoleUrl(h.test), AUTH_SECRET, ...env });
      const app = createApp({
        logger: captureLogger().logger,
        db: h.db,
        auth: authFromConfig(config, { db: h.db.db }),
      });
      for (const email of [OWNER.email, 'stranger@example.test']) {
        const res = await app.request('/api/auth/magic-link', {
          method: 'POST',
          headers: {
            origin: config.PUBLIC_BASE_URL ? PUBLIC_BASE_URL : 'http://localhost',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ email }),
        });
        expect(res.status).toBe(503);
        expect(Problem.parse(await res.json()).detail).toContain('SMTP_URL');
      }
    }
  });

  it('no token ever reaches a log line', () => {
    expect(seen.length).toBeGreaterThan(5);
    const log = h.lines.join('\n');
    for (const t of seen) expect(log).not.toContain(t);
  });
});
