import { getExportJob, getImportJob, sql, updateImportJob } from '@glidepath/data-access';
import type { ScenarioRecord, TenantTx } from '@glidepath/data-access';
import type { ChangesetDraft, JsonValue } from '@glidepath/domain';
import {
  ParseError,
  buildReport,
  buildWorkbook,
  buildTemplate,
  diff,
  identifyWorkbook,
  parseWorkbook,
  toChangeset,
  validateParsed,
  withImpact,
} from '@glidepath/excel';
import type { BuiltReport, ExportMeta, ParsedWorkbook, SheetDef } from '@glidepath/excel';
import type { ExcelJobDeps } from './deps';
import { previewImpact } from './impact';
import {
  ExcelJobError,
  exportValues,
  loadTenantState,
  sheetDefs,
} from './state';
import type { ColumnScenario, TenantState } from './state';
import { readStored, snapshotKey } from './storage';
import type {
  ExcelJobContext,
  ImportPayload,
  LayerVersion,
  ScenarioImpact,
  StoredExportSnapshot,
  StoredImportReport,
} from './types';

const json = (v: unknown): JsonValue => JSON.parse(JSON.stringify(v)) as JsonValue;

export interface ImportJobResult {
  readonly importJobId: string;
  readonly status: 'awaiting_review';
  readonly mode: 'three_way' | 'foreign';
  readonly summary: BuiltReport['report']['summary'];
}

/**
 * `excel.import` (05 section 2, step 2; spec 05 section 3 steps 1-5): identify the workbook through
 * `_meta`, parse, validate, diff against the export snapshot and the current database, preview the
 * impact by an engine `rerun` per affected scenario, and save the delta report on the `import_job`
 * (status `awaiting_review`). A workbook without `_meta` is a foreign workbook: matched by key, two-way
 * diff against the database. Any failure ends the job `failed` with the reason in `report.error`.
 */
export async function runImport(
  ctx: ExcelJobContext,
  payload: ImportPayload,
  deps: ExcelJobDeps,
): Promise<ImportJobResult> {
  try {
    return await importWorkbook(ctx, payload, deps);
  } catch (err) {
    const code = err instanceof ExcelJobError ? err.code : err instanceof ParseError ? 'not_a_workbook' : 'import_failed';
    const message = err instanceof Error ? err.message : String(err);
    await ctx
      .withTenant((tx) =>
        updateImportJob(tx, payload.importJobId, { status: 'failed', report: json({ error: { code, message } }) }),
      )
      .catch(() => undefined);
    throw err;
  }
}

