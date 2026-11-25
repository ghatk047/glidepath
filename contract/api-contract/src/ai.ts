import { z } from 'zod';
import {
  CellKey,
  ChangesetId,
  ClientRequestId,
  IsoDate,
  JobId,
  OneLine,
  SourceId,
  TenantId,
  TenantSlug,
  Timestamp,
  UserId,
} from './ids';
import { Problem, Violation } from './problem';
import { Confidence } from './core';
import { JobProgressFraction } from './ws';

/**
 * AI reconfiguration (CON-03, 06 §2): `POST /api/ai/reconfig` starts job `ai.reconfig`,
 * `GET /api/ai/reconfig/:id` shows plan, sources, draft changesets, calibration and open
 * questions, `POST /api/ai/reconfig/:id/apply` accepts drafts through `applyChangeset`
 * (origin `ai_reconfig`). Nothing is written before apply.
 */

/** Pipeline steps of 06 §2, in order. */
export const ReconfigStep = z.enum([
  'scope',
  'research',
  'seed_draft',
  'validate',
  'calibrate',
  'lever_tuning',
  'review',
  'apply',
]);
export type ReconfigStep = z.infer<typeof ReconfigStep>;

/**
 * `ai_reconfig_job.status` (free text in schema.json; these values are the contract's):
 * `estimated` = a dry run answered with plan and cost estimate, nothing queued.
 * `budget_exceeded` = the job stopped at `AI_MAX_TOKENS_PER_JOB` (06 §2 cost guard); what it had is kept.
 */
export const ReconfigStatus = z.enum([
  'estimated',
  'queued',
  'running',
  'review',
  'applied',
  'failed',
  'budget_exceeded',
  'cancelled',
]);
export type ReconfigStatus = z.infer<typeof ReconfigStatus>;

/** The two reviewable changesets: the tenant seed and the separate lever tuning (06 §2 steps 3, 6). */
export const DraftKind = z.enum(['seed', 'lever_tuning']);
export type DraftKind = z.infer<typeof DraftKind>;

/**
 * Start a job. `tenant`: an existing tenant to tune, or `null` to set up a new one.
 * `dryRun: true` runs step 1 (scope) only and answers `estimated` with the plan and the cost
 * estimate, so the user sees the cost before anything starts (06 §2 cost guard).
 */
export const ReconfigRequest = z.object({
  prompt: z.string().trim().min(1),
  tenant: TenantSlug.nullable(),
  dryRun: z.boolean().optional(),
});
export type ReconfigRequest = z.infer<typeof ReconfigRequest>;

export const ReconfigParams = z.object({ id: JobId });

/** Step 1 `ReconfigPlan`: identity, years and what the job will produce. */
export const ReconfigPlan = z.object({
  mode: z.enum(['new_tenant', 'existing_tenant']),
  tenant: z.object({
    name: z.string().min(1),
    slug: TenantSlug,
    /** IATA-code monogram (rule 9: no logos, livery or typefaces). */
    monogram: z.string().regex(/^[A-Z0-9]{2,3}$/),
    ticker: z.string().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  baseYear: z.number().int(),
  targetYear: z.number().int(),
  produce: z.array(DraftKind).min(1),
  steps: z.array(OneLine),
});
export type ReconfigPlan = z.infer<typeof ReconfigPlan>;

/**
 * A public research source (10-K, filings, press) cited by step 2. `url` is the public web
 * page the fact came from, shown as a citation; it is never a storage location.
 */
export const ReconfigSource = z.object({
  id: SourceId,
  title: z.string().min(1),
  publisher: z.string().nullable(),
  url: z.url({ protocol: /^https?$/ }),
  publishedAt: IsoDate.nullable(),
  retrievedAt: Timestamp,
});
export type ReconfigSource = z.infer<typeof ReconfigSource>;

/** Step 2 `FactBase` entry. A fact without a source has confidence `L` and is flagged. */
export const ReconfigFact = z.object({
  id: z.string().min(1),
  /** Onboarding checklist item it answers (07 §2). */
  item: z.string().min(1),
  label: z.string().min(1),
  value: z.union([z.number(), z.string()]),
  unit: z.string(),
  sourceId: SourceId.nullable(),
  asOf: IsoDate.nullable(),
  confidence: Confidence,
});
export type ReconfigFact = z.infer<typeof ReconfigFact>;

/** Before → after of a headline cell, as tier 2 previews a draft's impact. */
export const ImpactRow = z.object({
  cell: CellKey,
  before: z.number().nullable(),
  after: z.number(),
});
export type ImpactRow = z.infer<typeof ImpactRow>;

/** A draft changeset, summarised for review (step 7). */
export const DraftChangesetSummary = z.object({
  kind: DraftKind,
  title: OneLine,
  summary: OneLine,
  changes: z.number().int().nonnegative(),
  sections: z.array(
    z.object({ section: z.string().min(1), changes: z.number().int().nonnegative() }),
  ),
  warnings: z.array(Violation),
  impact: z.array(ImpactRow),
});
export type DraftChangesetSummary = z.infer<typeof DraftChangesetSummary>;

/** Step 5: the last reported fiscal year rebuilt by the engine against the 10-K. */
export const CalibrationReport = z.object({
  fiscalYear: z.number().int(),
  /** Allowed relative residual (a fraction), from tier 2's settings. */
  tolerance: z.number().nonnegative(),
  passed: z.boolean(),
  repairRounds: z.number().int().nonnegative(),
  lines: z.array(
    z.object({
      metric: OneLine,
      /** Engine cell compared, when there is one. */
      cell: CellKey.nullable(),
      reported: z.number(),
      model: z.number(),
      /** (model − reported) / reported, as tier 2 computed it. */
      residual: z.number(),
      ok: z.boolean(),
    }),
  ),
});
export type CalibrationReport = z.infer<typeof CalibrationReport>;

export const OpenQuestion = z.object({
  id: z.string().min(1),
  question: OneLine,
  context: z.string().nullable(),
  item: z.string().nullable(),
  /** true: apply is refused until it is answered. */
  blocking: z.boolean(),
});
export type OpenQuestion = z.infer<typeof OpenQuestion>;

/** Token and cost figures as tier 2 computes them. */
export const AiUsage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  usd: z.number().nonnegative(),
});
export type AiUsage = z.infer<typeof AiUsage>;

