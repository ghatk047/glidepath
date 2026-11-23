import { createContext, useContext, type ReactNode } from 'react';
import type { JobKind } from '@glidepath/api-contract';
import type { SessionClient } from '../session';

/**
 * Asks tier 2 to cancel one job (`DELETE`); resolves once tier 2 accepted the request.
 * Progress then keeps arriving as `job` messages (`cancelRequested`, then `status: cancelled`).
 */
export type CancelJob = (id: string, kind: JobKind) => Promise<unknown>;

export interface JobsContextValue {
  /** The one session of the screen: `job` messages are read from its store, no second socket. */
  readonly session: Pick<SessionClient, 'store'>;
  /** `undefined`: this app has no way to cancel (the cancel link is not shown). */
  readonly cancel?: CancelJob | undefined;
}

const JobsContext = createContext<JobsContextValue | null>(null);

export interface JobsProviderProps extends JobsContextValue {
  children?: ReactNode;
}

/** Hands the session client (and the cancel call) to `useJob` and `JobHeader` below it. */
export function JobsProvider({ session, cancel, children }: JobsProviderProps) {
  return <JobsContext value={{ session, cancel }}>{children}</JobsContext>;
}

export function useJobsContext(): JobsContextValue {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJob / JobHeader need a <JobsProvider session={…}> above them');
  return ctx;
}
