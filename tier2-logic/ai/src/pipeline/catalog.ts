import { z } from 'zod';
import { ChecklistStepId } from '../onboarding/checklist';
import pipelineJson from './pipeline.json';

/**
 * Steps 6-8 (06 §2) as data: which registry layers lever tuning may change and the checklist step its flags belong
 * to, the node ids whose cells the impact preview shows, and the titles of the two drafts. Code only reads
 * `pipeline.json`; spec ids are used verbatim.
 */
const DraftText = z.strictObject({ title: z.string().min(1), summary: z.string().min(1) });

const ReviewConfigSchema = z.strictObject({
  source: z.string(),
  tuning: z.strictObject({
    /** Registry layers whose variables are lever inputs the tuning may propose. */
    layers: z.array(z.string().min(1)).min(1),
    /** The checklist step tuning flags belong to. */
    step: ChecklistStepId,
  }),
  impact: z.strictObject({
    /** Node ids previewed before → after, every cell of each (`node[member]`). */
    nodes: z.array(z.string().min(1)).min(1),
  }),
  drafts: z.strictObject({ seed: DraftText, lever_tuning: DraftText }),
});
export type ReviewConfig = z.infer<typeof ReviewConfigSchema>;

export const parseReviewConfig = (raw: unknown): ReviewConfig => ReviewConfigSchema.parse(raw);

/** `pipeline.json`, parsed once. */
export const REVIEW_CONFIG: ReviewConfig = parseReviewConfig(pipelineJson);
