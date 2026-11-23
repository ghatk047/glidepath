import { z } from 'zod';
import checklistJson from './checklist.json';

/**
 * The tenant onboarding checklist (spec 07 §2) as data. The steps live in `checklist.json`; code only
 * reads them, so prompts, schemas and the seed chunking all follow the same list.
 */

const SEED_FILES = [
  'tenant.json',
  'dimension_members.json',
  'variable_values.json',
  'scenarios.json',
  'lever_library.json',
] as const;
export type SeedFile = (typeof SEED_FILES)[number];

const ChecklistStepSchema = z.strictObject({
  n: z.number().int().positive(),
  id: z.string().regex(/^[a-z][a-z_]*$/),
  title: z.string().min(1),
  /** What the step must produce, in the spec's words (airline-neutral). */
  produce: z.string().min(1),
  /** Public facts to gather for this step in the research step. */
  research: z.array(z.string().min(1)),
  /**
   * Which parts of the seed the step fills: files, dimensions, registry groups, single variables. `from` says how
   * the seed draft (pipeline step 3) fills them: drafted by the model from the fact base (`facts`), or copied from
   * the global presets (`presets`).
   */
  seed: z.strictObject({
    from: z.enum(['facts', 'presets']),
    files: z.array(z.enum(SEED_FILES)),
    dims: z.array(z.string().min(1)),
    groups: z.array(z.string().min(1)),
    variables: z.array(z.string().min(1)),
  }),
});

const ChecklistSchema = z
  .strictObject({ source: z.string(), steps: z.array(ChecklistStepSchema).min(1) })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.steps.forEach((s, i) => {
      if (s.n !== i + 1) ctx.addIssue({ code: 'custom', path: ['steps', i, 'n'], message: `step ${s.id} is out of order` });
      if (seen.has(s.id)) ctx.addIssue({ code: 'custom', path: ['steps', i, 'id'], message: `duplicate step id ${s.id}` });
      seen.add(s.id);
    });
  });

export type ChecklistStep = z.infer<typeof ChecklistStepSchema>;
export type Checklist = z.infer<typeof ChecklistSchema>;

/** Validate a checklist document (exported for tests and for a checklist loaded from elsewhere). */
export const parseChecklist = (json: unknown): Checklist => ChecklistSchema.parse(json);

export const ONBOARDING_CHECKLIST: Checklist = parseChecklist(checklistJson);

const stepIds = ONBOARDING_CHECKLIST.steps.map((s) => s.id);
/** A checklist step id (`tenant_record`, `baseline_lines`, ...), as an enum built from the data. */
export const ChecklistStepId = z.enum(stepIds as [string, ...string[]]);
export type ChecklistStepId = z.infer<typeof ChecklistStepId>;

export function checklistStep(id: ChecklistStepId, checklist: Checklist = ONBOARDING_CHECKLIST): ChecklistStep {
  const step = checklist.steps.find((s) => s.id === id);
  if (!step) throw new Error(`unknown checklist step '${id}'`);
  return step;
}

/** The step that owns a dimension's members, or undefined when no step claims it. */
export function checklistStepForDim(dim: string, checklist: Checklist = ONBOARDING_CHECKLIST): ChecklistStep | undefined {
  return checklist.steps.find((s) => s.seed.dims.includes(dim));
}

/**
 * The step that owns a variable's tenant default: a step naming the variable id wins over a step naming its
 * registry group (`variables.json` → `group`).
 */
export function checklistStepForVariable(
  variable: { readonly id: string; readonly group?: string },
  checklist: Checklist = ONBOARDING_CHECKLIST,
): ChecklistStep | undefined {
  const { id, group } = variable;
  return (
    checklist.steps.find((s) => s.seed.variables.includes(id)) ??
    (group === undefined ? undefined : checklist.steps.find((s) => s.seed.groups.includes(group)))
  );
}

/** The checklist as one prompt block, rendered from the data (the stable, cached part of every step's prefix). */
export function renderChecklist(checklist: Checklist = ONBOARDING_CHECKLIST): string {
  const lines = checklist.steps.map((s) => {
    const research = s.research.length > 0 ? `\n   Research: ${s.research.join('; ')}.` : '';
    return `${s.n}. ${s.title} (\`${s.id}\`): ${s.produce}${research}`;
  });
  return `<onboarding_checklist>\nWhat a tenant onboarding must produce, step by step:\n${lines.join('\n')}\n</onboarding_checklist>`;
}
