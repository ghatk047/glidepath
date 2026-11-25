import type { JsonValue } from '@glidepath/domain';
import { and, asc, eq } from 'drizzle-orm';
import { isUuid, jsonb } from '../repos/rows';
import { ai_reconfig_job } from '../schema';
import { tenantScope } from '../scope';
import type { TenantTx } from '../tenant';

/** One ai_reconfig_job row (schema.json tables.ai_reconfig_job); `status` is free text in the schema. */
export interface AiReconfigJobRecord {
  readonly id: string;
  readonly prompt: string;
  /** Proposed members, values, sources. */
  readonly plan: JsonValue;
  readonly status: string;
  /** Applied as one reviewable changeset. */
  readonly changeset_id: string | null;
}

export interface NewAiReconfigJob {
  readonly id?: string;
  readonly prompt: string;
  /** Default `{}`. */
  readonly plan?: JsonValue;
  readonly status: string;
  readonly changeset_id?: string | null;
}

export interface AiReconfigJobPatch {
  readonly plan?: JsonValue;
  readonly status?: string;
  readonly changeset_id?: string | null;
}

const record = (r: typeof ai_reconfig_job.$inferSelect): AiReconfigJobRecord => ({
  id: r.id,
  prompt: r.prompt,
  plan: r.plan as JsonValue,
  status: r.status,
  changeset_id: r.changeset_id,
});

export async function createAiReconfigJob(tx: TenantTx, input: NewAiReconfigJob): Promise<AiReconfigJobRecord> {
  const { tenantId } = tenantScope(tx, 'createAiReconfigJob');
  const [row] = await tx
    .insert(ai_reconfig_job)
    .values({
      tenant_id: tenantId,
      id: input.id ?? crypto.randomUUID(),
      prompt: input.prompt,
      plan: jsonb(input.plan ?? {}),
      status: input.status,
      changeset_id: input.changeset_id ?? null,
    })
    .returning();
  return record(row!);
}

export async function getAiReconfigJob(tx: TenantTx, id: string): Promise<AiReconfigJobRecord | null> {
  const { tenantId } = tenantScope(tx, 'getAiReconfigJob');
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select()
    .from(ai_reconfig_job)
    .where(and(eq(ai_reconfig_job.tenant_id, tenantId), eq(ai_reconfig_job.id, id)));
  return row ? record(row) : null;
}

/** The tenant's reconfiguration jobs, optionally of one status, ordered by id (the table has no timestamp). */
export async function listAiReconfigJobs(tx: TenantTx, status?: string): Promise<AiReconfigJobRecord[]> {
  const { tenantId } = tenantScope(tx, 'listAiReconfigJobs');
  const rows = await tx
    .select()
    .from(ai_reconfig_job)
    .where(
      and(eq(ai_reconfig_job.tenant_id, tenantId), status === undefined ? undefined : eq(ai_reconfig_job.status, status)),
    )
    .orderBy(asc(ai_reconfig_job.id));
  return rows.map(record);
}

export async function updateAiReconfigJob(
  tx: TenantTx,
  id: string,
  patch: AiReconfigJobPatch,
): Promise<AiReconfigJobRecord | null> {
  const { tenantId } = tenantScope(tx, 'updateAiReconfigJob');
  if (!isUuid(id)) return null;
  const set = {
    ...(patch.plan === undefined ? {} : { plan: jsonb(patch.plan) }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
    ...(patch.changeset_id === undefined ? {} : { changeset_id: patch.changeset_id }),
  };
  if (Object.keys(set).length === 0) return getAiReconfigJob(tx, id);
  const [row] = await tx
    .update(ai_reconfig_job)
    .set(set)
    .where(and(eq(ai_reconfig_job.tenant_id, tenantId), eq(ai_reconfig_job.id, id)))
    .returning();
  return row ? record(row) : null;
}

export async function deleteAiReconfigJob(tx: TenantTx, id: string): Promise<boolean> {
  const { tenantId } = tenantScope(tx, 'deleteAiReconfigJob');
  if (!isUuid(id)) return false;
  const rows = await tx
    .delete(ai_reconfig_job)
    .where(and(eq(ai_reconfig_job.tenant_id, tenantId), eq(ai_reconfig_job.id, id)))
    .returning({ id: ai_reconfig_job.id });
  return rows.length > 0;
}
