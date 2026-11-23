// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useEffect, type ReactNode } from 'react';
import { createStore } from 'zustand';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ChangesetResult,
  ScenarioId,
  TenantSlug,
  apiRoutes,
  type Change,
  type ChangesetRequest,
} from '@glidepath/api-contract';
import {
  changesetConflictFixture,
  coreRouteFixtures,
  serverMessageFixtures,
  specFixtures,
} from '@glidepath/api-contract/testing';
import { ScenarioBar } from '@glidepath/ui/shell';
import { createViewStore } from '../app/view-store';
import { BindProvider, useBindContext } from '../bind';
import { DataProvider, createDataClient, createServerState, useScenarios } from '../data';
import { initialSessionState, type SessionState } from '../session/state';
import {
  COMMIT_DEBOUNCE_MS,
  CommitProvider,
  createCommitQueue,
  useCommit,
  useCommitState,
  useForkNavigation,
  type CommitSession,
} from './index';

const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const tenant = TenantSlug.parse(fx.scenarios.params.tenant);
const [presetC, customC] = fx.scenarios.response.scenarios;
const PRESET = ScenarioId.parse(presetC!.id);
const CUSTOM = ScenarioId.parse(customC!.id);
const applied = ChangesetResult.parse(fx.changesetApply.response); // forks PRESET → CUSTOM
const WARNINGS = serverMessageFixtures.warnings.violations;

// Spec ids verbatim; values from the fixtures, never typed in.
const TARGET = fx.changesetApply.body.changes[0]!;
const targetDef = specFixtures.bundle.variables.find((v) => v.id === TARGET.key)!;
const LEVER = 'lev.L10.shelf';
const leverD = specFixtures.snapshots.D!.cells[`${LEVER}[]`] as number;

const variable = (key: string, value: number | null): Change =>
  ({ target: 'variable', key, member: '', value }) as Change;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());

const problemJson = (body: object, status: number) =>
  HttpResponse.json(body, { status, headers: { 'content-type': 'application/problem+json' } });

interface Served {
  posts: ChangesetRequest[];
  reverts: { id: string; body: unknown }[];
  hits: Map<string, number>;
}

/** msw for tier 2: each POST answer comes from `answer(n)` (default: the fixture result). */
function serve(answer?: (n: number, body: ChangesetRequest) => Response): Served {
  const posts: ChangesetRequest[] = [];
  const reverts: { id: string; body: unknown }[] = [];
  const hits = new Map<string, number>();
  const count = (k: string) => hits.set(k, (hits.get(k) ?? 0) + 1);
  let next = 0;
  server.use(
    http.post(`${BASE}${apiRoutes.changesetApply.path}`, async ({ request }) => {
      const body = (await request.json()) as ChangesetRequest;
      posts.push(body);
      return answer ? answer(posts.length, body) : HttpResponse.json(fx.changesetApply.response);
    }),
    http.post(`${BASE}${apiRoutes.changesetRevert.path}`, async ({ request, params }) => {
      const id = String(params['id']);
      reverts.push({ id, body: await request.json() });
      next += 1;
      return HttpResponse.json({
        ...fx.changesetRevert.response,
        changesetId: `${fx.changesetRevert.response.changesetId}-${next}`,
        reverts: id,
      });
    }),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () => {
      count('scenarios');
      return HttpResponse.json(fx.scenarios.response);
    }),
    http.get(`${BASE}${apiRoutes.scenarioInputs.path}`, ({ params }) => {
      const id = String(params['id']);
      count(`inputs:${id}`);
      const s = fx.scenarios.response.scenarios.find((x) => x.id === id)!;
      return HttpResponse.json({
        ...fx.scenarioInputs.response,
        scenarioId: id,
        version: s.version,
      });
    }),
  );
  return { posts, reverts, hits };
}

/** A session double: the store the queue reads and a `settleCommit` spy. */
function fakeSession(scenarioId: string, version: number) {
  const store = createStore<SessionState>()(() => ({
    ...initialSessionState(),
    status: 'open',
    scenarioId,
    version,
  }));
  const settled: string[] = [];
  const settle = <T,>(p: Promise<T>): Promise<T> =>
    p.then(
      (v) => (settled.push('resolved'), v),
      (e: unknown) => {
        settled.push('rejected');
        throw e;
      },
    );
  const settleCommit = vi.fn(settle) as unknown as typeof settle & ReturnType<typeof vi.fn>;
  return { store, settleCommit, settled } satisfies CommitSession & { settled: string[] };
}

const client = () => createDataClient({ baseUrl: BASE });

