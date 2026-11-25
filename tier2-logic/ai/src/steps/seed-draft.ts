import type { DimensionDef, VariableDef } from '@glidepath/spec';
import { ModelOutputError } from '../errors';
import {
  checklistStep,
  checklistStepForDim,
  checklistStepForVariable,
  type ChecklistStepId,
  ONBOARDING_CHECKLIST,
} from '../onboarding/checklist';
import { type PromptVariable, renderSeedSectionPrompt, type SeedSectionPromptInput } from '../prompts/render';
import { systemBlocks } from '../prompts/system';
import type { ReviewFlag } from '../review';
import type { FactBase } from '../schemas/facts';
import { Confidence, type ReconfigPlan } from '../schemas/plan';
import {
  assembleSeedDraft,
  SeedAssemblyError,
  SeedSectionDraft,
  type SeedPresets,
  splitSeedDraft,
  TENANT_TARGET,
  TenantSeedDraft,
  type TenantSeedDraftInput,
} from '../schemas/seed';
import { defineStep, type ModelClient, type Step } from '../step';
import { type StepCall, stepCall, type StepResult } from './result';

/** The parts of a model version (`ModelBundle`) the seed draft reads: the registry and the dimensions. */
export interface SeedBundle {
  readonly variables: readonly VariableDef[];
  readonly dimensions: readonly DimensionDef[];
}

/** One section of the seed: a checklist step with the tenant record, dimensions and variables it owns. */
export interface SeedSectionPlan {
  step: ChecklistStepId;
  /** The step that owns `tenant.json` writes the tenant record. */
  ownsTenant: boolean;
  dimensions: { id: string; attributes: readonly string[] }[];
  variables: PromptVariable[];
}

/**
 * The seed's sections in checklist order, from the checklist data and the registry (pure). `from` selects the steps
 * the model drafts from facts or the steps copied from the global presets (`checklist.json` → `seed.from`). Steps that
 * own nothing (e.g. `sources`, a rule over every value) have no section.
 */
export function seedSectionPlans(bundle: SeedBundle, from: 'facts' | 'presets' = 'facts'): SeedSectionPlan[] {
  return ONBOARDING_CHECKLIST.steps
    .filter((s) => s.seed.from === from)
    .map((s) => ({
      step: s.id,
      ownsTenant: s.seed.files.includes('tenant.json'),
      dimensions: bundle.dimensions
        .filter((d) => checklistStepForDim(d.id)?.id === s.id)
        .map((d) => ({ id: d.id, attributes: [...d.attributes] })),
      variables: bundle.variables
        .filter((v) => checklistStepForVariable(v)?.id === s.id)
        .map((v) => ({ id: v.id, label: v.label, unit: v.unit, dims: [...v.dims], min: v.min, max: v.max })),
    }))
    .filter((p) => p.ownsTenant || p.dimensions.length > 0 || p.variables.length > 0);
}

/** Audit slug of a section's call: `seed-<step id with hyphens>`, e.g. `seed-baseline-lines`. */
export const seedSectionStepId = (step: ChecklistStepId): string => `seed-${step.replace(/_/g, '-')}`;

/**
 * Pipeline step 3 (06 §2) for one seed section: structured output `SeedSectionDraft`, effort `high`, no tools.
 * Every section shares the same system blocks (system prompt, instructions, checklist, worked example), so the
 * first section writes the prefix cache and the others read it.
 */
export function seedSectionStep(
  step: ChecklistStepId,
  opts: { workedExample?: string } = {},
): Step<SeedSectionPromptInput, SeedSectionDraft> {
  return defineStep({
    id: seedSectionStepId(step),
    effort: 'high',
    output: SeedSectionDraft,
    system: systemBlocks('seed_draft', opts.workedExample === undefined ? {} : { workedExample: opts.workedExample }),
    prompt: renderSeedSectionPrompt,
  });
}

type Issue = { path: PropertyKey[]; message: string };
type Provenance = { source: string | null; confidence: Confidence; factIds: string[] };

/**
 * Check one section reply against its plan and the fact base (pure).
 * Contract violations (wrong section, a tenant record in the wrong section, a dimension or variable the section
 * does not own) are `issues`: the reply is rejected. Everything else is fixed and flagged for review:
 * no source → confidence `L` + `unsourced`; unknown fact ids → dropped + `unknown_fact`; a variable or dimension
 * of the section left out → `missing_value`.
 */
