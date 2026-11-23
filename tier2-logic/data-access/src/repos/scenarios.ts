import type { ScenarioRow } from '@glidepath/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import { scenario } from '../schema';
import { tenantScope } from '../scope';
import type { TenantTx } from '../tenant';
import { isUuid, iso } from './rows';

/** A scenario row (domain ScenarioRow) plus `archived` (manual migration 0001, ADR-023). */
export interface ScenarioRecord extends ScenarioRow {
  readonly archived: boolean;
}

const toRecord = (r: typeof scenario.$inferSelect): ScenarioRecord => ({
  id: r.id,
  key: r.key,
  label: r.label,
  kind: r.kind,
  parent_id: r.parent_id,
  model_version_id: r.model_version_id,
  version: r.version,
  locked: r.locked,
  created_by: r.created_by,
  created_at: iso(r.created_at),
  archived: r.archived,
});

/** Every scenario of the current tenant (archived ones too), oldest first, then by key. */
export async function listScenarios(tx: TenantTx): Promise<ScenarioRecord[]> {
  const { tenantId } = tenantScope(tx, 'listScenarios');
  const rows = await tx
    .select()
    .from(scenario)
    .where(eq(scenario.tenant_id, tenantId))
    .orderBy(asc(scenario.created_at), sql`${scenario.key} collate "C"`);
  return rows.map(toRecord);
}

/** One scenario of the current tenant, or null (also for an id of another tenant or not a uuid). */
export async function getScenario(tx: TenantTx, scenarioId: string): Promise<ScenarioRecord | null> {
  const { tenantId } = tenantScope(tx, 'getScenario');
  if (!isUuid(scenarioId)) return null;
  const [row] = await tx
    .select()
    .from(scenario)
    .where(and(eq(scenario.tenant_id, tenantId), eq(scenario.id, scenarioId)));
  return row ? toRecord(row) : null;
}
