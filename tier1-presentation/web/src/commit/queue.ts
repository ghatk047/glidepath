import { createStore, type StoreApi } from 'zustand';
import {
  ApiError,
  ClientRequestId,
  isChangesetConflict,
  type ApiClient,
  type Change,
  type ChangesetId,
  type ChangesetResult,
  type Problem,
  type RevertResult,
  type ScenarioId,
  type TenantSlug,
  type Violation,
} from '@glidepath/api-contract';
import type { SessionClient } from '../session';

/**
 * Commit queue (WEB-05; 04 §4, 07 §3): release or typed entry → `POST /changesets`, debounced
 * and batched; a 409 re-sends the pending edits on the server's version; a fork answer moves the
 * queue (and, through `onFork`, the URL) to `Custom (from X)`; undo / redo call
 * `POST /changesets/:id/revert`. Nothing is computed here: version, edits count, warnings and the
 * fork are stored exactly as tier 2 answered them.
 */

/** Quiet time after the last edit before the batch is posted (04 §4: "debounced 400 ms"). */
export const COMMIT_DEBOUNCE_MS = 400;
/** 409 re-sends of one batch before the queue gives up and surfaces the conflict. */
export const MAX_CONFLICT_RESENDS = 3;

export type CommitClient = Pick<ApiClient, 'changesetApply' | 'changesetRevert'>;
/** The session parts the queue uses: the version it is on and `settleCommit` (cancelPreview). */
export type CommitSession = Pick<SessionClient, 'store' | 'settleCommit'>;

/** A failed commit, for the error chip: tier 2's one-line `detail` (and its problem) as sent. */
export interface CommitError {
  readonly detail: string;
  readonly status: number | null;
  readonly problem: Problem | null;
}

export interface CommitState {
  /** Scenario the queue commits to: the screen's, or the fork tier 2 moved it to. */
  readonly scenarioId: ScenarioId;
  /** Last version tier 2 reported for `scenarioId` (commit answer or session `changeset`). */
  readonly version: number | null;
  /** Edits counter as tier 2 last reported it; `null` until it reports one. */
  readonly editsCount: number | null;
  /** Rule warnings of the last commit, verbatim. */
  readonly warnings: readonly Violation[];
  /** The preset the current scenario was forked from by one of this queue's commits. */
  readonly forkedFrom: ScenarioId | null;
  /** Edits waiting for the debounce (one per cell). */
  readonly pending: number;
  /** A POST (or its 409 re-send) is on the wire. */
  readonly inFlight: boolean;
  readonly error: CommitError | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly lastResult: ChangesetResult | null;
}

export interface CommitQueueOptions {
  tenant: TenantSlug;
  scenarioId: ScenarioId;
  client: CommitClient;
  /** Session of the screen: its version is used as `baseVersion`, its `settleCommit` wraps POSTs. */
  session?: CommitSession | undefined;
  /** Version to use when neither the session nor a commit has reported one (resolved inputs). */
  baseVersion?: ((scenarioId: ScenarioId) => number | undefined) | undefined;
  debounceMs?: number | undefined;
  /** Idempotency key per request (default `crypto.randomUUID()`). */
  newRequestId?: (() => string) | undefined;
  /** Every applied answer (commit, undo, redo). */
  onResult?: ((result: ChangesetResult) => void) | undefined;
  /** Tier 2 forked a preset: switch the URL and the scenario bar to `scenarioId`. */
  onFork?:
    ((scenarioId: ScenarioId, forkedFrom: ScenarioId, result: ChangesetResult) => void) | undefined;
}

export interface CommitQueue {
  readonly store: StoreApi<CommitState>;
  /** Queue one change; resolves with the answer of the batch it went out in. */
  commit(change: Change): Promise<ChangesetResult>;
  /** Post the pending edits now; resolves once everything queued so far has settled. */
  flush(): Promise<void>;
  /** Revert the latest edit (or redo) of this session; `null` when there is none. */
  undo(): Promise<RevertResult | null>;
  /** Revert the latest undo; `null` when there is none. */
  redo(): Promise<RevertResult | null>;
  /** The screen moved to another scenario: pending edits go out on the old one first. */
  setScenario(scenarioId: ScenarioId): void;
  /** Follow session `changeset` messages for version and edits count; returns the detach. */
  attach(): () => void;
  clearError(): void;
  /** Posts what is pending (used on unmount); the queue stays usable. */
  dispose(): void;
}

