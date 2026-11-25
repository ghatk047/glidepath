import Anthropic from '@anthropic-ai/sdk';
import type { RetryPolicy } from './config';

/**
 * Retries for model calls (06 §2: typed SDK errors, retried in the job runner, never string-matched).
 * The SDK's own retries are switched off (`maxRetries: 0`) so this is the single, testable policy.
 *
 * Retryable: 408, 409, 429, 5xx (except 501) and connection errors, mid-stream `error` events included
 * (the SDK raises those as APIConnectionError). Everything else, including 400/401/403/404 and user
 * aborts, is rethrown at once. The decision uses `instanceof` only; error messages are never read.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.NotImplementedError) return false;
  return (
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.RequestTimeoutError ||
    error instanceof Anthropic.ConflictError ||
    error instanceof Anthropic.APIConnectionError
  );
}

const MS_PER_S = 1000;

/** `retry-after` (seconds or HTTP date) from a typed API error, in ms; null when absent. */
export function retryAfterMs(error: unknown, now: number): number | null {
  if (!(error instanceof Anthropic.APIError) || !error.headers) return null;
  const v = error.headers.get('retry-after');
  if (v === null) return null;
  const s = Number(v);
  if (Number.isFinite(s)) return Math.max(0, s * MS_PER_S);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export interface RetryDeps {
  sleep: (ms: number) => Promise<void>;
  /** [0, 1); injectable for deterministic tests. */
  random: () => number;
  now: () => number;
  /** Called before each wait; for logging attempt numbers (never the error message). */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

/** Exponential backoff with full jitter, raised to `retry-after` when the API asks for longer. */
export function backoffMs(
  policy: RetryPolicy,
  attempt: number,
  error: unknown,
  deps: RetryDeps,
): number {
  const ceiling = Math.min(policy.maxMs, policy.baseMs * 2 ** (attempt - 1));
  const jittered = Math.floor(deps.random() * ceiling);
  const asked = retryAfterMs(error, deps.now());
  return Math.min(policy.maxMs, Math.max(jittered, asked ?? 0));
}

export async function withRetry<T>(
  policy: RetryPolicy,
  deps: RetryDeps,
  call: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= policy.attempts || !isRetryable(error)) throw error;
      const delayMs = backoffMs(policy, attempt, error, deps);
      deps.onRetry?.({ attempt, delayMs, error });
      await deps.sleep(delayMs);
    }
  }
}
