import { changesetTx, createChangesetStore, getImportJob, updateImportJob } from '@glidepath/data-access';
import type { TenantTx } from '@glidepath/data-access';
import { applyChangeset, recomputeHook, revert } from '@glidepath/domain';
import type { ApplyOptions, JsonObject, JsonValue, RecomputeResult } from '@glidepath/domain';
import { toChangeset } from '@glidepath/excel';
import type { BuiltReport, ChangesetOptions } from '@glidepath/excel';
import type { ExcelJobDeps } from './deps';
import { ExcelJobError, loadTenantState } from './state';
import type { TenantState } from './state';
import type { AppliedImport, ApplyPayload, ExcelJobContext, StoredImportReport } from './types';

const json = (v: unknown): JsonValue => JSON.parse(JSON.stringify(v)) as JsonValue;

export interface ApplyJobResult {
  readonly importJobId: string;
  /** The first changeset (`import_job.changeset_id`); a multi-scenario import has one per layer, all in `changesetIds`. */
  readonly changesetId: string | null;
  readonly applied: AppliedImport;
  /** True when the import was already applied and nothing was written this time. */
  readonly replayed: boolean;
}

/**
 * Generates the key of a new line from the keys the tenant already has: their most common prefix,
 * the highest number plus one, the same width. The app assigns keys, never the workbook.
 */
export function newKeyGenerator(existing: readonly string[]): () => string {
  const parts = existing.flatMap((id) => {
    const m = /^(.*?)(\d+)$/.exec(id);
    return m ? [{ prefix: m[1] ?? '', n: Number(m[2]), width: (m[2] ?? '').length }] : [];
  });
  const counts = new Map<string, number>();
  for (const p of parts) counts.set(p.prefix, (counts.get(p.prefix) ?? 0) + 1);
  const prefix = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? 'new_';
  const mine = parts.filter((p) => p.prefix === prefix);
  let next = mine.reduce((m, p) => Math.max(m, p.n), 0);
  const width = mine.reduce((m, p) => Math.max(m, p.width), 1);
  const taken = new Set(existing);
  return () => {
    let key: string;
    do key = `${prefix}${String(++next).padStart(width, '0')}`;
    while (taken.has(key));
    taken.add(key);
    return key;
  };
}

/** The report as `toChangeset` takes it, from what `excel.import` stored. */
export const builtOf = (stored: StoredImportReport): BuiltReport => ({
  report: stored.report,
  items: stored.items,
  unmatched: stored.unmatched,
  warnings: stored.warnings as unknown as BuiltReport['warnings'],
});

/** The lookups `toChangeset` needs beyond the report: stored rows of edited lines, notes' values, keys of new lines. */
async function changesetOptions(
  tx: TenantTx,
  state: TenantState,
  stored: StoredImportReport,
): Promise<ChangesetOptions> {
  const layers = stored.base.scenarios;
  const lineKeys = [
    ...new Set(stored.report.changes.flatMap((c) => (c.sheet === 'Line_Items' && c.member !== '' ? [c.member] : []))),
  ];
  const rows = lineKeys.length === 0 ? new Map<string, JsonObject>() : await changesetTx(tx).loadMemberRows('line', lineKeys);
  const defaults = new Map(state.defaults.map((r) => [`${r.var_key}\u0000${r.member_key}`, r.value]));
  const nextKey = newKeyGenerator((state.members.line ?? []).map((m) => m.id));
  return {
    defaultsVersion: stored.base.defaultsVersion,
    scenarios: Object.fromEntries(Object.entries(layers).map(([k, l]) => [k, { id: l.id, version: l.version }])),
    memberRow: (dim, key) => (dim === 'line' ? (rows.get(key) ?? null) : null),
    newMemberKey: () => nextKey(),
    currentValue: (cell) => {
      if (cell.target === 'variable') return defaults.get(`${cell.key}\u0000${cell.member_key}`) ?? null;
      const layer = cell.scenario === null ? undefined : layers[cell.scenario];
      const pin = layer === undefined ? undefined : state.inputs.get(layer.id)?.overrides.find(
        (p) => p.node_key === cell.key && p.member_key === cell.member_key,
      );
      return pin?.value ?? null;
    },
  };
}

/**
 * `excel.apply` (05 section 2, step 4): the accepted rows of an `awaiting_review` import become
 * changesets of origin `excel_import` (`toChangeset`), applied through `applyChangeset` in one
 * transaction: all layers or none (a tenant-defaults changeset and one per scenario). Each draft starts
 * at the version the preview saw, so a scenario that moved since fails the apply with a conflict and
 * nothing is written. Each changeset recomputes (a new `calc_run`). The import job becomes `applied`
 * with its changeset ids; undo is `undoImport` (a `revert` of each).
 *
 * Throws `ToChangesetError` when a conflict has no decision, `ChangesetConflictError` /
 * `ChangesetRejectedError` from the write path.
 */
