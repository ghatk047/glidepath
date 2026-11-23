import { createStore, type StoreApi } from 'zustand';

/**
 * The server-state layer (ADR-026): a keyed cache of what tier 2 sent, with in-flight
 * de-duplication, loading / error state, stale times and invalidate-by-key. It only holds and
 * moves the values tier 2 returns; it never derives one. Built on `fetch` (through the typed
 * client the caller's fetcher uses) and zustand, so the hooks in `hooks.ts` do not depend on
 * which cache library is underneath.
 */

export type QueryKey = readonly (string | number | boolean | null | object)[];
export type QueryStatus = 'pending' | 'success' | 'error';

/** One cached query. Replaced, never mutated, so a selector can compare by reference. */
export interface QueryEntry<T = unknown> {
  readonly keyHash: string;
  readonly key: QueryKey;
  readonly data: T | undefined;
  /** The last fetch's failure; `data` keeps the last good value. Cleared by the next success. */
  readonly error: unknown;
  readonly status: QueryStatus;
  readonly fetching: boolean;
  /** An extra page is being fetched (`fetchMore`). */
  readonly fetchingMore: boolean;
  /** Clock reading of the last successful fetch, `null` before one. */
  readonly updatedAt: number | null;
  /** Invalidated after the last fetch started; the data is shown but not fresh. */
  readonly invalidated: boolean;
}

export interface ServerState {
  readonly store: StoreApi<{ entries: Readonly<Record<string, QueryEntry>> }>;
  /** The cached entry for `key`, if any. */
  entry<T>(key: QueryKey): QueryEntry<T> | undefined;
  /**
   * Fresh data wins: returns without a request while the entry is fresh (`staleTime`) and not
   * invalidated, unless `force`. One request per key at a time: a second call while one is in
   * flight shares it. Never rejects; failures land in the entry's `error`.
   */
  fetch<T>(key: QueryKey, fetcher: () => Promise<T>, options?: FetchOptions): Promise<void>;
  /** Appends a page: `next(current)` returns the next fetch, or `null` when there is none. */
  fetchMore<T>(
    key: QueryKey,
    next: (current: T) => (() => Promise<T>) | null,
    merge: (current: T, page: T) => T,
  ): Promise<void>;
  /**
   * Marks every entry whose key starts with `prefix` (all of it with `exact`) as stale and
   * refetches those that have a mounted hook now; the rest refetch when next used. Resolves once
   * those refetches settle.
   */
  invalidate(prefix: QueryKey, options?: { exact?: boolean }): Promise<void>;
  /** A hook is using `key` with this `fetcher`; returns the release. */
  observe(key: QueryKey, fetcher: () => Promise<unknown>, staleTime: number): () => void;
}

export interface FetchOptions {
  /** How long a successful fetch stays fresh, in ms (default 0: always refetch). */
  staleTime?: number;
  force?: boolean;
}

export interface ServerStateOptions {
  /** Clock in ms; default `Date.now`. Tests pass a fake. */
  now?: () => number;
}

export const hashKey = (key: QueryKey): string => JSON.stringify(key);

const startsWith = (key: QueryKey, prefix: QueryKey): boolean =>
  prefix.length <= key.length &&
  prefix.every((p, i) => JSON.stringify(p) === JSON.stringify(key[i]));

/** Keeps the old object when the new one is the same JSON, so unchanged data does not re-render. */
const share = <T>(old: T | undefined, next: T): T =>
  old !== undefined && JSON.stringify(old) === JSON.stringify(next) ? old : next;

interface Observed {
  fetcher: () => Promise<unknown>;
  staleTime: number;
  count: number;
}

