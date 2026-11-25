import type { JsonValue } from '@glidepath/domain';
import { and, desc, eq } from 'drizzle-orm';
import { isUuid, iso, jsonb, toDate } from '../repos/rows';
import { export_job } from '../schema';
import { tenantScope } from '../scope';
import type { TenantTx } from '../tenant';

/** One export_job row (schema.json tables.export_job). */
export interface ExportJobRecord {
  readonly id: string;
  readonly template_version: string;
  readonly scenario_ids: readonly string[];
  /** Every exported cell value, for the 3-way diff. */
  readonly snapshot: JsonValue;
  readonly file_uri: string;
  readonly checksum: string;
  readonly created_by: string;
  readonly created_at: string;
}

export interface NewExportJob {
  readonly id?: string;
  readonly template_version: string;
  readonly scenario_ids: readonly string[];
  readonly snapshot: JsonValue;
  readonly file_uri: string;
  readonly checksum: string;
  readonly created_by: string;
  /** Default: now. */
  readonly created_at?: string;
}

export interface ExportJobPatch {
  readonly snapshot?: JsonValue;
  readonly file_uri?: string;
  readonly checksum?: string;
}

const record = (r: typeof export_job.$inferSelect): ExportJobRecord => ({
  id: r.id,
  template_version: r.template_version,
  scenario_ids: r.scenario_ids,
  snapshot: r.snapshot as JsonValue,
  file_uri: r.file_uri,
  checksum: r.checksum,
  created_by: r.created_by,
  created_at: iso(r.created_at),
});

export async function createExportJob(tx: TenantTx, input: NewExportJob): Promise<ExportJobRecord> {
  const { tenantId } = tenantScope(tx, 'createExportJob');
  const [row] = await tx
    .insert(export_job)
    .values({
      tenant_id: tenantId,
      id: input.id ?? crypto.randomUUID(),
      template_version: input.template_version,
      scenario_ids: [...input.scenario_ids],
      snapshot: jsonb(input.snapshot),
      file_uri: input.file_uri,
      checksum: input.checksum,
      created_by: input.created_by,
      created_at: input.created_at === undefined ? new Date() : toDate(input.created_at),
    })
    .returning();
  return record(row!);
}

export async function getExportJob(tx: TenantTx, id: string): Promise<ExportJobRecord | null> {
  const { tenantId } = tenantScope(tx, 'getExportJob');
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select()
    .from(export_job)
    .where(and(eq(export_job.tenant_id, tenantId), eq(export_job.id, id)));
  return row ? record(row) : null;
}

/** The tenant's export jobs, newest first. */
export async function listExportJobs(tx: TenantTx, limit = 50): Promise<ExportJobRecord[]> {
  const { tenantId } = tenantScope(tx, 'listExportJobs');
  const rows = await tx
    .select()
    .from(export_job)
    .where(eq(export_job.tenant_id, tenantId))
    .orderBy(desc(export_job.created_at), desc(export_job.id))
    .limit(limit);
  return rows.map(record);
}

export async function updateExportJob(
  tx: TenantTx,
  id: string,
  patch: ExportJobPatch,
): Promise<ExportJobRecord | null> {
  const { tenantId } = tenantScope(tx, 'updateExportJob');
  if (!isUuid(id)) return null;
  const set = {
    ...(patch.snapshot === undefined ? {} : { snapshot: jsonb(patch.snapshot) }),
    ...(patch.file_uri === undefined ? {} : { file_uri: patch.file_uri }),
    ...(patch.checksum === undefined ? {} : { checksum: patch.checksum }),
  };
  if (Object.keys(set).length === 0) return getExportJob(tx, id);
  const [row] = await tx
    .update(export_job)
    .set(set)
    .where(and(eq(export_job.tenant_id, tenantId), eq(export_job.id, id)))
    .returning();
  return row ? record(row) : null;
}

export async function deleteExportJob(tx: TenantTx, id: string): Promise<boolean> {
  const { tenantId } = tenantScope(tx, 'deleteExportJob');
  if (!isUuid(id)) return false;
  const rows = await tx
    .delete(export_job)
    .where(and(eq(export_job.tenant_id, tenantId), eq(export_job.id, id)))
    .returning({ id: export_job.id });
  return rows.length > 0;
}
