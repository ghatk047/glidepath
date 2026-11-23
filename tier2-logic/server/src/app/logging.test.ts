import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createLogger, REDACTED, secretsFrom } from './logger';
import { AUTH_SECRET, DB_PASSWORD, UNREACHABLE_URL, ana, aaId, aa, captureLogger, unreachableDb } from './testing/fixtures';
import { staticMemberships } from './tenant';

const COOKIE = 'gp_session=s%3Aabcdef0123456789.signaturevalue';
const secrets = secretsFrom({ AUTH_SECRET, DATABASE_URL: UNREACHABLE_URL });

function expectClean(text: string) {
  expect(text).not.toContain(AUTH_SECRET);
  expect(text).not.toContain(DB_PASSWORD);
  expect(text).not.toContain(UNREACHABLE_URL);
  expect(text).not.toContain('abcdef0123456789');
  expect(text).not.toContain('signaturevalue');
}

describe('JSON logs never contain AUTH_SECRET, DB passwords or cookies', () => {
  it('every line is JSON with level, time and msg', () => {
    const { logger, lines } = captureLogger(secrets);
    logger.info('hello', { a: 1 });
    expect(JSON.parse(lines[0] as string)).toMatchObject({ level: 'info', msg: 'hello', a: 1 });
    expect(typeof JSON.parse(lines[0] as string).time).toBe('string');
  });

  it('scrubs secret values in messages, fields, nested objects and errors', () => {
    const { logger, lines } = captureLogger(secrets);
    logger.error(`failed with ${AUTH_SECRET}`, {
      note: `url ${UNREACHABLE_URL}`,
      nested: { deeper: [`pw ${DB_PASSWORD}`] },
      err: new Error(`connect ECONNREFUSED ${UNREACHABLE_URL}`, { cause: new Error(`pw=${DB_PASSWORD}`) }),
    });
    expectClean(lines.join('\n'));
    expect(lines.join('\n')).toContain(REDACTED);
  });

  it('redacts sensitive keys (cookie, authorization, set-cookie, password, secret, token)', () => {
    const { logger, lines } = captureLogger(secrets);
    logger.info('headers', {
      headers: { Cookie: COOKIE, 'Set-Cookie': COOKIE, Authorization: 'Bearer abcdef0123456789', host: 'x' },
      AUTH_SECRET: 'whatever',
      dbPassword: 'whatever',
      sessionToken: 'whatever',
    });
    const line = JSON.parse(lines[0] as string);
    expect(line.headers.Cookie).toBe(REDACTED);
    expect(line.headers['Set-Cookie']).toBe(REDACTED);
    expect(line.headers.Authorization).toBe(REDACTED);
    expect(line.headers.host).toBe('x');
    expect(line.AUTH_SECRET).toBe(REDACTED);
    expect(line.dbPassword).toBe(REDACTED);
    expect(line.sessionToken).toBe(REDACTED);
  });

  it('scrubs a password inside any connection URL, even one that is not configured', () => {
    const lines: string[] = [];
    createLogger({ write: (l) => lines.push(l) }).warn('x postgres://user:hunter2hunter2@db:5432/app failed');
    expect(lines[0]).not.toContain('hunter2hunter2');
    expect(lines[0]).toContain(`postgres://user:${REDACTED}@db:5432/app`);
  });

  it('request logs and error logs from the app carry no cookie or secret', async () => {
    const { logger, lines } = captureLogger(secrets);
    const app = createApp({
      logger,
      db: unreachableDb(),
      authenticate: () => ana,
      membership: staticMemberships([{ userId: ana, tenantId: aaId, slug: aa, role: 'owner' }]),
      withTenant: (_t, _u, fn) => fn(undefined as never),
    });
    app.get('/api/t/:tenant/leak', () => {
      throw new Error(`boom ${AUTH_SECRET} ${UNREACHABLE_URL} cookie ${COOKIE}`);
    });
    const res = await app.request('/api/t/aa/leak?x=1', {
      headers: { cookie: COOKIE, authorization: `Bearer ${AUTH_SECRET}` },
    });
    expect(res.status).toBe(500);
    expectClean(await res.text());
    await app.request('/healthz', { headers: { cookie: COOKIE } });
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const l of lines) JSON.parse(l);
    expectClean(lines.join('\n'));
    expect(lines.some((l) => JSON.parse(l).msg === 'request')).toBe(true);
  });
});
