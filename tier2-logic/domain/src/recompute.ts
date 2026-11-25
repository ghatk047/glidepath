/**
 * The Recompute hook of the write path (docs/architecture/04_data_and_api.md section 2, steps 6 and
 * 7): after the writes and the version bump, inside the same transaction, the post-change state is
 * compiled through the ModelCache port and evaluated, VR05 and VR08 run on the evaluation, and the
 * headline outputs are stored as `calc_run` keyed (scenario_id, input_hash). A rule error throws
 * `ChangesetRejectedError`, so the changeset rolls back and nothing is persisted.
 *
 * ```ts
 * const recompute = recomputeHook({ tenantId, modelVersionId, bundle, cache });
 * const r = await applyChangeset(store, draft, { actor, bundle, recompute });
 * r.recomputed; // { scenarioId, version, inputHash, outputs: { 'res.net[]': 119.28, ... }, cached }
 * ```
 */
import { compile as engineCompile, type CompiledModel } from '@glidepath/engine';
import type { ModelBundle, TenantMembers } from '@glidepath/spec';
import type { Recompute, RecomputeInput } from './apply';
import { ChangesetRejectedError } from './apply-errors';
import type { ScenarioId, Timestamp } from './changeset';
import { modelCacheKey, type CalcRunRow, type ModelCache } from './ports';
import type { InputValueRow, NodeOverrideRow } from './resolve';
import { nodeMemberKeys, toCellKey, validateOutputs, type ValidationEntry } from './validation';

/** Headline output cells, by the contract's CellKey (`res.net[]`, `lev.iy[L01]`): `Outputs`. */
export type Outputs = Readonly<Record<string, number>>;

/** What the hook returns as `ApplyResult.recomputed`: step 7 of the write path. */
export interface RecomputeResult {
  /** The scenario recomputed; null for tenant defaults (no calc_run is stored for them). */
  readonly scenarioId: ScenarioId | null;
  /** The scenario's version after the changeset. */
  readonly version: number;
  /** `CompiledModel.inputHash` of the resolved inputs and pins: the calc_run cache key. */
  readonly inputHash: string;
  /** Every cell of every node with `output: true` (calc_run.outputs, "output nodes only"). */
  readonly outputs: Outputs;
  /** True when a calc_run of the scenario already held these inputs: nothing was evaluated. */
  readonly cached: boolean;
  /** The calc_run row holding the outputs; null for tenant defaults. */
  readonly calcRunId: string | null;
}

/** `compile(bundle, members)` of the engine (03 section 1). */
export type CompileModel = (bundle: ModelBundle, members: TenantMembers) => CompiledModel;

export interface RecomputeOptions {
  /** ModelCacheKey.tenant_id. */
  readonly tenantId: string;
  /** The tenant's pinned model version; a scenario of another version is an error. */
  readonly modelVersionId: string;
  /** The pinned model: compiled on a cache miss; its `output` nodes are the headline outputs. */
  readonly bundle: ModelBundle;
  /** Compiled models shared across requests (the server's). */
  readonly cache: ModelCache<CompiledModel>;
  /** The engine's `compile` by default. */
  readonly compile?: CompileModel;
  /** calc_run ids; `crypto.randomUUID` by default. */
  readonly newId?: () => string;
  /** calc_run.created_at; the current time by default. */
  readonly now?: () => Timestamp;
  /** A millisecond clock for calc_run.ms; `performance.now` by default. */
  readonly clock?: () => number;
}

/** Resolved input rows as the engine's value map (`var` for a scalar, `var[member_key]` otherwise). */
export function engineValues(rows: readonly InputValueRow[]): Map<string, number> {
  return new Map(rows.map((r) => [engineCellKey(r.var_key, r.member_key), r.value]));
}

/** node_override rows as the engine's override map. */
export function engineOverrides(rows: readonly NodeOverrideRow[]): Map<string, number> {
  return new Map(rows.map((r) => [engineCellKey(r.node_key, r.member_key), r.value]));
}

