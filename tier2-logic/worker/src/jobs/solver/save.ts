import { createChangesetStore, updateSolverRun } from '@glidepath/data-access';
import type { ScenarioRecord, TenantTx } from '@glidepath/data-access';
import { applyChangeset, createScenario, recomputeHook } from '@glidepath/domain';
import type { ModelCache } from '@glidepath/domain';
import type { Change as DraftChange, JsonValue } from '@glidepath/domain';
import type { SolverResult } from '@glidepath/solvers';
import type { ModelBundle } from '@glidepath/spec';
import type { CompiledModel } from '@glidepath/engine';

/** `scenario.kind` of a saved solver result. */
export const SOLVER_KIND = 'solver' as const;

/** Labels of the saved scenario by problem (UX 02: "All-VP feasible plan"); the start scenario's label follows. */
const LABELS: Readonly<Record<string, string>> = {
  min_risk_mix: 'Min-risk mix',
  vp_feasible: 'All-VP feasible plan',
};

/** The solver's cell `lev.start[L03]` as a draft change: variable id and member key (`''` for a scalar). */
export function toDraftChange(change: SolverResult['changes'][number]): DraftChange {
  const open = change.cell.indexOf('[');
  const key = open < 0 ? change.cell : change.cell.slice(0, open);
  const member_key = open < 0 ? '' : change.cell.slice(open + 1, change.cell.length - 1);
  return { target: 'variable', key, member_key, op: 'set', new_value: change.value };
}

export interface SaveInput {
  readonly runId: string;
  readonly actor: string;
  readonly start: ScenarioRecord;
  readonly result: SolverResult;
  readonly bundle: ModelBundle;
  readonly tenantId: string;
  readonly modelVersionId: string;
  readonly cache: ModelCache<CompiledModel>;
}

export interface SavedScenario {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly version: number;
  readonly changesetId: string;
  readonly editsCount: number;
}

/**
 * Saves a solver result as a new scenario, in the caller's transaction (03 section 4, UX 02 section 3):
 * a copy of the start scenario (kind `solver`, so it resolves as the start does, pins included), then the
 * moves as one changeset of origin `solver` through `applyChangeset` (VR04 stays a warning for that origin),
 * recomputed in the same transaction. `solver_run.result_scenario_id` is set with it. A start scenario that
 * is a locked preset is only copied, never written.
 *
 * Both writes run in a savepoint: when the write path rejects the moves (an input rule) nothing of the new
 * scenario is kept and the error is returned for the caller to record; the transaction stays usable.
 */
export async function saveAsScenario(
  tx: TenantTx,
  input: SaveInput,
): Promise<{ readonly saved: SavedScenario } | { readonly error: string }> {
  const { result, start } = input;
  const recompute = recomputeHook({
    tenantId: input.tenantId,
    modelVersionId: input.modelVersionId,
    bundle: input.bundle,
    cache: input.cache,
  });
  const base = { actor: input.actor, bundle: input.bundle, recompute };
  try {
    const saved = await tx.transaction(async (sp) => {
      const inner = createChangesetStore(sp as TenantTx);
      const created = await createScenario(
        inner,
        { mode: 'copy', from: start.id, kind: SOLVER_KIND, label: `${LABELS[result.problem] ?? result.problem} (from ${start.key})` },
        { ...base, origin: 'solver' },
      );
      const applied = await applyChangeset(
        inner,
        {
          origin: 'solver',
          scenario_id: created.scenario.id,
          base_scenario_version: created.scenario.version,
          changes: result.changes.map(toDraftChange),
        },
        base,
      );
      return {
        id: created.scenario.id,
        key: created.scenario.key,
        label: created.scenario.label,
        version: applied.version,
        changesetId: applied.changesetId,
        editsCount: applied.editsCount,
      } satisfies SavedScenario;
    });
    return { saved };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Writes the finished result (and the scenario it became) on the run. */
export async function recordResult(
  tx: TenantTx,
  runId: string,
  result: JsonValue,
  scenarioId: string | null,
): Promise<void> {
  await updateSolverRun(tx, runId, { result, ...(scenarioId === null ? {} : { result_scenario_id: scenarioId }) });
}
