import {
  calibrate,
  draftSeed,
  type ModelClient,
  presetsFromSeed,
  type ReconfigPlan,
  type ReconfigReview,
  research,
  reviewPayload,
  scope,
  seedSectionPlans,
  type StepCall,
  type ReviewFlag,
  targetsFromFacts,
  type TenantSeedDraftInput,
  tuneLevers,
  validateDraft,
} from '@glidepath/ai';
import { compile, type CompiledModel } from '@glidepath/engine';
import type { Member, ModelBundle, TenantSeed } from '@glidepath/spec';
import { AiJobError, type JobStep } from './types';

/**
 * Steps 1 to 7 of 06 section 2 as one function, shared by the `ai.reconfig` job and the rehearse CLI. It writes
 * nothing: persistence and progress go through `PipelineHooks`.
 */

export interface PipelineInput {
  readonly promptBar: string;
  /** ISO date of the job (step 1 reads it to find the last reported year). */
  readonly today: string;
  readonly bundle: ModelBundle;
  /**
   * The reference tenant's seed (AA): step 3 copies its scenario presets and lever library for the new tenant, and
   * its years are the defaults step 1 uses when the request names none.
   */
  readonly reference: TenantSeed;
  /** Tenants that exist, for step 1 to tell a new airline from an existing one. */
  readonly existingTenants: readonly { id: string; name: string; iataCode: string }[];
  /** Step 1 only: return after the plan. */
  readonly planOnly?: boolean;
}

export interface PipelineHooks {
  /** Before each step; throw to stop the job (cancel). `fraction` is the share of the job done when the step starts. */
  enter(step: JobStep, fraction: number, note: string): Promise<void>;
  /** After step 1, with the plan and its cost shape; throw to stop. */
  planned?(plan: ReconfigPlan): Promise<void>;
}

export interface PipelineResult {
  readonly plan: ReconfigPlan;
  /** Null for `planOnly`. */
  readonly review: ReconfigReview | null;
}

/** Progress at the start of each step (the share of the job done). */
const PROGRESS: Readonly<Record<JobStep, number>> = {
  scope: 0,
  research: 0.1,
  seed_draft: 0.35,
  validate: 0.7,
  calibrate: 0.75,
  lever_tuning: 0.85,
  review: 0.95,
  apply: 1,
};

/** One engine compilation per distinct set of members: steps 4 to 7 evaluate the same draft. */
function memoCompile(): (bundle: ModelBundle, members: Readonly<Record<string, readonly Member[]>>) => CompiledModel {
  let key: string | null = null;
  let model: CompiledModel | null = null;
  return (bundle, members) => {
    const k = JSON.stringify(members);
    if (model === null || k !== key) {
      model = compile(bundle, members as never);
      key = k;
    }
    return model;
  };
}

export async function runPipeline(client: ModelClient, input: PipelineInput, hooks: PipelineHooks): Promise<PipelineResult> {
  const { bundle, promptBar } = input;
  const calls: StepCall[] = [];
  const flags: ReviewFlag[] = [];
  const stepAt = (step: JobStep, note: string): Promise<void> => hooks.enter(step, PROGRESS[step], note);

  // 1. scope
  await stepAt('scope', 'Scoping the request');
  const scoped = await scope(client, {
    promptBar,
    today: input.today,
    defaults: { baseYear: Number(input.reference.tenant.base_year), targetYear: Number(input.reference.tenant.target_year) },
    existingTenants: input.existingTenants,
  });
  const plan = scoped.output;
  calls.push(...scoped.calls);
  flags.push(...scoped.review);
  await hooks.planned?.(plan);
  if (input.planOnly === true) return { plan, review: null };
  if (plan.intent !== 'onboard' || !plan.produce.includes('seed'))
    throw new AiJobError(
      'unsupported_intent',
      'Tuning an existing tenant is not supported by this job yet: it needs the tenant\'s current inputs as the draft to tune. Onboard a new tenant instead.',
    );

  // 2. research
  await stepAt('research', 'Researching public sources');
  const researched = await research(client, { promptBar, plan });
  calls.push(...researched.calls);
  flags.push(...researched.review);
  const facts = researched.output;

  // 3. seed draft
  await stepAt('seed_draft', 'Drafting the tenant seed');
  const presets = presetsFromSeed(input.reference as unknown as TenantSeedDraftInput, bundle.variables);
  const drafted = await draftSeed(client, { promptBar, plan, facts, bundle, presets });
  calls.push(...drafted.calls);
  flags.push(...drafted.review);

  // 4. validate + 5. calibrate
  const compileOnce = memoCompile();
  await stepAt('validate', 'Validating the draft');
  await stepAt('calibrate', 'Calibrating against the last reported year');
  const calibrated = await calibrate(
    client,
    { draft: drafted.output, bundle, targets: targetsFromFacts(facts, plan.lastReportedYear), facts, promptBar },
    { compile: compileOnce },
  );
  calls.push(...calibrated.calls);
  flags.push(...calibrated.review);
  const seed = calibrated.output.draft;
  const validation = calibrated.output.validation ?? validateDraft(seed, bundle, { compile: compileOnce });

  // 6. lever tuning
  let tuning = null;
  if (plan.produce.includes('lever_tuning')) {
    await stepAt('lever_tuning', 'Tuning lever intensities');
    const tuned = await tuneLevers(client, { promptBar, plan, facts, seed, bundle });
    calls.push(...tuned.calls);
    flags.push(...tuned.review);
    tuning = tuned.output;
  }

  // 7. review payload
  await stepAt('review', 'Preparing the review');
  const review = reviewPayload(
    {
      plan,
      facts,
      calls,
      flags,
      bundle,
      seed,
      validation,
      calibration: { report: calibrated.output.report, openQuestions: calibrated.output.openQuestions },
      tuning,
    },
    { compile: compileOnce },
  );
  return { plan, review };
}

/** Model calls of the seed draft, for the cost estimate. */
export const seedSectionCount = (bundle: ModelBundle): number => seedSectionPlans(bundle).length;
