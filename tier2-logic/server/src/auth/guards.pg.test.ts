import { Problem, problemTypes } from '@glidepath/api-contract';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CSRF_COOKIE, CSRF_HEADER } from './cookies';
import { requireRole } from './guard';
import {
  ADVISOR,
  EDITOR,
  OWNER,
  PUBLIC_BASE_URL,
  VIEWER,
  startAuthHarness,
} from './testing/harness';
import type { AuthHarness, Browser } from './testing/harness';

let h: AuthHarness;
const b = new Map<string, Browser>();
/** Handler runs, by route: a refused request must never reach its handler. */
let ran: string[] = [];

beforeAll(async () => {
  h = await startAuthHarness({
    // Stand-ins for the real routes of later items, mounted on their contract paths behind the app's own guards.
    routes: (app) => {
      app.post('/api/t/:tenant/probe-write', (c) => {
        ran.push('changesets');
        return c.json({ ok: true, role: c.get('tenant').role });
      });
      app.patch('/api/t/:tenant/scenarios/:id', (c) => {
        ran.push('scenarioPatch');
        return c.json({ ok: true });
      });
      app.delete('/api/t/:tenant/solver-runs/:id', (c) => {
        ran.push('solverCancel');
        return c.json({ ok: true });
      });
      app.get('/api/t/:tenant/probe-read', (c) => {
        ran.push('probeRead');
        return c.json({ ok: true });
      });
      app.post('/api/t/:tenant/members-admin', requireRole('owner'), (c) => {
        ran.push('ownerOnly');
        return c.json({ ok: true });
      });
    },
  });
  for (const u of [OWNER, EDITOR, VIEWER, ADVISOR]) b.set(u.email, await h.login(u.email));
}, 120_000);

beforeEach(() => {
  ran = [];
});

afterAll(async () => {
  await h?.close();
});

const user = (email: string): Browser => {
  const x = b.get(email);
  if (!x) throw new Error(`not signed in: ${email}`);
  return x;
};

const send = (method: string, path: string, headers: Record<string, string>) =>
  h.app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? null : '{}',
  });

const expectForbidden = async (res: Response) => {
  expect(res.status).toBe(403);
  expect(Problem.parse(await res.json()).type).toBe(problemTypes.forbidden);
};

describe('role guard: viewer cannot POST changesets', () => {
  it('a viewer’s POST /changesets is 403 and never reaches the handler', async () => {
    await expectForbidden(
      await send('POST', '/api/t/ta/probe-write', h.headers(user(VIEWER.email))),
    );
    expect(ran).toEqual([]);
  });

  it('an advisor is read-only too', async () => {
    await expectForbidden(
      await send('POST', '/api/t/ta/probe-write', h.headers(user(ADVISOR.email))),
    );
    expect(ran).toEqual([]);
  });

  it('owner and editor may POST changesets', async () => {
    for (const [email, role] of [
      [OWNER.email, 'owner'],
      [EDITOR.email, 'editor'],
    ] as const) {
      const res = await send('POST', '/api/t/ta/probe-write', h.headers(user(email)));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, role });
    }
    expect(ran).toEqual(['changesets', 'changesets']);
  });

  it('deny by default: every state-changing tenant route needs a write role; reads stay open to viewers', async () => {
    await expectForbidden(
      await send('PATCH', '/api/t/ta/scenarios/s1', h.headers(user(VIEWER.email))),
    );
    await expectForbidden(
      await send('DELETE', '/api/t/ta/solver-runs/r1', h.headers(user(VIEWER.email))),
    );
    expect((await send('GET', '/api/t/ta/probe-read', h.headers(user(VIEWER.email)))).status).toBe(
      200,
    );
    expect(ran).toEqual(['probeRead']);
  });

  it('the role is per tenant: the editor of A is a viewer of B', async () => {
    await expectForbidden(
      await send('POST', '/api/t/tb/probe-write', h.headers(user(EDITOR.email))),
    );
    expect(ran).toEqual([]);
  });

  it('requireRole: an owner-only route refuses an editor', async () => {
    await expectForbidden(
      await send('POST', '/api/t/ta/members-admin', h.headers(user(EDITOR.email))),
    );
    expect(
      (await send('POST', '/api/t/ta/members-admin', h.headers(user(OWNER.email)))).status,
    ).toBe(200);
    expect(ran).toEqual(['ownerOnly']);
  });
});

