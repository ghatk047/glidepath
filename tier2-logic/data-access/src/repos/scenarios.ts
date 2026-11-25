import type { ScenarioRow } from '@glidepath/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import { scenario } from '../schema';
import { tenantScope } from '../scope';
import type { TenantTx } from '../tenant';
import { isUuid, iso } from './rows';

/**
 * A scenario row (domain ScenarioRow) plus `archived` (manual migration 0001, ADR-023) and `is_default` (the seed's
 * `default_scenario`, manual migration 0007; absent reads as false).
 */
export interface ScenarioRecord extends ScenarioRow {
  readonly archived: boolean;
  readonly is_default?: boolean;
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
  is_default: r.is_default,
});

/**
 * Every scenario of the current tenant (archived ones too): presets in seed order (`sort_order`, set by the seeder
 * from the position in the tenant's scenarios.json; DATA-14), nulls last, then oldest first, then by key.
 */
export async function listScenarios(tx: TenantTx): Promise<ScenarioRecord[]> {
  const { tenantId } = tenantScope(tx, 'listScenarios');
  const rows = await tx
    .select()
    .from(scenario)
    .where(eq(scenario.tenant_id, tenantId))
    .orderBy(sql`${scenario.sort_order} asc nulls last`, asc(scenario.created_at), sql`${scenario.key} collate "C"`);
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

/**
 * The edits counter of each of `scenarioIds` (of the current tenant) in one query, as the domain stored it
 * (DOM-03): `summary.edits_count` of the scenario's applied changeset with `base_scenario_version = version - 1`
 * (the newest, if several), or 0 when it has none (a preset, or a scenario with no edit yet) or the summary
 * holds no number. Every id of the tenant is in the map; ids of other tenants and non-uuids are not.
 */
export async function loadEditsCounts(tx: TenantTx, scenarioIds: readonly string[]): Promise<Map<string, number>> {
  const { tenantId } = tenantScope(tx, 'loadEditsCounts');
  const ids = [...new Set(scenarioIds.filter(isUuid))];
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const res = await tx.execute<{ id: string; edits_count: number }>(sql`
    select s.id, coalesce(e.n, 0)::int as edits_count
    from scenario s
    left join lateral (
      select case when jsonb_typeof(c.summary) = 'object' and jsonb_typeof(c.summary -> 'edits_count') = 'number'
                  then (c.summary ->> 'edits_count')::numeric end as n
      from changeset c
      where c.tenant_id = s.tenant_id and c.scenario_id = s.id and c.status = 'applied'
        and c.base_scenario_version = s.version - 1
      order by c.created_at desc, c.id desc
      limit 1
    ) e on true
    where s.tenant_id = ${tenantId}::uuid
      and s.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
  for (const r of res.rows) out.set(r.id, Number(r.edits_count));
  return out;
}
