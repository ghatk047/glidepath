/**
 * Undo and redo (docs/architecture/04_data_and_api.md section 2: "Undo = applyChangeset(reverse(
 * changeset)) with origin preserved and a reverts link"; docs/spec/01_data_model.md section 5), and
 * what the edits counter and changeset tray need from a scenario's history (docs/ux/
 * 04_component_inventory.md, Shell #5: count, canUndo, canRedo).
 */
import { applyInTx, replayResult, summaryOf, type ApplyOptions, type ApplyResult } from './apply';
import { ChangesetNotFoundError, ScenarioNotFoundError } from './apply-errors';
import {
  ChangesetDraftError,
  type Changeset,
  type ChangesetId,
  type ChangesetStatus,
} from './changeset';
import type { ChangesetStore } from './ports';
import { reverse } from './reverse';

const draftError = (message: string): ChangesetDraftError =>
  new ChangesetDraftError([{ index: null, message }]);

/**
 * Undo a changeset: `applyChangeset(reverse(changeset))` at its scenario's current version, in one
 * transaction. The undo keeps the changeset's origin, links it with `reverts_id`, marks it
 * `reverted` and takes its edits off the counter; it restores the values as they were, also past a
 * registry bound (`UNDO_BOUNDS_POLICY`). Redo is the revert of that undo.
 *
 * Throws `ChangesetNotFoundError`, `ScenarioNotFoundError`, a `ChangesetDraftError` when the
 * changeset is not `applied` (already undone, or never applied) or its scenario is locked (a preset,
 * also for the seed's own changesets), and what `applyChangeset` throws: e.g. a `ChangesetConflictError` with `stale` cells when a later
 * changeset changed a cell the undo would restore. With `clientRequestId`, a retry returns the first
 * result (`replayed`).
 */
export async function revert<R = undefined>(
  store: ChangesetStore,
  changesetId: ChangesetId,
  options: ApplyOptions<R>,
): Promise<ApplyResult<R>> {
  return store.transaction(async (tx) => {
    const changeset = await tx.loadChangeset(changesetId);
    if (changeset === null) throw new ChangesetNotFoundError(changesetId);
    const scenarioId = changeset.scenario_id;
    let version: number;
    if (scenarioId === null) {
      await tx.lockTenantDefaults();
      version = (await tx.changesSince(null, 0)).length;
    } else {
      const scenario = await tx.loadScenarioForUpdate(scenarioId);
      if (scenario === null) throw new ScenarioNotFoundError(scenarioId);
      // Also for origin seed, which applyChangeset lets write a locked preset: no user undoes the seed.
      if (scenario.locked) {
        throw draftError(
          `scenario ${scenario.key} is locked; its changesets cannot be undone (copy it to change it)`,
        );
      }
      version = scenario.version;
    }
    if (options.clientRequestId !== undefined) {
      const prior = await tx.findChangesetByClientRequest(options.actor, options.clientRequestId);
      if (prior !== null) {
        if (prior.reverts_id !== changesetId) {
          throw draftError(
            `clientRequestId ${options.clientRequestId} was used for changeset ${prior.id}, which does not revert ${changesetId}`,
          );
        }
        return replayResult<R>(prior, scenarioId);
      }
    }
    if (changeset.status !== 'applied') {
      throw draftError(
        `changeset ${changesetId} is ${changeset.status}, not applied; only an applied changeset can be undone`,
      );
    }
    return applyInTx(tx, reverse(changeset, version), options);
  });
}

/** What the edits counter and the changeset tray show for a scenario. */
export interface UndoRedo {
  /** The scenario's edits counter: `edits_count` of its latest changeset, 0 without one. */
  readonly editsCount: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The changeset undo reverts: the latest edit (or redo) not undone; null when none. */
  readonly undo: ChangesetId | null;
  /** The changeset redo reverts: the latest undo not redone, with no edit since; null when none. */
  readonly redo: ChangesetId | null;
}

/** The statuses of changesets that were applied (`ChangesetTx.changesSince` returns these). */
const APPLIED: readonly ChangesetStatus[] = ['applied', 'reverted'];

/**
 * The undo and redo targets of a scenario from its history (`changesSince(scenarioId, 0)`): a
 * linear undo stack. An edit (a changeset that counts edits, so not the seed, a fork's copy of the
 * preset's pins or a new scenario's first values) is pushed and clears the redo stack; an undo moves
 * the changeset it reverts to the redo stack (as the undo, which a redo reverts); a redo moves it
 * back (as the redo, which an undo reverts). Pure; changesets that were never applied are skipped.
 */
export function undoRedo(history: readonly Changeset[]): UndoRedo {
  const applied = history
    .filter((c) => APPLIED.includes(c.status))
    .sort((a, b) => a.base_scenario_version - b.base_scenario_version);
  const undo: ChangesetId[] = [];
  let redo: ChangesetId[] = [];
  for (const c of applied) {
    if (c.reverts_id === null) {
      if (summaryOf(c).edits > 0) {
        undo.push(c.id);
        redo = [];
      }
      continue;
    }
    const u = undo.lastIndexOf(c.reverts_id);
    if (u >= 0) {
      undo.splice(u, 1);
      redo.push(c.id);
      continue;
    }
    const r = redo.lastIndexOf(c.reverts_id);
    if (r >= 0) {
      redo.splice(r, 1);
      undo.push(c.id);
    }
  }
  const last = applied.at(-1);
  return {
    editsCount: last === undefined ? 0 : summaryOf(last).edits_count,
    canUndo: undo.length > 0,
    canRedo: redo.length > 0,
    undo: undo.at(-1) ?? null,
    redo: redo.at(-1) ?? null,
  };
}
