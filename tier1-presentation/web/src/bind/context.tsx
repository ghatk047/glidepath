import { createContext, useContext, type ReactNode } from 'react';
import type { Change, ChangesetResult, ScenarioId, TenantSlug } from '@glidepath/api-contract';
import type { SessionClient } from '../session';

/**
 * Sends one change to tier 2 (`POST /changesets`). The default posts it at once through the
 * typed client; WEB-05 passes its commit queue (debounce, batching, 409 re-send) instead.
 */
export type CommitChange = (change: Change) => Promise<ChangesetResult>;

/** What the session client must offer the bindings. `createSessionClient()` satisfies it. */
export type BindSession = Pick<
  SessionClient,
  'store' | 'subscribe' | 'subscribeView' | 'preview' | 'settleCommit'
>;

export interface BindContextValue {
  readonly tenant: TenantSlug;
  /** Scenario on screen (the URL's); REST reads and commits use it. */
  readonly scenarioId: ScenarioId;
  /** The one session of the screen: cells and views come from its store. */
  readonly session: BindSession;
  /** Replaces the default direct `POST /changesets` (WEB-05 commit queue). */
  readonly commit?: CommitChange | undefined;
  /** Opens the trace drawer for a cell (`res.net[]`); bound outputs call it on click. */
  readonly onTrace?: ((cell: string) => void) | undefined;
}

const BindContext = createContext<BindContextValue | null>(null);

export interface BindProviderProps extends BindContextValue {
  children?: ReactNode;
}

/** Hands tenant, scenario and session to `useNode`, `useVariable`, `useView`, `useTrace`. */
export function BindProvider({ children, ...value }: BindProviderProps) {
  return <BindContext value={value}>{children}</BindContext>;
}

export function useBindContext(): BindContextValue {
  const ctx = useContext(BindContext);
  if (!ctx)
    throw new Error('bind hooks need a <BindProvider tenant scenarioId session> above them');
  return ctx;
}
