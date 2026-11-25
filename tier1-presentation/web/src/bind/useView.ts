import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import type { ViewName, ViewParams, ViewPayload } from '@glidepath/api-contract';
import { selectView, viewKey } from '../session';
import { useBindContext } from './context';

/** One ADR-021 view-model as tier 2 pushed it. */
export interface BoundView<V extends ViewName> {
  readonly view: V;
  /** Tier 2's payload; `undefined` until the first `view` message. */
  readonly payload: ViewPayload<V> | undefined;
  /** Kept from before a drop: show dimmed. */
  readonly stale: boolean;
  /** No payload yet. */
  readonly isLoading: boolean;
}

/**
 * `useView(view, params)`: subscribes to a tier 2 view-model (ADR-021, e.g. `bridge`,
 * `baseline.groups {by}`) on mount, releases it on unmount, and re-renders when tier 2 pushes a
 * new payload. Params are compared by value, so an inline `{ by: 'pool' }` does not resubscribe.
 */
export function useView<V extends ViewName>(view: V, params: ViewParams<V>): BoundView<V> {
  const { session } = useBindContext();
  const key = viewKey(view, params);
  // The first params object of each distinct key is kept, so effects run once per key.
  const stableParams = useMemo(() => params, [key]);
  useEffect(() => session.subscribeView(view, stableParams), [session, view, stableParams]);
  const entry = useStore(session.store, selectView(view, stableParams));
  return {
    view,
    payload: entry?.payload,
    stale: entry?.stale ?? false,
    isLoading: entry === undefined,
  };
}
