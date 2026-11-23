import { PostgresObjectStore, withTenant } from '@glidepath/data-access';
import type { DbHandle } from '@glidepath/data-access';
// Test wiring only: the real worker jobs (AI-06) run in-process against the test database with the worker's fake model
// client (no network, no key). Production wiring is the composition root's pg-boss port (`compose/ai-jobs.ts`).
import { runApply } from '../../../../../worker/src/jobs/ai/apply';
import type { AiJobDeps } from '../../../../../worker/src/jobs/ai/deps';
import { runReconfig } from '../../../../../worker/src/jobs/ai/reconfig';
import { testDeps } from '../../../../../worker/src/jobs/ai/testing/fake-model';
import type { Fixtures, FakeModel } from '../../../../../worker/src/jobs/ai/testing/fake-model';
import type { AiJobContext } from '../../../../../worker/src/jobs/ai/types';
import type { AiJobs, AiWho } from '../jobs';

export interface WorkerAiJobs {
  readonly jobs: AiJobs;
  readonly objects: (who: AiWho) => PostgresObjectStore;
  /** Every fake model client a job created, in order: `calls` lists the steps it ran. */
  readonly models: FakeModel[];
  /** Resolves when every started `ai.reconfig` job has ended. */
  settled(): Promise<void>;
}

/** `AiJobs` over the worker's `run*` functions, the fake model and the Postgres object store of `db`. */
export function workerAiJobs(db: DbHandle, fixtures: Fixtures): WorkerAiJobs {
  const objects = (who: AiWho): PostgresObjectStore => new PostgresObjectStore(db.db, who.tenantId, who.userId);
  const models: FakeModel[] = [];
  const deps: AiJobDeps = testDeps(fixtures, { models, overrides: { objects, db: () => db.db } });
  const ctxOf = (who: AiWho): AiJobContext => ({
    tenantId: who.tenantId,
    userId: who.userId,
    signal: new AbortController().signal,
    progress: () => undefined,
    withTenant: (fn) => withTenant(db.db, who.tenantId, who.userId, fn),
  });
  const running = new Set<Promise<unknown>>();
  const jobs: AiJobs = {
    startReconfig(who, { jobId }) {
      const p = runReconfig(ctxOf(who), { tenantId: who.tenantId, userId: who.userId, jobId }, deps).catch(() => undefined);
      running.add(p);
      void p.finally(() => running.delete(p));
      return Promise.resolve();
    },
    async estimateReconfig(who, { jobId }) {
      await runReconfig(ctxOf(who), { tenantId: who.tenantId, userId: who.userId, jobId, dryRun: true }, deps);
    },
    applyReconfig: (who, { jobId, accept, clientRequestId }) =>
      runApply(
        ctxOf(who),
        {
          tenantId: who.tenantId,
          userId: who.userId,
          jobId,
          accept: accept as ('seed' | 'lever_tuning')[],
          ...(clientRequestId === undefined ? {} : { clientRequestId }),
        },
        deps,
      ),
  };
  return { jobs, objects, models, settled: async () => void (await Promise.all([...running])) };
}
