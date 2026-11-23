import { ChangesetResult, Scenario as ScenarioSchema } from '@glidepath/api-contract';
import type { ChangesetAuthor, Scenario } from '@glidepath/api-contract';
import {
  changesetTx,
  createChangesetStore,
  getScenario,
  loadEditsCounts,
  sql,
} from '@glidepath/data-access';
import type { TenantTx } from '@glidepath/data-access';
import { recomputeHook } from '@glidepath/domain';
import type {
  ApplyResult,
  ChangesetStore,
  Outputs,
  Recompute,
  RecomputeResult,
  ScenarioPatch,
  ScenarioStore,
  ValidationEntry,
} from '@glidepath/domain';
import type { ModelBundle } from '@glidepath/spec';
import type { Context } from 'hono';
import type { AppEnv } from '../../app/tenant';
import { ApiError } from '../../app/problem';
import { BundleError } from '../read/bundle';
import { checked, toScenario } from '../read/mappers';
import type { SpecBundleSource } from '../read/spec-source';
import { toViolation } from './errors';
import type { LruModelCache } from './model-cache';

/** Everything a write needs from the tenant's pinned model, resolved once per request. */
export interface WriteContext {
  readonly store: ChangesetStore;
  readonly bundle: ModelBundle;
  readonly modelVersionId: string;
  readonly recompute: Recompute<RecomputeResult>;
}

/** The tenant's pinned model version (id, semver): one indexed lookup, not the whole definition set. */
export async function pinnedModel(tx: TenantTx, tenantId: string): Promise<{ id: string; semver: string }> {
  const res = await tx.execute<{ id: string; semver: string }>(
    sql`select mv.id::text as id, mv.semver from tenant t join model_version mv on mv.id = t.model_version_id where t.id = ${tenantId}::uuid`,
  );
  const row = res.rows[0];
  if (!row) throw new Error('the tenant pins no readable model version');
  return row;
}

export async function writeContext(
  c: Context<AppEnv>,
  deps: { specBundle: SpecBundleSource; cache: LruModelCache },
): Promise<WriteContext> {
  const t = c.get('tenant');
  const pin = await pinnedModel(t.tx, t.tenantId);
  const bundle = await deps.specBundle(pin.semver);
  if (!bundle) throw new BundleError(`no spec bundle for model version ${pin.semver}`);
  return {
    store: createChangesetStore(t.tx),
    bundle,
    modelVersionId: pin.id,
    recompute: recomputeHook({ tenantId: t.tenantId, modelVersionId: pin.id, bundle, cache: deps.cache }),
  };
}

/**
 * A ScenarioStore for PATCH (DOM-04 `patchScenario`) over the request's transaction: the data-access
 * ChangesetTx plus `updateScenario`, which sets label, locked and archived on the row the transaction
 * holds locked. Metadata only; the version is never touched. RLS and the tenant predicate scope it.
 */
export function scenarioStore(tx: TenantTx): ScenarioStore {
  return {
    transaction: (fn) =>
      tx.transaction((sp) => {
        const inner = sp as TenantTx;
        return fn({
          ...changesetTx(inner),
          async updateScenario(scenarioId: string, patch: ScenarioPatch): Promise<void> {
            const set = [
              ...(patch.label === undefined ? [] : [sql`label = ${patch.label}`]),
              ...(patch.locked === undefined ? [] : [sql`locked = ${patch.locked}`]),
              ...(patch.archived === undefined ? [] : [sql`archived = ${patch.archived}`]),
            ];
            if (set.length === 0) return;
            await inner.execute(
              sql`update scenario set ${sql.join(set, sql`, `)} where id = ${scenarioId}::uuid and tenant_id = current_setting('app.tenant_id')::uuid`,
            );
          },
        });
      }),
  };
}

/** The calc_run row as the routes use it. */
export interface CalcRun {
  readonly scenario_version: number;
  readonly model_version_id: string;
  readonly input_hash: string;
  readonly ms: number;
  readonly created_at: string;
  readonly outputs: Outputs;
}

/**
 * The scenario's current calc_run: the highest `scenario_version`, then the newest. A recompute that
 * finds its inputs already calculated (an undo back to an earlier state) re-stamps that row with the new
 * version without touching `created_at`, so ordering by `created_at` first (data-access
 * `getLatestCalcRun`) would answer the superseded run.
 */
export async function latestCalcRun(tx: TenantTx, scenarioId: string): Promise<CalcRun | null> {
  const res = await tx.execute<Omit<CalcRun, 'created_at'> & { created_at: string }>(sql`
    select scenario_version, model_version_id::text as model_version_id, input_hash, ms, outputs,
           to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
    from calc_run
    where scenario_id = ${scenarioId}::uuid and tenant_id = current_setting('app.tenant_id')::uuid
    order by scenario_version desc, created_at desc, id desc
    limit 1`);
  return res.rows[0] ?? null;
}

/** A scenario of the tenant in contract shape, with its stored edits counter. */
export async function loadScenario(tx: TenantTx, id: string): Promise<Scenario> {
  const record = await getScenario(tx, id);
  if (!record) throw ApiError.notFound('No such scenario in this tenant. Check the scenario id.');
  const edits = await loadEditsCounts(tx, [id]);
  return checked('scenario', ScenarioSchema, toScenario(record, edits.get(id) ?? 0));
}

/** The name the toast and history show for the author (`app_user.name`); null when unknown. */
export async function authorOf(tx: TenantTx, userId: string): Promise<ChangesetAuthor | null> {
  const res = await tx.execute<{ name: string }>(sql`select name from app_user where id = ${userId}::uuid`);
  const name = res.rows[0]?.name;
  return name === undefined ? null : ({ id: userId, name } as ChangesetAuthor);
}

/**
 * The contract's ChangesetResult of an applied (or replayed) changeset. Headline outputs and inputHash
 * come from the Recompute hook; a replay recomputes nothing, so they are the scenario's latest calc_run.
 */
export async function toChangesetResult(
  tx: TenantTx,
  applied: ApplyResult<RecomputeResult>,
): Promise<ChangesetResult> {
  const scenarioId = applied.scenarioId;
  if (scenarioId === null) throw new Error('a scenario changeset answered no scenario');
  let outputs: Outputs;
  let inputHash: string;
  if (applied.recomputed) {
    ({ outputs, inputHash } = applied.recomputed);
  } else {
    const run = await latestCalcRun(tx, scenarioId);
    if (!run) throw new Error(`scenario ${scenarioId} has no calc_run to answer a replay with`);
    outputs = run.outputs as Outputs;
    inputHash = run.input_hash;
  }
  return checked('changeset result', ChangesetResult, {
    changesetId: applied.changesetId,
    scenarioId,
    version: applied.version,
    editsCount: applied.editsCount,
    inputHash,
    outputs,
    warnings: applied.warnings.map((w: ValidationEntry) => toViolation(w)),
    ...(applied.forkedFrom === undefined ? {} : { forkedFrom: applied.forkedFrom }),
  });
}
