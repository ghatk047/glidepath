import { z } from 'zod';

/**
 * AI settings come from environment variables only (CLAUDE.md rule 10, ADR-022). The caller (the worker)
 * passes its environment in; this module never reads `process.env` itself. Error messages name the
 * variable, never its value: ANTHROPIC_API_KEY is a secret and must never reach a log.
 */

/** Current Claude model ids (06 §2 API usage rules). Overridable per deployment, never hard-coded at call sites. */
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_LIGHT_MODEL = 'claude-sonnet-5-5';
/** `max_tokens` for streamed calls (06 §2: ~64k when streaming). */
export const DEFAULT_MAX_OUTPUT_TOKENS = 64_000;
export const DEFAULT_RETRY_ATTEMPTS = 4;
export const DEFAULT_RETRY_BASE_MS = 1_000;
export const DEFAULT_RETRY_MAX_MS = 30_000;
/** How many times one step may resume a `pause_turn` (server-tool loops) before giving up. */
export const DEFAULT_MAX_PAUSE_TURNS = 5;

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const intFromEnv = (name: string, def: number, min: number) =>
  z.preprocess(
    (v) => {
      const b = blankToUndefined(v);
      if (b === undefined) return def;
      return typeof b === 'string' && /^-?\d+$/.test(b.trim()) ? Number(b) : b;
    },
    z
      .number({ error: `${name} must be an integer` })
      .int(`${name} must be an integer`)
      .min(min, `${name} must be at least ${min}`),
  );

const modelFromEnv = (name: string, def: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9.-]*$/, `${name} must be a model id such as ${def}`)
      .default(def),
  );

export const AiEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.preprocess(
    blankToUndefined,
    z.string({ error: 'ANTHROPIC_API_KEY is required for AI reconfiguration' }).trim(),
  ),
  ANTHROPIC_BASE_URL: z.preprocess(
    blankToUndefined,
    z.url('ANTHROPIC_BASE_URL must be a URL').optional(),
  ),
  AI_MODEL: modelFromEnv('AI_MODEL', DEFAULT_MODEL),
  AI_MODEL_LIGHT: modelFromEnv('AI_MODEL_LIGHT', DEFAULT_LIGHT_MODEL),
  AI_MAX_OUTPUT_TOKENS: intFromEnv('AI_MAX_OUTPUT_TOKENS', DEFAULT_MAX_OUTPUT_TOKENS, 1),
  AI_RETRY_ATTEMPTS: intFromEnv('AI_RETRY_ATTEMPTS', DEFAULT_RETRY_ATTEMPTS, 1),
  AI_RETRY_BASE_MS: intFromEnv('AI_RETRY_BASE_MS', DEFAULT_RETRY_BASE_MS, 0),
  AI_RETRY_MAX_MS: intFromEnv('AI_RETRY_MAX_MS', DEFAULT_RETRY_MAX_MS, 0),
  AI_MAX_PAUSE_TURNS: intFromEnv('AI_MAX_PAUSE_TURNS', DEFAULT_MAX_PAUSE_TURNS, 0),
});

export interface RetryPolicy {
  /** Total attempts per model call, the first one included. */
  attempts: number;
  baseMs: number;
  maxMs: number;
}

export interface AiConfig {
  /** Secret. Handed to the SDK only; never logged, persisted or put in an error message. */
  apiKey: string;
  baseURL: string | undefined;
  models: { primary: string; light: string };
  maxOutputTokens: number;
  retry: RetryPolicy;
  maxPauseTurns: number;
}

/** Thrown when the AI settings are missing or invalid. Lists variable names only, never values. */
export class AiConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid AI configuration: ${problems.join('; ')}`);
    this.name = 'AiConfigError';
  }
}

export function loadAiConfig(env: Readonly<Record<string, string | undefined>>): AiConfig {
  const picked = Object.fromEntries(Object.keys(AiEnvSchema.shape).map((k) => [k, env[k]]));
  const r = AiEnvSchema.safeParse(picked);
  if (!r.success) {
    // Issue messages are ours (above) and never echo the input value.
    throw new AiConfigError(r.error.issues.map((i) => i.message));
  }
  const e = r.data;
  return {
    apiKey: e.ANTHROPIC_API_KEY,
    baseURL: e.ANTHROPIC_BASE_URL,
    models: { primary: e.AI_MODEL, light: e.AI_MODEL_LIGHT },
    maxOutputTokens: e.AI_MAX_OUTPUT_TOKENS,
    retry: { attempts: e.AI_RETRY_ATTEMPTS, baseMs: e.AI_RETRY_BASE_MS, maxMs: e.AI_RETRY_MAX_MS },
    maxPauseTurns: e.AI_MAX_PAUSE_TURNS,
  };
}