describe('state-changing routes require same-origin + CSRF token', () => {
  const editor = () => user(EDITOR.email);
  const cookieAndToken = () => ({ cookie: editor().cookie, [CSRF_HEADER]: editor().csrf });

  it('refuses a request without Origin, from another origin, or from an opaque origin, even with a valid CSRF token', async () => {
    for (const origin of [
      undefined,
      'https://evil.example.test',
      'null',
      'http://glidepath.example.test',
      `${PUBLIC_BASE_URL}:8443`,
    ]) {
      const headers = { ...cookieAndToken(), ...(origin ? { origin } : {}) };
      await expectForbidden(await send('POST', '/api/t/ta/probe-write', headers));
    }
    await expectForbidden(
      await send('POST', '/api/t/ta/probe-write', {
        ...cookieAndToken(),
        'sec-fetch-site': 'cross-site',
      }),
    );
    expect(ran).toEqual([]);
  });

  it('without Origin, Sec-Fetch-Site: same-origin passes', async () => {
    expect(
      (
        await send('POST', '/api/t/ta/probe-write', {
          ...cookieAndToken(),
          'sec-fetch-site': 'same-origin',
        })
      ).status,
    ).toBe(200);
  });

  it('refuses a same-origin request whose CSRF token is missing, wrong or another session’s', async () => {
    const base = { origin: h.origin, cookie: editor().cookie };
    for (const token of [
      undefined,
      '',
      'x',
      `${editor().csrf}x`,
      user(OWNER.email).csrf,
      user(VIEWER.email).csrf,
    ]) {
      await expectForbidden(
        await send('POST', '/api/t/ta/probe-write', {
          ...base,
          ...(token !== undefined ? { [CSRF_HEADER]: token } : {}),
        }),
      );
    }
    expect(ran).toEqual([]);
  });

  it('the CSRF cookie alone is not enough: the token must come back in the header', async () => {
    await expectForbidden(
      await send('POST', '/api/t/ta/probe-write', { origin: h.origin, cookie: editor().cookie }),
    );
    expect(editor().cookie).toContain(`${CSRF_COOKIE}=`);
  });

  it('a same-origin request with the session’s token passes', async () => {
    expect((await send('POST', '/api/t/ta/probe-write', h.headers(editor()))).status).toBe(200);
    expect(ran).toEqual(['changesets']);
  });

  it('reads need neither', async () => {
    expect(
      (
        await h.app.request('/api/me', {
          headers: { cookie: editor().cookie, origin: 'https://evil.example.test' },
        })
      ).status,
    ).toBe(200);
    expect(
      (await h.app.request('/api/t/ta/probe-read', { headers: { cookie: editor().cookie } })).status,
    ).toBe(200);
  });

  it('logout is state-changing: it needs the CSRF token', async () => {
    const victim = await h.login(VIEWER.email);
    await expectForbidden(
      await h.app.request('/api/auth/logout', {
        method: 'POST',
        headers: { origin: h.origin, cookie: victim.cookie },
      }),
    );
    expect((await h.app.request('/api/me', { headers: { cookie: victim.cookie } })).status).toBe(
      200,
    );
  });

  it('a cross-site magic-link request is refused and sends no mail', async () => {
    const before = h.sink.countTo(OWNER.email);
    const res = await h.app.request('/api/auth/magic-link', {
      method: 'POST',
      headers: { origin: 'https://evil.example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ email: OWNER.email }),
    });
    await expectForbidden(res);
    await h.auth.idle();
    expect(h.sink.countTo(OWNER.email)).toBe(before);
  });

  it('a same-origin magic-link request needs no CSRF token before sign-in', async () => {
    expect((await h.requestLink(OWNER.email)).status).toBe(202);
  });
});
