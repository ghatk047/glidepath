import type { ScenarioId, TenantId, UserId } from '@glidepath/api-contract';
import { getScenario, getTenant, loadMembers, loadModelDefs, loadResolvedInputs } from '@glidepath/data-access';
import type { ResolvedInputsRecord } from '@glidepath/data-access';
import type { CellKey, Evaluation } from '@glidepath/engine';
import type { ModelBundle } from '@glidepath/spec';
import type { WithTenant } from '../app/tenant';
import type { SpecBundleSource } from '../routes/read/spec-source';
import { engineCell } from './cells';
import { ModelCache } from './model-cache';
import type { CachedModel, ModelKey } from './model-cache';

/** What a session holds of its scenario: the compiled model and the committed state at a version. */
export interface ScenarioState {
  readonly scenarioId: ScenarioId;
  /** `scenario.version` read before the inputs (never newer than them). */
  readonly version: number;
  readonly model: CachedModel;
  /** Evaluation of the scenario's resolved inputs and pins (shared, never modified). */
  readonly committed: Evaluation;
}

/** Who opens a scenario: the tenant scope of every read. */
export interface SessionScope {
  readonly tenantId: TenantId;
  readonly userId: UserId;
}

/** Builds a session's scenario state from tier 3 (sessions are a cache, never the source of truth). */
export interface ScenarioLoader {
  /** The scenario's state, or null when it is not one of the tenant's (or not a valid id). */
  load(scope: SessionScope, scenarioId: string): Promise<ScenarioState | null>;
}

/** The model version's bundle cannot be had: the pinned version changed meanwhile, or no spec answers for it. */
export class ModelBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelBundleError';
  }
}

export interface DbScenarioLoaderDeps {
  withTenant: WithTenant;
  /** Bundle of a model version by semver (the read routes' source, so both see the same definitions). */
  specBundle: SpecBundleSource;
  /** Shared compiled models; default a new cache. */
  models?: ModelCache;
}

/** Resolved input rows → engine cells (`var` for a scalar, `var[member]` otherwise). */
export function inputCells(inputs: ResolvedInputsRecord): {
  values: Map<CellKey, number>;
  overrides: Map<CellKey, number>;
} {
  const values = new Map<CellKey, number>();
  for (const r of inputs.values) values.set(engineCell(r.var_key, r.member_key), r.value);
  const overrides = new Map<CellKey, number>();
  for (const o of inputs.overrides) overrides.set(engineCell(o.node_key, o.member_key), o.value);
  return { values, overrides };
}

/**
 * The scenario loader over DATA-05's read repositories, in one `withTenant` transaction (RLS applies):
 * `getScenario` (version first), `getTenant` (the pinned model version), `loadMembers` (members and
 * `membersHash`), `loadResolvedInputs` (v_inputs_resolved values and the scenario's node overrides). The
 * compiled model comes from the ModelCache keyed `(tenant, model_version, members_hash)`; only on a miss is
 * the model version read (`loadModelDefs`) to fetch its bundle and compile. Inputs and members are those of
 * the tenant's pinned model version, as the views resolve them.
 */
export function dbScenarioLoader(deps: DbScenarioLoaderDeps): ScenarioLoader & { readonly models: ModelCache } {
  const models = deps.models ?? new ModelCache();

  const bundleOf = async (scope: SessionScope, key: ModelKey): Promise<ModelBundle> => {
    const defs = await deps.withTenant(scope.tenantId, scope.userId, (tx) => loadModelDefs(tx));
    if (!defs || defs.modelVersion.id !== key.modelVersionId) {
      throw new ModelBundleError(`the tenant no longer pins model version ${key.modelVersionId}`);
    }
    const bundle = await deps.specBundle(defs.modelVersion.semver);
    if (!bundle) throw new ModelBundleError(`no spec bundle for model version ${defs.modelVersion.semver}`);
    return bundle;
  };

  return {
    models,
    async load(scope, scenarioId) {
      const read = await deps.withTenant(scope.tenantId, scope.userId, async (tx) => {
        const scenario = await getScenario(tx, scenarioId);
        if (!scenario) return null;
        const tenant = await getTenant(tx);
        if (!tenant) return null;
        const members = await loadMembers(tx);
        const inputs = await loadResolvedInputs(tx, scenario.id);
        if (!inputs) return null;
        return { scenario, modelVersionId: tenant.model_version_id, members, inputs };
      });
      if (!read) return null;

      const key: ModelKey = {
        tenantId: scope.tenantId,
        modelVersionId: read.modelVersionId,
        membersHash: read.members.membersHash,
      };
      const model = await models.get(key, read.members.members, () => bundleOf(scope, key));
      const { values, overrides } = inputCells(read.inputs);
      return {
        scenarioId: read.scenario.id as ScenarioId,
        version: read.scenario.version,
        model,
        committed: model.committed(read.scenario.id, values, overrides),
      };
    },
  };
}
