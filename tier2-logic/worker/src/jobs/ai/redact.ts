/**
 * Keeps secrets out of anything stored or logged. ANTHROPIC_API_KEY is read from the environment and handed to the
 * SDK only; an error that happens to carry it (a proxy echoing a header, say) is scrubbed before it reaches a job row.
 */
export const REDACTED = '[redacted]';

/** Environment variables whose values are secrets for this item. */
export const SECRET_ENV = ['ANTHROPIC_API_KEY'] as const;

export function secretsOf(env: Readonly<Record<string, string | undefined>>): string[] {
  return SECRET_ENV.map((k) => env[k]?.trim() ?? '').filter((v) => v.length > 0);
}

export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join(REDACTED);
  return out;
}

/** The message of an unknown thrown value, scrubbed. Names the error class, never a stack. */
export function safeMessage(err: unknown, secrets: readonly string[]): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return redact(text, secrets);
}
