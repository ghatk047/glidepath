import type { ModelBundle, TenantSeed } from '@glidepath/spec';
import { REVIEW_CONFIG, type ReviewConfig } from '../pipeline/catalog';
import { type LeverTuningPromptInput, renderLeverTuningPrompt } from '../prompts/render';
import { systemBlocks } from '../prompts/system';
import type { ReviewFlag } from '../review';
import type { FactBase } from '../schemas/facts';
import { type LeverTuningChange, LeverTuningDraft } from '../schemas/lever-tuning';
import type { ReconfigPlan } from '../schemas/plan';
import { defineStep, type ModelClient, type Step } from '../step';
import { stepCall, type StepResult } from './result';

/** Pipeline step 6 (06 §2): structured output `LeverTuningDraft`, effort `high`, no tools. */
export const leverTuningStep: Step<LeverTuningPromptInput, LeverTuningDraft> = defineStep({
  id: 'lever-tuning',
  effort: 'high',
  output: LeverTuningDraft,
  system: systemBlocks('lever_tuning'),
  prompt: renderLeverTuningPrompt,
});

type TuningBundle = Pick<ModelBundle, 'variables'>;

/** The lever inputs the tuning may change (registry layers of `pipeline.json`) that the seed sets, as the prompt shows them. */
export function tunableLevers(seed: TenantSeed, bundle: TuningBundle, config: ReviewConfig = REVIEW_CONFIG): LeverTuningPromptInput['levers'] {
  return bundle.variables
    .filter((v) => config.tuning.layers.includes(v.layer) && v.id in seed.variableValues)
    .map((v) => ({
      id: v.id,
      label: v.label,
      unit: v.unit,
      dims: [...v.dims],
      min: v.min,
      max: v.max,
      libraryDefault: seed.variableValues[v.id]!,
    }));
}

/** Is `key` a member key of `dims` (comma-joined, in dims order) whose ids are members of the seed? */
function isMemberKey(key: string, dims: readonly string[], seed: TenantSeed): boolean {
  const ids = key.split(',');
  return ids.length === dims.length && ids.every((id, i) => (seed.dimensionMembers[dims[i]!] ?? []).some((m) => m.id === id));
}

/**
 * Check the model's tuning against the seed it goes on and the registry: a change is dropped (flag `tuning_dropped`)
 * when its variable is not a tunable lever input, its member key or scenario does not exist, or its value is not
 * finite or outside the registry bounds (the `ai_reconfig` write path rejects those). Fact ids not in the fact base
 * are removed (`unknown_fact`); a change that then rests on no fact gets confidence `L` (`unsourced`).
 */
export function checkLeverTuning(
  draft: LeverTuningDraft,
  ctx: { seed: TenantSeed; bundle: TuningBundle; facts: FactBase | null; config?: ReviewConfig },
): { draft: LeverTuningDraft; review: ReviewFlag[] } {
  const config = ctx.config ?? REVIEW_CONFIG;
  const step = config.tuning.step;
  const levers = new Map(tunableLevers(ctx.seed, ctx.bundle, config).map((l) => [l.id, l]));
  const scenarios = new Set(ctx.seed.scenarios.scenarios.map((s) => s.id));
  const factIds = new Set((ctx.facts?.facts ?? []).map((f) => f.id));
  const review: ReviewFlag[] = [];
  const drop = (c: LeverTuningChange, why: string): void => {
    review.push({ kind: 'tuning_dropped', step, target: c.variable, message: `Lever tuning change to ${c.variable} dropped: ${why}.` });
  };

  const changes: LeverTuningChange[] = [];
  for (const c of draft.changes) {
    const lever = levers.get(c.variable);
    if (!lever) {
      drop(c, 'not a lever input of this tenant');
      continue;
    }
    if (lever.dims.length === 0 ? c.memberKey !== null && c.memberKey !== '' : c.memberKey === null || !isMemberKey(c.memberKey, lever.dims, ctx.seed)) {
      drop(c, `member key ${c.memberKey === null ? 'missing' : `'${c.memberKey}' unknown`} for dims [${lever.dims.join(', ')}]`);
      continue;
    }
    if (c.scenario !== null && !scenarios.has(c.scenario)) {
      drop(c, `no scenario ${c.scenario}`);
      continue;
    }
    if (!Number.isFinite(c.value) || (lever.min !== null && c.value < lever.min) || (lever.max !== null && c.value > lever.max)) {
      drop(c, `${c.value} is outside ${lever.min ?? '-∞'} to ${lever.max ?? '∞'}`);
      continue;
    }
    const known = c.factIds.filter((id) => factIds.has(id));
    for (const id of c.factIds.filter((x) => !factIds.has(x)))
      review.push({ kind: 'unknown_fact', step, target: c.variable, message: `Lever tuning of ${c.variable} names fact ${id}, which is not in the fact base.` });
    if (known.length === 0)
      review.push({ kind: 'unsourced', step, target: c.variable, message: `Lever tuning of ${c.variable} rests on no fact: confidence set to L.` });
    changes.push({ ...c, memberKey: lever.dims.length === 0 ? null : c.memberKey, factIds: known, confidence: known.length === 0 ? 'L' : c.confidence });
  }
  return { draft: LeverTuningDraft.parse({ ...draft, changes }), review };
}

export interface TuneLeversInput {
  /** The job's prompt-bar text, quoted as user input. */
  promptBar: string;
  plan: ReconfigPlan;
  /** The checked fact base of step 2. */
  facts: FactBase;
  /** The state the tuning goes on: the calibrated seed draft (onboard) or the tenant's current inputs (tune). */
  seed: TenantSeed;
  bundle: TuningBundle;
}

/**
 * Step 6 (06 §2): one `lever-tuning` call proposes tenant-specific lever intensities with reasons, checked against
 * the seed and the registry (`checkLeverTuning`). The result is its own draft, reviewed and applied separately from
 * the seed (`leverTuningChangeset`). The ModelClient is the only dependency; nothing is written.
 */
export async function tuneLevers(
  client: ModelClient,
  input: TuneLeversInput,
  opts: { config?: ReviewConfig } = {},
): Promise<StepResult<LeverTuningDraft>> {
  const run = await client.run(leverTuningStep, {
    promptBar: input.promptBar,
    plan: input.plan,
    facts: input.facts,
    levers: tunableLevers(input.seed, input.bundle, opts.config),
    scenarios: input.seed.scenarios.scenarios.map((s) => ({ id: s.id, label: s.label })),
  });
  const checked = checkLeverTuning(run.output, { seed: input.seed, bundle: input.bundle, facts: input.facts, config: opts.config });
  return { output: checked.draft, review: checked.review, calls: [stepCall(leverTuningStep.id, run)] };
}
