import type { Logger } from '../app/logger';
import type { ApplyJobOutcome, ExcelJobs, ExportJobOutcome } from '../routes/excel';
import type { JobQueue } from './queue';

/** Queue names of the worker's Excel handlers (XL-08). */
export const EXCEL_QUEUES = { export: 'excel.export', import: 'excel.import', apply: 'excel.apply' } as const;

/** Excel exports and applies finish in seconds; a request waits at most this long for the worker. */
export const EXCEL_JOB_TIMEOUT_MS = 120_000;

function object(value: unknown, queue: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`the ${queue} job answered no result`);
  }
  return value as Record<string, unknown>;
}

function text(o: Record<string, unknown>, key: string, queue: string): string {
  const v = o[key];
  if (typeof v !== 'string') throw new Error(`the ${queue} result has no '${key}'`);
  return v;
}

function strings(o: Record<string, unknown>, key: string, queue: string): string[] {
  const v = o[key];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error(`the ${queue} result has no '${key}' list`);
  return v as string[];
}

/**
 * API-10's `ExcelJobs` port over the worker's pg-boss queues (`excel.export`, `excel.import`, `excel.apply`).
 * Export and apply send the job and await its output (the job's own tenant transaction has committed when it
 * completes); `startImport` sends the preview job and returns at once, the client polls `GET imports/:id`
 * (ADR-024). A preview job that cannot be queued is logged: the row stays `parsed` with an empty report.
 */
export function excelJobsOverQueue(queue: JobQueue, logger?: Logger): ExcelJobs {
  return {
    async exportWorkbook(who, request) {
      const q = EXCEL_QUEUES.export;
      const out = object(await queue.run(q, { tenantId: who.tenantId, userId: who.userId, ...request }, { timeoutMs: EXCEL_JOB_TIMEOUT_MS }), q);
      const outcome: ExportJobOutcome = {
        id: text(out, 'id', q),
        templateVersion: text(out, 'templateVersion', q),
        scenarioIds: strings(out, 'scenarioIds', q),
        sheets: strings(out, 'sheets', q),
        fileName: text(out, 'fileName', q),
        checksum: text(out, 'checksum', q),
      };
      return outcome;
    },

    startImport(who, importJobId) {
      queue
        .enqueue(EXCEL_QUEUES.import, { tenantId: who.tenantId, userId: who.userId, importJobId })
        .then((id) => {
          if (id === null) logger?.warn('import preview was not accepted by the queue', { importJobId });
        })
        .catch((err: unknown) => logger?.error('import preview could not be queued', { err, importJobId }));
    },

    async applyImport(who, payload) {
      const q = EXCEL_QUEUES.apply;
      const out = object(await queue.run(q, { tenantId: who.tenantId, userId: who.userId, ...payload }, { timeoutMs: EXCEL_JOB_TIMEOUT_MS }), q);
      if (out.applied === null || typeof out.applied !== 'object') throw new Error(`the ${q} result has no 'applied'`);
      const changesetId = out.changesetId;
      if (changesetId !== null && typeof changesetId !== 'string') throw new Error(`the ${q} result has no 'changesetId'`);
      return { changesetId, applied: out.applied as ApplyJobOutcome['applied'] };
    },
  };
}
