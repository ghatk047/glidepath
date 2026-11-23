import type { NodeOverrideRow, ResolvedInput } from '@glidepath/domain';
import { sql } from 'drizzle-orm';
import { tenantScope } from '../scope';
import type { TenantTx } from '../tenant';
import { getScenario } from './scenarios';
import { isUuid, num, strOrNull } from './rows';

/** Which level supplied a resolved value (v_inputs_resolved.resolved_from). */
export type ResolvedFrom = 'tenant' | 'parent' | 'scenario';

/**
 * One resolved input cell: the domain's ResolvedInput (`scenario_id` = the scenario whose row won, null
 * for the tenant default) plus the view's provenance columns.
 */
export interface ResolvedInputRecord extends ResolvedInput {
  readonly resolved_from: ResolvedFrom;
  /** variable_value.confidence / note of a tenant default; null when a scenario row won. */
  readonly confidence: string | null;
  readonly note: string | null;
}

/** A scenario's resolved inputs (domain ResolvedInputs shape) as v_inputs_resolved returns them. */
export interface ResolvedInputsRecord {
  /** The scenario resolved; null = the tenant defaults alone. */
  readonly scenario_id: string | null;
  /** One entry per (var_key, member_key) of a variable of the pinned model, in code-point order. */
  readonly values: readonly ResolvedInputRecord[];
  /** The scenario's own node overrides (not inherited), ordered by node_key then member_key. */
  readonly overrides: readonly NodeOverrideRow[];
}

interface Raw extends Record<string, unknown> {
  kind: 'input' | 'override';
  key: string;
  member_key: string;
  value: string | number;
  resolved_from: ResolvedFrom;
  from_scenario_id: string | null;
  confidence: string | null;
  note: string | null;
  reason: string | null;
}

/**
 * Resolved inputs of a scenario of the current tenant via v_inputs_resolved (DATA-03): variable
 * definition, tenant default, then each ancestor down to the scenario, the last level wins; plus the
 * scenario's node overrides. `scenarioId` null resolves the tenant defaults. Null when the scenario is
 * not one of the tenant's.
 */
export async function loadResolvedInputs(
  tx: TenantTx,
  scenarioId: string | null,
): Promise<ResolvedInputsRecord | null> {
  const { tenantId } = tenantScope(tx, 'loadResolvedInputs');
  if (scenarioId !== null && !(isUuid(scenarioId) && (await getScenario(tx, scenarioId)))) return null;
  const res = await tx.execute<Raw>(sql`
    select kind, key, member_key, value, resolved_from, from_scenario_id, confidence, note, reason
    from v_inputs_resolved
    where tenant_id = ${tenantId}::uuid and scenario_id is not distinct from ${scenarioId}::uuid
    order by kind collate "C", key collate "C", member_key collate "C"`);

  const values: ResolvedInputRecord[] = [];
  const overrides: NodeOverrideRow[] = [];
  for (const r of res.rows) {
    if (r.kind === 'override') {
      overrides.push({ node_key: r.key, member_key: r.member_key, value: num(r.value), reason: r.reason ?? '' });
    } else {
      values.push({
        var_key: r.key,
        member_key: r.member_key,
        value: num(r.value),
        scenario_id: r.from_scenario_id,
        resolved_from: r.resolved_from,
        confidence: strOrNull(r.confidence),
        note: r.note,
      });
    }
  }
  return { scenario_id: scenarioId, values, overrides };
}