function queue(session = fakeSession(PRESET, presetC!.version)) {
  let id = 0;
  const q = createCommitQueue({
    tenant,
    scenarioId: PRESET,
    client: client(),
    session,
    newRequestId: () => `req-${(id += 1)}`,
  });
  return { q, session };
}

describe('AC1: release or typed entry → POST /changesets debounced 400 ms and batched', () => {
  it('posts once, 400 ms after the last edit, one change per cell (latest wins) (fake timers)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = serve();
    const { q } = queue();

    const first = q.commit(variable(TARGET.key, targetDef.min)); // slider release
    await vi.advanceTimersByTimeAsync(COMMIT_DEBOUNCE_MS / 4);
    const second = q.commit(variable(TARGET.key, TARGET.value as number)); // typed entry, same cell
    await vi.advanceTimersByTimeAsync(COMMIT_DEBOUNCE_MS / 2);
    const third = q.commit(variable(LEVER, leverD));
    expect(q.store.getState().pending).toBe(2);

    await vi.advanceTimersByTimeAsync(COMMIT_DEBOUNCE_MS - 1);
    expect(t.posts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const results = await Promise.all([first, second, third]);

    expect(t.posts).toHaveLength(1);
    expect(t.posts[0]).toMatchObject({
      scenarioId: PRESET,
      baseVersion: presetC!.version,
      changes: [variable(TARGET.key, TARGET.value as number), variable(LEVER, leverD)],
    });
    expect(new Set(results.map((r) => r.changesetId))).toEqual(new Set([applied.changesetId]));
    expect(q.store.getState()).toMatchObject({ pending: 0, inFlight: false });

    // The next edit is a new batch on the version (and scenario) tier 2 answered.
    const fourth = q.commit(variable(LEVER, leverD));
    await vi.advanceTimersByTimeAsync(COMMIT_DEBOUNCE_MS);
    await fourth;
    expect(t.posts).toHaveLength(2);
    expect(t.posts[1]).toMatchObject({ scenarioId: CUSTOM, baseVersion: applied.version });
  });

  it('is what BindProvider commits through: bound edits in one tick become one POST', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = serve();
    const session = fakeSession(PRESET, presetC!.version);
    let bind: ReturnType<typeof useBindContext> | null = null;
    const Probe = () => {
      bind = useBindContext();
      return null;
    };
    const Bound = ({ children }: { children: ReactNode }) => {
      const { commit } = useCommit();
      return (
        <BindProvider
          tenant={tenant}
          scenarioId={PRESET}
          session={session as never}
          commit={commit}
        >
          {children}
        </BindProvider>
      );
    };
    render(
      <DataProvider client={client()} serverState={createServerState()}>
        <CommitProvider
          tenant={tenant}
          scenarioId={PRESET}
          session={session}
          viewStore={createViewStore({ theme: 'cruise', applyTheme: () => undefined })}
        >
          <Bound>
            <Probe />
          </Bound>
        </CommitProvider>
      </DataProvider>,
    );
    const a = bind!.commit!(variable(TARGET.key, TARGET.value as number));
    const b = bind!.commit!(variable(LEVER, leverD));
    await act(() => vi.advanceTimersByTimeAsync(COMMIT_DEBOUNCE_MS));
    await Promise.all([a, b]);
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0]!.changes).toHaveLength(2);
    // The whole POST is wrapped once, so cancelPreview follows it.
    expect(session.settleCommit).toHaveBeenCalledTimes(1);
  });
});

