import { MeResponse, Problem, TenantsResponse, problemTypes } from '@glidepath/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADVISOR,
  EDITOR,
  MODEL_VERSION,
  NOBODY,
  OWNER,
  TENANT_A,
  TENANT_B,
  VIEWER,
  startAuthHarness,
} from './testing/harness';
import type { AuthHarness, Browser } from './testing/harness';

let h: AuthHarness;
const browsers = new Map<string, Browser>();

beforeAll(async () => {
  h = await startAuthHarness({
    routes: (app) =>
      app.get('/api/t/:tenant/whoami', (c) => {
        const t = c.get('tenant');
        return c.json({ slug: t.slug, tenantId: t.tenantId, role: t.role, userId: t.userId });
      }),
  });
  for (const u of [OWNER, EDITOR, VIEWER, ADVISOR, NOBODY])
    browsers.set(u.email, await h.login(u.email));
}, 120_000);

afterAll(async () => {
  await h?.close();
});

const as = (email: string) => ({ headers: { cookie: browsers.get(email)?.cookie ?? '' } });

const getMe = async (email: string) => {
  const res = await h.app.request('/api/me', as(email));
  expect(res.status).toBe(200);
  return MeResponse.parse(await res.json());
};

const getTenants = async (email: string) => {
  const res = await h.app.request('/api/tenants', as(email));
  expect(res.status).toBe(200);
  return TenantsResponse.parse(await res.json());
};

const membership = (t: { id: string; slug: string; name: string }, role: string) => ({
  tenantId: t.id,
  tenantSlug: t.slug,
  tenantName: t.name,
  role,
});

describe('/api/me returns user, memberships and roles owner/editor/viewer; /api/tenants lists only the user’s tenants', () => {
  it('GET /api/me: the signed-in user and each membership with its role (MeResponse)', async () => {
    expect(await getMe(OWNER.email)).toEqual({
      user: OWNER,
      memberships: [membership(TENANT_A, 'owner')],
    });
    expect(await getMe(EDITOR.email)).toEqual({
      user: EDITOR,
      memberships: [membership(TENANT_A, 'editor'), membership(TENANT_B, 'viewer')],
    });
    expect(await getMe(VIEWER.email)).toEqual({
      user: VIEWER,
      memberships: [membership(TENANT_A, 'viewer')],
    });
    expect(await getMe(ADVISOR.email)).toEqual({
      user: ADVISOR,
      memberships: [membership(TENANT_A, 'advisor')],
    });
    expect(await getMe(NOBODY.email)).toEqual({ user: NOBODY, memberships: [] });
  });

  it('GET /api/tenants: only the user’s tenants, with the role in each (TenantsResponse)', async () => {
    expect((await getTenants(OWNER.email)).tenants.map((t) => [t.slug, t.role])).toEqual([
      ['ta', 'owner'],
    ]);
    expect((await getTenants(VIEWER.email)).tenants.map((t) => [t.slug, t.role])).toEqual([
      ['ta', 'viewer'],
    ]);
    expect((await getTenants(NOBODY.email)).tenants).toEqual([]);
    expect((await getTenants(EDITOR.email)).tenants).toEqual([
      {
        id: TENANT_A.id,
        slug: 'ta',
        name: 'Tenant A',
        currency: 'USD',
        baseYear: 2026,
        targetYear: 2027,
        fiscalCalendar: 'calendar',
        ticker: null,
        status: 'active',
        modelVersionId: MODEL_VERSION,
        role: 'editor',
      },
      {
        id: TENANT_B.id,
        slug: 'tb',
        name: 'Tenant B',
        currency: 'EUR',
        baseYear: 2026,
        targetYear: 2027,
        fiscalCalendar: 'calendar',
        ticker: 'TB',
        status: 'setup',
        modelVersionId: MODEL_VERSION,
        role: 'viewer',
      },
    ]);
  });

  it('both are per-user answers that must not be cached', async () => {
    for (const path of ['/api/me', '/api/tenants']) {
      expect((await h.app.request(path, as(OWNER.email))).headers.get('cache-control')).toBe(
        'private, no-store',
      );
    }
  });

  it('both answer 401 problem without a valid session', async () => {
    for (const path of ['/api/me', '/api/tenants']) {
      for (const headers of [
        {},
        { cookie: '__Host-gp_session=garbage' },
        { cookie: 'gp_csrf=x' },
      ] as Record<string, string>[]) {
        const res = await h.app.request(path, { headers });
        expect(res.status).toBe(401);
        expect(Problem.parse(await res.json()).type).toBe(problemTypes.unauthenticated);
      }
    }
  });

  it('/api/t/:tenant/* resolves the caller’s role from tenant_membership; other tenants are 404', async () => {
    const who = async (email: string, slug: string) =>
      h.app.request(`/api/t/${slug}/whoami`, as(email));
    expect(await (await who(OWNER.email, 'ta')).json()).toEqual({
      slug: 'ta',
      tenantId: TENANT_A.id,
      role: 'owner',
      userId: OWNER.id,
    });
    expect(await (await who(EDITOR.email, 'tb')).json()).toMatchObject({
      slug: 'tb',
      role: 'viewer',
      userId: EDITOR.id,
    });
    for (const [email, slug] of [
      [OWNER.email, 'tb'],
      [NOBODY.email, 'ta'],
      [OWNER.email, 'zz'],
    ] as const) {
      const res = await who(email, slug);
      expect(res.status).toBe(404);
      expect(Problem.parse(await res.json()).type).toBe(problemTypes.notFound);
    }
    expect((await h.app.request('/api/t/ta/whoami')).status).toBe(401);
  });
});
