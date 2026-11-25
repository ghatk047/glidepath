import type { JsonValue } from '@glidepath/domain';
import { and, asc, eq } from 'drizzle-orm';
import { isUuid, jsonb } from '../repos/rows';
import { import_job } from '../schema';
import { tenantScope } from '../scope';
import type { TenantTx } from '../tenant';

export type ImportJobStatus = (typeof import_job.$inferSelect)['status'];

/** One import_job row (schema.json tables.import_job). */
export interface ImportJobRecord {
  readonly id: string;
  /** From the workbook's _meta; null = a foreign workbook. */
  readonly export_job_id: string | null;
  readonly file_uri: string;
  readonly status: ImportJobStatus;
  readonly changeset_id: string | null;
  /** Delta report. */
  readonly report: JsonValue;
}

export interface NewImportJob {
  readonly id?: string;
  readonly export_job_id?: string | null;
  readonly file_uri: string;
  /** Default `parsed`. */
  readonly status?: ImportJobStatus;
  readonly changeset_id?: string | null;
  /** Default `{}`. */
  readonly report?: JsonValue;
}

export interface ImportJobPatch {
  readonly file_uri?: string;
  readonly status?: ImportJobStatus;
  readonly changeset_id?: string | null;
  readonly report?: JsonValue;
}

const record = (r: typeof import_job.$inferSelect): ImportJobRecord => ({
  id: r.id,
  export_job_id: r.export_job_id,
  file_uri: r.file_uri,
  status: r.status,
  changeset_id: r.changeset_id,
  report: r.report as JsonValue,
});

export async function createImportJob(tx: TenantTx, input: NewImportJob): Promise<ImportJobRecord> {
  const { tenantId } = tenantScope(tx, 'createImportJob');
  const [row] = await tx
    .insert(import_job)
    .values({
      tenant_id: tenantId,
      id: input.id ?? crypto.randomUUID(),
      export_job_id: input.export_job_id ?? null,
      file_uri: input.file_uri,
      status: input.status ?? 'parsed',
      changeset_id: input.changeset_id ?? null,
      report: jsonb(input.report ?? {}),
    })
    .returning();
  return record(row!);
}

export async function getImportJob(tx: TenantTx, id: string): Promise<ImportJobRecord | null> {
  const { tenantId } = tenantScope(tx, 'getImportJob');
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select()
    .from(import_job)
    .where(and(eq(import_job.tenant_id, tenantId), eq(import_job.id, id)));
  return row ? record(row) : null;
}

/** The tenant's import jobs, optionally of one status, ordered by id (the table has no timestamp). */
export async function listImportJobs(tx: TenantTx, status?: ImportJobStatus): Promise<ImportJobRecord[]> {
  const { tenantId } = tenantScope(tx, 'listImportJobs');
  const rows = await tx
    .select()
    .from(import_job)
    .where(and(eq(import_job.tenant_id, tenantId), status === undefined ? undefined : eq(import_job.status, status)))
    .orderBy(asc(import_job.id));
  return rows.map(record);
}

export async function updateImportJob(
  tx: TenantTx,
  id: string,
  patch: ImportJobPatch,
): Promise<ImportJobRecord | null> {
  const { tenantId } = tenantScope(tx, 'updateImportJob');
  if (!isUuid(id)) return null;
  const set = {
    ...(patch.file_uri === undefined ? {} : { file_uri: patch.file_uri }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
    ...(patch.changeset_id === undefined ? {} : { changeset_id: patch.changeset_id }),
    ...(patch.report === undefined ? {} : { report: jsonb(patch.report) }),
  };
  if (Object.keys(set).length === 0) return getImportJob(tx, id);
  const [row] = await tx
    .update(import_job)
    .set(set)
    .where(and(eq(import_job.tenant_id, tenantId), eq(import_job.id, id)))
    .returning();
  return row ? record(row) : null;
}

export async function deleteImportJob(tx: TenantTx, id: string): Promise<boolean> {
  const { tenantId } = tenantScope(tx, 'deleteImportJob');
  if (!isUuid(id)) return false;
  const rows = await tx
    .delete(import_job)
    .where(and(eq(import_job.tenant_id, tenantId), eq(import_job.id, id)))
    .returning({ id: import_job.id });
  return rows.length > 0;
}
