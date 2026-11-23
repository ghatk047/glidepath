import type { CalcRunRow, JsonValue } from '@glidepath/domain';
import { and, desc, eq } from 'drizzle-orm';
import { calc_run } from '../schema';
import { tenantScope } from '../scope';
import type { TenantTx } from '../tenant';
import { isUuid, iso } from './rows';

/**
 * The current calc_run of a scenario of the current tenant, or null: the highest `scenario_version`,
 * then the newest `created_at`, then the highest id. A recompute that finds its inputs already
 * calculated (an undo back to an earlier state) re-stamps that older row with the new scenario version
 * without touching its `created_at`, so the version decides, not the age. Whether the run is stale
 * (older scenario or model version) is the caller's call.
 */
export async function getLatestCalcRun(tx: TenantTx, scenarioId: string): Promise<CalcRunRow | null> {
  const { tenantId } = tenantScope(tx, 'getLatestCalcRun');
  if (!isUuid(scenarioId)) return null;
  const [r] = await tx
    .select()
    .from(calc_run)
    .where(and(eq(calc_run.tenant_id, tenantId), eq(calc_run.scenario_id, scenarioId)))
    .orderBy(desc(calc_run.scenario_version), desc(calc_run.created_at), desc(calc_run.id))
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