export function checkSeedSection(
  draft: SeedSectionDraft,
  plan: SeedSectionPlan,
  facts: FactBase,
): { section: SeedSectionDraft; review: ReviewFlag[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const review: ReviewFlag[] = [];
  const step = plan.step;
  if (draft.step !== step) issues.push({ path: ['step'], message: `expected section ${step}, got ${draft.step}` });
  if (plan.ownsTenant && draft.tenant === null)
    issues.push({ path: ['tenant'], message: `section ${step} must write the tenant record` });
  if (!plan.ownsTenant && draft.tenant !== null)
    issues.push({ path: ['tenant'], message: `section ${step} does not own the tenant record` });
  const dims = new Set(plan.dimensions.map((d) => d.id));
  draft.dimensions.forEach((d, i) => {
    if (!dims.has(d.dim)) issues.push({ path: ['dimensions', i, 'dim'], message: `dimension '${d.dim}' is not part of section ${step}` });
  });
  const vars = new Set(plan.variables.map((v) => v.id));
  draft.values.forEach((v, i) => {
    if (!vars.has(v.variable)) issues.push({ path: ['values', i, 'variable'], message: `variable '${v.variable}' is not part of section ${step}` });
  });

  const known = new Set(facts.facts.map((f) => f.id));
  const checkProvenance = <T extends Provenance>(item: T, target: string): T => {
    const source = item.source !== null && item.source.trim() !== '' ? item.source : null;
    const unknown = item.factIds.filter((id) => !known.has(id));
    if (unknown.length > 0)
      review.push({ kind: 'unknown_fact', step, target, message: `${target} names unknown fact(s) ${unknown.join(', ')}; reference dropped.` });
    if (source === null)
      review.push({ kind: 'unsourced', step, target, message: `${target} has no source; confidence set to L.` });
    return {
      ...item,
      source,
      confidence: source === null ? 'L' : item.confidence,
      factIds: item.factIds.filter((id) => known.has(id)),
    };
  };

  const drafted = new Set(draft.values.map((v) => v.variable));
  for (const v of plan.variables) {
    if (!drafted.has(v.id))
      review.push({ kind: 'missing_value', step, target: v.id, message: `${v.id} got no value in section ${step}.` });
  }
  const draftedDims = new Set(draft.dimensions.map((d) => d.dim));
  for (const d of plan.dimensions) {
    if (!draftedDims.has(d.id))
      review.push({ kind: 'missing_value', step, target: d.id, message: `Dimension ${d.id} got no members in section ${step}.` });
  }

  const section: SeedSectionDraft = {
    step: draft.step,
    tenant: draft.tenant === null ? null : checkProvenance(draft.tenant, TENANT_TARGET),
    dimensions: draft.dimensions,
    values: draft.values.map((v) => checkProvenance(v, v.variable)),
  };
  return { section, review, issues };
}

/** Flags where the drafted tenant record disagrees with the plan of step 1 (pure). */
export function checkTenantAgainstPlan(section: SeedSectionDraft, plan: ReconfigPlan): ReviewFlag[] {
  const t = section.tenant;
  if (!t) return [];
  const flag = (field: string, drafted: unknown, planned: unknown): ReviewFlag => ({
    kind: 'plan_mismatch',
    step: section.step,
    target: TENANT_TARGET,
    message: `tenant ${field} is ${String(drafted)} but the plan says ${String(planned)}.`,
  });
  const out: ReviewFlag[] = [];
  if (t.base_year !== plan.baseYear) out.push(flag('base_year', t.base_year, plan.baseYear));
  if (t.target_year !== plan.targetYear) out.push(flag('target_year', t.target_year, plan.targetYear));
  if (plan.tenant.currency !== null && t.currency !== plan.tenant.currency) out.push(flag('currency', t.currency, plan.tenant.currency));
  return out;
}

/** `source` of values copied from the global presets. */
export const PRESET_SOURCE = 'global preset';

/** What step 3 copies instead of drafting: the scenario presets, the lever library and the preset sections. */
export interface DraftSeedPresets extends SeedPresets {
  /** One section per checklist step with `seed.from = presets` (lever members and library defaults). */
  readonly sections: readonly SeedSectionDraft[];
}

/**
 * The global presets taken from a reference seed (pure; the caller reads the seed files). Values keep the registry's
 * confidence for the variable and `source: global preset`.
 */
export function presetsFromSeed(
  seedJson: TenantSeedDraftInput,
  registry: readonly Pick<VariableDef, 'id' | 'group' | 'confidence'>[],
): DraftSeedPresets {
  const seed = TenantSeedDraft.parse(seedJson);
  const confidenceOf = new Map(registry.map((r) => [r.id, Confidence.safeParse(r.confidence).data ?? 'L']));
  const sections = splitSeedDraft(seed, registry)
    .filter((s) => checklistStep(s.step).seed.from === 'presets')
    .map((s) => ({
      ...s,
      values: s.values.map((v) => ({ ...v, source: PRESET_SOURCE, confidence: confidenceOf.get(v.variable) ?? 'L', factIds: [] })),
    }));
  return { scenarios: seedJson.scenarios, leverLibrary: seedJson.leverLibrary, sections };
}

export interface DraftSeedInput {
  promptBar: string;
  plan: ReconfigPlan;
  /** The checked fact base of step 2. */
  facts: FactBase;
  bundle: SeedBundle;
  presets: DraftSeedPresets;
  /** Stable worked example for the cached prefix (e.g. a reference seed split into sections), loaded by the caller. */
  workedExample?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Step 3: draft the tenant seed, one model call per seed section (checklist step with `seed.from = facts`), in
 * checklist order; preset sections are copied. Sections are checked (`checkSeedSection`), merged
 * (`assembleSeedDraft`) and validated as a `TenantSeedDraft`. The ModelClient is the only dependency.
 *
 * Throws `ModelOutputError` when a section breaks its contract, `SeedAssemblyError` when the sections do not make a
 * valid seed.
 */
export async function draftSeed(client: ModelClient, input: DraftSeedInput): Promise<StepResult<TenantSeedDraft>> {
  const { plan, facts, bundle, presets } = input;
  if (!plan.produce.includes('seed')) throw new Error(`the plan (${plan.intent}) does not produce a seed`);

  const presetPlans = seedSectionPlans(bundle, 'presets');
  const presetSteps = presets.sections.map((s) => s.step);
  const presetProblems = [
    ...presetPlans.filter((p) => !presetSteps.includes(p.step)).map((p) => `no preset section for checklist step ${p.step}`),
    ...presetSteps.filter((s) => !presetPlans.some((p) => p.step === s)).map((s) => `checklist step ${s} is not copied from presets`),
  ];
  if (presetProblems.length > 0) throw new SeedAssemblyError(presetProblems);

  const review: ReviewFlag[] = [];
  const calls: StepCall[] = [];
  const drafted: SeedSectionDraft[] = [];
  // Sequential on purpose: the first call writes the shared prefix cache, the rest read it.
  for (const p of seedSectionPlans(bundle, 'facts')) {
    const step = seedSectionStep(p.step, input.workedExample === undefined ? {} : { workedExample: input.workedExample });
    const run = await client.run(step, {
      promptBar: input.promptBar,
      plan,
      facts,
      step: p.step,
      dimensions: p.dimensions,
      variables: p.variables,
    });
    calls.push(stepCall(step.id, run));
    const checked = checkSeedSection(run.output, p, facts);
    if (checked.issues.length > 0) throw new ModelOutputError(step.id, checked.issues);
    review.push(...checked.review, ...checkTenantAgainstPlan(checked.section, plan));
    drafted.push(checked.section);
  }

  const assembled = assembleSeedDraft([...drafted, ...presets.sections], presets);
  const tenantId = isRecord(assembled.tenant) ? assembled.tenant.id : undefined;
  // The presets are copied for this tenant: their `tenant` field names the new tenant, not the reference one.
  if (isRecord(assembled.scenarios) && typeof assembled.scenarios.tenant === 'string' && typeof tenantId === 'string')
    assembled.scenarios = { ...assembled.scenarios, tenant: tenantId };
  const parsed = TenantSeedDraft.safeParse(assembled);
  if (!parsed.success)
    throw new SeedAssemblyError(parsed.error.issues.map((i) => `${i.path.map(String).join('.') || '$'}: ${i.message}`));
  return { output: parsed.data, review, calls };
}
