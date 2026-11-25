// @vitest-environment jsdom
import { createMemoryHistory, isNotFound } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { AppModule, type ApiClient } from '@glidepath/api-contract';
import { MODULE_IDS } from './modules';
import { createAppRouter, defaultAppServices } from './router';
import { parseViewSearch } from './search';

async function open(url: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  // A redirect or a canonical URL rewrite (dropping unknown params) re-enters load().
  for (let i = 0; i < 5; i++) {
    await router.load();
    if (router.state.matches.length) break;
  }
  return router;
}

const leaf = (router: Awaited<ReturnType<typeof open>>) => router.state.matches.at(-1)!;

describe('route parsing', () => {
  it('has exactly the 9 modules of the contract, in IA order', () => {
    expect(MODULE_IDS).toEqual(AppModule.options);
    expect(MODULE_IDS).toHaveLength(9);
  });

  it.each(MODULE_IDS)('parses /:tenant/:scenario/%s', async (module) => {
    const router = await open(`/ZZ/C/${module}`);
    const m = leaf(router);
    expect(m.routeId).toBe('/$tenant/$scenario/$module');
    expect(m.params).toEqual({ tenant: 'ZZ', scenario: 'C', module });
    expect(router.state.location.pathname).toBe(`/ZZ/C/${module}`);
  });

  it('parses the four search params lever, group, key, node verbatim', async () => {
    const router = await open('/ZZ/C/levers?lever=L10&group=pool&key=software&node=br.eps27');
    expect(leaf(router).search).toEqual({
      lever: 'L10',
      group: 'pool',
      key: 'software',
      node: 'br.eps27',
    });
  });

  it('keeps spec ids with dots, commas and digits as strings', async () => {
    const router = await open('/YY/pilots/baseline?key=pilots%2Cfy27&lever=10&node=res.net');
    expect(leaf(router).search).toEqual({ key: 'pilots,fy27', lever: '10', node: 'res.net' });
  });

  it('omits absent search params and drops unknown or empty ones', async () => {
    const router = await open('/ZZ/C/cockpit?foo=1&lever=&node=res.net');
    // `search` also carries the raw params; `_strictSearch` is what validateSearch returned.
    expect((leaf(router) as unknown as { _strictSearch: unknown })._strictSearch).toEqual({
      node: 'res.net',
    });
    expect(
      (leaf(await open('/ZZ/C/cockpit')) as unknown as { _strictSearch: unknown })._strictSearch,
    ).toEqual({});
  });

  it('round-trips search params when building a link', async () => {
    const router = await open('/ZZ/C/cockpit');
    const href = router.buildLocation({
      to: '/$tenant/$scenario/$module',
      params: { tenant: 'ZZ', scenario: 'D', module: 'path' },
      search: { node: 'res.net', group: 'vp' },
    }).href;
    expect(href).toBe('/ZZ/D/path?node=res.net&group=vp');
  });

  it('sends /:tenant/:scenario to the cockpit', async () => {
    const router = await open('/ZZ/C');
    expect(router.state.location.pathname).toBe('/ZZ/C/cockpit');
  });

  it('does not match an unknown module', async () => {
    const router = await open('/ZZ/C/nonsense');
    // The not-found boundary is the root, which renders the not-found screen.
    expect(router.state.matches.some((m) => isNotFound(m.error))).toBe(true);
  });

  it('parseViewSearch coerces scalars and ignores structures', () => {
    expect(parseViewSearch({ lever: 7, group: ['a'], key: { x: 1 }, node: true })).toEqual({
      lever: '7',
      node: 'true',
    });
    expect(parseViewSearch({})).toEqual({});
  });
});

describe('/ opens the viewer\'s tenant (WEB-12)', () => {
  const membership = { tenantId: 't1', tenantSlug: 'zz', tenantName: 'ZZ Air', role: 'editor' as const };
  const scenario = (id: string, archived = false) => ({ id, archived });

  async function home(client: Partial<ApiClient>) {
    const services = { ...defaultAppServices(), client: client as ApiClient };
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/'] }), services);
    for (let i = 0; i < 5; i++) {
      await router.load();
      if (router.state.status === 'idle' && router.state.matches.length) break;
    }
    return router;
  }

  it('redirects to the first membership, on the default scenario, Cockpit', async () => {
    const router = await home({
      me: async () => ({ user: {}, memberships: [membership, { ...membership, tenantSlug: 'yy' }] }) as never,
      scenarios: async () => ({ scenarios: [scenario('s-a'), scenario('s-c')], defaultScenarioId: 's-c' }) as never,
    });
    expect(router.state.location.pathname).toBe('/zz/s-c/cockpit');
  });

  it('without a default, takes the first scenario that is not archived', async () => {
    const router = await home({
      me: async () => ({ user: {}, memberships: [membership] }) as never,
      scenarios: async () =>
        ({ scenarios: [scenario('s-old', true), scenario('s-b')], defaultScenarioId: null }) as never,
    });
    expect(router.state.location.pathname).toBe('/zz/s-b/cockpit');
  });

  it.each([
    ['no-tenant', { me: async () => ({ user: {}, memberships: [] }) as never }],
    [
      'no-scenario',
      {
        me: async () => ({ user: {}, memberships: [membership] }) as never,
        scenarios: async () => ({ scenarios: [], defaultScenarioId: null }) as never,
      },
    ],
    ['unreachable', { me: async () => Promise.reject(new Error('offline')) }],
  ] as const)('stays on / and reports %s', async (state, client) => {
    const router = await home(client as Partial<ApiClient>);
    expect(router.state.location.pathname).toBe('/');
    expect(leaf(router).loaderData).toBe(state);
  });
});
