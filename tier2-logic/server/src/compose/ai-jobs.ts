import type { AiJobs, ApplyJobOutcome } from '../routes/ai';
import type { JobQueue } from './queue';

/** Queue names of the worker's AI handlers (AI-06). */
export const AI_QUEUES = { reconfig: 'ai.reconfig', apply: 'ai.apply' } as const;

/** A dry run is one model call (step 1); an apply writes a tenant: both finish well inside this. */
export const AI_JOB_TIMEOUT_MS = 180_000;

function outcome(value: unknown): ApplyJobOutcome {
  const o = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  if (typeof o.jobId !== 'string' || typeof o.tenantId !== 'string' || typeof o.tenant !== 'string' || !Array.isArray(o.applied)) {
    throw new Error('the ai.apply job answered no result');
  }
  return o as unknown as ApplyJobOutcome;
}

/** API-11's `AiJobs` port over the worker's pg-boss queues. */
export function aiJobsOverQueue(queue: JobQueue): AiJobs {
  return {
    async startReconfig(who, { jobId }) {
      await queue.enqueue(AI_QUEUES.reconfig, { tenantId: who.tenantId, userId: who.userId, jobId });
    },
    async estimateReconfig(who, { jobId }) {
      await queue.run(AI_QUEUES.reconfig, { tenantId: who.tenantId, userId: who.userId, jobId, dryRun: true }, { timeoutMs: AI_JOB_TIMEOUT_MS });
    },
    async applyReconfig(who, { jobId, accept, clientRequestId }) {
      const payload = { tenantId: who.tenantId, userId: who.userId, jobId, accept: [...accept], ...(clientRequestId === undefined ? {} : { clientRequestId }) };
      return outcome(await queue.run(AI_QUEUES.apply, payload, { timeoutMs: AI_JOB_TIMEOUT_MS }));
    },
  };
}
