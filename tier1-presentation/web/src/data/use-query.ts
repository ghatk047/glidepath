import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { hashKey, type QueryEntry, type QueryKey, type QueryStatus } from './server-state';
import { useServerState } from './provider';

/** What a data hook returns: tier 2's last answer plus the loading and error state around it. */
export interface QueryResult<T> {
  data: T | undefined;
  /** `ApiError` for a problem answer, `ContractError` for a body that broke the contract. */
  error: unknown;
  status: QueryStatus;
  /** No data yet. */
  isPending: boolean;
  /** No data yet and a request is out. */
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  /** A request is out (first load or refresh). */
  isFetching: boolean;
  /** Invalidated or past its stale time; shown, and being or about to be refetched. */
  isStale: boolean;
  /** Fetch again now. Resolves when the request settles; never rejects (see `error`). */
  refetch: () => Promise<void>;
}

export function resultOf<T>(
  entry: QueryEntry | undefined,
  refetch: () => Promise<void>,
): QueryResult<T> {
  const status: QueryStatus = entry?.status ?? 'pending';
  return {
    data: entry?.data as T | undefined,
    error: entry?.error ?? null,
    status,
    isPending: status === 'pending',
    isLoading: status === 'pending' && (entry?.fetching ?? true),
    isSuccess: status === 'success',
    isError: status === 'error',
    isFetching: entry?.fetching ?? true,
    isStale: entry?.invalidated ?? false,
    refetch,
  };
}

/**
 * Subscribes the component to the cache entry for `key` and keeps it loaded: fetches on mount
 * unless the entry is fresh, and again when it is invalidated while mounted.
 */
export function useQueryEntry<T>(
  key: QueryKey,
  fetcher: () => Promise<T>,
  staleTime: number,
): { result: QueryResult<T>; entry: QueryEntry<T> | undefined } {
  const serverState = useServerState();
  const keyHash = hashKey(key);
  const entry = useStore(serverState.store, (s) => s.entries[keyHash]) as QueryEntry<T> | undefined;

  // The key's hash identifies the query; the fetcher is read through a ref so a new closure
  // (same key) does not restart anything.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const stableKey = useMemo(() => JSON.parse(keyHash) as QueryKey, [keyHash]);
  const load = useCallback(() => fetcherRef.current(), []);
  const run = useCallback(
    (force: boolean) => serverState.fetch(stableKey, load, { staleTime, force }),
    [serverState, stableKey, load, staleTime],
  );

  useEffect(() => {
    const release = serverState.observe(stableKey, load, staleTime);
    void run(false);
    return release;
  }, [serverState, stableKey, load, staleTime, run]);

  const refetch = useCallback(() => run(true), [run]);
  return { result: resultOf<T>(entry, refetch), entry };
}

export const useServerQuery = <T>(
  key: QueryKey,
  fetcher: () => Promise<T>,
  staleTime: number,
): QueryResult<T> => useQueryEntry(key, fetcher, staleTime).result;
