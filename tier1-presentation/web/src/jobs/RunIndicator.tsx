import { ComputeFlow } from '@glidepath/ui/compute';
import { JobHeader } from './JobHeader';
import { JobsStyles } from './styles';

export interface RunIndicatorProps {
  /** A run was started (POST in flight or job active). */
  busy: boolean;
  /** Job id once tier 2 has sent one; `null` / `undefined` before the first `job` message. */
  jobId: string | null | undefined;
  /** Replaces the default "Starting…" before the first `job` message. */
  note?: string;
}

/**
 * Header indicator for a run's whole life: the `JobHeader` once a job exists, and until then
 * (request in flight, quick runs) the inline ComputeFlow with a short note. Pass it as
 * `GlassPanel` `header.status`.
 */
export function RunIndicator({ busy, jobId, note = 'Starting…' }: RunIndicatorProps) {
  if (jobId) return <JobHeader id={jobId} />;
  if (!busy) return null;
  return (
    <>
      <JobsStyles />
      <span className="gp-job-starting" data-testid="run-starting">
        <ComputeFlow active variant="inline" />
        <span>{note}</span>
      </span>
    </>
  );
}
