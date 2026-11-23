import { isIP } from 'node:net';
import net from 'node:net';
import { MeResponse, TenantsResponse } from '@glidepath/api-contract';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO, TENANT_A, startAuthHarness } from './testing/harness';
import type { AuthHarness } from './testing/harness';

let h: AuthHarness;

beforeAll(async () => {
  h = await startAuthHarness();
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await h?.close();
});

/** Where a `Socket#connect(...)` call goes: `host:port`, or the Unix socket path. */
function target(args: unknown[]): string {
  const a = Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
  const first = a[0];
  if (typeof first === 'object' && first !== null) {
    const o = first as { path?: string; host?: string; port?: number | string };
    return o.path ? `unix:${o.path}` : `${o.host ?? 'localhost'}:${String(o.port)}`;
  }
  if (typeof first === 'string' && Number.isNaN(Number(first))) return `unix:${first}`;
  return `${typeof a[1] === 'string' ? a[1] : 'localhost'}:${String(first)}`;
}

const isLocal = (t: string): boolean => {
  if (t.startsWith('unix:')) return true;
  const host = t.slice(0, t.lastIndexOf(':')).replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
};

describe('seeded demo user can log in with no internet (test with local SMTP sink)', () => {
  it('signs the demo user in through the local mail sink; every connection stays on this machine', async () => {
    const connects: string[] = [];
    const original = net.Socket.prototype.connect;
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (
      this: net.Socket,
      ...args: unknown[]
    ) {
      connects.push(target(args));
      return (original as (...a: unknown[]) => net.Socket).apply(this, args);
    });

    const browser = await h.login(DEMO.email);

    const meRes = await h.app.request('/api/me', { headers: { cookie: browser.cookie } });
    expect(meRes.status).toBe(200);
    expect(MeResponse.parse(await meRes.json())).toEqual({
      user: DEMO,
      memberships: [
        {
          tenantId: TENANT_A.id,
          tenantSlug: TENANT_A.slug,
          tenantName: TENANT_A.name,
          role: 'owner',
        },
      ],
    });
    const tenants = TenantsResponse.parse(
      await (await h.app.request('/api/tenants', { headers: { cookie: browser.cookie } })).json(),
    );
    expect(tenants.tenants.map((t) => [t.slug, t.role])).toEqual([[TENANT_A.slug, 'owner']]);
    // An owner may change the tenant: a state-changing request passes the guards (no route there yet: 404).
    const write = await h.app.request(`/api/t/${TENANT_A.slug}/changesets`, {
      method: 'POST',
      headers: h.headers(browser),
    });
    expect(write.status).toBe(404);

    vi.restoreAllMocks();
    expect(connects).toContain(`127.0.0.1:${h.sink.port}`);
    expect(connects.filter((t) => !isLocal(t))).toEqual([]);
  });
});
