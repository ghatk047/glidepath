import type { CSSProperties } from 'react';
import { ComputeFlow } from '@glidepath/ui/compute';
import { useJob } from './useJob';
import { JobsStyles } from './styles';

export interface JobHeaderProps {
  /** Job to show; `null` / `undefined` or a job tier 2 has not reported yet renders nothing. */
  id: string | null | undefined;
}

/** Words for the screen reader, announced only when the state changes (not on every tick). */
const STATE_WORD = { queued: 'Queued', running: 'Running', cancelling: 'Cancelling' } as const;

/**
 * Inline job progress for a panel header (02 §6 "Job running"): tier 2's note
 * ("Searching 1,634 combinations…"), a thin progress bar and a cancel link. Pass it as
 * `GlassPanel` `header.status`. It is plain inline content: nothing is inert, modal or covered,
 * so the rest of the screen stays usable while the job runs.
 *
 * A finished job renders nothing; a failed or cancelled one leaves a one-word end state.
 * Note and progress are shown exactly as tier 2 sent them.
 */
export function JobHeader({ id }: JobHeaderProps) {
  const job = useJob(id);

  if (job.status === 'failed' || job.status === 'cancelled') {
    const failed = job.status === 'failed';
    return (
      <>
        <JobsStyles />
        <span
          className="gp-job-end"
          data-tone={failed ? 'neg' : 'neutral'}
          data-status={job.status}
        >
          <span aria-hidden="true">{failed ? '✕' : '●'}</span>
          <span>{job.note ?? (failed ? 'Failed' : 'Cancelled')}</span>
        </span>
      </>
    );
  }
  if (!job.active) return null;

  const queued = job.status === 'queued';
  const text = job.note ?? (queued ? 'Queued…' : 'Working…');
  const state = job.cancelRequested ? 'cancelling' : queued ? 'queued' : 'running';
  const style = { '--gp-job-progress': job.progress } as CSSProperties;

  return (
    <>
      <JobsStyles />
      <span
        className="gp-job"
        data-status={job.status}
        data-cancelling={job.cancelRequested || undefined}
      >
        <span className="gp-job-sr">{STATE_WORD[state]}</span>
        <ComputeFlow active variant="inline" progress={job.progress ?? undefined} />
        <span className="gp-job-note" aria-live="off">
          {text}
        </span>
        <span
          className="gp-job-bar"
          role="progressbar"
          aria-label="Job progress"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={queued ? undefined : (job.progress ?? undefined)}
          aria-valuetext={text}
          data-indeterminate={queued || undefined}
          style={style}
        >
          <i />
        </span>
        {job.cancelRequested ? (
          <span className="gp-job-cancelling">Cancelling…</span>
        ) : job.canCancel ? (
          <button type="button" className="gp-job-cancel" onClick={() => void job.cancel()}>
            Cancel
          </button>
        ) : null}
        {job.cancelError && (
          <span className="gp-job-problem" role="alert">
            {job.cancelError}
          </span>
        )}
      </span>
    </>
  );
}
