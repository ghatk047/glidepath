import type { AuditSink, ModelClient } from '@glidepath/ai';
import { createAiReconfigJob, getAiReconfigJob, schema, updateAiReconfigJob } from '@glidepath/data-access';
import { JobCancelledError } from '../../runtime';
import { BudgetExceededError, TokenBudget, budgetedClient } from './budget';
import { emptyUsage, estimateReconfigCost } from './cost';
import type { AiJobDeps } from './deps';
import { runPipeline, seedSectionCount } from './pipeline';
import { redact, safeMessage, secretsOf } from './redact';
import { loadJobSettings } from './settings';
import {
  AiJobError,
  type AiJobContext,
  type JobStatus,
  type JobStep,
  type ReconfigPayload,
  type StoredReconfigJob,
} from './types';
import type { JsonValue } from '@glidepath/domain';

/** What the handler returns: the job's end state (the full state is `ai_reconfig_job.plan`). */
export interface ReconfigJobResult {
  readonly jobId: string;
  readonly status: JobStatus;
  readonly step: JobStep | null;
}

/** The job's own objects beside the model client's audit records: `ai/<job-id>/<name>`. */
export const reviewKey = (jobId: string): string => `${jobId}/review.json`;
export const usageKey = (jobId: string): string => `${jobId}/usage.json`;

const encoder = new TextEncoder();
const asJson = (v: unknown): JsonValue => JSON.parse(JSON.stringify(v)) as JsonValue;

/**
 * Handler `ai.reconfig` (06 section 2): runs steps 1 to 7 for the job's prompt and keeps the result for review.
 *
 * - Before the first model call it computes the cost estimate and stores it on the job (`plan.estimate`), so the
 *   cost is visible before anything is spent. The token budget `AI_MAX_TOKENS_PER_JOB` (ADR-022) is enforced on every
 *   model call; a job that reaches it ends `budget_exceeded` with what it had.
 * - The job writes only its own row (`ai_reconfig_job`: `plan` = `StoredReconfigJob`, `status`) and `ai/<job-id>/`
 *   objects. It never touches tenant data: the only write of a reconfiguration is the user's apply.
 * - `dryRun` stops after step 1 with status `estimated`.
 * - A failure ends `failed` (message scrubbed of secrets) and is rethrown; a cancel ends `cancelled`.
 */
export async function runReconfig(ctx: AiJobContext, payload: ReconfigPayload, deps: AiJobDeps): Promise<ReconfigJobResult> {
  const jobId = payload.jobId ?? deps.newId();
  const secrets = secretsOf(deps.env);
  const existing = await ctx.withTenant((tx) => getAiReconfigJob(tx, jobId));
  if (existing !== null && existing.status !== 'queued')
    throw new AiJobError('bad_state', `Job ${jobId} is ${existing.status}, not queued: it runs once.`);
  const prompt = existing?.prompt ?? payload.prompt?.trim();
  if (prompt === undefined || prompt === '') throw new AiJobError('bad_payload', 'ai.reconfig needs a prompt (payload.prompt or the queued job row).');
  const dryRun = payload.dryRun === true;

  let state: StoredReconfigJob | null = null;
  const save = async (status: JobStatus, patch: Partial<StoredReconfigJob>): Promise<void> => {
    state = { ...state!, ...patch };
    const plan = asJson(state);
    await ctx.withTenant(async (tx) => {
      if ((await updateAiReconfigJob(tx, jobId, { plan, status })) === null)
        await createAiReconfigJob(tx, { id: jobId, prompt, plan, status });
    });
  };

  const settings = loadJobSettings(deps.env);
  const budget = new TokenBudget(settings.maxTokensPerJob);
  let step: JobStep | null = null;
  try {
    const config = deps.config();
    const spec = await deps.spec();
    // Cost estimate first, before any model call: the job row carries it from the start.
    const estimate = estimateReconfigCost({
      prompt,
      seedSections: seedSectionCount(spec.bundle),
      config,
      maxTokens: settings.maxTokensPerJob,
    });
    state = { format: 1, step: null, progress: 0, note: null, dryRun, plan: null, estimate, usage: null, review: null, error: null, applied: null, cache: null };
    await save('running', {});

    const objects = deps.objects({ tenantId: ctx.tenantId, userId: ctx.userId });
    const audit: AuditSink = { put: (bucket, key, body, options) => objects.put(bucket, key, body, options) };
    const client: ModelClient = budgetedClient(deps.client({ jobId, config, audit }), budget);

    const home = await ctx.withTenant(async (tx) => {
      const rows = await tx.select({ id: schema.tenant.id, name: schema.tenant.name, slug: schema.tenant.slug }).from(schema.tenant);
      return rows.map((r) => ({ id: r.id, name: r.name, iataCode: r.slug.toUpperCase() }));
    });

    const result = await runPipeline(
      client,
      { promptBar: prompt, today: deps.now().toISOString().slice(0, 10), bundle: spec.bundle, reference: spec.reference, existingTenants: home, planOnly: dryRun },
      {
        enter: async (s, fraction, note) => {
          if (ctx.signal.aborted) throw new JobCancelledError();
          step = s;
          await save('running', { step: s, progress: fraction, note, usage: budget.usage });
        },
        planned: async (plan) => save('running', { plan, usage: budget.usage }),
      },
    );

    if (result.review === null) {
      await save('estimated', { step: 'scope', progress: 1, note: 'Plan and cost estimate', plan: result.plan, usage: budget.usage });
      return { jobId, status: 'estimated', step: 'scope' };
    }
    await objects.put('ai', reviewKey(jobId), encoder.encode(JSON.stringify(result.review, null, 2)), { contentType: 'application/json' });
    await objects.put('ai', usageKey(jobId), encoder.encode(JSON.stringify(budget.usage, null, 2)), { contentType: 'application/json' });
    await save('review', { step: 'review', progress: 1, note: 'Ready for review', plan: result.plan, review: result.review, usage: budget.usage });
    return { jobId, status: 'review', step: 'review' };
  } catch (err) {
    if (state === null) {
      // Failed before the first write (settings, spec, key): the row still has to say so.
      state = { format: 1, step: null, progress: 0, note: null, dryRun, plan: null, estimate: { inputTokens: 0, outputTokens: 0, usd: 0, model: 'unknown', maxTokens: settings.maxTokensPerJob }, usage: null, review: null, error: null, applied: null, cache: null };
    }
    const base = { step, usage: budget.usage.calls > 0 ? budget.usage : emptyUsage() };
    if (err instanceof BudgetExceededError) {
      await save('budget_exceeded', { ...base, error: { code: err.code, message: redact(err.message, secrets) }, note: 'Stopped at the token budget' });
      return { jobId, status: 'budget_exceeded', step };
    }
    if (err instanceof JobCancelledError || ctx.signal.aborted) {
      await save('cancelled', { ...base, error: null, note: 'Cancelled' });
      return { jobId, status: 'cancelled', step };
    }
    const code = err instanceof AiJobError ? err.code : 'failed';
    const message = safeMessage(err, secrets);
    await save('failed', { ...base, error: { code, message }, note: 'Failed' });
    // pg-boss records what is thrown: rethrow the scrubbed message, never the original (it may carry a secret).
    throw new AiJobError(code, message);
  }
}
