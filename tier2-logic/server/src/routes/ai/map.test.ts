import { describe, expect, it } from 'vitest';
import { aiJobsOverQueue } from '../../compose/ai-jobs';
import type { JobQueue } from '../../compose/queue';
import { toReconfigJob } from './map';

const host = { slug: 'xa', currency: 'USD' };
const times = { createdAt: '2026-11-23T10:00:00.000Z', updatedAt: '2026-11-23T10:05:00.000Z', createdBy: null };
const row = (status: string, plan: unknown) => ({ id: 'job-1', prompt: 'Set up Example Air', status, plan });

describe('toReconfigJob (API-11)', () => {
  it('a queued row the worker has not touched shows a pending estimate and no sections', () => {
    const job = toReconfigJob(row('queued', {}), host, times);
    expect(job).toMatchObject({ status: 'queued', step: null, progress: 0, plan: null, drafts: [], usage: null, error: null });
    expect(job.costEstimate.model).toBe('pending');
  });

  it('budget_exceeded is a contract status; the stored error becomes a problem and the usage is kept', () => {
    const stored = {
      format: 1,
      step: 'research',
      progress: 0.3,
      note: 'Stopped at the token budget',
      estimate: { inputTokens: 10, outputTokens: 5, usd: 0.5, model: 'm', maxTokens: 100 },
      usage: { calls: 2, inputTokens: 90, outputTokens: 20, usd: 0.7 },
      error: { code: 'budget_exceeded', message: 'The job used 110 of 100 tokens.' },
      review: null,
    };
    const job = toReconfigJob(row('budget_exceeded', stored), host, times);
    expect(job.status).toBe('budget_exceeded');
    expect(job.error).toMatchObject({ status: 422, title: 'Token budget reached', detail: 'The job used 110 of 100 tokens.' });
    expect(job.usage).toEqual({ inputTokens: 90, outputTokens: 20, usd: 0.7 });
    expect(job.costEstimate.maxTokens).toBe(100);
  });

  it('a tune plan names the host tenant; scalar cells get the empty member; flags become open questions', () => {
    const plan = {
      intent: 'tune',
      tenant: { name: 'Example Air', iataCode: 'XA', ticker: null, currency: null, existingTenantId: 'x' },
      baseYear: 2025,
      targetYear: 2027,
      lastReportedYear: 2025,
      produce: ['lever_tuning'],
      checklist: [],
      openQuestions: [],
    };
    const drafts = {
      seed: null,
      lever_tuning: {
        title: 'Tuning',
        summary: 'Two changes',
        changes: 2,
        sections: [],
        warnings: [],
        impact: [{ scope: null, rows: [{ cell: 'res.net', before: 1, after: 2 }, { cell: 'pl.rev[fy27]', before: null, after: null }], error: null }],
      },
    };
    const stored = {
      format: 1,
      step: 'review',
      progress: 1,
      note: 'Ready',
      estimate: { inputTokens: 1, outputTokens: 1, usd: 0, model: 'm', maxTokens: 5 },
      review: {
        plan,
        sources: [
          { url: 'https://example.com/10k', title: 'Annual report', seenBy: [], factIds: ['f1'] },
          { url: 'file:///secret', title: null, seenBy: [], factIds: [] },
        ],
        facts: [{ id: 'f1', step: 'a', label: 'Revenue', value: 5, unit: 'USD m', sourceUrl: 'https://example.com/10k', date: '2026-02-01', confidence: 'H' }],
        openQuestions: [],
        flags: [{ kind: 'unsourced', step: null, target: 'f2', message: 'No source' }],
        validation: null,
        calibration: null,
        drafts,
      },
    };
    const job = toReconfigJob(row('review', stored), host, times);
    expect(job.tenant).toBe('xa');
    expect(job.plan).toMatchObject({ mode: 'existing_tenant', tenant: { slug: 'xa', currency: 'USD', monogram: 'XA' } });
    expect(job.drafts[0]!.impact).toEqual([{ cell: 'res.net[]', before: 1, after: 2 }]);
    expect(job.sources).toHaveLength(1); // only public web pages are citations
    expect(job.facts[0]!.sourceId).toBe(job.sources[0]!.id);
    expect(job.openQuestions).toEqual([{ id: 'flag:unsourced:f2', question: 'No source', context: 'unsourced', item: null, blocking: false }]);
  });
});

describe('aiJobsOverQueue (API-11)', () => {
  it('sends ai.reconfig, runs the dry run and ai.apply on the worker queues', async () => {
    const sent: { op: string; queue: string; payload: Record<string, unknown> }[] = [];
    const queue: JobQueue = {
      enqueue: (q, p) => {
        sent.push({ op: 'enqueue', queue: q, payload: p });
        return Promise.resolve('id-1');
      },
      run: (q, p) => {
        sent.push({ op: 'run', queue: q, payload: p });
        return Promise.resolve(q === 'ai.apply' ? { jobId: 'j', tenantId: 't', tenant: 'zz', applied: [] } : {});
      },
      close: () => Promise.resolve(),
    };
    const jobs = aiJobsOverQueue(queue);
    const who = { tenantId: 't', userId: 'u' };
    await jobs.startReconfig(who, { jobId: 'j' });
    await jobs.estimateReconfig(who, { jobId: 'j' });
    expect(await jobs.applyReconfig(who, { jobId: 'j', accept: ['seed'], clientRequestId: 'r' })).toMatchObject({ tenant: 'zz' });
    expect(sent).toEqual([
      { op: 'enqueue', queue: 'ai.reconfig', payload: { tenantId: 't', userId: 'u', jobId: 'j' } },
      { op: 'run', queue: 'ai.reconfig', payload: { tenantId: 't', userId: 'u', jobId: 'j', dryRun: true } },
      { op: 'run', queue: 'ai.apply', payload: { tenantId: 't', userId: 'u', jobId: 'j', accept: ['seed'], clientRequestId: 'r' } },
    ]);
  });
});
