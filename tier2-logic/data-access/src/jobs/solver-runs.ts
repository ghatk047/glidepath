import type { JsonValue } from '@glidepath/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import { isUuid, iso, jsonb, toDate } from '../repos/rows';
import { solver_run } from '../schema';
import { tenantScope } from '../scope';
import type { TenantTx } from '../tenant';

export type SolverRunKind = (typeof solver_run.$inferSelect)['kind'];
export type SolverRunStatus = (typeof solver_run.$inferSelect)['status'];

/** One solver_run row (schema.json tables.solver_run plus the progress columns of manual migration 0001). */
export interface SolverRunRecord {
  readonly id: string;
  readonly kind: SolverRunKind;
  /** Start point. */
  readonly scenario_id: string;
  /** Problem per solvers.json. */
  readonly spec: JsonValue;
  readonly status: SolverRunStatus;
  readonly result: JsonValue;
  /** Solver output saved as a scenario. */
  readonly result_scenario_id: string | null;
  readonly created_at: string;
  /** 0..1 */
  readonly progress: number;
  readonly progress_note: string | null;
  readonly cancel_requested: boolean;
  readonly updated_at: string;
}

export interface NewSolverRun {
  readonly id?: string;
  readonly kind: SolverRunKind;
  readonly scenario_id: string;
  readonly spec: JsonValue;
  /** Default `queued`. */
  readonly status?: SolverRunStatus;
  /** Default: now. */
  readonly created_at?: string;
}

export interface SolverRunPatch {
  readonly status?: SolverRunStatus;
  readonly result?: JsonValue;
  readonly result_scenario_id?: string | null;
  readonly progress?: number;
  readonly progress_note?: string | null;
  readonly cancel_requested?: boolean;
}

const record = (r: typeof solver_run.$inferSelect): SolverRunRecord => ({
  id: r.id,
  kind: r.kind,
  scenario_id: r.scenario_id,
  spec: r.spec as JsonValue,
  status: r.status,
  result: r.result as JsonValue,
  result_scenario_id: r.result_scenario_id,
  created_at: iso(r.created_at),
  progress: r.progress,
  progress_note: r.progress_note,
  cancel_requested: r.cancel_requested,
  updated_at: iso(r.updated_at),
});

/** Creates a solver_run of the current tenant (status `queued`, empty result, progress 0). */
export async function createSolverRun(tx: TenantTx, input: NewSolverRun): Promise<SolverRunRecord> {
  const { tenantId } = tenantScope(tx, 'createSolverRun');
  const [row] = await tx
    .insert(solver_run)
    .values({
      tenant_id: tenantId,
      id: input.id ?? crypto.randomUUID(),
      kind: input.kind,
      scenario_id: input.scenario_id,
      spec: jsonb(input.spec),
      status: input.status ?? 'queued',
      result: {},
      result_scenario_id: null,
      created_at: input.created_at === undefined ? new Date() : toDate(input.created_at),
    })
    .returning();
  return record(row!);
}

export async function getSolverRun(tx: TenantTx, id: string): Promise<SolverRunRecord | null> {
  const { tenantId } = tenantScope(tx, 'getSolverRun');
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select()
    .from(solver_run)
    .where(and(eq(solver_run.tenant_id, tenantId), eq(solver_run.id, id)));
  return row ? record(row) : null;
}

export interface SolverRunFilter {
  readonly status?: SolverRunStatus;
  readonly scenarioId?: string;
  /** Default 50. */
  readonly limit?: number;
}

/** The tenant's solver runs, newest first. */
export async function listSolverRuns(tx: TenantTx, filter: SolverRunFilter = {}): Promise<SolverRunRecord[]> {
  const { tenantId } = tenantScope(tx, 'listSolverRuns');
  if (filter.scenarioId !== undefined && !isUuid(filter.scenarioId)) return [];
  const rows = await tx
    .select()
    .from(solver_run)
    .where(
      and(
        eq(solver_run.tenant_id, tenantId),
        filter.status === undefined ? undefined : eq(solver_run.status, filter.status),
        filter.scenarioId === undefined ? undefined : eq(solver_run.scenario_id, filter.scenarioId),
      ),
    )
    .orderBy(desc(solver_run.created_at), desc(solver_run.id))
    .limit(filter.limit ?? 50);
  return rows.map(record);
}

/** Applies `patch` (and sets updated_at); the changed run, or null when the tenant has no such run. */
export async function updateSolverRun(
  tx: TenantTx,
  id: string,
  patch: SolverRunPatch,
): Promise<SolverRunRecord | null> {
  const { tenantId } = tenantScope(tx, 'updateSolverRun');
  if (!isUuid(id)) return null;
  const [row] = await tx
    .update(solver_run)
    .set({
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.result === undefined ? {} : { result: jsonb(patch.result) }),
      ...(patch.result_scenario_id === undefined ? {} : { result_scenario_id: patch.result_scenario_id }),
      ...(patch.progress === undefined ? {} : { progress: patch.progress }),
      ...(patch.progress_note === undefined ? {} : { progress_note: patch.progress_note }),
      ...(patch.cancel_requested === undefined ? {} : { cancel_requested: patch.cancel_requested }),
      updated_at: sql`now()`,
    })
    .where(and(eq(solver_run.tenant_id, tenantId), eq(solver_run.id, id)))
    .returning();
  return row ? record(row) : null;
}

/** True when a run of the tenant was deleted. */
export async function deleteSolverRun(tx: TenantTx, id: string): Promise<boolean> {
  const { tenantId } = tenantScope(tx, 'deleteSolverRun');
  if (!isUuid(id)) return false;
  const rows = await tx
    .delete(solver_run)
    .where(and(eq(solver_run.tenant_id, tenantId), eq(solver_run.id, id)))
    .returning({ id: solver_run.id });
  return rows.length > 0;
}
