import { describe, expect, it } from 'vitest';
import { aiJobsOverQueue } from '../../compose/ai-jobs';
import type { JobQueue } from '../../compose/queue';
import { onboardingOf, toReconfigJob } from './map';
import { parityOf } from './parity';

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

describe('onboarding step states (API-14)', () => {
  const steps = ['tenant_record', 'baseline_lines', 'org', 'sources'];
  const fact = (item: string, sourceId: string | null, confidence = 'M') => ({ item, sourceId, confidence });

  it('is todo with nothing behind it, review for an open question or an unsourced / low-confidence fact, done for sourced facts', () => {
    const out = onboardingOf(
      steps,
      [fact('tenant_record', 'S1', 'H'), fact('baseline_lines', 'S1'), fact('baseline_lines', null), fact('org', 'S1', 'L')],
      [],
      'review',
    );
    expect(out.steps).toEqual([
      { id: 'tenant_record', state: 'done' },
      { id: 'baseline_lines', state: 'review' },
      { id: 'org', state: 'review' },
      { id: 'sources', state: 'todo' },
    ]);
    expect(out).toMatchObject({ done: 1, total: 4 });
    const asked = onboardingOf(steps, [fact('sources', 'S1')], [{ item: 'sources' }, { item: null }], 'review');
    expect(asked.steps.at(-1)).toEqual({ id: 'sources', state: 'review' });
  });

  it('an applied job settles every step that has something behind it; the rest stay todo', () => {
    const out = onboardingOf(steps, [fact('org', null, 'L')], [{ item: 'tenant_record' }], 'applied');
    expect(out.steps.map((s) => s.state)).toEqual(['done', 'todo', 'done', 'todo']);
    expect(out.done).toBe(2);
  });

  it('follows the stored plan: its checklist in order, none before the plan is known or for a tuning plan', () => {
    expect(toReconfigJob(row('queued', {}), host, times).onboarding).toEqual({ steps: [], done: 0, total: 0 });
    const plan = {
      intent: 'onboard',
      tenant: { name: 'Example Air', iataCode: 'XA', ticker: null, currency: 'USD' },
      baseYear: 2025,
      targetYear: 2027,
      produce: ['seed'],
      checklist: ['org', 'tenant_record', 'org'],
    };
    const stored = {
      format: 1,
      step: 'review',
      progress: 1,
      estimate: { inputTokens: 1, outputTokens: 1, usd: 0.1, model: 'm', maxTokens: 10 },
      review: {
        plan,
        sources: [{ url: 'https://example.com/ar', title: 'Annual report' }],
        facts: [{ id: 'f1', step: 'tenant_record', label: 'Name', value: 'Example Air', unit: '', sourceUrl: 'https://example.com/ar', date: null, confidence: 'H' }],
        flags: [{ kind: 'incomplete_checklist', step: 'org', target: 'plan', message: 'Org is thin' }],
        drafts: {},
      },
    };
    const job = toReconfigJob(row('review', stored), host, times);
    expect(job.onboarding).toEqual({
      steps: [
        { id: 'org', state: 'review' },
        { id: 'tenant_record', state: 'done' },
      ],
      done: 1,
      total: 2,
    });
  });
});

describe('parityOf (API-14)', () => {
  const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
  const record = { format: 'glidepath.parity/1', tenant: 'aa', recordedAt: '2026-11-23T10:00:00Z', passed: 9, total: 10 };

  it('reads the stored record as the parity of the tenant that holds it', () => {
    expect(parityOf(bytes(record), 'aa')).toEqual({ tenant: 'aa', passed: 9, total: 10, recordedAt: '2026-11-23T10:00:00.000Z' });
  });

  it('a record it cannot read is none, never an error', () => {
    expect(parityOf(new TextEncoder().encode('not json'), 'aa')).toBeNull();
    expect(parityOf(bytes({ ...record, format: 'other' }), 'aa')).toBeNull();
    expect(parityOf(bytes({ ...record, passed: 11 }), 'aa')).toBeNull();
    expect(parityOf(bytes({ ...record, recordedAt: 'yesterday' }), 'aa')).toBeNull();
    expect(parityOf(bytes(null), 'aa')).toBeNull();
  });
});