export function createServerState(options: ServerStateOptions = {}): ServerState {
  const now = options.now ?? Date.now;
  const store = createStore<{ entries: Readonly<Record<string, QueryEntry>> }>(() => ({
    entries: {},
  }));
  const inflight = new Map<string, Promise<void>>();
  const observed = new Map<string, Observed>();
  /** Invalidation order: a fetch that started before an invalidation does not clear it. */
  let clock = 0;
  const invalidatedAt = new Map<string, number>();

  const blank = (key: QueryKey, keyHash: string): QueryEntry => ({
    keyHash,
    key,
    data: undefined,
    error: null,
    status: 'pending',
    fetching: false,
    fetchingMore: false,
    updatedAt: null,
    invalidated: false,
  });
  const patch = (key: QueryKey, change: Partial<QueryEntry>): void => {
    const keyHash = hashKey(key);
    store.setState((s) => ({
      entries: {
        ...s.entries,
        [keyHash]: { ...(s.entries[keyHash] ?? blank(key, keyHash)), ...change },
      },
    }));
  };
  const entry = <T>(key: QueryKey): QueryEntry<T> | undefined =>
    store.getState().entries[hashKey(key)] as QueryEntry<T> | undefined;

  const statusOf = (data: unknown, error: unknown): QueryStatus =>
    error ? 'error' : data === undefined ? 'pending' : 'success';

  const isFresh = (e: QueryEntry | undefined, staleTime: number): boolean =>
    e !== undefined &&
    e.updatedAt !== null &&
    !e.invalidated &&
    !e.error &&
    now() - e.updatedAt < staleTime;

  function fetchKey<T>(key: QueryKey, fetcher: () => Promise<T>, opts: FetchOptions = {}) {
    const hash = hashKey(key);
    const existing = inflight.get(hash);
    if (existing) return existing;
    if (!opts.force && isFresh(entry(key), opts.staleTime ?? 0)) return Promise.resolve();

    const started = ++clock;
    patch(key, { fetching: true });
    const run = (async () => {
      try {
        const next = await fetcher();
        const old = entry<T>(key)?.data;
        patch(key, {
          data: share(old, next),
          error: null,
          status: 'success',
          fetching: false,
          updatedAt: now(),
          invalidated: (invalidatedAt.get(hash) ?? 0) > started,
        });
      } catch (error) {
        patch(key, {
          error,
          status: 'error',
          fetching: false,
          invalidated: (invalidatedAt.get(hash) ?? 0) > started,
        });
      } finally {
        inflight.delete(hash);
      }
      // Invalidated while this request was in flight: its answer may predate the change.
      const o = observed.get(hash);
      if (o && o.count > 0 && entry(key)?.invalidated && !entry(key)?.error) {
        await fetchKey(key, o.fetcher, { staleTime: o.staleTime });
      }
    })();
    inflight.set(hash, run);
    return run;
  }

  return {
    store,
    entry,
    fetch: fetchKey,

    async fetchMore<T>(
      key: QueryKey,
      next: (current: T) => (() => Promise<T>) | null,
      merge: (current: T, page: T) => T,
    ) {
      const hash = `${hashKey(key)}#more`;
      const current = entry<T>(key);
      if (inflight.has(hash) || current?.data === undefined || current.fetching) return;
      const fetchPage = next(current.data);
      if (!fetchPage) return;
      const base = current.updatedAt;
      const run = (async () => {
        patch(key, { fetchingMore: true });
        try {
          const page = await fetchPage();
          const latest = entry<T>(key);
          // A refetch replaced the pages meanwhile: this page belongs to the old list.
          if (latest?.data !== undefined && latest.updatedAt === base) {
            patch(key, { data: merge(latest.data, page), error: null, status: 'success' });
          }
        } catch (error) {
          patch(key, { error, status: statusOf(current.data, error) });
        } finally {
          patch(key, { fetchingMore: false });
          inflight.delete(hash);
        }
      })();
      inflight.set(hash, run);
      await run;
    },

    async invalidate(prefix, opts = {}) {
      const at = ++clock;
      const refetches: Promise<void>[] = [];
      for (const [hash, e] of Object.entries(store.getState().entries)) {
        const hit = opts.exact ? hashKey(e.key) === hashKey(prefix) : startsWith(e.key, prefix);
        if (!hit) continue;
        invalidatedAt.set(hash, at);
        patch(e.key, { invalidated: true });
        const o = observed.get(hash);
        // A request already in flight started before this call; it re-runs when it ends.
        if (o && o.count > 0 && !inflight.has(hash)) {
          refetches.push(fetchKey(e.key, o.fetcher, { staleTime: o.staleTime }));
        } else if (inflight.has(hash)) {
          const running = inflight.get(hash);
          if (running) refetches.push(running);
        }
      }
      await Promise.all(refetches);
    },

    observe(key, fetcher, staleTime) {
      const hash = hashKey(key);
      const o = observed.get(hash) ?? { fetcher, staleTime, count: 0 };
      o.fetcher = fetcher;
      o.staleTime = staleTime;
      o.count += 1;
      observed.set(hash, o);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        o.count -= 1;
      };
    },
  };
}
