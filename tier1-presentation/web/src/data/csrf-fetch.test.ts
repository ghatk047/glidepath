// @vitest-environment jsdom
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PROBLEM_CONTENT_TYPE, apiRoutes } from '@glidepath/api-contract';
import { coreRouteFixtures } from '@glidepath/api-contract/testing';
import { createDataClient } from './client';
import { CSRF_COOKIE, CSRF_HEADER, readCsrfCookie, withCsrfHeader } from './csrf-fetch';

const BASE = 'http://tier2.test';
const TOKEN = 'csrf-token-for-this-session';
const fx = coreRouteFixtures;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  document.cookie = `${CSRF_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
});
afterAll(() => server.close());

/** Tier 2's guard: a state-changing call must echo the `gp_csrf` cookie in `x-csrf-token`. */
const csrfProblem = () =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Forbidden', status: 403, detail: 'CSRF token missing' },
    { status: 403, headers: { 'content-type': PROBLEM_CONTENT_TYPE } },
  );

describe('readCsrfCookie', () => {
  it('finds gp_csrf among other cookies and decodes it', () => {
    expect(readCsrfCookie(`a=1; ${CSRF_COOKIE}=ab%2Bc; b=2`)).toBe('ab+c');
    expect(readCsrfCookie(`${CSRF_COOKIE}=x`)).toBe('x');
  });
  it('is null without the cookie, with an empty one, or with a lookalike name', () => {
    expect(readCsrfCookie('')).toBeNull();
    expect(readCsrfCookie('a=1; b=2')).toBeNull();
    expect(readCsrfCookie(`${CSRF_COOKIE}=`)).toBeNull();
    expect(readCsrfCookie(`x${CSRF_COOKIE}=nope`)).toBeNull();
  });
});

describe('withCsrfHeader', () => {
  const seen: { method: string; headers: Record<string, string> }[] = [];
  const spy = (async (_url, init) => {
    seen.push({ method: init.method, headers: init.headers });
    return { status: 200, headers: { get: () => null }, text: () => Promise.resolve('{}') };
  }) as Parameters<typeof withCsrfHeader>[0];

  afterEach(() => (seen.length = 0));

  it.each(['POST', 'PATCH', 'DELETE'] as const)('adds the header on %s', async (method) => {
    await withCsrfHeader(spy, () => `${CSRF_COOKIE}=${TOKEN}`)('/api/x', { method, headers: {} });
    expect(seen[0]!.headers[CSRF_HEADER]).toBe(TOKEN);
  });

  it.each(['GET'] as const)('leaves %s alone', async (method) => {
    await withCsrfHeader(spy, () => `${CSRF_COOKIE}=${TOKEN}`)('/api/x', { method, headers: {} });
    expect(seen[0]!.headers).toEqual({});
  });

  it('adds nothing without a cookie, and keeps a caller-supplied header', async () => {
    await withCsrfHeader(spy, () => '')('/api/x', { method: 'POST', headers: {} });
    expect(seen[0]!.headers).toEqual({});
    await withCsrfHeader(spy, () => `${CSRF_COOKIE}=${TOKEN}`)('/api/x', {
      method: 'POST',
      headers: { 'X-CSRF-Token': 'own' },
    });
    expect(seen[1]!.headers).toEqual({ 'X-CSRF-Token': 'own' });
  });

  it('reads the cookie per request (sign-in changes it without a reload)', async () => {
    let cookie = '';
    const f = withCsrfHeader(spy, () => cookie);
    await f('/api/x', { method: 'POST', headers: {} });
    cookie = `${CSRF_COOKIE}=${TOKEN}`;
    await f('/api/x', { method: 'POST', headers: {} });
    expect(seen.map((s) => s.headers[CSRF_HEADER])).toEqual([undefined, TOKEN]);
  });
});

describe('createDataClient against a tier 2 that enforces CSRF (document.cookie, real fetch)', () => {
  function serve() {
    const headers: (string | null)[] = [];
    server.use(
      http.post(`${BASE}${apiRoutes.changesetApply.path}`, ({ request }) => {
        const sent = request.headers.get(CSRF_HEADER);
        headers.push(sent);
        if (sent !== TOKEN) return csrfProblem();
        return HttpResponse.json(fx.changesetApply.response);
      }),
      http.get(`${BASE}${apiRoutes.me.path}`, ({ request }) => {
        headers.push(request.headers.get(CSRF_HEADER));
        return HttpResponse.json(fx.me.response);
      }),
    );
    return headers;
  }

  it('sends x-csrf-token from the gp_csrf cookie on a commit', async () => {
    const sent = serve();
    document.cookie = `${CSRF_COOKIE}=${TOKEN}; path=/`;
    const api = createDataClient({ baseUrl: BASE });
    await expect(
      api.changesetApply({ params: fx.changesetApply.params, body: fx.changesetApply.body }),
    ).resolves.toBeTruthy();
    expect(sent).toEqual([TOKEN]);
  });

  it('is refused by tier 2 without the cookie (the guard the smoke hit)', async () => {
    serve();
    const api = createDataClient({ baseUrl: BASE });
    await expect(
      api.changesetApply({ params: fx.changesetApply.params, body: fx.changesetApply.body }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('does not send the header on reads', async () => {
    const sent = serve();
    document.cookie = `${CSRF_COOKIE}=${TOKEN}; path=/`;
    await createDataClient({ baseUrl: BASE }).me();
    expect(sent).toEqual([null]);
  });
});
