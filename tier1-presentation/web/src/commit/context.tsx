import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { ScenarioId, TenantSlug } from '@glidepath/api-contract';
import { viewStore as appViewStore, type ViewStore } from '../app/view-store';
import { invalidateForChangeset, useApiClient, useInputs, useServerState } from '../data';
import {
  createCommitQueue,
  type CommitClient,
  type CommitQueue,
  type CommitSession,
  type CommitState,
} from './queue';

const CommitContext = createContext<CommitQueue | null>(null);

export interface CommitProviderProps {
  tenant: TenantSlug;
  /** Scenario on screen (the URL's). */
  scenarioId: ScenarioId;
  /** The screen's session client: version, `settleCommit`, `changeset` messages. */
  session?: CommitSession | undefined;
  /** Tier 2 forked a preset (use `useForkNavigation()` to switch the URL). */
  onFork?: ((scenarioId: ScenarioId, forkedFrom: ScenarioId) => void) | undefined;
  /** Where the edits counter is reported (default: the app's view store). */
  viewStore?: ViewStore | undefined;
  /** Default `COMMIT_DEBOUNCE_MS`. */
  debounceMs?: number | undefined;
  /** Default: the `DataProvider`'s client. */
  client?: CommitClient | undefined;
  newRequestId?: (() => string) | undefined;
  children?: ReactNode;
}

/**
 * Mounts one commit queue for the screen (inside `DataProvider`). Pass `useCommit().commit` to
 * `BindProvider commit` so every bound edit goes through it. On a fork the scenario list and the
 * fork's data are refetched, so the scenario bar shows tier 2's `Custom (from X)` label.
 */
export function CommitProvider({
  tenant,
  scenarioId,
  session,
  onFork,
  viewStore = appViewStore,
  debounceMs,
  client,
  newRequestId,
  children,
}: CommitProviderProps) {
  const api = useApiClient();
  const serverState = useServerState();
  const inputs = useInputs(tenant, scenarioId);
  const latest = useRef({ onFork, inputs: inputs.data, scenarioId });
  latest.current = { onFork, inputs: inputs.data, scenarioId };

  const queue = useMemo(
    () =>
      createCommitQueue({
        tenant,
        scenarioId: latest.current.scenarioId,
        client: client ?? api,
        session,
        debounceMs,
        newRequestId,
        baseVersion: (id) => {
          const data = latest.current.inputs;
          return data && data.scenarioId === id ? data.version : undefined;
        },
        onFork: (id, from) => {
          void invalidateForChangeset(serverState, tenant, { scenarioId: id, forkedFrom: from });
          latest.current.onFork?.(id, from);
        },
      }),
    [tenant, client, api, session, debounceMs, newRequestId, serverState],
  );

  useEffect(() => queue.attach(), [queue]);
  useEffect(() => () => queue.dispose(), [queue]);
  useEffect(() => queue.setScenario(scenarioId), [queue, scenarioId]);
  useEffect(() => {
    const report = (s: CommitState) => {
      if (s.editsCount !== null) viewStore.getState().reportEdits(s.editsCount);
    };
    report(queue.store.getState());
    return queue.store.subscribe(report);
  }, [queue, viewStore]);

  return <CommitContext value={queue}>{children}</CommitContext>;
}

/** The screen's commit queue: `commit` (for `BindProvider`), `flush`, `undo`, `redo`, `store`. */
export function useCommit(): CommitQueue {
  const q = useContext(CommitContext);
  if (!q) throw new Error('useCommit needs a <CommitProvider tenant scenarioId> above it');
  return q;
}

/** Selects from the queue's state (edits count, warnings, error, canUndo, canRedo, ...). */
export function useCommitState<T>(selector: (s: CommitState) => T): T {
  return useStore(useCommit().store, selector);
}
