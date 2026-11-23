import { createExportJob } from '@glidepath/data-access';
import { buildWorkbook, writeWorkbook } from '@glidepath/excel';
import type { ExportMeta } from '@glidepath/excel';
import type { JsonValue } from '@glidepath/domain';
import type { ExcelJobDeps } from './deps';
import { ExcelJobError, exportValues, inputSheetNames, loadTenantState, sheetDefs } from './state';
import type { ColumnScenario } from './state';
import { XLSX_TYPE, exportKey, snapshotKey, toUri } from './storage';
import type { ExcelJobContext, ExportJobResult, ExportPayload, StoredExportSnapshot } from './types';

/**
 * `excel.export` (05 section 2, step 1): builds the workbook of the chosen scenarios from the current
 * database, stores the file (`exports/`) and the E snapshot (`export-snapshots/`), and writes the
 * `export_job` row. The snapshot is also the row's `snapshot` column, so a diff still has E when the
 * object is gone. Only `xlsx` is built here; a csv export is refused.
 */
export async function runExport(
  ctx: ExcelJobContext,
  payload: ExportPayload,
  deps: ExcelJobDeps,
): Promise<ExportJobResult> {
  if (payload.format === 'csv') {
    throw new ExcelJobError('unsupported_format', 'CSV export is not available yet; export the sheet as xlsx.');
  }
  if (payload.scenarioIds.length === 0) throw new ExcelJobError('no_scenarios', 'Choose at least one scenario to export.');
  const exportJobId = payload.exportJobId ?? deps.newId();
  const exportedAt = deps.now();

  ctx.progress(0.1, 'reading the model');
  const read = await ctx.withTenant(async (tx) => {
    const state = await loadTenantState(tx, deps, payload.scenarioIds);
    const columns: ColumnScenario[] = payload.scenarioIds.map((id) => {
      const record = state.scenarios.find((s) => s.id === id);
      if (record === undefined) throw new ExcelJobError('scenario_not_found', `No scenario ${id} in this tenant.`);
      return { record, id: record.key };
    });
    const defs = sheetDefs(state, payload.sheets);
    if (payload.sheets !== undefined) {
      const known = new Set(inputSheetNames(sheetDefs(state)));
      const unknown = payload.sheets.filter((s) => !known.has(s));
      if (unknown.length > 0) throw new ExcelJobError('unknown_sheet', `Unknown sheet: ${unknown.join(', ')}.`);
    }
    const meta: ExportMeta = {
      tenantId: state.tenant.id,
      tenantSlug: state.tenant.slug,
      modelVersion: state.modelVersionId,
      templateVersion: state.template.template_version,
      exportJobId,
      exportedAt,
      exportedBy: ctx.userId,
      fileNamePattern: state.template.file.name_pattern,
    };
    return { defs, columns, values: exportValues(state, columns, true), meta };
  });

  ctx.progress(0.5, 'building the workbook');
  const built = buildWorkbook(read.defs, read.values, read.meta);
  const bytes = await writeWorkbook(built.workbook);

  ctx.progress(0.8, 'storing the file');
  const store = deps.objects({ tenantId: ctx.tenantId, userId: ctx.userId });
  const fileUri = toUri('exports', exportKey(exportJobId, built.fileName));
  const snapshotUri = toUri('export-snapshots', snapshotKey(exportJobId));
  const stored: StoredExportSnapshot = {
    snapshot: built.snapshot,
    scenarios: read.columns.map((c) => ({ id: c.record.id, key: c.id, label: c.record.label })),
    sheets: inputSheetNames(read.defs),
    fileUri,
    fileName: built.fileName,
  };
  await store.put('exports', exportKey(exportJobId, built.fileName), bytes, { contentType: XLSX_TYPE });
  await store.put('export-snapshots', snapshotKey(exportJobId), new TextEncoder().encode(JSON.stringify(stored)), {
    contentType: 'application/json',
  });

  await ctx.withTenant((tx) =>
    createExportJob(tx, {
      id: exportJobId,
      template_version: read.meta.templateVersion,
      scenario_ids: payload.scenarioIds,
      snapshot: stored as unknown as JsonValue,
      file_uri: fileUri,
      checksum: built.snapshot.checksum,
      created_by: ctx.userId,
      created_at: exportedAt.toISOString(),
    }),
  );
  ctx.progress(1, 'done');
  return {
    id: exportJobId,
    templateVersion: read.meta.templateVersion,
    scenarioIds: payload.scenarioIds,
    sheets: stored.sheets,
    fileUri,
    snapshotUri,
    fileName: built.fileName,
    checksum: built.snapshot.checksum,
    size: bytes.byteLength,
  };
}
