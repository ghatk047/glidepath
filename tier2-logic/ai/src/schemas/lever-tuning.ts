import { z } from 'zod';
import { Confidence } from './plan';

/** One proposed lever input: a registry variable id, verbatim (`lev.L03.cut`), with the reason. */
export const LeverTuningChange = z.strictObject({
  variable: z.string().min(1),
  /** Comma-joined member key for a dimensioned lever input (`L03`), null for a scalar. */
  memberKey: z.string().nullable(),
  /** Scenario id the value applies to; null for the tenant default. */
  scenario: z.string().nullable(),
  value: z.number(),
  /** Why this tenant differs from the library default, in one or two sentences. */
  reason: z.string().min(1),
  /** FactBase ids the reason rests on. */
  factIds: z.array(z.string()),
  confidence: Confidence,
});
export type LeverTuningChange = z.infer<typeof LeverTuningChange>;

/**
 * Step 6 output (06 §2): tenant-specific lever intensities with reasons, reviewed and applied as a
 * changeset separate from the seed. Bounds and ids are checked against the registry in validation (step 4).
 */
export const LeverTuningDraft = z
  .strictObject({
    summary: z.string().min(1),
    changes: z.array(LeverTuningChange),
    openQuestions: z.array(z.string()),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    d.changes.forEach((c, i) => {
      const key = JSON.stringify([c.variable, c.memberKey, c.scenario]);
      if (seen.has(key))
        ctx.addIssue({ code: 'custom', path: ['changes', i], message: `${c.variable} proposed twice for the same cell` });
      seen.add(key);
    });
  });
export type LeverTuningDraft = z.infer<typeof LeverTuningDraft>;
