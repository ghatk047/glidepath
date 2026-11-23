import type { JsonValue } from '@glidepath/domain';
import { registerHandler } from '../../runtime';
import type { JobContext } from '../../runtime';
import { runApply } from './apply';
import { defaultExcelDeps } from './deps';
import type { ExcelJobDeps } from './deps';
import { runExport } from './export';
import { runImport } from './import';
import { ExcelJobError } from './state';
import { QUEUE_APPLY, QUEUE_EXPORT, QUEUE_IMPORT } from './types';
import type { ApplyPayload, ExportPayload, ImportPayload } from './types';

let deps: ExcelJobDeps | undefined;
/** Production dependencies, created on the first job (spec files and the object store are not touched at import time). */
const depsOf = (): ExcelJobDeps => (deps ??= defaultExcelDeps());

const json = (v: unknown): JsonValue => JSON.parse(JSON.stringify(v)) as JsonValue;

function need(ok: boolean, message: string): void {
  if (!ok) throw new ExcelJobError('bad_payload', message);
}

registerHandler(QUEUE_EXPORT, async (ctx: JobContext) => {
  const p = ctx.payload as ExportPayload;
  need(Array.isArray(p.scenarioIds), 'excel.export needs scenarioIds.');
  return json(await runExport(ctx, p, depsOf()));
});

registerHandler(QUEUE_IMPORT, async (ctx: JobContext) => {
  const p = ctx.payload as ImportPayload;
  need(typeof p.importJobId === 'string', 'excel.import needs importJobId.');
  return json(await runImport(ctx, p, depsOf()));
});

registerHandler(QUEUE_APPLY, async (ctx: JobContext) => {
  const p = ctx.payload as ApplyPayload;
  need(typeof p.importJobId === 'string', 'excel.apply needs importJobId.');
  need(p.accept === 'all' || p.accept === 'selected', "excel.apply needs accept 'all' or 'selected'.");
  need(Array.isArray(p.decisions), 'excel.apply needs decisions (an array, possibly empty).');
  return json(await runApply(ctx, p, depsOf()));
});
