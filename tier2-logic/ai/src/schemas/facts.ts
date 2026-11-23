import { z } from 'zod';
import { ChecklistStepId } from '../onboarding/checklist';
import { Confidence } from './plan';

/** One public fact gathered in step 2, tied to a checklist step. */
export const Fact = z.strictObject({
  /** Job-local id, referenced by seed values and lever tuning (`factIds`). */
  id: z.string().min(1),
  step: ChecklistStepId,
  /** What the value is, e.g. "Total operating revenue". */
  label: z.string().min(1),
  /** A number, or text for facts such as a union or vendor name. */
  value: z.union([z.number(), z.string()]),
  /** Unit of `value`, e.g. `USD m`, `FTE`, `%`, `text`. */
  unit: z.string().min(1),
  /** Period the value refers to, e.g. `FY2025`, when it has one. */
  period: z.string().nullable(),
  /** The page the value was read from; null when the value is an estimate without a source. */
  sourceUrl: z.url().nullable(),
  sourceTitle: z.string().nullable(),
  /** ISO date the value was published or is as of. */
  date: z.iso.date(),
  confidence: Confidence,
  note: z.string().nullable(),
});
export type Fact = z.infer<typeof Fact>;

/** Step 2 output (06 §2): facts with value, unit, source URL, date and confidence, plus what was not found. */
export const FactBase = z
  .strictObject({
    facts: z.array(Fact),
    /** Checklist items the research could not answer from public sources. */
    gaps: z.array(z.strictObject({ step: ChecklistStepId, question: z.string().min(1) })),
  })
  .superRefine((fb, ctx) => {
    const seen = new Set<string>();
    fb.facts.forEach((f, i) => {
      if (seen.has(f.id)) ctx.addIssue({ code: 'custom', path: ['facts', i, 'id'], message: `duplicate fact id ${f.id}` });
      seen.add(f.id);
    });
  });
export type FactBase = z.infer<typeof FactBase>;