describe('AC2: 409 → pending edits re-sent on the server version', () => {
  it('re-sends the same changes on serverVersion with a new request id, inside one settleCommit', async () => {
    const t = serve((n) =>
      n === 1
        ? problemJson(changesetConflictFixture, 409)
        : HttpResponse.json(fx.changesetApply.response),
    );
    const { q, session } = queue();

    const done = q.commit(variable(TARGET.key, TARGET.value as number));
    await q.flush();
    const result = await done;

    expect(t.posts).toHaveLength(2);
    expect(t.posts[0]!.baseVersion).toBe(presetC!.version);
    expect(t.posts[1]!.baseVersion).toBe(changesetConflictFixture.serverVersion);
    expect(t.posts[1]!.changes).toEqual(t.posts[0]!.changes);
    expect(t.posts[1]!.scenarioId).toBe(t.posts[0]!.scenarioId);
    expect(t.posts[1]!.clientRequestId).not.toBe(t.posts[0]!.clientRequestId);
    expect(result.changesetId).toBe(applied.changesetId);
    expect(session.settleCommit).toHaveBeenCalledTimes(1);
    expect(session.settled).toEqual(['resolved']);
    expect(q.store.getState().error).toBeNull();
  });

  it('edits made while a POST is in flight wait for it and go out on its answer', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const t = serve();
    server.use(
      http.post(`${BASE}${apiRoutes.changesetApply.path}`, async ({ request }) => {
        const body = (await request.json()) as ChangesetRequest;
        t.posts.push(body);
        if (t.posts.length === 1) await gate;
        return HttpResponse.json(fx.changesetApply.response);
      }),
    );
    const { q } = queue();
    const a = q.commit(variable(TARGET.key, TARGET.value as number));
    void q.flush();
    await waitFor(() => expect(t.posts).toHaveLength(1));
    const b = q.commit(variable(LEVER, leverD));
    void q.flush();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.posts).toHaveLength(1); // serialised behind the first
    release();
    await Promise.all([a, b]);
    expect(t.posts[1]).toMatchObject({ scenarioId: CUSTOM, baseVersion: applied.version });
  });

  it('a conflict that keeps coming back is surfaced as the commit error', async () => {
    serve(() => problemJson(changesetConflictFixture, 409));
    const { q, session } = queue();
    const done = q.commit(variable(TARGET.key, TARGET.value as number));
    await q.flush();
    await expect(done).rejects.toThrow();
    expect(q.store.getState().error?.detail).toBe(changesetConflictFixture.detail);
    expect(session.settled).toEqual(['rejected']);
  });
});

describe('AC3: fork response switches URL and scenario bar to Custom (from X)', () => {
  it('moves the URL to the fork, keeps module and selection, and the bar shows tier 2 label', async () => {
    const t = serve();
    const serverState = createServerState();
    const session = fakeSession(PRESET, presetC!.version);
    let queueRef: ReturnType<typeof useCommit> | null = null;

    function Bar({ current }: { current: string }) {
      const list = useScenarios(tenant).data?.scenarios ?? [];
      return (
        <ScenarioBar
          scenarios={list
            .filter((s) => s.kind === 'preset')
            .map((s) => ({ id: s.id, letter: s.key, name: s.label }))}
          customs={list
            .filter((s) => s.kind !== 'preset')
            .map((s) => ({ id: s.id, name: s.label }))}
          current={current}
          onSelect={() => undefined}
        />
      );
    }
    function Grab() {
      const q = useCommit();
      useEffect(() => {
        queueRef = q;
      }, [q]);
      return null;
    }
    function Screen() {
      const { scenario } = moduleRoute.useParams();
      const onFork = useForkNavigation();
      return (
        <CommitProvider
          tenant={tenant}
          scenarioId={ScenarioId.parse(scenario)}
          session={session}
          onFork={onFork}
          viewStore={createViewStore({ theme: 'cruise', applyTheme: () => undefined })}
        >
          <Bar current={scenario} />
          <Grab />
        </CommitProvider>
      );
    }
    const rootRoute = createRootRoute({ component: Outlet });
    const moduleRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '$tenant/$scenario/$module',
      component: Screen,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([moduleRoute]),
      history: createMemoryHistory({ initialEntries: [`/${tenant}/${PRESET}/levers?lever=L10`] }),
    });
    render(
      <DataProvider client={client()} serverState={serverState}>
        <RouterProvider router={router as never} />
      </DataProvider>,
    );
    await waitFor(() => expect(queueRef).not.toBeNull());
    await waitFor(() => screen.getByRole('button', { name: new RegExp(presetC!.label) }));
    const scenarioHits = t.hits.get('scenarios') ?? 0;

    await act(async () => {
      const done = queueRef!.commit(variable(TARGET.key, TARGET.value as number));
      await queueRef!.flush();
      await done;
    });

    await waitFor(() => expect(router.state.location.pathname).toBe(`/${tenant}/${CUSTOM}/levers`));
    expect(router.state.location.search).toMatchObject({ lever: 'L10' });
    expect(t.hits.get('scenarios')).toBeGreaterThan(scenarioHits); // list refetched on fork
    // The overflow button shows the current custom scenario by tier 2's label.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: new RegExp(customC!.label.replace(/[()]/g, '\\$&')) }),
      ).toBeTruthy(),
    );
    expect(customC!.label).toBe('Custom (from Plan C)');
    expect(queueRef!.store.getState()).toMatchObject({ scenarioId: CUSTOM, forkedFrom: PRESET });

    // The next edit goes to the fork, not the preset again.
    await act(async () => {
      const done = queueRef!.commit(variable(LEVER, leverD));
      await queueRef!.flush();
      await done;
    });
    expect(t.posts.at(-1)!.scenarioId).toBe(CUSTOM);
  });
});

