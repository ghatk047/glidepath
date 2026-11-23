import { ONBOARDING_CHECKLIST } from '../onboarding/checklist';
import { renderScopePrompt, type ScopePromptInput } from '../prompts/render';
import { systemBlocks } from '../prompts/system';
import type { ReviewFlag } from '../review';
import { ReconfigPlan } from '../schemas/plan';
import { defineStep, type ModelClient, type Step } from '../step';
import { stepCall, type StepResult } from './result';

/** Pipeline step 1 (06 §2): the prompt bar parsed into a `ReconfigPlan`, effort `medium`, no tools. */
export const scopeStep: Step<ScopePromptInput, ReconfigPlan> = defineStep({
  id: 'scope',
  effort: 'medium',
  output: ReconfigPlan,
  system: systemBlocks('scope'),
  prompt: renderScopePrompt,
});

/** Review flags for a plan: an onboarding plan must cover every checklist step (the seed is drafted whole). */
export function reviewPlan(plan: ReconfigPlan): ReviewFlag[] {
  if (plan.intent !== 'onboard') return [];
  return ONBOARDING_CHECKLIST.steps
    .filter((s) => !plan.checklist.includes(s.id))
    .map((s) => ({
      kind: 'incomplete_checklist' as const,
      step: s.id,
      target: 'checklist',
      message: `The onboarding plan leaves out checklist step ${s.id}.`,
    }));
}

/** Step 1: scope the job. The ModelClient is the only dependency; the plan is returned, never stored here. */
export async function scope(client: ModelClient, input: ScopePromptInput): Promise<StepResult<ReconfigPlan>> {
  const run = await client.run(scopeStep, input);
  return { output: run.output, review: reviewPlan(run.output), calls: [stepCall(scopeStep.id, run)] };
}
