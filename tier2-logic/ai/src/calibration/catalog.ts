import { z } from 'zod';
import calibrationJson from './calibration.json';

/**
 * Steps 4-5 (06 §2) as data: the calibration metrics with the node each ties to, the tolerance, the year attributes
 * that find the last reported year, the units a reported figure may come in, the invariants of 06 §4 and the member
 * references the draft's integrity check follows. Code only reads `calibration.json`; spec ids are used verbatim.
 */

const Metric = z.strictObject({
  id: z.string().regex(/^[a-z][a-z_]*$/),
  label: z.string().min(1),
  /** The year-dimensioned node whose last-reported-year cell must tie. */
  node: z.string().min(1),
  /** Normalised fact labels that name this figure, in order of preference. */
  aliases: z.array(z.string().min(1)).min(1),
});

const Invariant = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  /** `zero`: every cell of `node` is 0. `same_input_year`: `node` is equal across year members with the same input year. */
  kind: z.enum(['zero', 'same_input_year']),
  node: z.string().min(1),
});

const MemberReference = z.strictObject({
  dim: z.string().min(1),
  attribute: z.string().min(1),
  /** The dimension every id in the attribute (a string or a list of strings) must be a member of; '' means none. */
  references: z.string().min(1),
});

const CalibrationConfigSchema = z
  .strictObject({
    source: z.string(),
    /** Relative tolerance of a tie (06 §2: within 1%). */
    tolerance: z.number().positive(),
    /** Repair rounds with the model on a miss (06 §2: one). */
    repairRounds: z.number().int().nonnegative(),
    /** Registry layers whose variables a repair may change. */
    repairLayers: z.array(z.string().min(1)).min(1),
    year: z.strictObject({
      dim: z.string().min(1),
      prevAttribute: z.string().min(1),
      inputYearAttribute: z.string().min(1),
      itAttribute: z.string().min(1),
    }),
    units: z.array(z.strictObject({ names: z.array(z.string().min(1)).min(1), factor: z.number().positive() })),
    metrics: z.array(Metric).min(1),
    invariants: z.array(Invariant),
    memberReferences: z.array(MemberReference),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    c.metrics.forEach((m, i) => {
      if (ids.has(m.id)) ctx.addIssue({ code: 'custom', path: ['metrics', i, 'id'], message: `duplicate metric ${m.id}` });
      ids.add(m.id);
    });
  });

export type CalibrationConfig = z.infer<typeof CalibrationConfigSchema>;
export type CalibrationMetricDef = z.infer<typeof Metric>;
export type InvariantDef = z.infer<typeof Invariant>;

export const parseCalibrationConfig = (json: unknown): CalibrationConfig => CalibrationConfigSchema.parse(json);

export const CALIBRATION: CalibrationConfig = parseCalibrationConfig(calibrationJson);

/** Metric ids from the data (`revenue`, `fuel`, ...). */
export const CalibrationMetricId = z.enum(CALIBRATION.metrics.map((m) => m.id) as [string, ...string[]]);
export type CalibrationMetricId = z.infer<typeof CalibrationMetricId>;

/** Lowercase, `&` as `and`, punctuation as spaces, spaces collapsed: how fact labels and units are compared. */
export const normaliseLabel = (text: string): string =>
  text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9$]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
