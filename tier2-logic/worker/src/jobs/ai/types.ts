import type { Deliverable, ReconfigPlan, ReconfigReview } from '@glidepath/ai';
import type { JobContext, JobPayload } from '../../runtime';

/** Queue names (JOB-01: `ai.*`). */
export const QUEUE_RECONFIG = 'ai.reconfig';
export const QUEUE_APPLY = 'ai.apply';

/**
 * `ai_reconfig_job.status` (free text in schema.json). The contract's `ReconfigStatus` names `estimated`, `queued`,
 * `running`, `review`, `applied`, `failed` and `cancelled`; `budget_exceeded` is this item's (the cost guard).
 */
export type JobStatus =
  | 'estimated'
  | 'queued'
  | 'running'
  | 'review'
  | 'applied'
  | 'failed'
  | 'cancelled'
  | 'budget_exceeded';

/** The contract's `ReconfigStep`, as far as steps 1 to 7 and the apply go. */
export type JobStep = 'scope' | 'research' | 'seed_draft' | 'validate' | 'calibrate' | 'lever_tuning' | 'review' | 'apply';

/** What the handlers use of the runtime's JobContext (tests pass a plain object). */
export type AiJobContext = Pick<JobContext, 'tenantId' | 'userId' | 'withTenant' | 'progress' | 'signal'>;

export interface ReconfigPayload extends JobPayload {
  /** `ai_reconfig_job.id`; the API route creates the row (status `queued`) so it can answer before the job runs. Default: a new uuid. */
  readonly jobId?: string;
  /** The prompt-bar text. Needed when the row does not exist yet; the row's own prompt wins. */
  readonly prompt?: string;
  /** Step 1 only: the plan and the cost estimate, status `estimated`, nothing else runs. */
  readonly dryRun?: boolean;
}

export interface ApplyPayload extends JobPayload {
  readonly jobId: string;
  readonly accept: readonly Deliverable[];
  readonly clientRequestId?: string;
}

/** Token and cost figures of a job (contract `AiUsage`, plus the call and cache counts). */
export interface JobUsage {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly usd: number;
}

/** Contract `CostEstimate`: shown before start. */
export interface JobCostEstimate {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly usd: number;
  readonly model: string;
  readonly maxTokens: number;
}

/** What `apply` did, kept on the job. */
export interface AppliedReconfig {
  readonly tenantId: string;
  readonly tenant: string;
  /** Contract `ReconfigApplyResult.applied`: one entry per accepted kind. */
  readonly applied: readonly { readonly kind: Deliverable; readonly changesetId: string; readonly editsCount: number }[];
  /** Every changeset written, in apply order (a seed is several: defaults, copied presets, one per preset). */
  readonly changesets: readonly {
    readonly kind: Deliverable;
    readonly scope: string | null;
    readonly changesetId: string;
    readonly origin: string;
    readonly editsCount: number;
  }[];
}

/**
 * What `ai_reconfig_job.plan` holds: the job's whole state, which the API reads for `GET /api/ai/reconfig/:id`.
 * `review` is the step 7 payload (plan, sources, facts, calibration, both drafts); it is null until the job
 * reaches review. Nothing in here is secret: the API key never enters a job row.
 */
export interface StoredReconfigJob {
  readonly format: 1;
  readonly step: JobStep | null;
  /** 0..1 */
  readonly progress: number;
  readonly note: string | null;
  readonly dryRun: boolean;
  /** Step 1's plan, as soon as it is known. */
  readonly plan: ReconfigPlan | null;
  /** Computed before the first model call. */
  readonly estimate: JobCostEstimate;
  readonly usage: JobUsage | null;
  readonly review: ReconfigReview | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly applied: AppliedReconfig | null;
  /** Set for a job imported from a rehearsal bundle (`migrate --ai-cache`). */
  readonly cache: {
    readonly bundleId: string;
    readonly rehearsedTenant: string;
    readonly rehearsedAt: string;
  } | null;
}

export class AiJobError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AiJobError';
  }
}
