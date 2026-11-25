import { describe, expect, it } from 'vitest';
import {
  AiConfigError,
  DEFAULT_LIGHT_MODEL,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_PAUSE_TURNS,
  DEFAULT_MODEL,
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_RETRY_MAX_MS,
  loadAiConfig,
} from './config';

const KEY = 'sk-ant-test-secret-value';

describe('loadAiConfig', () => {
  it('applies defaults when only the key is set (blank means default)', () => {
    const c = loadAiConfig({ ANTHROPIC_API_KEY: KEY, AI_MODEL: '', AI_RETRY_ATTEMPTS: ' ' });
    expect(c).toEqual({
      apiKey: KEY,
      baseURL: undefined,
      models: { primary: DEFAULT_MODEL, light: DEFAULT_LIGHT_MODEL },
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      retry: {
        attempts: DEFAULT_RETRY_ATTEMPTS,
        baseMs: DEFAULT_RETRY_BASE_MS,
        maxMs: DEFAULT_RETRY_MAX_MS,
      },
      maxPauseTurns: DEFAULT_MAX_PAUSE_TURNS,
    });
  });

  it('reads overrides from the environment', () => {
    const c = loadAiConfig({
      ANTHROPIC_API_KEY: KEY,
      ANTHROPIC_BASE_URL: 'https://proxy.internal.example/',
      AI_MODEL: 'claude-opus-5',
      AI_MODEL_LIGHT: 'claude-haiku-5-5',
      AI_MAX_OUTPUT_TOKENS: '32000',
      AI_RETRY_ATTEMPTS: '2',
    });
    expect(c.baseURL).toBe('https://proxy.internal.example/');
    expect(c.models).toEqual({ primary: 'claude-opus-5', light: 'claude-haiku-5-5' });
    expect(c.maxOutputTokens).toBe(32000);
    expect(c.retry.attempts).toBe(2);
  });

  it('fails without ANTHROPIC_API_KEY, naming the variable', () => {
    expect(() => loadAiConfig({})).toThrow(AiConfigError);
    expect(() => loadAiConfig({ ANTHROPIC_API_KEY: '  ' })).toThrow(
      /ANTHROPIC_API_KEY is required/,
    );
  });

  it('never echoes values in errors', () => {
    try {
      loadAiConfig({ ANTHROPIC_API_KEY: KEY, AI_MODEL: 'Bad Model!', AI_RETRY_ATTEMPTS: 'many' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AiConfigError);
      const text = `${String(e)} ${JSON.stringify((e as AiConfigError).problems)}`;
      expect(text).toMatch(/AI_MODEL/);
      expect(text).toMatch(/AI_RETRY_ATTEMPTS/);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('Bad Model!');
      expect(text).not.toContain('many');
    }
  });
});
