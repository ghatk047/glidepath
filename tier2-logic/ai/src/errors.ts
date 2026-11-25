import type { BetaStopReason } from '@anthropic-ai/sdk/resources/beta/messages/messages';

/** Base class for step failures that are not SDK errors. Messages never carry secrets. */
export class ModelStepError extends Error {
  constructor(
    readonly stepId: string,
    message: string,
  ) {
    super(`step ${stepId}: ${message}`);
    this.name = 'ModelStepError';
  }
}

/** The model (and the server-side fallback chain) declined: `stop_reason: "refusal"`. */
export class ModelRefusalError extends ModelStepError {
  constructor(
    stepId: string,
    readonly category: string | null,
    readonly explanation: string | null,
    readonly model: string,
  ) {
    super(stepId, `declined by ${model}${category ? ` (${category})` : ''}`);
    this.name = 'ModelRefusalError';
  }
}

/** The reply stopped before it was complete (`max_tokens`, context window, too many pause_turns). */
export class ModelIncompleteError extends ModelStepError {
  constructor(
    stepId: string,
    readonly stopReason: BetaStopReason | 'pause_turn_limit' | null,
  ) {
    super(stepId, `incomplete reply (${stopReason ?? 'no stop_reason'})`);
    this.name = 'ModelIncompleteError';
  }
}

/** The reply ended in a way this pipeline never asks for (e.g. `tool_use` with no client tools). */
export class ModelProtocolError extends ModelStepError {
  constructor(
    stepId: string,
    readonly stopReason: BetaStopReason | null,
  ) {
    super(stepId, `unexpected stop_reason ${stopReason ?? 'null'}`);
    this.name = 'ModelProtocolError';
  }
}

/** The reply was not valid JSON for the step's zod schema. */
export class ModelOutputError extends ModelStepError {
  constructor(
    stepId: string,
    readonly issues: readonly { path: readonly PropertyKey[]; message: string }[],
  ) {
    super(stepId, `output does not match the schema (${issues.length} issue(s))`);
    this.name = 'ModelOutputError';
  }
}