export async function runApply(
  ctx: ExcelJobContext,
  payload: ApplyPayload,
  deps: ExcelJobDeps,
): Promise<ApplyJobResult> {
  return ctx.withTenant(async (tx) => {
    const job = await getImportJob(tx, payload.importJobId);
    if (job === null) throw new ExcelJobError('import_not_found', `No import ${payload.importJobId} in this tenant.`);
    const stored = job.report as unknown as StoredImportReport;
    if (job.status === 'applied' && stored.applied !== undefined) {
      return {
        importJobId: job.id,
        changesetId: job.changeset_id,
        applied: stored.applied,
        replayed: true,
      };
    }
    if (job.status !== 'awaiting_review') {
      throw new ExcelJobError('not_reviewable', `Import ${job.id} is ${job.status}; only an import awaiting review can be applied.`);
    }

    ctx.progress(0.2, 'preparing the changes');
    const layerIds = Object.values(stored.base.scenarios).map((l) => l.id);
    const state = await loadTenantState(tx, deps, layerIds);
    const plan = toChangeset(
      builtOf(stored),
      {
        accept: payload.accept,
        decisions: payload.decisions.map(({ column, rowNumber, ...d }) => ({
          ...d,
          ...(column == null ? {} : { column }),
          ...(rowNumber == null ? {} : { rowNumber }),
        })),
      },
      await changesetOptions(tx, state, stored),
    );

    const store = createChangesetStore(tx);
    const recompute = recomputeHook({
      tenantId: state.tenant.id,
      modelVersionId: state.modelVersionId,
      bundle: state.bundle,
      cache: deps.cache,
    });
    const results = [];
    for (const [i, draft] of plan.drafts.entries()) {
      ctx.progress(0.3 + (0.6 * i) / plan.drafts.length, 'applying');
      const options: ApplyOptions<RecomputeResult> = {
        actor: ctx.userId,
        bundle: state.bundle,
        recompute,
        ...(payload.clientRequestId === undefined ? {} : { clientRequestId: `${payload.clientRequestId}:${i}` }),
      };
      results.push(await applyChangeset(store, draft, options));
    }

    const applied: AppliedImport = {
      changesetIds: results.map((r) => r.changesetId),
      scenarios: results.map((r) => ({
        scenarioId: r.scenarioId,
        changesetId: r.changesetId,
        version: r.version,
        editsCount: r.editsCount,
        ...(r.forkedFrom === undefined ? {} : { forkedFrom: r.forkedFrom }),
      })),
      editsCount: results.reduce((n, r) => n + r.changeset.changes.length, 0),
      warnings: json(results.flatMap((r) => r.warnings)) as JsonValue[],
      applied: plan.applied,
      skipped: plan.skipped.map((s) => ({ index: s.index, reason: s.reason })),
    };
    const next: StoredImportReport = { ...stored, applied };
    await updateImportJob(tx, job.id, {
      status: 'applied',
      changeset_id: results[0]?.changesetId ?? null,
      report: json(next),
    });
    ctx.progress(1, 'applied');
    return { importJobId: job.id, changesetId: results[0]?.changesetId ?? null, applied, replayed: false };
  });
}

/**
 * Undo of an applied import: `revert` of each of its changesets, newest first, in one transaction.
 * A cell that a later changeset changed makes the revert fail with a conflict and nothing is undone.
 */
export async function undoImport(
  ctx: ExcelJobContext,
  importJobId: string,
  deps: ExcelJobDeps,
): Promise<{ readonly revertedIds: readonly string[] }> {
  return ctx.withTenant(async (tx) => {
    const job = await getImportJob(tx, importJobId);
    const stored = job?.report as unknown as StoredImportReport | undefined;
    if (job === null || stored?.applied === undefined) {
      throw new ExcelJobError('not_applied', `Import ${importJobId} has not been applied.`);
    }
    const state = await loadTenantState(tx, deps, []);
    const store = createChangesetStore(tx);
    const recompute = recomputeHook({
      tenantId: state.tenant.id,
      modelVersionId: state.modelVersionId,
      bundle: state.bundle,
      cache: deps.cache,
    });
    const revertedIds: string[] = [];
    for (const id of [...stored.applied.changesetIds].reverse()) {
      const r = await revert(store, id, { actor: ctx.userId, bundle: state.bundle, recompute });
      revertedIds.push(r.changesetId);
    }
    return { revertedIds };
  });
}