const cellOf = (c: Change) => `${c.target}\u0000${c.key}\u0000${c.member}`;

const toError = (e: unknown): CommitError =>
  e instanceof ApiError
    ? { detail: e.problem.detail, status: e.status, problem: e.problem }
    : { detail: e instanceof Error ? e.message : String(e), status: null, problem: null };

/** A transport failure (no answer at all): the same request may be retried with the same id. */
const isNetworkFailure = (e: unknown) => e instanceof TypeError;

const defaultRequestId = () => globalThis.crypto.randomUUID();

interface Waiter {
  resolve: (r: ChangesetResult) => void;
  reject: (e: unknown) => void;
}

export function createCommitQueue(options: CommitQueueOptions): CommitQueue {
  const { tenant, client, session } = options;
  const debounceMs = options.debounceMs ?? COMMIT_DEBOUNCE_MS;
  const newRequestId = () => ClientRequestId.parse((options.newRequestId ?? defaultRequestId)());

  const store = createStore<CommitState>()(() => ({
    scenarioId: options.scenarioId,
    version: null,
    editsCount: null,
    warnings: [],
    forkedFrom: null,
    pending: 0,
    inFlight: false,
    error: null,
    canUndo: false,
    canRedo: false,
    lastResult: null,
  }));

  let pending = new Map<string, Change>();
  let waiters: Waiter[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Serialises POSTs so each one is sent on the version the previous one produced. */
  let chain: Promise<unknown> = Promise.resolve();
  let inFlight = 0;
  /** Presets this queue's commits forked, to the fork: a batch queued on the preset follows. */
  const forks = new Map<string, ScenarioId>();
  let undoStack: ChangesetId[] = [];
  let redoStack: ChangesetId[] = [];

  const follow = (id: ScenarioId): ScenarioId => {
    let at = id;
    for (let next = forks.get(at); next !== undefined && next !== at; next = forks.get(at))
      at = next;
    return at;
  };

  const stacks = () => ({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });

  /** The newest version anyone reported for `scenarioId` (versions only grow). */
  const baseVersionFor = (scenarioId: ScenarioId): number => {
    const seen: number[] = [];
    const s = store.getState();
    if (s.scenarioId === scenarioId && s.version !== null) seen.push(s.version);
    const live = session?.store.getState();
    if (live && live.scenarioId === scenarioId && live.version !== null) seen.push(live.version);
    if (seen.length === 0) {
      const fallback = options.baseVersion?.(scenarioId);
      if (fallback !== undefined) seen.push(fallback);
    }
    if (seen.length === 0) throw new Error(`no version of scenario ${scenarioId} yet`);
    return Math.max(...seen);
  };

  const settle = <T>(p: Promise<T>): Promise<T> => (session ? session.settleCommit(p) : p);

  /**
   * Sends with re-sends: 409 → new `baseVersion` and id (04 §4); no answer at all → once more with
   * the same id (`clientRequestId`, changeset POST only).
   */
  async function withResends<T>(
    send: (baseVersion: number, requestId: ClientRequestId) => Promise<T>,
    baseVersion: number,
    retryNetwork: boolean,
  ): Promise<T> {
    let base = baseVersion;
    let requestId = newRequestId();
    let conflicts = 0;
    let retried = false;
    for (;;) {
      try {
        return await send(base, requestId);
      } catch (e) {
        if (isChangesetConflict(e) && conflicts < MAX_CONFLICT_RESENDS) {
          conflicts += 1;
          base = e.problem.serverVersion;
          requestId = newRequestId();
          continue;
        }
        if (retryNetwork && isNetworkFailure(e) && !retried) {
          retried = true;
          continue;
        }
        throw e;
      }
    }
  }

  function applied(result: ChangesetResult) {
    const before = store.getState().scenarioId;
    const forked =
      result.forkedFrom !== undefined && result.scenarioId !== before ? result.forkedFrom : null;
    if (forked !== null) forks.set(forked, result.scenarioId);
    store.setState({
      scenarioId: result.scenarioId,
      version: result.version,
      editsCount: result.editsCount,
      warnings: result.warnings,
      lastResult: result,
      error: null,
      ...(forked !== null ? { forkedFrom: forked } : {}),
      ...stacks(),
    });
    options.onResult?.(result);
    if (forked !== null) options.onFork?.(result.scenarioId, forked, result);
  }

  /** Runs `job` after everything queued before it; failures are recorded and rethrown. */
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      inFlight += 1;
      store.setState({ inFlight: true });
      try {
        return await job();
      } catch (e) {
        store.setState({ error: toError(e) });
        throw e;
      } finally {
        inFlight -= 1;
        store.setState({ inFlight: inFlight > 0 });
      }
    });
    chain = run.catch(() => undefined);
    return run;
  }

  function sendBatch(target: ScenarioId, changes: Change[]): Promise<ChangesetResult> {
    return enqueue(async () => {
      const scenarioId = follow(target);
      const result = await settle(
        withResends(
          (baseVersion, clientRequestId) =>
            client.changesetApply({
              params: { tenant },
              body: { scenarioId, baseVersion, changes, clientRequestId },
            }),
          baseVersionFor(scenarioId),
          true,
        ),
      );
      undoStack.push(result.changesetId);
      redoStack = [];
      applied(result);
      return result;
    });
  }

  function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pending.size > 0) {
      const changes = [...pending.values()];
      const batch = waiters;
      pending = new Map();
      waiters = [];
      store.setState({ pending: 0 });
      sendBatch(store.getState().scenarioId, changes).then(
        (r) => batch.forEach((w) => w.resolve(r)),
        (e: unknown) => batch.forEach((w) => w.reject(e)),
      );
    }
    return chain.then(() => undefined);
  }

  function commit(change: Change): Promise<ChangesetResult> {
    return new Promise<ChangesetResult>((resolve, reject) => {
      const key = cellOf(change);
      pending.delete(key); // latest value wins, in the order of the last edit
      pending.set(key, change);
      waiters.push({ resolve, reject });
      store.setState({ pending: pending.size });
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void flush();
      }, debounceMs);
    });
  }

  async function revertTop(which: 'undo' | 'redo'): Promise<RevertResult | null> {
    await flush();
    return enqueue(async () => {
      const from = which === 'undo' ? undoStack : redoStack;
      const id = from.at(-1);
      if (id === undefined) return null;
      const scenarioId = store.getState().scenarioId;
      const result = await settle(
        withResends(
          // RevertRequest has no idempotency key, so a revert is never retried blind.
          (baseVersion) =>
            client.changesetRevert({ params: { tenant, id }, body: { baseVersion } }),
          baseVersionFor(scenarioId),
          false,
        ),
      );
      from.pop();
      (which === 'undo' ? redoStack : undoStack).push(result.changesetId);
      applied(result);
      return result;
    });
  }

  function setScenario(scenarioId: ScenarioId) {
    const s = store.getState();
    if (s.scenarioId === scenarioId) return;
    void flush(); // pending edits belong to the scenario they were made on
    void chain.then(() => {
      if (store.getState().scenarioId === scenarioId) return;
      undoStack = [];
      redoStack = [];
      forks.clear(); // the person chose a scenario: an edit of a preset forks it again (INT-04)
      store.setState({
        scenarioId,
        version: null,
        editsCount: null,
        warnings: [],
        forkedFrom: null,
        lastResult: null,
        ...stacks(),
      });
    });
  }

  function attach(): () => void {
    if (!session) return () => undefined;
    const sync = (live: ReturnType<CommitSession['store']['getState']>) => {
      const m = live.changeset;
      const s = store.getState();
      if (m === null || m.scenarioId !== s.scenarioId) return;
      if (s.version !== null && m.version < s.version) return; // older than a commit answer
      if (s.version === m.version && s.editsCount === m.editsCount) return;
      store.setState({ version: m.version, editsCount: m.editsCount });
    };
    sync(session.store.getState());
    return session.store.subscribe(sync);
  }

  return {
    store,
    commit,
    flush,
    undo: () => revertTop('undo'),
    redo: () => revertTop('redo'),
    setScenario,
    attach,
    clearError: () => store.setState({ error: null }),
    dispose: () => void flush(),
  };
}