async function importWorkbook(
  ctx: ExcelJobContext,
  payload: ImportPayload,
  deps: ExcelJobDeps,
): Promise<ImportJobResult> {
  const store = deps.objects({ tenantId: ctx.tenantId, userId: ctx.userId });

  ctx.progress(0.05, 'reading the upload');
  const first = await ctx.withTenant(async (tx) => {
    const job = await getImportJob(tx, payload.importJobId);
    if (job === null) throw new ExcelJobError('import_not_found', `No import ${payload.importJobId} in this tenant.`);
    const state = await loadTenantState(tx, deps, []);
    return { job, scenarios: state.scenarios, defs: buildTemplate(state.template, state.bundle, state.members), tenantId: state.tenant.id, templateVersion: state.template.template_version };
  });
  const bytes = await readStored(store, first.job.file_uri);

  // 1. identify
  ctx.progress(0.15, 'reading the workbook');
  const probe = await parseWorkbook(bytes, first.defs);
  const who = identifyWorkbook(probe, { tenantId: first.tenantId, templateVersion: first.templateVersion });
  if (who.problems.length > 0) throw new ExcelJobError('wrong_workbook', who.problems.join(' '));

  let exported: StoredExportSnapshot | null = null;
  if (probe.mode === 'export' && probe.meta !== null) {
    const exportJobId = probe.meta.exportJobId;
    exported = await ctx.withTenant(async (tx) => {
      const row = await getExportJob(tx, exportJobId);
      if (row === null) {
        throw new ExcelJobError(
          'unknown_export',
          `This workbook comes from export ${exportJobId}, which this app does not know. Export again and re-apply the edits.`,
        );
      }
      const obj = await store.get('export-snapshots', snapshotKey(exportJobId));
      return obj === null
        ? (row.snapshot as unknown as StoredExportSnapshot)
        : (JSON.parse(new TextDecoder().decode(obj.bytes)) as StoredExportSnapshot);
    });
  }

  // 2. parse again with the scenarios of the columns, so repeated labels get their ids (foreign: the label is the id)
  const defsAtParse = exported === null ? first.defs : first.defs.filter((d) => keepSheet(d, exported!.sheets));
  const columnsAtParse =
    exported === null
      ? first.scenarios.filter((s) => !s.archived).map((s) => ({ id: s.label, label: s.label }))
      : exported.scenarios.map((s) => ({ id: s.key, label: s.label }));
  const parsed: ParsedWorkbook = await parseWorkbook(bytes, defsAtParse, { scenarios: columnsAtParse });

  ctx.progress(0.35, 'checking the values');
  await ctx.withTenant(async (tx) => {
    await updateImportJob(tx, payload.importJobId, { status: 'parsed' });
    if (exported !== null && parsed.meta !== null) await setExportJob(tx, payload.importJobId, parsed.meta.exportJobId);
  });

  // 3-5. validate, diff, impact: one transaction, so D and the versions are one consistent read
  const stored = await ctx.withTenant(async (tx) => {
    const state = await loadTenantState(tx, deps, exported === null ? 'live' : exported.scenarios.map((s) => s.id));
    const columns = columnsOf(state.scenarios, exported);
    return buildStored(ctx, state, columns, parsed, exported, payload, first.job.file_uri, deps);
  });

  ctx.progress(0.95, 'saving the report');
  await ctx.withTenant(async (tx) => {
    await updateImportJob(tx, payload.importJobId, { status: 'awaiting_review', report: json(stored) });
  });
  ctx.progress(1, 'ready for review');
  return {
    importJobId: payload.importJobId,
    status: 'awaiting_review',
    mode: stored.report.mode,
    summary: stored.report.summary,
  };
}

/** `import_job.export_job_id` has no patch field in data-access: set it with SQL (RLS scopes the row). */
async function setExportJob(tx: TenantTx, importJobId: string, exportJobId: string): Promise<void> {
  await tx.execute(sql`update import_job set export_job_id = ${exportJobId}::uuid where id = ${importJobId}::uuid`);
}

const keepSheet = (d: SheetDef, sheets: readonly string[]): boolean =>
  d.kind === 'readme' || d.kind === 'lists' || d.kind === 'meta' || sheets.includes(d.name);

/** The scenarios of the columns: those of the export (key as exported), or in a foreign workbook all live scenarios by label. */
function columnsOf(scenarios: readonly ScenarioRecord[], exported: StoredExportSnapshot | null): ColumnScenario[] {
  if (exported !== null) {
    return exported.scenarios.map((s) => {
      const record = scenarios.find((r) => r.id === s.id);
      if (record === undefined) {
        throw new ExcelJobError('scenario_not_found', `Scenario '${s.label}' of the export no longer exists.`);
      }
      return { record, id: s.key };
    });
  }
  return scenarios.filter((s) => !s.archived).map((record) => ({ record, id: record.label }));
}

