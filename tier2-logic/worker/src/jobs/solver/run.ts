import { runSolver } from '@glidepath/solvers';
import type { SolverResult } from '@glidepath/solvers';
import type { JsonValue } from '@glidepath/domain';
import { loadSolverInput } from './load';
import { SAVING_PROBLEMS, SolverJobError } from './types';
import type { SolverJobContext, SolverJobDeps, StoredSolverResult } from './types';
import { recordResult, saveAsScenario } from './save';
import type { SavedScenario } from './save';

const json = (v: unknown): JsonValue => JSON.parse(JSON.stringify(v)) as JsonValue;

/** Options of one handler: the problem its queue serves and, for the Sobol queue, the method it accepts. */
export interface SolverHandlerSpec {
  readonly problem: string;
  /** `sensitivity` only: the method this queue runs (`sobol`). */
  readonly method?: string;
}

export interface SolverJobResult {
  /** `solver_run.result`: the solver's `SolverResult`, plus `resultScenarioId` / `scenario` / `saveError`. */
  readonly stored: StoredSolverResult;
  readonly result: SolverResult;
  readonly saved: SavedScenario | null;
}

/** Progress shares of a job: loading, the solver, saving. */
const LOAD = 0.05;
const SOLVE_END = 0.95;

/**
 * One solver job (03 section 4): read the run, its start scenario's resolved inputs (`v_inputs_resolved`) and
 * the tenant's members in one transaction, build the `SolverModel` (compiled models are cached per process),
 * run the pure solver outside any transaction with the job's signal and progress, then in a second
 * transaction save the result:
 * - `min_risk_mix` and `vp_feasible`: a new scenario of kind `solver` through `applyChangeset` with origin
 *   `solver` (unless the payload says `save: false`, the run was cancelled, or nothing moved); the ranked moves
 *   and binding constraints stay in `solver_run.result`, and `result_scenario_id` points at the scenario;
 * - every other problem (`monte_carlo`, `pareto`, `sensitivity`): the result only, no scenario.
 *
 * A run whose signal fired returns its partial result without saving a scenario (the runtime marks it cancelled).
 */
export async function runSolverJob(
  ctx: SolverJobContext,
  handler: SolverHandlerSpec,
  deps: SolverJobDeps,
): Promise<SolverJobResult> {
  const runId = ctx.payload.runId;
  if (typeof runId !== 'string') throw new SolverJobError('bad_payload', `solver.${handler.problem} needs a runId.`);

  ctx.progress(0, 'loading the scenario');
  const input = await ctx.withTenant((tx) => loadSolverInput(tx, runId, deps));
  const { spec, run, start, tenant, bundle, model } = input;
  if (spec.problem !== handler.problem) {
    throw new SolverJobError('bad_spec', `Run ${run.id} is a ${spec.problem} run, not ${handler.problem}.`);
  }
  if (handler.method !== undefined) {
    const method = (spec.params as { method?: string }).method;
    if (method !== handler.method) {
      throw new SolverJobError('bad_spec', `solver.${handler.problem} runs only the ${handler.method} method (got ${String(method)}).`);
    }
  }
  ctx.progress(LOAD, 'solving');

  const result = (await runSolver(model, spec, {
    signal: ctx.signal,
    progress: (fraction, note) => ctx.progress(LOAD + (SOLVE_END - LOAD) * Math.min(1, Math.max(0, fraction)), note),
  })) as SolverResult;

  const wantsSave = SAVING_PROBLEMS.includes(spec.problem) && ctx.payload.save !== false;
  const worthSaving = result.status !== 'cancelled' && result.changes.length > 0 && !ctx.signal.aborted;
  let saved: SavedScenario | null = null;
  let saveError: string | undefined;

  if (wantsSave && worthSaving) {
    ctx.progress(SOLVE_END, 'saving the scenario');
    await ctx.withTenant(async (tx) => {
      const out = await saveAsScenario(tx, {
        runId,
        actor: ctx.userId,
        start,
        result,
        bundle,
        tenantId: tenant.id,
        modelVersionId: tenant.model_version_id,
        cache: deps.cache,
      });
      if ('saved' in out) saved = out.saved;
      else saveError = out.error;
      const stored = storedOf(result, saved, saveError);
      await recordResult(tx, runId, stored, saved === null ? null : (saved as SavedScenario).id);
    });
  }

  const stored = storedOf(result, saved, saveError);
  return { stored, result, saved };
}

function storedOf(result: SolverResult, saved: SavedScenario | null, saveError: string | undefined): StoredSolverResult {
  return {
    ...(json(result) as StoredSolverResult),
    resultScenarioId: saved?.id ?? null,
    ...(saved === null ? {} : { scenario: json(saved) }),
    ...(saveError === undefined ? {} : { saveError }),
  };
}
