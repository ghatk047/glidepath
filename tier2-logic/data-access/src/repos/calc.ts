import type { CalcRunRow, JsonValue } from '@glidepath/domain';
import { and, desc, eq } from 'drizzle-orm';
import { calc_run } from '../schema';
import { tenantScope } from '../scope';
import type { TenantTx } from '../tenant';
import { isUuid, iso } from './rows';

/**
 * The latest calc_run of a scenario of the current tenant (created_at, then scenario_version, then
 * id, descending), or null. Whether it is stale (older scenario or model version) is the caller's call.
 */
export async function getLatestCalcRun(tx: TenantTx, scenarioId: string): Promise<CalcRunRow | null> {
  const { tenantId } = tenantScope(tx, 'getLatestCalcRun');
  if (!isUuid(scenarioId)) return null;
  const [r] = await tx
    .select()
    .from(calc_run)
    .where(and(eq(calc_run.tenant_id, tenantId), eq(calc_run.scenario_id, scenarioId)))
    .orderBy(desc(calc_run.created_at), desc(calc_run.scenario_version), desc(calc_run.id))
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    scenario_id: r.scenario_id,
    scenario_version: r.scenario_version,
    model_version_id: r.model_version_id,
    input_hash: r.input_hash,
    ms: r.ms,
    outputs: r.outputs as JsonValue,
    created_at: iso(r.created_at),
  };
}
