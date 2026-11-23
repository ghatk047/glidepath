// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiError,
  PROBLEM_CONTENT_TYPE,
  ScenarioId,
  TenantSlug,
  apiRoutes,
  parseServerMessage,
  problemTypes,
} from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  presetSnapshot,
  serverMessageFixtures,
  specFixtures,
  type MockSocket,
} from '@glidepath/api-contract/testing';
import {
  DataProvider,
  STALE_TIME_MS,
  bindChangesetInvalidation,
  createDataClient,
  createServerState,
  dataKeys,
  useBundle,
  useCalc,
  useChangesetInvalidation,
  useHistory,
  useInputs,
  useMe,
  useMembers,
  useScenarios,
  useTenants,
  type ServerMessageSource,
} from './index';

const BASE = 'http://tier2.test';
const tenant = TenantSlug.parse(coreRouteFixtures.scenarioCalc.params.tenant);
const scenarioId = ScenarioId.parse(coreRouteFixtures.scenarioCalc.params.id);
const otherScenarioId = ScenarioId.parse('sc-other');

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

/** Bodies the fake tier 2 answers with: contract fixtures, plus the generated spec fixtures. */
const bodies = {
  me: coreRouteFixtures.me.response,
  tenants: coreRouteFixtures.tenants.response,
  bundle: specFixtures.bundle,
  members: specFixtures.members,
  scenarios: specFixtures.scenarios,
  scenarioInputs: coreRouteFixtures.scenarioInputs.response,
  scenarioCalc: coreRouteFixtures.scenarioCalc.response,
  changesetHistory: coreRouteFixtures.changesetHistory.response,
} as const;
type Served = keyof typeof bodies;

/** Serves every read route and counts requests per `route` or `route:<scenario id>`. */
function serveAll(): Map<string, number> {
  const hits = new Map<string, number>();
  const count = (key: string) => hits.set(key, (hits.get(key) ?? 0) + 1);
  for (const id of Object.keys(bodies) as Served[]) {
    const path = apiRoutes[id].path;
    server.use(
      http.get(`${BASE}${path}`, ({ params }) => {
        const scenario = params['id'];
        count(typeof scenario === 'string' ? `${id}:${scenario}` : id);
        return HttpResponse.json(bodies[id]);
      }),
    );
  }
  return hits;
}

function setup() {
  const serverState = createServerState();
  const client = createDataClient({ baseUrl: BASE });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataProvider client={client} serverState={serverState}>
      {children}
    </DataProvider>
  );
  return { serverState, wrapper };
}

const parsed = <Id extends Served>(id: Id) => apiRoutes[id].response.parse(bodies[id]);

