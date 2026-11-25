import type { ObjectStore } from '@glidepath/data-access';

/** Who a job runs for: the tenant that holds the job row, and the user. */
export interface AiWho {
  readonly tenantId: string;
  readonly userId: string;
}

/** What `ai.apply` answers (the worker's `ApplyJobResult`, as far as the routes read it). */
export interface ApplyJobOutcome {
  readonly jobId: string;
  readonly tenantId: string;
  readonly tenant: string;
  readonly applied: readonly { readonly kind: string; readonly changesetId: string; readonly editsCount: number }[];
}

/**
 * The two AI jobs of the worker tier (AI-06: `ai.reconfig`, `ai.apply`), as the routes start them. The server never
 * imports the worker; the composition root wires pg-boss (`compose/ai-jobs.ts`) and tests wire the worker's `run*`
 * functions with a fake model client. The route creates the `ai_reconfig_job` row (status `queued`, committed)
 * before it calls either method.
 */
export interface AiJobs {
  /** Sends `ai.reconfig` and returns once it is queued; the job runs on its own (the client polls `GET`). */
  startReconfig(who: AiWho, job: { readonly jobId: string }): Promise<void>;
  /** Runs `ai.reconfig` with `dryRun` (step 1 only) and resolves when it has ended; a failed job rejects. */
  estimateReconfig(who: AiWho, job: { readonly jobId: string }): Promise<void>;
  /** Runs `ai.apply` and resolves with its result once the changesets are committed. */
  applyReconfig(
    who: AiWho,
    job: { readonly jobId: string; readonly accept: readonly string[]; readonly clientRequestId?: string },
  ): Promise<ApplyJobOutcome>;
}

export interface AiRoutesDeps {
  readonly jobs: AiJobs;
  /** The tenant's object store (ADR-025): `ai/<job-id>/` holds the request record and the job's own objects. */
  readonly objects: (who: AiWho) => ObjectStore;
  /** How long `POST reconfig` waits for the worker to store the cost estimate (ms). Default 5000. */
  readonly estimateWaitMs?: number;
  readonly newId?: () => string;
}