const engineCellKey = (id: string, memberKey: string): string =>
  memberKey === '' ? id : `${id}[${memberKey}]`;

/**
 * The headline outputs of an evaluation: every cell of every node with `output: true` that the
 * evaluation holds, by the contract's CellKey, in node then member order.
 */
export function headlineOutputs(
  bundle: Pick<ModelBundle, 'nodes'>,
  members: TenantMembers,
  evaluation: { get(cell: string): number; has(cell: string): boolean },
): Record<string, number> {
  const outputs: Record<string, number> = {};
  for (const node of bundle.nodes) {
    if (!node.output) continue;
    for (const k of nodeMemberKeys(node, members)) {
      const cell = engineCellKey(node.id, k);
      if (evaluation.has(cell)) outputs[toCellKey(node.id, k)] = evaluation.get(cell);
    }
  }
  return outputs;
}

/**
 * The Recompute hook for `applyChangeset` (and `createScenario`, `revert`). For the post-change state
 * it:
 * 1. gets the compiled model from `cache` under (tenant, model version, members hash), compiling on a
 *    miss;
 * 2. hashes the resolved inputs and pins (`inputHash`) and looks up the scenario's calc_run for that
 *    hash: a hit returns its outputs without evaluating (its rules passed when it was stored), and
 *    re-stamps the row with the new scenario version;
 * 3. otherwise evaluates, runs VR05 and VR08 (`validateOutputs`; any error throws
 *    `ChangesetRejectedError` and the transaction rolls back), and upserts the calc_run.
 *
 * Tenant defaults (no scenario) are evaluated and checked on their own, but store no calc_run.
 */
export function recomputeHook(options: RecomputeOptions): Recompute<RecomputeResult> {
  const compile = options.compile ?? engineCompile;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date().toISOString());
  const clock = options.clock ?? (() => performance.now());

  return async (input: RecomputeInput): Promise<RecomputeResult> => {
    const { tx, scenario, state } = input;
    const version = scenario?.version ?? input.changeset.base_scenario_version + 1;
    if (scenario !== null && scenario.model_version_id !== options.modelVersionId) {
      throw new Error(
        `recompute: scenario ${scenario.id} pins model version ${scenario.model_version_id}, not ${options.modelVersionId}`,
      );
    }
    const members = state.members;
    const model = options.cache.getOrCompile(
      modelCacheKey(options.tenantId, options.modelVersionId, members),
      () => compile(options.bundle, members),
    );
    const values = engineValues(state.values);
    const overrides = engineOverrides(input.overrides);
    const inputHash = model.inputHash(values, overrides);

    if (scenario !== null) {
      const hit = await tx.findCalcRun(scenario.id, inputHash);
      if (hit !== null) {
        if (hit.scenario_version !== version) {
          await tx.upsertCalcRun({ ...hit, scenario_version: version });
        }
        return {
          scenarioId: scenario.id,
          version,
          inputHash,
          outputs: hit.outputs as Outputs,
          cached: true,
          calcRunId: hit.id,
        };
      }
    }

    const started = clock();
    const evaluation = model.evaluate(values, overrides);
    const ms = Math.max(0, Math.round(clock() - started));
    const errors: ValidationEntry[] = validateOutputs({
      bundle: options.bundle,
      members,
      evaluation,
      upstream: (cell) => model.upstream(cell),
    }).filter((e) => e.severity === 'error');
    if (errors.length > 0) throw new ChangesetRejectedError(errors);

    const outputs = headlineOutputs(options.bundle, members, evaluation);
    if (scenario === null) {
      return { scenarioId: null, version, inputHash, outputs, cached: false, calcRunId: null };
    }
    const row: CalcRunRow = {
      id: newId(),
      scenario_id: scenario.id,
      scenario_version: version,
      model_version_id: options.modelVersionId,
      input_hash: inputHash,
      ms,
      outputs,
      created_at: now(),
    };
    await tx.upsertCalcRun(row);
    return {
      scenarioId: scenario.id,
      version,
      inputHash,
      outputs,
      cached: false,
      calcRunId: row.id,
    };
  };
}
