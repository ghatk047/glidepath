import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { MemoryAuditSink } from './audit';
import { createClaudeModelClient } from './client';
import { ModelRefusalError } from './errors';
import { loadExchanges } from './testing/fake-transport';
import {
  forbidNetwork,
  harness,
  researchStep,
  scopeStep,
  TEST_API_KEY,
  testConfig,
} from './testing/harness';

forbidNetwork();

describe('AC5 every response and source list persisted through AuditSink to ai/<job-id>/; no network in tests', () => {
  it('writes each response and the source list of a step under ai/<job-id>/, in call order', async () => {
    const h = harness(
      [...loadExchanges('scope-end-turn'), ...loadExchanges('research-pause-turn')],
      {
        jobId: 'job-42',
      },
    );
    const scope = await h.client.run(scopeStep, { request: 'x' });
    const research = await h.client.run(researchStep, { tenant: 'Example Air' });

    expect(h.audit.paths()).toEqual([
      'ai/job-42/001-scope-response-1.json',
      'ai/job-42/001-scope-sources.json',
      'ai/job-42/002-research-response-1.json',
      'ai/job-42/002-research-response-2.json',
      'ai/job-42/002-research-sources.json',
    ]);
    expect(scope.audit).toEqual([
      'ai/job-42/001-scope-response-1.json',
      'ai/job-42/001-scope-sources.json',
    ]);
    expect(research.audit).toHaveLength(3);
    for (const p of h.audit.paths())
      expect(h.audit.objects.get(p)!.contentType).toBe('application/json');

    const r2 = h.audit.json('ai/job-42/002-research-response-2.json') as {
      jobId: string;
      step: string;
      turn: number;
      request: { messages: unknown[] };
      response: { id: string; stop_reason: string };
    };
    expect(r2).toMatchObject({ jobId: 'job-42', step: 'research', turn: 2 });
    expect(r2.response).toMatchObject({ id: 'msg_research_02', stop_reason: 'end_turn' });
    expect(r2.request.messages).toHaveLength(2);
  });

  it('stores the deduplicated source list: search results, fetched pages and citations', async () => {
    const h = harness(loadExchanges('research-pause-turn'));
    const run = await h.client.run(researchStep, { tenant: 'Example Air' });
    const stored = h.audit.json('ai/job-0001/001-research-sources.json') as { sources: unknown };
    expect(stored.sources).toEqual(run.sources);
    expect(run.sources).toEqual([
      {
        url: 'https://investors.example.com/annual-report-2025',
        title: 'Example Air 2025 Annual Report',
        via: ['search', 'fetch'],
        pageAge: '2026-02-14',
        retrievedAt: '2026-11-23T09:12:00Z',
        citedText: [],
      },
      {
        url: 'https://news.example.org/example-air-results',
        title: 'Example Air posts full-year results',
        via: ['search', 'citation'],
        pageAge: '2026-01-30',
        retrievedAt: null,
        citedText: ['Operating revenue rose to 9.1 billion.'],
      },
    ]);
  });

  it('persists the response and sources of a refused step before throwing', async () => {
    const h = harness(loadExchanges('refusal'));
    await expect(h.client.run(scopeStep, { request: 'x' })).rejects.toBeInstanceOf(
      ModelRefusalError,
    );
    expect(h.audit.paths()).toEqual([
      'ai/job-0001/001-scope-response-1.json',
      'ai/job-0001/001-scope-sources.json',
    ]);
    expect(h.audit.json('ai/job-0001/001-scope-response-1.json')).toMatchObject({
      response: { stop_reason: 'refusal', stop_details: { category: 'cyber' } },
    });
  });

  it('never writes the API key into an audit object', async () => {
    const h = harness([
      ...loadExchanges('scope-end-turn'),
      ...loadExchanges('research-pause-turn'),
    ]);
    await h.client.run(scopeStep, { request: 'x' });
    await h.client.run(researchStep, { tenant: 'Example Air' });
    const dump = [...h.audit.objects.values()]
      .map((o) => new TextDecoder().decode(o.body))
      .join('\n');
    expect(dump).not.toContain(TEST_API_KEY);
  });

  it('rejects job ids that would escape ai/<job-id>/', () => {
    for (const jobId of ['', '../other', 'a/b', '.hidden']) {
      expect(() =>
        createClaudeModelClient({ jobId, config: testConfig(), audit: new MemoryAuditSink() }),
      ).toThrow(/job id/);
    }
  });

  it('runs without network: global fetch is blocked and unscripted requests fail', async () => {
    expect(() => fetch('https://api.anthropic.com/v1/messages')).toThrow(/network access/);
    const h = harness([]);
    const err = await h.client.run(scopeStep, { request: 'x' }).catch((e: unknown) => e);
    // The SDK wraps a transport failure as a (retryable) connection error; the cause is the fake's refusal.
    expect(err).toBeInstanceOf(Anthropic.APIConnectionError);
    expect(String((err as Error).cause)).toMatch(/unscripted request/);
    expect(h.audit.paths()).toEqual([]);
  });
});
