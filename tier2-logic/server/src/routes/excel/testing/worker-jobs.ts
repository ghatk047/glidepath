import { PostgresObjectStore, withTenant } from '@glidepath/data-access';
import type { DbHandle } from '@glidepath/data-access';
// Test wiring only: the real worker jobs (XL-08) run in-process against the test database. Production wiring
// belongs to the server composition root; the routes depend on the `ExcelJobs` port alone.
import { runApply } from '../../../../../worker/src/jobs/excel/apply';
import { defaultExcelDeps } from '../../../../../worker/src/jobs/excel/deps';
import type { ExcelJobDeps } from '../../../../../worker/src/jobs/excel/deps';
import { runExport } from '../../../../../worker/src/jobs/excel/export';
import { runImport } from '../../../../../worker/src/jobs/excel/import';
import type { ExcelJobContext } from '../../../../../worker/src/jobs/excel/types';
import type { ExcelJobs, ExcelWho } from '../jobs';

/** `ExcelJobs` over the worker's `run*` functions, with the object store on the same (RLS) database. */
export function workerJobs(db: DbHandle): {
  jobs: ExcelJobs;
  objects: (who: ExcelWho) => PostgresObjectStore;
  /** Resolves when every started import preview has ended. */
  settled(): Promise<void>;
} {
  const objects = (who: ExcelWho): PostgresObjectStore => new PostgresObjectStore(db.db, who.tenantId, who.userId);
  const deps: ExcelJobDeps = { ...defaultExcelDeps(), objects };
  const ctxOf = (who: ExcelWho): ExcelJobContext => ({
    tenantId: who.tenantId,
    userId: who.userId,
    signal: new AbortController().signal,
    progress: () => undefined,
    withTenant: (fn) => withTenant(db.db, who.tenantId, who.userId, fn),
  });
  const running = new Set<Promise<unknown>>();
  const jobs: ExcelJobs = {
    exportWorkbook: (who, request) => runExport(ctxOf(who), { tenantId: who.tenantId, userId: who.userId, ...request }, deps),
    startImport(who, importJobId) {
      const p = runImport(ctxOf(who), { tenantId: who.tenantId, userId: who.userId, importJobId }, deps).catch(() => undefined);
      running.add(p);
      void p.finally(() => running.delete(p));
    },
    applyImport: (who, payload) => runApply(ctxOf(who), { tenantId: who.tenantId, userId: who.userId, ...payload }, deps),
  };
  return { jobs, objects, settled: async () => void (await Promise.all([...running])) };
}
