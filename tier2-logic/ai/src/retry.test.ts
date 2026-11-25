import Anthropic from '@anthropic-ai/sdk';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isRetryable } from './retry';
import { loadError, loadExchanges } from './testing/fake-transport';
import {
  forbidNetwork,
  harness,
  researchStep,
  scopeStep,
  SPEC_EXCERPT,
  SYSTEM_PROMPT,
} from './testing/harness';

forbidNetwork();

describe('AC4a typed SDK errors retried with backoff, never string-matched', () => {
  it('retries 429, 529 and 500 with exponential backoff, honouring retry-after', async () => {
    const h = harness([
      loadError('rate_limited'),
      loadError('overloaded'),
      loadError('server_error'),
      ...loadExchanges('scope-end-turn'),
    ]);
    const run = await h.client.run(scopeStep, { request: 'x' });
    expect(run.output.baseYear).toBe(2025);
    expect(h.requests).toHaveLength(4);
    // base 1000 ms, full jitter at random()=0.5: 500 raised to retry-after 7 s, then 1000, then 2000.
    expect(h.sleeps).toEqual([7000, 1000, 2000]);
    // Identical body on every attempt.
    expect(new Set(h.requests.map((r) => JSON.stringify(r.body))).size).toBe(1);
  });

  it('retries a dropped connection (APIConnectionError)', async () => {
    const h = harness([loadError('connection_reset'), ...loadExchanges('scope-end-turn')]);
    await h.client.run(scopeStep, { request: 'x' });
    expect(h.requests).toHaveLength(2);
  });

  it('does not retry a 400 even when its message reads like a rate limit', async () => {
    const h = harness([
      loadError('bad_request_saying_rate_limit'),
      ...loadExchanges('scope-end-turn'),
    ]);
    await expect(h.client.run(scopeStep, { request: 'x' })).rejects.toBeInstanceOf(
      Anthropic.BadRequestError,
    );
    expect(h.requests).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
  });

  it('does not retry 401 and gives up after AI_RETRY_ATTEMPTS with the typed error', async () => {
    const auth = harness([loadError('unauthorized')]);
    await expect(auth.client.run(scopeStep, { request: 'x' })).rejects.toBeInstanceOf(
      Anthropic.AuthenticationError,
    );
    expect(auth.requests).toHaveLength(1);

    const limited = harness([loadError('rate_limited'), loadError('rate_limited')], {
      env: { AI_RETRY_ATTEMPTS: '2' },
    });
    await expect(limited.client.run(scopeStep, { request: 'x' })).rejects.toBeInstanceOf(
      Anthropic.RateLimitError,
    );
    expect(limited.requests).toHaveLength(2);
  });

  it('classifies by class only', () => {
    const headers = new Headers();
    expect(isRetryable(new Anthropic.RateLimitError(429, undefined, 'x', headers))).toBe(true);
    expect(isRetryable(new Anthropic.APIConnectionError({ message: 'x' }))).toBe(true);
    expect(
      isRetryable(new Anthropic.BadRequestError(400, undefined, 'rate limit overloaded', headers)),
    ).toBe(false);
    expect(isRetryable(new Anthropic.APIUserAbortError())).toBe(false);
    expect(isRetryable(new Error('rate_limit_error 429 overloaded'))).toBe(false);
  });

  it('never string-matches error messages in source code', () => {
    const dir = new URL('./', import.meta.url);
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const matchOnMessage =
      /\.message\b[^\n]*\.(includes|match|test|startsWith|endsWith|indexOf|search)\(|\.(includes|match|test|startsWith|endsWith|indexOf|search)\([^\n]*\.message\b/;
    expect(sources).toEqual(expect.arrayContaining(['retry.ts', 'client.ts']));
    for (const f of sources) {
      const text = readFileSync(new URL(f, dir), 'utf8');
      expect(text, f).not.toMatch(matchOnMessage);
    }
    // The retry and client modules do not touch error messages at all.
    for (const f of ['retry.ts', 'client.ts']) {
      expect(readFileSync(new URL(f, dir), 'utf8'), f).not.toMatch(/\.message\b/);
    }
  });
});

describe('AC4b stable prefix carries cache_control, per-job prompt last', () => {
  it('marks only the last stable system block with cache_control and sends the per-job prompt last', async () => {
    const h = harness(loadExchanges('scope-end-turn'));
    await h.client.run(scopeStep, { request: 'set up Example Air' });
    const body = h.requests[0]!.body;
    expect(body.system).toEqual([
      { type: 'text', text: SYSTEM_PROMPT },
      { type: 'text', text: SPEC_EXCERPT, cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.messages).toEqual([
      { role: 'user', content: '<prompt_bar>set up Example Air</prompt_bar>' },
    ]);
    expect(JSON.stringify(body.system)).not.toContain('Example Air');
    // Render order is tools -> system -> messages: the per-job text sits after the cached prefix.
    expect(Object.keys(body).indexOf('messages')).toBeGreaterThan(
      Object.keys(body).indexOf('system'),
    );
  });

  it('keeps the prefix byte-identical across jobs and across pause_turn continuations', async () => {
    const a = harness(loadExchanges('research-pause-turn'), { jobId: 'job-a' });
    const b = harness(loadExchanges('research-pause-turn'), { jobId: 'job-b' });
    await a.client.run(researchStep, { tenant: 'Example Air' });
    await b.client.run(researchStep, { tenant: 'Other Air' });
    const prefix = (r: { body: { model: string; tools: unknown; system: unknown } }) =>
      JSON.stringify([r.body.model, r.body.tools, r.body.system]);
    const all = [...a.requests, ...b.requests].map(prefix);
    expect(new Set(all).size).toBe(1);
    expect(a.requests[0]!.body.messages[0].content).not.toEqual(
      b.requests[0]!.body.messages[0].content,
    );
  });
});
