import { BetaMessageStream } from '@anthropic-ai/sdk/lib/BetaMessageStream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_BETA } from './client';
import { DEFAULT_MAX_OUTPUT_TOKENS } from './config';
import { ModelIncompleteError, ModelOutputError, ModelRefusalError } from './errors';
import { loadExchanges } from './testing/fake-transport';
import { forbidNetwork, harness, researchStep, scopeStep } from './testing/harness';

forbidNetwork();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AC3 streamed with finalMessage(); stop_reason checked first; refusals use the server-side fallback beta', () => {
  it('streams every call (stream: true, ~64k max_tokens) and collects it with finalMessage()', async () => {
    const finalMessage = vi.spyOn(BetaMessageStream.prototype, 'finalMessage');
    const h = harness(loadExchanges('scope-end-turn'));
    await h.client.run(scopeStep, { request: 'x' });
    expect(h.requests[0]!.body.stream).toBe(true);
    expect(h.requests[0]!.body.max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(finalMessage).toHaveBeenCalledTimes(1);
  });

  it('opts into the server-side fallback beta with fallbacks "default" on every request', async () => {
    const h = harness([
      ...loadExchanges('scope-end-turn'),
      ...loadExchanges('research-pause-turn'),
    ]);
    await h.client.run(scopeStep, { request: 'x' });
    await h.client.run(researchStep, { tenant: 'Example Air' });
    for (const r of h.requests) {
      expect(r.headers['anthropic-beta']?.split(',')).toContain(FALLBACK_BETA);
      expect(r.body.fallbacks).toBe('default');
      expect(r.body).not.toHaveProperty('betas'); // the SDK moves betas into the header
    }
    expect(FALLBACK_BETA).toBe('server-side-fallback-2026-07-01');
  });

  it('reports a reply served by the fallback model', async () => {
    const h = harness(loadExchanges('fallback-served'));
    const run = await h.client.run(scopeStep, { request: 'x' });
    expect(run.fallback).toBe(true);
    expect(run.model).toBe('claude-opus-5');
    expect(run.output.produce).toEqual(['seed']);
  });

  it('throws ModelRefusalError on stop_reason refusal without parsing the partial text', async () => {
    const h = harness(loadExchanges('refusal'));
    const err = await h.client.run(scopeStep, { request: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelRefusalError);
    expect(err).not.toBeInstanceOf(ModelOutputError);
    expect((err as ModelRefusalError).category).toBe('cyber');
    expect((err as ModelRefusalError).explanation).toMatch(/declined/);
  });

  it('throws ModelIncompleteError on max_tokens instead of parsing truncated JSON', async () => {
    const h = harness(loadExchanges('max-tokens'));
    const err = await h.client.run(scopeStep, { request: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelIncompleteError);
    expect((err as ModelIncompleteError).stopReason).toBe('max_tokens');
  });

  it('resumes pause_turn by sending the assistant content back, then reads only the final answer', async () => {
    const h = harness(loadExchanges('research-pause-turn'));
    const run = await h.client.run(researchStep, { tenant: 'Example Air' });

    expect(h.requests).toHaveLength(2);
    const [first, second] = h.requests;
    expect(first!.body.messages).toHaveLength(1);
    expect(second!.body.messages).toHaveLength(2);
    expect(second!.body.messages[1].role).toBe('assistant');
    expect(second!.body.messages[1].content.map((b: { type: string }) => b.type)).toEqual([
      'server_tool_use',
      'web_search_tool_result',
    ]);
    // Narration before the last tool result is not part of the structured answer.
    expect(run.output.facts).toHaveLength(1);
    expect(run.output.facts[0]!.value).toBe(9104);
    expect(run.usage.inputTokens).toBe(420 + 1630);
  });

  it('gives up after AI_MAX_PAUSE_TURNS continuations', async () => {
    const h = harness(loadExchanges('research-pause-turn').slice(0, 1), {
      env: { AI_MAX_PAUSE_TURNS: '0' },
    });
    const err = await h.client
      .run(researchStep, { tenant: 'Example Air' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelIncompleteError);
    expect((err as ModelIncompleteError).stopReason).toBe('pause_turn_limit');
  });
});
