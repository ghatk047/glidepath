// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { apiRoutes } from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  presetSnapshot,
  specFixtures,
} from '@glidepath/api-contract/testing';
import { createDataClient, createServerState } from '../data';
import { createSessionClient } from '../session';
import { loadModule } from './modules';
import { createAppRouter } from './router';
import { viewStore } from './view-store';

/**
 * The real app tree (router -> DataProvider -> GlobalLayout -> module screen), the way `main.tsx`
 * builds it. The unit tests of each piece mount their own harness, which is how the unmounted
 * overlays and the missing tooltip went unnoticed (WEB-09, found by the E2E smoke).
 */

const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const tenant = specFixtures.tenant;
const presets = specFixtures.scenarios.scenarios;
const SCENARIO = presetSnapshot('C').scenarioId;
const bundle = specFixtures.bundle;
const tenantRow = { ...fx.tenants.response.tenants[0]!, slug: tenant };

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined; // jsdom: the router restores scroll
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  viewStore.getState().closePanel?.('commandPalette');
});
afterAll(() => server.close());

async function mount() {
  server.use(
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, () => HttpResponse.json({ tenants: [tenantRow] })),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(bundle)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () => HttpResponse.json({ scenarios: presets })),
    http.get(`${BASE}${apiRoutes.scenarioInputs.path}`, ({ params }) =>
      HttpResponse.json({
        scenarioId: String(params['id']),
        version: 0,
        inputs: [],
        overrides: [],
      }),
    ),
    http.get(`${BASE}${apiRoutes.scenarioCalc.path}`, ({ params }) =>
      HttpResponse.json({
        ...fx.scenarioCalc.response,
        scenarioId: String(params['id']),
        stale: false,
      }),
    ),
    http.get(`${BASE}${apiRoutes.changesetHistory.path}`, ({ params }) =>
      HttpResponse.json({ scenarioId: String(params['id']), changesets: [], nextCursor: null }),
    ),
    http.get(`${BASE}${apiRoutes.members.path}`, () => HttpResponse.json({ members: [] })),
    http.get(`${BASE}${apiRoutes.search.path}`, ({ request }) =>
      HttpResponse.json({ q: new URL(request.url).searchParams.get('q') ?? '', results: [] }),
    ),
  );
  const mock = createMockSession({ snapshots: presets.map((p) => presetSnapshot(p.key)) });
  const frames: (() => void)[] = [];
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [`/${tenant}/${SCENARIO}/levers`] }),
    {
      client: createDataClient({ baseUrl: BASE }),
      serverState: createServerState(),
      createSession: (t, s) =>
        createSessionClient({
          tenant: t,
          scenario: s,
          origin: 'ws://localhost:8080',
          connect: mock.connect,
          requestFrame: (cb) => void frames.push(cb),
          random: () => 0,
        }),
    },
  );
  await loadModule('levers');
  render(<RouterProvider router={router} />);
  const until = async (check: () => void) => {
    for (let i = 0; ; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
        await mock.flush();
      });
      act(() => {
        for (const cb of frames.splice(0)) cb();
      });
      try {
        check();
        return;
      } catch (e) {
        if (i > 60) throw e;
      }
    }
  };
  return { until };
}

describe('the app tree mounts the global overlays and the shared tooltip', () => {
  it('app_tree_cmdk_opens_the_palette', async () => {
    const t = await mount();
    await t.until(() =>
      expect(screen.getByRole('button', { name: /find any number/i })).toBeTruthy(),
    );
    expect(screen.queryByRole('dialog', { name: 'Find any number' })).toBeNull();

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    await t.until(() =>
      expect(screen.getByRole('dialog', { name: 'Find any number' })).toBeTruthy(),
    );

    // and the shell's own button opens the same one
    fireEvent.keyDown(document, { key: 'Escape' });
    await t.until(() =>
      expect(screen.queryByRole('dialog', { name: 'Find any number' })).toBeNull(),
    );
    fireEvent.click(screen.getByRole('button', { name: /find any number/i }));
    await t.until(() =>
      expect(screen.getByRole('dialog', { name: 'Find any number' })).toBeTruthy(),
    );
  });

  it('app_tree_mounts_exactly_one_tooltip', async () => {
    const t = await mount();
    await t.until(() =>
      expect(screen.getByRole('button', { name: /find any number/i })).toBeTruthy(),
    );
    expect(screen.getAllByRole('tooltip', { hidden: true })).toHaveLength(1);
  });
});