describe('Data hooks for me, tenants, bundle (ETag), members, scenarios, inputs, calc, history with long stale times', () => {
  it('serves each hook the zod-parsed contract fixture', async () => {
    serveAll();
    const { wrapper } = setup();

    const me = renderHook(() => useMe(), { wrapper });
    const tenants = renderHook(() => useTenants(), { wrapper });
    const bundle = renderHook(() => useBundle(tenant), { wrapper });
    const members = renderHook(() => useMembers(tenant), { wrapper });
    const scenarios = renderHook(() => useScenarios(tenant), { wrapper });
    const inputs = renderHook(() => useInputs(tenant, scenarioId), { wrapper });
    const calc = renderHook(() => useCalc(tenant, scenarioId), { wrapper });
    const history = renderHook(() => useHistory(tenant, scenarioId), { wrapper });

    await waitFor(() => expect(history.result.current.isSuccess).toBe(true));
    await waitFor(() => {
      for (const q of [me, tenants, bundle, members, scenarios, inputs, calc]) {
        expect(q.result.current.isSuccess).toBe(true);
      }
    });

    expect(me.result.current.data).toEqual(parsed('me'));
    expect(tenants.result.current.data).toEqual(parsed('tenants'));
    expect(bundle.result.current.data).toEqual(parsed('bundle'));
    expect(members.result.current.data).toEqual(parsed('members'));
    expect(scenarios.result.current.data).toEqual(parsed('scenarios'));
    expect(inputs.result.current.data).toEqual(parsed('scenarioInputs'));
    expect(calc.result.current.data).toEqual(parsed('scenarioCalc'));
    expect(history.result.current.data?.pages).toEqual([parsed('changesetHistory')]);
  });

  it('keeps data fresh for long stale times: a remounted hook does not refetch', async () => {
    const hits = serveAll();
    const { wrapper, serverState } = setup();

    const first = renderHook(() => useScenarios(tenant), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => useScenarios(tenant), { wrapper });
    expect(second.result.current.isSuccess).toBe(true);
    expect(second.result.current.isStale).toBe(false);
    await act(() => Promise.resolve());
    expect(hits.get('scenarios')).toBe(1);

    for (const ms of Object.values(STALE_TIME_MS)) expect(ms).toBeGreaterThanOrEqual(10 * 60_000);
    expect(serverState.entry(dataKeys.scenarios(tenant))?.invalidated).toBe(false);
  });

  it('revalidates the bundle with its ETag and reuses the cached body on 304', async () => {
    const etag = '"bundle-v1"';
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${BASE}${apiRoutes.bundle.path}`, ({ request }) => {
        const inm = request.headers.get('if-none-match');
        seen.push(inm);
        return inm === etag
          ? new HttpResponse(null, { status: 304, headers: { etag } })
          : HttpResponse.json(bodies.bundle, { headers: { etag } });
      }),
    );
    const { wrapper } = setup();

    const { result } = renderHook(() => useBundle(tenant), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const firstData = result.current.data;
    expect(firstData).toEqual(parsed('bundle'));

    await act(async () => {
      await result.current.refetch();
    });

    expect(seen).toEqual([null, etag]);
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual(parsed('bundle'));
    // Same body parsed again: TanStack's structural sharing keeps the identical object.
    expect(result.current.data).toBe(firstData);
  });

  it('fetches the bundle in full again when the server sends a new ETag', async () => {
    let n = 0;
    server.use(
      http.get(`${BASE}${apiRoutes.bundle.path}`, () => {
        n += 1;
        return HttpResponse.json(
          { ...bodies.bundle, modelVersion: { id: `mv-${n}`, semver: `1.0.${n}` } },
          { headers: { etag: `"v${n}"` } },
        );
      }),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useBundle(tenant), { wrapper });
    await waitFor(() => expect(result.current.data?.modelVersion.semver).toBe('1.0.1'));
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.data?.modelVersion.semver).toBe('1.0.2'));
  });

  it('pages the history with nextCursor and the limit', async () => {
    const [first] = bodies.changesetHistory.changesets;
    const queries: string[] = [];
    server.use(
      http.get(`${BASE}${apiRoutes.changesetHistory.path}`, ({ request }) => {
        const url = new URL(request.url);
        queries.push(url.search);
        const cursor = url.searchParams.get('cursor');
        return HttpResponse.json({
          ...bodies.changesetHistory,
          changesets: [{ ...first, id: cursor ? 'cs-8' : 'cs-9' }],
          nextCursor: cursor ? null : 'c2',
        });
      }),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useHistory(tenant, scenarioId, { limit: 1 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(queries).toEqual(['?limit=1', '?cursor=c2&limit=1']);
    await waitFor(() =>
      expect(result.current.data?.pages.flatMap((p) => p.changesets.map((c) => c.id))).toEqual([
        'cs-9',
        'cs-8',
      ]),
    );
    expect(result.current.hasNextPage).toBe(false);
  });

  it('surfaces a problem answer as an ApiError without retrying it', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}${apiRoutes.scenarioCalc.path}`, () => {
        calls += 1;
        return HttpResponse.json(
          {
            type: problemTypes.notFound,
            title: 'Not found',
            status: 404,
            detail: 'No calc run for this scenario.',
          },
          { status: 404, headers: { 'content-type': PROBLEM_CONTENT_TYPE } },
        );
      }),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useCalc(tenant, scenarioId), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).problem.detail).toBe(
      'No calc run for this scenario.',
    );
    expect(calls).toBe(1);
  });
});

/** The mock `WS /ws/session`, seen as a `ServerMessageSource` (what the WEB-03 client will give). */
function sourceOf(socket: MockSocket): ServerMessageSource {
  return (listener) => {
    const onMessage = (e: { data: string }) => {
      const result = parseServerMessage(e.data);
      if (!result.ok) throw new Error(result.detail);
      listener(result.message);
    };
    socket.addEventListener('message', onMessage);
    return () => socket.removeEventListener('message', onMessage);
  };
}

async function openSession() {
  const session = createMockSession();
  const socket = session.connect(
    `ws://localhost/ws/session?tenant=${specFixtures.tenant}&scenario=${presetSnapshot().scenarioId}`,
  );
  await session.flush();
  return { session, socket };
}

