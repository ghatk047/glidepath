import { z } from 'zod';
import { ChecklistStepId } from '../onboarding/checklist';

/**
 * Confidence of a value, as in the registry and the seed (`variables.json` / `line.confidence`): H, M, L.
 * A value without a source is always `L` (06 §2 Safety and trust).
 */
export const Confidence = z.enum(['H', 'M', 'L']);
export type Confidence = z.infer<typeof Confidence>;

/** What a job produces: the tenant seed, the lever tuning, or both (each its own changeset). */
export const Deliverable = z.enum(['seed', 'lever_tuning']);
export type Deliverable = z.infer<typeof Deliverable>;

/**
 * Step 1 output (06 §2): the job plan parsed from the prompt bar. `onboard` creates a new tenant;
 * `tune` proposes lever tuning for an existing one.
 */
export const ReconfigPlan = z
  .strictObject({
    intent: z.enum(['onboard', 'tune']),
    tenant: z.strictObject({
      name: z.string().min(1),
      /** Two-character IATA airline designator, also the tenant monogram. */
      iataCode: z.string().regex(/^[A-Z0-9]{2}$/),
      ticker: z.string().nullable(),
      /** ISO 4217 reporting currency, when known from the prompt. */
      currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
      /** Set for `tune`: the tenant the tuning applies to. */
      existingTenantId: z.string().nullable(),
    }),
    baseYear: z.number().int(),
    targetYear: z.number().int(),
    /** Fiscal year the calibration ties to (step 5): the last year with a published annual report. */
    lastReportedYear: z.number().int(),
    produce: z.array(Deliverable).min(1),
    /** Onboarding checklist steps this job covers (all of them for `onboard`). */
    checklist: z.array(ChecklistStepId),
    /** Ambiguities in the request the reviewer must resolve; never guessed silently. */
    openQuestions: z.array(z.string()),
  })
  .superRefine((p, ctx) => {
    if (p.targetYear < p.baseYear)
      ctx.addIssue({ code: 'custom', path: ['targetYear'], message: 'targetYear is before baseYear' });
    if (p.lastReportedYear > p.baseYear)
      ctx.addIssue({ code: 'custom', path: ['lastReportedYear'], message: 'lastReportedYear is after baseYear' });
    if (new Set(p.produce).size !== p.produce.length)
      ctx.addIssue({ code: 'custom', path: ['produce'], message: 'deliverable listed twice' });
    if (p.intent === 'tune') {
      if (p.tenant.existingTenantId === null)
        ctx.addIssue({ code: 'custom', path: ['tenant', 'existingTenantId'], message: 'tune needs an existing tenant' });
      if (p.produce.includes('seed'))
        ctx.addIssue({ code: 'custom', path: ['produce'], message: 'tune does not produce a seed' });
    }
    if (p.intent === 'onboard' && !p.produce.includes('seed'))
      ctx.addIssue({ code: 'custom', path: ['produce'], message: 'onboard produces a seed' });
  });
export type ReconfigPlan = z.infer<typeof ReconfigPlan>;