function buildStored(
  ctx: ExcelJobContext,
  state: TenantState,
  columns: readonly ColumnScenario[],
  parsed: ParsedWorkbook,
  exported: StoredExportSnapshot | null,
  payload: ImportPayload,
  fileUri: string,
  deps: ExcelJobDeps,
): StoredImportReport {
  const defs = exported === null ? sheetDefs(state) : sheetDefs(state, exported.sheets);

  // D: the app now, in the form of the export snapshot (same scenarios, same columns)
  const meta: ExportMeta = {
    tenantId: state.tenant.id,
    tenantSlug: state.tenant.slug,
    modelVersion: state.modelVersionId,
    templateVersion: state.template.template_version,
    exportJobId: exported?.snapshot.exportJobId ?? payload.importJobId,
    exportedAt: deps.now(),
    exportedBy: ctx.userId,
    fileNamePattern: state.template.file.name_pattern,
  };
  const values = exportValues(state, columns, false);
  const current = buildWorkbook(defs, values, meta).snapshot;

  const entries = validateParsed(parsed, {
    sheets: defs,
    model: state.bundle,
    members: state.members,
    current: {
      defaults: state.defaults,
      scenarios: Object.fromEntries(values.scenarios.map((s) => [s.id, s.values])),
    },
  });
  const diffResult = diff(exported?.snapshot ?? null, parsed, current, defs);
  const built = buildReport(diffResult, entries, {
    importJobId: payload.importJobId,
    exportJobId: exported?.snapshot.exportJobId ?? null,
  });

  const layers: Record<string, LayerVersion> = Object.fromEntries(
    columns.map((c) => [c.id, { id: c.record.id, key: c.record.key, label: c.record.label, version: c.record.version }]),
  );
  const { impacts, notes, first } = impactOf(state, columns, built, layers, deps);
  const report = first === null ? built.report : withImpact(built, first).report;

  return {
    report,
    items: json(built.items) as unknown as StoredImportReport['items'],
    unmatched: built.unmatched,
    warnings: json(built.warnings) as JsonValue[],
    impacts,
    impactNotes: notes,
    base: { defaultsVersion: state.defaultsVersion, scenarios: layers },
    ignored: {
      sheets: [...parsed.unknownSheets],
      columns: parsed.sheets.flatMap((s) => s.unknownColumns.map((c) => ({ sheet: s.name, header: c.header }))),
    },
    violations: json(entries) as JsonValue[],
    filename: fileUri.slice(fileUri.lastIndexOf('/') + 1),
  };
}

/** Step 5: rerun the engine per affected scenario with the default decisions (conflicts: the file wins). */
function impactOf(
  state: TenantState,
  columns: readonly ColumnScenario[],
  built: BuiltReport,
  layers: Readonly<Record<string, LayerVersion>>,
  deps: ExcelJobDeps,
): { impacts: ScenarioImpact[]; notes: string[]; first: ScenarioImpact | null } {
  const decisions = built.report.changes.flatMap((c) =>
    c.status === 'conflict'
      ? [{ sheet: c.sheet, key: c.key, member: c.member, scenario: c.scenario, take: 'excel' as const }]
      : [],
  );
  let drafts: readonly ChangesetDraft[];
  let applied: readonly number[];
  try {
    const plan = toChangeset(built, { accept: 'all', decisions }, {
      defaultsVersion: state.defaultsVersion,
      scenarios: Object.fromEntries(Object.entries(layers).map(([k, l]) => [k, { id: l.id, version: l.version }])),
    });
    drafts = plan.drafts;
    applied = plan.applied;
  } catch (err) {
    return { impacts: [], notes: [`No impact preview: ${err instanceof Error ? err.message : String(err)}`], first: null };
  }
  if (drafts.length === 0) return { impacts: [], notes: [], first: null };

  const touchesDefaults = applied.some((i) => built.report.changes[i]?.scenario === null);
  const touched = new Set(applied.flatMap((i) => built.report.changes[i]?.scenario ?? []));
  const targets = columns.filter((c) => touchesDefaults || touched.has(c.id)).slice(0, deps.maxImpactScenarios);

  const impacts: ScenarioImpact[] = [];
  let structural = 0;
  for (const c of targets) {
    const inputs = state.inputs.get(c.record.id);
    if (inputs === undefined) continue;
    const r = previewImpact({
      model: state.model,
      bundle: state.bundle,
      members: state.members,
      state: inputs,
      scenarioId: c.record.id,
      scenarioKey: c.id,
      drafts,
      nodes: deps.impactNodes,
    });
    impacts.push(r.impact);
    structural = Math.max(structural, r.skippedStructural);
  }
  const notes = structural > 0 ? [`${structural} new or deleted lines are not in the impact preview.`] : [];
  return { impacts, notes, first: impacts[0] ?? null };
}