const changeset = serverMessageFixtures.changeset;

function mountAll(wrapper: ({ children }: { children: ReactNode }) => ReactNode) {
  const mounts = [
    renderHook(() => useMe(), { wrapper }),
    renderHook(() => useTenants(), { wrapper }),
    renderHook(() => useBundle(tenant), { wrapper }),
    renderHook(() => useMembers(tenant), { wrapper }),
    renderHook(() => useScenarios(tenant), { wrapper }),
    renderHook(() => useInputs(tenant, ScenarioId.parse(changeset.scenarioId)), { wrapper }),
    renderHook(() => useCalc(tenant, ScenarioId.parse(changeset.scenarioId)), { wrapper }),
    renderHook(() => useHistory(tenant, ScenarioId.parse(changeset.scenarioId)), { wrapper }),
    renderHook(() => useCalc(tenant, otherScenarioId), { wrapper }),
  ];
  return waitFor(() => {
    for (const m of mounts) expect(m.result.current.isSuccess).toBe(true);
  });
}

describe('a `changeset` WS message invalidates scenarios, history and calc', () => {
  it('refetches scenarios, history and calc (and inputs) of the scenario, nothing else', async () => {
    const hits = serveAll();
    const { wrapper, serverState } = setup();
    const { session, socket } = await openSession();
    await mountAll(wrapper);
    const scenario = changeset.scenarioId;

    bindChangesetInvalidation(serverState, tenant, sourceOf(socket));
    act(() => session.emit(changeset));

    await waitFor(() => {
      expect(hits.get('scenarios')).toBe(2);
      expect(hits.get(`changesetHistory:${scenario}`)).toBe(2);
      expect(hits.get(`scenarioCalc:${scenario}`)).toBe(2);
      expect(hits.get(`scenarioInputs:${scenario}`)).toBe(2);
    });
    await session.flush();

    // Unrelated queries stay cached: definitions, members, identity, another scenario's calc.
    expect(hits.get('me')).toBe(1);
    expect(hits.get('tenants')).toBe(1);
    expect(hits.get('bundle')).toBe(1);
    expect(hits.get('members')).toBe(1);
    expect(hits.get(`scenarioCalc:${otherScenarioId}`)).toBe(1);
  });

  it('also refreshes the scenario a custom copy was forked from', async () => {
    const hits = serveAll();
    const { wrapper, serverState } = setup();
    const { session, socket } = await openSession();
    const forkedFrom = changeset.forkedFrom;
    expect(forkedFrom).toBeTruthy();
    const parent = renderHook(() => useCalc(tenant, ScenarioId.parse(forkedFrom)), { wrapper });
    await waitFor(() => expect(parent.result.current.isSuccess).toBe(true));

    bindChangesetInvalidation(serverState, tenant, sourceOf(socket));
    act(() => session.emit(changeset));

    await waitFor(() => expect(hits.get(`scenarioCalc:${forkedFrom}`)).toBe(2));
  });

  it('ignores other messages and stops after unbinding', async () => {
    const hits = serveAll();
    const { wrapper, serverState } = setup();
    const { session, socket } = await openSession();
    const scenarios = renderHook(() => useScenarios(tenant), { wrapper });
    await waitFor(() => expect(scenarios.result.current.isSuccess).toBe(true));

    const unbind = bindChangesetInvalidation(serverState, tenant, sourceOf(socket));
    act(() => session.emit(serverMessageFixtures.delta));
    act(() => session.emit(serverMessageFixtures.job));
    await session.flush();
    expect(hits.get('scenarios')).toBe(1);

    unbind();
    act(() => session.emit(changeset));
    await session.flush();
    expect(hits.get('scenarios')).toBe(1);
  });

  it('useChangesetInvalidation binds for the life of the component', async () => {
    const hits = serveAll();
    const { wrapper } = setup();
    const { session, socket } = await openSession();
    const source = sourceOf(socket);
    const view = renderHook(
      () => {
        useChangesetInvalidation(tenant, source);
        return useScenarios(tenant);
      },
      { wrapper },
    );
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));

    act(() => session.emit(changeset));
    await waitFor(() => expect(hits.get('scenarios')).toBe(2));

    view.unmount();
    act(() => session.emit(changeset));
    await session.flush();
    expect(hits.get('scenarios')).toBe(2);
  });
});