/** Shown before start: expected usage, the model and the per-job token budget. */
export const CostEstimate = AiUsage.extend({
  model: z.string().min(1),
  maxTokens: z.number().int().positive(),
});
export type CostEstimate = z.infer<typeof CostEstimate>;

/** One onboarding step (07 section 2) as the job stands: nothing yet, needs a reviewer, or settled. */
export const OnboardingState = z.enum(['done', 'review', 'todo']);
export type OnboardingState = z.infer<typeof OnboardingState>;

/**
 * The onboarding checklist of one job (07 section 2), as tier 2 judges it. `steps` follow the
 * job's plan, in checklist order, each with the id facts and open questions use in their `item`.
 * `review` = an open question, or a fact with no source or confidence `L`, is attached to the
 * step; `done` = it has facts and none of that (every step once the job is applied);
 * `todo` = nothing yet. `done` and `total` count the steps, so a screen prints "done of total"
 * without counting. Empty `steps` (`total` 0): the plan is not known yet, or it covers no
 * onboarding step (a lever-tuning job).
 */
export const OnboardingStatus = z.object({
  steps: z.array(z.object({ id: z.string().min(1), state: OnboardingState })),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type OnboardingStatus = z.infer<typeof OnboardingStatus>;

/** What `POST` and `GET /api/ai/reconfig/:id` answer. Sections fill in as steps complete. */
export const ReconfigJob = z.object({
  id: JobId,
  prompt: z.string().min(1),
  tenant: TenantSlug.nullable(),
  status: ReconfigStatus,
  step: ReconfigStep.nullable(),
  progress: JobProgressFraction,
  progressNote: OneLine.nullable(),
  plan: ReconfigPlan.nullable(),
  sources: z.array(ReconfigSource),
  facts: z.array(ReconfigFact),
  drafts: z.array(DraftChangesetSummary),
  validation: z.array(Violation),
  calibration: CalibrationReport.nullable(),
  openQuestions: z.array(OpenQuestion),
  /** Per-step onboarding state, judged by tier 2 (a screen never derives it from facts). */
  onboarding: OnboardingStatus,
  costEstimate: CostEstimate,
  usage: AiUsage.nullable(),
  error: Problem.nullable(),
  createdBy: UserId.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type ReconfigJob = z.infer<typeof ReconfigJob>;

/** Accept drafts: a new tenant needs `seed`; `lever_tuning` applies as its own changeset. */
export const ReconfigApplyRequest = z.object({
  drafts: z.array(DraftKind).min(1),
  clientRequestId: ClientRequestId.optional(),
});
export type ReconfigApplyRequest = z.infer<typeof ReconfigApplyRequest>;

export const ReconfigApplyResult = z.object({
  jobId: JobId,
  tenantId: TenantId,
  tenant: TenantSlug,
  applied: z.array(
    z.object({
      kind: DraftKind,
      changesetId: ChangesetId,
      editsCount: z.number().int().nonnegative(),
    }),
  ),
});
export type ReconfigApplyResult = z.infer<typeof ReconfigApplyResult>;

/**
 * The latest parity result tier 2 recorded for a tenant: `passed` of `total` checks of the parity
 * replay (docs/spec/reference/parity_report.json, the "parity 245/245" of the Airlines tile) matched
 * the engine. A tenant with no recorded result has no entry.
 */
export const TenantParity = z.object({
  tenant: TenantSlug,
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** When the result was recorded. */
  recordedAt: Timestamp,
});
export type TenantParity = z.infer<typeof TenantParity>;

/**
 * `GET /api/ai/reconfig`: the reconfiguration jobs of every tenant the caller belongs to, newest
 * first (the cached rehearsal included; dry-run estimates are left out), and the latest parity
 * of those tenants. A screen finds its job here without remembering an id.
 */
export const ReconfigList = z.object({
  jobs: z.array(ReconfigJob),
  parity: z.array(TenantParity),
});
export type ReconfigList = z.infer<typeof ReconfigList>;
