import { z } from 'zod';
import { CalibrationMetricId } from '../calibration/catalog';
import { Confidence } from './plan';

// ---------------------------------------------------------------------------------------------------------------
// Step 4: the validation report of a seed draft.

/**
 * What found a problem: a rule of schema.json `validation_rules` (VR01-VR10; VR04 is the registry bounds), `members`
 * (member integrity: dimensions, member keys, member references) or `engine` (the draft does not compile or evaluate).
 */
export const DraftCheck = z.enum(['VR01', 'VR02', 'VR03', 'VR04', 'VR05', 'VR06', 'VR07', 'VR08', 'VR09', 'VR10', 'members', 'engine']);
export type DraftCheck = z.infer<typeof DraftCheck>;

export const DraftValidationEntry = z.strictObject({
  check: DraftCheck,
  severity: z.enum(['error', 'warning']),
  /** Contract CellKeys (`id[member_key]`) or, for member integrity, `dim/member` paths. */
  cells: z.array(z.string()),
  message: z.string().min(1),
  /** Where it holds: `null` for the tenant defaults, else the scenario ids. An entry identical in several is listed once. */
  scopes: z.array(z.string().nullable()).min(1),
});
export type DraftValidationEntry = z.infer<typeof DraftValidationEntry>;

/** Step 4 output: `ok` when no entry is an error. */
export const ValidationReport = z.strictObject({
  ok: z.boolean(),
  entries: z.array(DraftValidationEntry),
});
export type ValidationReport = z.infer<typeof ValidationReport>;

// ---------------------------------------------------------------------------------------------------------------
// Step 5: calibration targets, report and the repair round.

/** A reported figure of the last reported fiscal year (the 10-K), in the engine's unit ($M). */
export const CalibrationTarget = z.strictObject({
  metric: CalibrationMetricId,
  value: z.number(),
  source: z.string().nullable(),
  factIds: z.array(z.string()),
});
export type CalibrationTarget = z.infer<typeof CalibrationTarget>;

export const MetricStatus = z.enum(['tied', 'miss', 'missing']);
export type MetricStatus = z.infer<typeof MetricStatus>;

export const MetricResult = z.strictObject({
  metric: CalibrationMetricId,
  /** Engine CellKey of the rebuilt figure, e.g. `pl.rev[fy25]`. */
  cell: z.string().min(1),
  reported: z.number().nullable(),
  model: z.number().nullable(),
  /** model − reported. */
  residual: z.number().nullable(),
  /** residual / |reported|; null when either side is missing or reported is 0. */
  relative: z.number().nullable(),
  status: MetricStatus,
  factIds: z.array(z.string()),
});
export type MetricResult = z.infer<typeof MetricResult>;

export const CalibrationRound = z.strictObject({
  /** 0 for the draft as drafted, 1 after the repair. */
  round: z.number().int().nonnegative(),
  tied: z.boolean(),
  metrics: z.array(MetricResult),
  /** Set when the engine could not evaluate the draft. */
  error: z.string().nullable(),
});
export type CalibrationRound = z.infer<typeof CalibrationRound>;

export const InvariantResult = z.strictObject({
  id: z.string().min(1),
  /** `null` for the tenant defaults, else a scenario id. */
  scope: z.string().nullable(),
  holds: z.boolean(),
  /** The cells that break it, with their values. */
  failing: z.array(z.strictObject({ cell: z.string(), value: z.number() })),
});
export type InvariantResult = z.infer<typeof InvariantResult>;

export const RepairChangeRecord = z.strictObject({
  variable: z.string().min(1),
  memberKey: z.string(),
  from: z.number().nullable(),
  to: z.number(),
  reason: z.string(),
});
export type RepairChangeRecord = z.infer<typeof RepairChangeRecord>;

/** Step 5 output (06 §2 "calibration report"). */
export const CalibrationReport = z.strictObject({
  /** The year member rebuilt, e.g. `fy25`. */
  year: z.string().min(1),
  tolerance: z.number(),
  /** Every metric ties in the last round and every invariant holds. */
  tied: z.boolean(),
  rounds: z.array(CalibrationRound).min(1),
  /** What the repair round changed (empty when there was none). */
  repair: z.array(RepairChangeRecord),
  invariants: z.array(InvariantResult),
});
export type CalibrationReport = z.infer<typeof CalibrationReport>;

/** One value the model changes in the repair round. Wire format: lists, no maps (see `ValueDraft`). */
export const RepairChange = z
  .strictObject({
    variable: z.string().min(1),
    scalar: z.number().nullable(),
    perMember: z.array(z.strictObject({ key: z.string().min(1), value: z.number() })).nullable(),
    /** Which residual this addresses and why the new value is right, in one or two sentences. */
    reason: z.string().min(1),
    source: z.string().nullable(),
    confidence: Confidence,
    factIds: z.array(z.string()),
  })
  .superRefine((v, ctx) => {
    if ((v.scalar === null) === (v.perMember === null))
      ctx.addIssue({ code: 'custom', path: ['scalar'], message: `${v.variable}: give exactly one of scalar and perMember` });
  });
export type RepairChange = z.infer<typeof RepairChange>;

/** Structured output of the repair call (step 5 on a miss). */
export const CalibrationRepair = z.strictObject({
  changes: z.array(RepairChange),
  openQuestions: z.array(z.string()),
});
export type CalibrationRepair = z.infer<typeof CalibrationRepair>;
