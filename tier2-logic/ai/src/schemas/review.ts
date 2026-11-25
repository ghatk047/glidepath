import { z } from 'zod';
import { ChecklistStepId } from '../onboarding/checklist';
import { ReviewFlag } from '../review';
import { CalibrationReport, DraftValidationEntry, ValidationReport } from './calibration';
import { Fact } from './facts';
import { LeverTuningDraft } from './lever-tuning';
import { Deliverable, ReconfigPlan } from './plan';

/**
 * Steps 7 and 8 (06 §2): the review payload tier 1 shows, and what `applyDraft` writes from it once the user accepts.
 * Plain JSON (the worker stores it on the job), so every part has a schema and is parsed again before apply.
 */

const Json: z.ZodType<unknown> = z.unknown();

/** A value change as `@glidepath/domain` `ValueChange` (target, key, member_key, op, new_value, note). */
export const DraftValueChange = z.strictObject({
  target: z.enum(['variable', 'override']),
  key: z.string().min(1),
  member_key: z.string(),
  op: z.enum(['set', 'unset']),
  new_value: z.number().nullable(),
  note: z.string().optional(),
});
export type DraftValueChange = z.infer<typeof DraftValueChange>;

/** A structural change as `@glidepath/domain` `StructuralChange`: a dimension_member or line_item row. */
export const DraftStructuralChange = z.strictObject({
  target: z.literal('structural'),
  key: z.string().min(1),
  member_key: z.string().min(1),
  op: z.enum(['insert', 'set', 'delete']),
  new_value: z.record(z.string(), Json).nullable(),
  note: z.string().optional(),
});
export type DraftStructuralChange = z.infer<typeof DraftStructuralChange>;

export const DraftChange = z.union([DraftValueChange, DraftStructuralChange]);
export type DraftChange = z.infer<typeof DraftChange>;

/**
 * The origins a reconfiguration writes with. Everything the AI drafted is `ai_reconfig` (bounds are rejected, as
 * step 4 checked them); what step 3 copied from the global presets unchanged is written as the seed loader writes
 * the same presets for every tenant (`seed`: locked presets in place, values past a registry bound kept as warnings).
 */
export const DraftOrigin = z.enum(['ai_reconfig', 'seed']);
export type DraftOrigin = z.infer<typeof DraftOrigin>;

/** One changeset of a draft: the changes to one scope. `scope` null is the tenant defaults, else a scenario key. */
export const ChangesetPart = z.strictObject({
  scope: z.string().min(1).nullable(),
  origin: DraftOrigin,
  changes: z.array(DraftChange).min(1),
});
export type ChangesetPart = z.infer<typeof ChangesetPart>;

/** A reviewable draft (06 §2 step 7: "the two changesets"): the seed or the lever tuning, as changesets per scope. */
export const ReconfigChangeset = z.strictObject({
  kind: Deliverable,
  parts: z.array(ChangesetPart),
});
export type ReconfigChangeset = z.infer<typeof ReconfigChangeset>;

/** What applying the seed creates besides changesets: the tenant row, its preset scenarios and line-lever links. */
export const TenantPlan = z.strictObject({
  /** `tenant.json` of the draft (id, name, currency, years, fiscal calendar, ticker). */
  record: z.record(z.string(), Json),
  /** The preset scenarios, in file order; created unlocked, filled, then locked. */
  presets: z.array(z.strictObject({ key: z.string().min(1), label: z.string().min(1) })),
  defaultScenario: z.string().min(1),
  /** line_item_lever rows (the changeset store has no write for them). */
  leverMappings: z.array(z.strictObject({ line_key: z.string().min(1), lever_code: z.string().min(1) })),
});
export type TenantPlan = z.infer<typeof TenantPlan>;

/** Before → after of one cell (`node[member]`); `before` null when the cell does not exist yet (a new tenant). */
export const ImpactRow = z.strictObject({
  cell: z.string().min(1),
  before: z.number().nullable(),
  after: z.number().nullable(),
});
export type ImpactRow = z.infer<typeof ImpactRow>;

/** The impact preview of one scope: the tenant defaults (null) or a scenario key. */
export const ImpactPreview = z.strictObject({
  scope: z.string().nullable(),
  rows: z.array(ImpactRow),
  /** Set when the state could not be evaluated. */
  error: z.string().nullable(),
});
export type ImpactPreview = z.infer<typeof ImpactPreview>;

/** One draft as the review shows it (contract `DraftChangesetSummary`, plus the changeset itself). */
export const DraftReview = z.strictObject({
  kind: Deliverable,
  title: z.string().min(1),
  summary: z.string().min(1),
  /** Number of changes over all parts. */
  changes: z.number().int().nonnegative(),
  /** Changes per checklist step. */
  sections: z.array(z.strictObject({ section: z.string().min(1), changes: z.number().int().nonnegative() })),
  /** Step 4 entries on the state with this draft applied that touch its cells. */
  warnings: z.array(DraftValidationEntry),
  impact: z.array(ImpactPreview),
  changeset: ReconfigChangeset,
  /** The lever tuning with its reasons, fact ids and confidence (lever_tuning only). */
  tuning: LeverTuningDraft.nullable(),
});
export type DraftReview = z.infer<typeof DraftReview>;

/** A public source of the job: every page the model searched, fetched or cited, and every fact URL. */
export const ReviewSource = z.strictObject({
  url: z.string().min(1),
  title: z.string().nullable(),
  /** Pipeline steps whose calls saw it, and `facts` when a fact cites it. */
  seenBy: z.array(z.string().min(1)),
  factIds: z.array(z.string()),
});
export type ReviewSource = z.infer<typeof ReviewSource>;

export const QuestionOrigin = z.enum(['plan', 'research', 'calibration', 'lever_tuning']);
export type QuestionOrigin = z.infer<typeof QuestionOrigin>;

/** contract `OpenQuestion`. Model questions never block apply; the reviewer reads them before accepting. */
export const ReviewQuestion = z.strictObject({
  id: z.string().min(1),
  question: z.string().min(1),
  origin: QuestionOrigin,
  item: ChecklistStepId.nullable(),
  blocking: z.boolean(),
});
export type ReviewQuestion = z.infer<typeof ReviewQuestion>;

export const ReviewUsage = z.strictObject({
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative(),
  cacheReadInputTokens: z.number().int().nonnegative(),
});
export type ReviewUsage = z.infer<typeof ReviewUsage>;

/**
 * Step 7 output: plan, sources, open questions, validation and calibration, and the two changesets with their impact
 * preview. `tenant` is set when the seed draft creates a tenant.
 */
export const ReconfigReview = z.strictObject({
  plan: ReconfigPlan,
  sources: z.array(ReviewSource),
  facts: z.array(Fact),
  openQuestions: z.array(ReviewQuestion),
  flags: z.array(ReviewFlag),
  validation: ValidationReport.nullable(),
  calibration: CalibrationReport.nullable(),
  tenant: TenantPlan.nullable(),
  drafts: z.strictObject({ seed: DraftReview.nullable(), lever_tuning: DraftReview.nullable() }),
  usage: ReviewUsage,
});
export type ReconfigReview = z.infer<typeof ReconfigReview>;
