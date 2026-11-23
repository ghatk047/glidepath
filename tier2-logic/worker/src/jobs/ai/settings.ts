/**
 * Job settings from the environment (CLAUDE.md rule 10, ADR-022). `AI_MAX_TOKENS_PER_JOB` is an operational limit,
 * not a business number: its default lives here, in the config loader. The AI client's own settings (key, models,
 * retries) are `loadAiConfig` of `@glidepath/ai`.
 */

/** Tokens a job may use (input, output and cache tokens of every model call) before it stops. */
export const DEFAULT_MAX_TOKENS_PER_JOB = 2_000_000;

export class AiJobSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiJobSettingsError';
  }
}

export interface AiJobSettings {
  readonly maxTokensPerJob: number;
}

export function loadJobSettings(env: Readonly<Record<string, string | undefined>>): AiJobSettings {
  const raw = env.AI_MAX_TOKENS_PER_JOB?.trim();
  if (raw === undefined || raw === '') return { maxTokensPerJob: DEFAULT_MAX_TOKENS_PER_JOB };
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new AiJobSettingsError('AI_MAX_TOKENS_PER_JOB must be a positive integer');
  return { maxTokensPerJob: Number(raw) };
}