describe('AC4: edits counter and warnings as tier 2 reports them; undo/redo call revert', () => {
  it('shows edits count and warnings verbatim, follows session changesets, surfaces errors', async () => {
    const reported = { ...fx.changesetApply.response, warnings: WARNINGS };
    serve((n) =>
      n === 1
        ? HttpResponse.json(reported)
        : problemJson(
            {
              type: '/problems/rule',
              title: 'Rule violation',
              status: 422,
              detail: WARNINGS[0]!.message,
              violations: WARNINGS,
            },
            422,
          ),
    );
    const session = fakeSession(PRESET, presetC!.version);
    const views = createViewStore({ theme: 'cruise', applyTheme: () => undefined });
    let queueRef: ReturnType<typeof useCommit> | null = null;
    function Status() {
      queueRef = useCommit();
      const edits = useCommitState((s) => s.editsCount);
      const warnings = useCommitState((s) => s.warnings);
      const error = useCommitState((s) => s.error);
      return (
        <div>
          <output aria-label="edits">{edits ?? ''}</output>
          <ul aria-label="warnings">
            {warnings.map((w) => (
              <li key={w.rule}>{w.message}</li>
            ))}
          </ul>
          {error && <p role="alert">{error.detail}</p>}
        </div>
      );
    }
    render(
      <DataProvider client={client()} serverState={createServerState()}>
        <CommitProvider tenant={tenant} scenarioId={PRESET} session={session} viewStore={views}>
          <Status />
        </CommitProvider>
      </DataProvider>,
    );
    await act(async () => {
      const done = queueRef!.commit(variable(TARGET.key, TARGET.value as number));
      await queueRef!.flush();
      await done;
    });
    expect(screen.getByLabelText('edits').textContent).toBe(String(applied.editsCount));
    expect(views.getState().editsCount).toBe(applied.editsCount);
    expect(screen.getByLabelText('warnings').textContent).toBe(
      WARNINGS.map((w) => w.message).join(''),
    );
    expect(queueRef!.store.getState().warnings).toEqual(WARNINGS);

    // Another commit reaches this scenario over the session: its count is shown as sent.
    const other = {
      ...serverMessageFixtures.changeset,
      scenarioId: CUSTOM,
      version: applied.version + 1,
      editsCount: applied.editsCount + 1,
    };
    act(() =>
      session.store.setState({
        scenarioId: CUSTOM,
        version: other.version,
        changeset: other as never,
      }),
    );
    expect(screen.getByLabelText('edits').textContent).toBe(String(other.editsCount));
    expect(views.getState().editsCount).toBe(other.editsCount);

    // A refused commit is surfaced in tier 2's words (bound controls swallow the rejection).
    await act(async () => {
      const done = queueRef!.commit(variable(LEVER, leverD)).catch(() => undefined);
      await queueRef!.flush();
      await done;
    });
    expect(screen.getByRole('alert').textContent).toBe(WARNINGS[0]!.message);
  });

  it('undo reverts the latest edit, redo reverts that undo (POST /changesets/:id/revert)', async () => {
    const t = serve();
    const { q } = queue();
    expect(q.store.getState()).toMatchObject({ canUndo: false, canRedo: false });
    expect(await q.undo()).toBeNull();
    expect(t.reverts).toHaveLength(0);

    const done = q.commit(variable(TARGET.key, TARGET.value as number));
    await q.flush();
    await done;
    expect(q.store.getState()).toMatchObject({ canUndo: true, canRedo: false });

    const undone = await q.undo();
    expect(t.reverts[0]).toEqual({
      id: applied.changesetId,
      body: { baseVersion: applied.version },
    });
    expect(q.store.getState()).toMatchObject({
      canUndo: false,
      canRedo: true,
      editsCount: fx.changesetRevert.response.editsCount,
      version: fx.changesetRevert.response.version,
    });

    await q.redo();
    expect(t.reverts[1]).toEqual({
      id: undone!.changesetId,
      body: { baseVersion: fx.changesetRevert.response.version },
    });
    expect(q.store.getState()).toMatchObject({ canUndo: true, canRedo: false });

    // Undo first sends what is pending, then reverts that commit.
    const t2 = t.posts.length;
    const pendingEdit = q.commit(variable(LEVER, leverD));
    await q.undo();
    await pendingEdit;
    expect(t.posts).toHaveLength(t2 + 1);
    expect(t.reverts.at(-1)!.id).toBe(applied.changesetId);
  });
});
