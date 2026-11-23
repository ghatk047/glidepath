import type {
  BetaOutputConfig,
  BetaWebFetchTool20260209,
  BetaWebSearchTool20260209,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { z } from 'zod';
import type { Source } from './sources';

/** `output_config.effort`. Every step sets it explicitly: the model's default (`medium`) is never relied on. */
export type Effort = NonNullable<BetaOutputConfig['effort']>;

/** Which configured model a step runs on (`AI_MODEL` / `AI_MODEL_LIGHT`). */
export type ModelTier = 'primary' | 'light';

/**
 * Server tools a step may enable (06 §2 step 2: web search + web fetch). Anthropic runs them; there is
 * no client tool loop, so `tool_choice` is always `auto` (forced choice is rejected on this model).
 */
export type ServerTool = BetaWebSearchTool20260209 | BetaWebFetchTool20260209;

/**
 * One pipeline step: a fixed prompt shape with a typed output. The stable prefix (`system`) comes first
 * and is cached; the per-job prompt (`prompt(input)`) always goes last.
 */
export interface Step<I, O> {
  /** Slug used in audit keys, e.g. `scope`, `research`. */
  readonly id: string;
  readonly effort: Effort;
  /** zod schema of the output; sent as `output_config.format` and used to validate the reply. */
  readonly output: z.ZodType<O>;
  /**
   * Stable system blocks in order: system prompt, spec excerpts, onboarding checklist, worked example.
   * Identical across jobs so the prefix cache hits; the last block carries `cache_control`.
   */
  readonly system: readonly string[];
  /** The per-job prompt, rendered from the step input. */
  readonly prompt: (input: I) => string;
  readonly tools?: readonly ServerTool[];
  /** Defaults to `primary`. */
  readonly model?: ModelTier;
}

/** Identity helper so step literals infer `I` and `O`. */
export const defineStep = <I, O>(step: Step<I, O>): Step<I, O> => step;

export interface StepUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface StepRun<O> {
  /** The validated, typed output. */
  output: O;
  /** Every web source the model saw or cited, deduplicated by URL. */
  sources: Source[];
  /** Model that produced the final reply (differs from the requested one after a fallback). */
  model: string;
  /** True when the server-side fallback answered instead of the requested model. */
  fallback: boolean;
  /** Summed over all calls of the step (pause_turn continuations included). */
  usage: StepUsage;
  /** Audit object keys written for this step, as `ai/<job-id>/...`. */
  audit: string[];
}

/** The port pipeline steps depend on (AI-01 contract): run(step, input) → typed output. */
export interface ModelClient {
  run<I, O>(step: Step<I, O>, input: I): Promise<StepRun<O>>;
}
