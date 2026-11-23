import { ReconfigStep, type ReconfigJob, type Tenant } from '@glidepath/api-contract';
import { CHECKLIST, type ChecklistId, type PipelineId, type StepState } from './copy';

/**
 * Display mapping only. Nothing here is a business rule: which pipeline step tier 2 reports
 * decides which of the four visible steps is active; which facts tier 2 attached to a checklist
 * item decide its state. No value is computed.
 */
const order = ReconfigStep.options;
const at = (s: ReconfigStep) => order.indexOf(s);

export function pipelineGroup(step: ReconfigStep | null): number {
  if (step === null) return 0;
  const i = at(step);
  return i < at('validate') ? 0 : i < at('lever_tuning') ? 1 : i < at('apply') ? 2 : 3;
}

export type PipelineState = 'done' | 'active' | 'todo';

export function pipelineStates(
  job: Pick<ReconfigJob, 'status' | 'step'> | null,
  ids: readonly PipelineId[],
): PipelineState[] {
  if (!job) return ids.map(() => 'todo');
  if (job.status === 'applied') return ids.map(() => 'done');
  if (job.status === 'review')
    return ids.map((_, i) => (i < 2 ? 'done' : i === 2 ? 'active' : 'todo'));
  const g = pipelineGroup(job.step);
  return ids.map((_, i) => (i < g ? 'done' : i === g ? 'active' : 'todo'));
}

/** Done / in review / to do of one onboarding step, from the facts and questions tier 2 sent. */
export function checklistStates(job: ReconfigJob | null): Record<ChecklistId, StepState> {
  const out = {} as Record<ChecklistId, StepState>;
  for (const step of CHECKLIST) {
    const facts = job?.facts.filter((f) => f.item === step.id) ?? [];
    const questions = job?.openQuestions.filter((q) => q.item === step.id) ?? [];
    if (!job || (facts.length === 0 && questions.length === 0)) out[step.id] = 'todo';
    else if (job.status === 'applied') out[step.id] = 'done';
    else if (questions.length > 0 || facts.some((f) => f.sourceId === null || f.confidence === 'L'))
      out[step.id] = 'review';
    else out[step.id] = 'done';
  }
  return out;
}

export type TileKind = 'live' | 'draft' | 'new' | 'add';

export interface TileModel {
  key: string;
  kind: TileKind;
  /** IATA-code monogram, uppercase (rule 9). */
  monogram: string;
  name: string;
  slug: string | null;
  sub: string;
  /** Prompt prefilled for "Set up with AI" / "Continue setup". */
  prompt: string | null;
}

/** Tenant row → tile. `draft` is the AI job tier 2 holds for that airline, if any. */
export function tileOf(t: Tenant, draft: ReconfigJob | null, cy: string): TileModel {
  const monogram = t.slug.toUpperCase();
  if (t.status === 'active')
    return {
      key: t.slug,
      kind: 'live',
      monogram,
      name: t.name,
      slug: t.slug,
      sub: `model ${t.modelVersionId}`,
      prompt: null,
    };
  const drafted = draft !== null && draft.plan?.tenant.slug === t.slug;
  return {
    key: t.slug,
    kind: drafted ? 'draft' : 'new',
    monogram,
    name: t.name,
    slug: t.slug,
    sub: drafted ? 'example onboarding' : '',
    prompt: `Set up ${t.name} for ${cy}`,
  };
}

/** A tile for an AI draft whose airline is not in the tenant list yet. */
export function draftTile(job: ReconfigJob): TileModel | null {
  if (!job.plan) return null;
  const p = job.plan.tenant;
  return {
    key: `draft-${p.slug}`,
    kind: 'draft',
    monogram: p.monogram,
    name: p.name,
    slug: p.slug,
    sub: 'example onboarding',
    prompt: job.prompt,
  };
}
