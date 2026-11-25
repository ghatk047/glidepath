import { z } from 'zod';
import { ChecklistStepId } from './onboarding/checklist';

/**
 * Why a fact, value or plan field needs a reviewer's attention (06 §2 Safety and trust; pipeline step 7 shows them):
 * - `unsourced`: a fact or seeded value without a source; its confidence is forced to `L`.
 * - `source_not_seen`: a fact cites a URL the model never searched, fetched or cited in this job; confidence `L`.
 * - `unknown_fact`: a seeded value names a fact id that is not in the fact base; the reference is dropped.
 * - `missing_value`: a variable of a drafted seed section got no value.
 * - `plan_mismatch`: the tenant record disagrees with the plan (years, currency).
 * - `incomplete_checklist`: an onboarding plan leaves out checklist steps.
 * - `calibration_miss`: a figure of the last reported year does not tie within tolerance, or has no reported value.
 * - `invariant_broken`: an invariant of 06 §4 fails on the draft (pool effects, VP nets, base vs IT revenue).
 * - `repair_dropped`: a calibration repair change was not applied (a variable or member key it may not change).
 * - `tuning_dropped`: a lever tuning change was left out of the tuning changeset (not a lever input, an unknown member
 *   key or scenario, a value outside the registry bounds).
 */
export const ReviewFlagKind = z.enum([
  'unsourced',
  'source_not_seen',
  'unknown_fact',
  'missing_value',
  'plan_mismatch',
  'incomplete_checklist',
  'calibration_miss',
  'invariant_broken',
  'repair_dropped',
  'tuning_dropped',
]);
export type ReviewFlagKind = z.infer<typeof ReviewFlagKind>;

export const ReviewFlag = z.strictObject({
  kind: ReviewFlagKind,
  /** The checklist step the flagged item belongs to, when it belongs to one. */
  step: ChecklistStepId.nullable(),
  /** What is flagged: a fact id, a variable id, `tenant`, or a plan field. Spec ids verbatim. */
  target: z.string().min(1),
  message: z.string().min(1),
});
export type ReviewFlag = z.infer<typeof ReviewFlag>;
