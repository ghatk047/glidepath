import { useCallback, useState } from 'react';
import { useStore } from 'zustand';
import { ApiError, type JobKind, type JobStatus } from '@glidepath/api-contract';
import type { JobMessage } from '../session/state';
import { cancellableKinds } from './cancel';
import { useJobsContext } from './context';

export interface JobHandle {
  readonly id: string | null;
  /** The last `job` message tier 2 sent for `id`; `undefined` until one arrives. */
  readonly job: JobMessage | undefined;
  /** `null` until the first `job` message. */
  readonly status: JobStatus | null;
  /** Absent in the message means `solver` (CON-03). */
  readonly kind: JobKind;
  /** Fraction as tier 2 sent it, 0..1; `null` until the first message. */
  readonly progress: number | null;
  /** Tier 2's one-line note ("Searching 1,634 combinations…"); `null` when it sent none. */
  readonly note: string | null;
  /** `queued` or `running`. */
  readonly active: boolean;
  /** Tier 2 says a cancel was asked for, or our `DELETE` was accepted; the job has not stopped yet. */
  readonly cancelRequested: boolean;
  /** Active, cancellable kind, not already asked to stop, and the app can cancel. */
  readonly canCancel: boolean;
  /** One-line cause when the last cancel request failed; cleared by the next attempt. */
  readonly cancelError: string | null;
  /** Sends `DELETE`; never throws (a failure lands in `cancelError`). */
  cancel(): Promise<void>;
}

type Ask =
  { id: string; state: 'sending' | 'accepted' } | { id: string; state: 'failed'; detail: string };

const problemLine = (e: unknown): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : 'Cancel failed';

/**
 * One background job as tier 2 reports it. Values come from the `job` messages the session
 * client already stored (no second socket); `cancel()` calls the app's `CancelJob`
 * (`DELETE /solver-runs/:id`). Nothing is derived: status, progress and note are shown as sent.
 */
export function useJob(id: string | null | undefined): JobHandle {
  const { session, cancel: send } = useJobsContext();
  const job = useStore(session.store, (s) => (id ? s.jobs.get(id) : undefined));
  const [ask, setAsk] = useState<Ask | null>(null);
  const mine = ask && ask.id === id ? ask : null;

  const status = job?.status ?? null;
  const kind: JobKind = job?.kind ?? 'solver';
  const active = status === 'queued' || status === 'running';
  const cancelRequested =
    active &&
    (job?.cancelRequested === true || mine?.state === 'sending' || mine?.state === 'accepted');
  const canCancel =
    active && !cancelRequested && send !== undefined && cancellableKinds.includes(kind);

  const cancel = useCallback(async () => {
    if (!id || !send || !canCancel) return;
    setAsk({ id, state: 'sending' });
    try {
      await send(id, kind);
      setAsk({ id, state: 'accepted' });
    } catch (e) {
      setAsk({ id, state: 'failed', detail: problemLine(e) });
    }
  }, [id, send, canCancel, kind]);

  return {
    id: id ?? null,
    job,
    status,
    kind,
    progress: job?.progress ?? null,
    note: job?.note ?? null,
    active,
    cancelRequested,
    canCancel,
    cancelError: mine?.state === 'failed' ? mine.detail : null,
    cancel,
  };
}
