import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type {
  BetaContentBlock,
  BetaJSONOutputFormat,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaTextBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { z } from 'zod';
import { assertJobId, assertStepId, auditKey, type AuditSink, writeAudit } from './audit';
import type { AiConfig } from './config';
import {
  ModelIncompleteError,
  ModelOutputError,
  ModelProtocolError,
  ModelRefusalError,
} from './errors';
import { type RetryDeps, withRetry } from './retry';
import { SourceCollector } from './sources';
import type { ModelClient, Step, StepRun, StepUsage } from './step';

/** Server-side fallback on refusals (06 §2): this beta plus `fallbacks: "default"`. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** `fetch`-compatible transport. Tests pass a fake that replays recorded fixtures; production omits it. */
export type Transport = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ClaudeModelClientOptions {
  /** The job this client works for; audit files go to `ai/<job-id>/`. */
  jobId: string;
  config: AiConfig;
  audit: AuditSink;
  transport?: Transport;
  sleep?: RetryDeps['sleep'];
  random?: RetryDeps['random'];
  now?: () => Date;
  onRetry?: RetryDeps['onRetry'];
}

/** The JSON schema for `output_config.format`, built from the step's zod schema by the SDK helper. */
export function outputFormat(schema: z.ZodType): BetaJSONOutputFormat {
  // Only the wire part: parsing happens here, after stop_reason has been checked, not inside the SDK.
  const { type, schema: json } = betaZodOutputFormat(schema);
  return { type, schema: json };
}

/** Stable prefix first (cached at its last block), per-job prompt last. */
export function buildRequest<I, O>(
  step: Step<I, O>,
  input: I,
  config: AiConfig,
): BetaMessageStreamParams {
  if (step.system.length === 0) throw new Error(`step ${step.id}: system prefix must not be empty`);
  const last = step.system.length - 1;
  const system: BetaTextBlockParam[] = step.system.map((text, i) =>
    i === last
      ? { type: 'text', text, cache_control: { type: 'ephemeral' } }
      : { type: 'text', text },
  );
  const tools = step.tools ?? [];
  return {
    model: config.models[step.model ?? 'primary'],
    max_tokens: config.maxOutputTokens,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: step.effort, format: outputFormat(step.output) },
    system,
    ...(tools.length > 0 ? { tools: [...tools], tool_choice: { type: 'auto' as const } } : {}),
    messages: [{ role: 'user', content: step.prompt(input) }],
  };
}

const SERVER_RESULT_TYPES = new Set<BetaContentBlock['type']>([
  'web_search_tool_result',
  'web_fetch_tool_result',
]);

/** Text after the last server-tool result: the structured answer (earlier text is narration). */
export function answerText(content: readonly BetaContentBlock[]): string {
  let start = 0;
  content.forEach((b, i) => {
    if (SERVER_RESULT_TYPES.has(b.type)) start = i + 1;
  });
  return content
    .slice(start)
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('');
}

function parseOutput<O>(stepId: string, schema: z.ZodType<O>, text: string): O {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ModelOutputError(stepId, [{ path: [], message: 'reply is not valid JSON' }]);
  }
  const r = schema.safeParse(json);
  if (!r.success) throw new ModelOutputError(stepId, r.error.issues);
  return r.data;
}

const servedByFallback = (m: BetaMessage): boolean =>
  m.content.some((b) => b.type === 'fallback') ||
  (m.usage.iterations ?? []).some((it) => it.type === 'fallback_message');

const addUsage = (u: StepUsage, m: BetaMessage): StepUsage => ({
  inputTokens: u.inputTokens + m.usage.input_tokens,
  outputTokens: u.outputTokens + m.usage.output_tokens,
  cacheCreationInputTokens: u.cacheCreationInputTokens + (m.usage.cache_creation_input_tokens ?? 0),
  cacheReadInputTokens: u.cacheReadInputTokens + (m.usage.cache_read_input_tokens ?? 0),
});

/**
 * ModelClient on the Claude Messages API (06 §2 API usage rules), bound to one job.
 *
 * Every call: configured model, adaptive thinking, the step's explicit effort, structured output from
 * zod, `tool_choice: auto` only, server-side refusal fallback, streamed and collected with
 * `finalMessage()`. `stop_reason` is checked before any content is read; `pause_turn` is resumed.
 * Each response and the step's source list are written to the AuditSink.
 */
export function createClaudeModelClient(opts: ClaudeModelClientOptions): ModelClient {
  assertJobId(opts.jobId);
  const { config, audit, jobId } = opts;
  const now = opts.now ?? (() => new Date());
  const retryDeps: RetryDeps = {
    sleep: opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    random: opts.random ?? Math.random,
    now: () => now().getTime(),
    onRetry: opts.onRetry,
  };
  const sdk = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0, // retries live in withRetry: one typed policy
    ...(opts.transport ? { fetch: opts.transport } : {}),
  });
  let seq = 0;

  async function call(request: BetaMessageStreamParams): Promise<BetaMessage> {
    return withRetry(config.retry, retryDeps, () =>
      sdk.beta.messages.stream(request).finalMessage(),
    );
  }

  return {
    async run<I, O>(step: Step<I, O>, input: I): Promise<StepRun<O>> {
      assertStepId(step.id);
      const base = buildRequest(step, input, config);
      const messages: BetaMessageParam[] = [...base.messages];
      const sources = new SourceCollector();
      const written: string[] = [];
      let usage: StepUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      };
      let fallback = false;
      const stepSeq = ++seq;

      for (let turn = 0; ; turn++) {
        const request: BetaMessageStreamParams = { ...base, messages: [...messages] };
        const message = await call(request);
        usage = addUsage(usage, message);
        fallback ||= servedByFallback(message);
        sources.add(message.content);
        written.push(
          await writeAudit(audit, auditKey(jobId, stepSeq, step.id, `response-${turn + 1}`), {
            jobId,
            step: step.id,
            turn: turn + 1,
            recordedAt: now().toISOString(),
            request,
            response: message,
          }),
        );

        // stop_reason first; content is read only once the reply is known to be complete.
        const stop = message.stop_reason;
        if (stop === 'pause_turn') {
          if (turn + 1 > config.maxPauseTurns) {
            await persistSources();
            throw new ModelIncompleteError(step.id, 'pause_turn_limit');
          }
          messages.push({ role: 'assistant', content: message.content });
          continue;
        }
        await persistSources();
        if (stop === 'refusal') {
          throw new ModelRefusalError(
            step.id,
            message.stop_details?.category ?? null,
            message.stop_details?.explanation ?? null,
            message.model,
          );
        }
        if (stop === 'max_tokens' || stop === 'model_context_window_exceeded') {
          throw new ModelIncompleteError(step.id, stop);
        }
        if (stop !== 'end_turn' && stop !== 'stop_sequence')
          throw new ModelProtocolError(step.id, stop);

        const output = parseOutput(step.id, step.output, answerText(message.content));
        return {
          output,
          sources: sources.list(),
          model: message.model,
          fallback,
          usage,
          audit: written,
        };
      }

      async function persistSources(): Promise<void> {
        written.push(
          await writeAudit(audit, auditKey(jobId, stepSeq, step.id, 'sources'), {
            jobId,
            step: step.id,
            recordedAt: now().toISOString(),
            sources: sources.list(),
          }),
        );
      }
    },
  };
}
