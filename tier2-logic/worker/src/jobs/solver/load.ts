import {
  getScenario,
  getSolverRun,
  getTenant,
  listScenarios,
  loadMembers,
  loadModelDefs,
  loadResolvedInputs,
} from '@glidepath/data-access';
import type { ScenarioRecord, SolverRunRecord, TenantRow, TenantTx } from '@glidepath/data-access';
import type { JsonValue } from '@glidepath/domain';
import { engineOverrides, engineValues, modelCacheKey } from '@glidepath/domain';
import { compile } from '@glidepath/engine';
import type { CellKey } from '@glidepath/engine';
import { withDecisionBounds } from '@glidepath/solvers';
import type { SolverModel, SolverSpec } from '@glidepath/solvers';
import { decisionBoundsFor } from '@glidepath/spec';
import type { ModelBundle } from '@glidepath/spec';
import { SolverJobError } from './types';
import type { SolverJobDeps } from './types';

/** What a solver job reads in its first transaction. */
export interface SolverJobInput {
  readonly run: SolverRunRecord;
  readonly spec: SolverSpec;
  readonly start: ScenarioRecord;
  readonly tenant: TenantRow;
  readonly bundle: ModelBundle;
  readonly model: SolverModel;
}

/** `{problem, params}` from `solver_run.spec` (extra fields such as JOB-02's `cache` are ignored). */
export function specOf(run: SolverRunRecord): SolverSpec {
  const raw = run.spec;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SolverJobError('bad_spec', `Solver run ${run.id} has no problem in its spec.`);
  }
  const { problem, params } = raw as { readonly [key: string]: JsonValue };
  if (typeof problem !== 'string') throw new SolverJobError('bad_spec', `Solver run ${run.id} has no problem in its spec.`);
  return {
    problem,
    params: params !== null && typeof params === 'object' && !Array.isArray(params) ? params : {},
  } as unknown as SolverSpec;
}

/** Resolved inputs of a scenario as the engine's cell maps (`v_inputs_resolved`). */
async function resolvedMaps(
  tx: TenantTx,
  scenarioId: string,
): Promise<{ values: Map<CellKey, number>; overrides: Map<CellKey, number> }> {
  const resolved = await loadResolvedInputs(tx, scenarioId);
  if (resolved === null) {
    throw new SolverJobError('scenario_not_found', `Scenario ${scenarioId} is not visible to this job.`);
  }
  return { values: engineValues(resolved.values), overrides: engineOverrides(resolved.overrides) };
}

/**
 * Builds the solver's `SolverModel` for a run: the start scenario's resolved inputs (`v_inputs_resolved`,
 * pins included) evaluated once as the base, the tenant's active members, the stretch cap from the
 * tenant's stretch presets, and the decision bounds of the model version (SOL-12: `decisionBoundsFor`, generated
 * from docs/spec/reference/solvers_demo.py, so a job moves the same inputs within the same bounds as the
 * reference). Everything is read in the caller's transaction; the solver then runs without one.
 */
export async function loadSolverInput(tx: TenantTx, runId: string, deps: SolverJobDeps): Promise<SolverJobInput> {
  const run = await getSolverRun(tx, runId);
  if (run === null) throw new SolverJobError('run_not_found', `No solver run ${runId} in this tenant.`);
  const spec = specOf(run);
  const start = await getScenario(tx, run.scenario_id);
  if (start === null) {
    throw new SolverJobError('scenario_not_found', `Start scenario ${run.scenario_id} is not visible to this job.`);
  }
  const tenant = await getTenant(tx);
  if (tenant === null) throw new SolverJobError('tenant_not_found', 'The tenant is not visible to this job.');
  const defs = await loadModelDefs(tx);
  if (defs === null) throw new SolverJobError('model_not_found', 'The tenant pins no readable model version.');
  const bundle = await deps.bundle(defs.modelVersion.semver);
  if (bundle === null) {
    throw new SolverJobError('model_not_found', `No spec bundle for model version ${defs.modelVersion.semver}.`);
  }
  const { members } = await loadMembers(tx);
  const compiled = deps.cache.getOrCompile(modelCacheKey(tenant.id, tenant.model_version_id, members), () =>
    compile(bundle, members),
  );

  const { values, overrides } = await resolvedMaps(tx, start.id);
  const wanted = new Set(deps.stretchPresets);
  const presets = (await listScenarios(tx)).filter((s) => s.kind === 'preset' && !s.archived && wanted.has(s.key));
  const stretch: ReadonlyMap<CellKey, number>[] = [];
  for (const p of presets) stretch.push((await resolvedMaps(tx, p.id)).values);

  const model: SolverModel = withDecisionBounds(
    {
      compiled,
      base: compiled.evaluate(values, overrides),
      bundle,
      members,
      ...(stretch.length === 0 ? {} : { stretch }),
    },
    decisionBoundsFor(bundle.specVersion),
  );
  return { run, spec, start, tenant, bundle, model };
}
