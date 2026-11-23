/**
 * Why `applyChangeset` wrote nothing. Each error is thrown inside the store transaction, so the store
 * rolls back whatever the transaction did. A draft that is invalid in itself throws the
 * `ChangesetDraftError` of ./changeset.
 *
 * The server maps them onto the contract (contract/api-contract): a conflict to the 409
 * `ChangesetConflict`, a rejection to a 422 problem with `violations`, a missing scenario to a 404.
 */
import type { Changeset, JsonValue, ScenarioId } from './changeset';
import type { ValidationEntry } from './validation';

/** A change whose `old_value` is not the cell's value in the stored state (the draft's view is stale). */
export interface StaleChange {
  /** The index of the change in the draft's `changes`. */
  readonly index: number;
  /** The contract's CellKey of the change, `key[member_key]` (a structural row: `dim[member]`). */
  readonly cell: string;
  /** The draft's `old_value`. */
  readonly expected: JsonValue;
  /** The value in the stored state, with the draft's earlier changes applied. */
  readonly actual: JsonValue;
}

/**
 * The draft started from another version than the stored one, or one of its `old_value`s is stale
 * (step 1 of the write path). Nothing was applied: the caller re-sends its edits on `serverVersion`.
 */
export class ChangesetConflictError extends Error {
  /** The scenario's version now (tenant defaults: their changeset count). */
  readonly serverVersion: number;
  /** The changesets applied since the draft's base version, oldest first; empty when only `stale`. */
  readonly changesSince: readonly Changeset[];
  /** The changes whose `old_value` is stale; empty for a plain version conflict. */
  readonly stale: readonly StaleChange[];

  constructor(
    baseVersion: number,
    serverVersion: number,
    changesSince: readonly Changeset[],
    stale: readonly StaleChange[] = [],
  ) {
    const n = changesSince.length;
    super(
      stale.length > 0
        ? `${stale[0]!.cell} is ${JSON.stringify(stale[0]!.actual)}, not ${JSON.stringify(stale[0]!.expected)}${stale.length > 1 ? ` (and ${stale.length - 1} more)` : ''}; reload and edit again.`
        : `The scenario is at version ${serverVersion}, not ${baseVersion} (${n} ${n === 1 ? 'changeset' : 'changesets'} since); re-send your edits on version ${serverVersion}.`,
    );
    this.name = 'ChangesetConflictError';
    this.serverVersion = serverVersion;
    this.changesSince = changesSince;
    this.stale = stale;
  }
}

/**
 * The post-change state breaks a rule (steps 3 and 4): an error entry of an input rule, or a value
 * outside its registry bounds from an origin that rejects them (`BOUNDS_POLICY`). `violations` are
 * the blocking entries, each with severity `error`.
 */
export class ChangesetRejectedError extends Error {
  readonly violations: readonly ValidationEntry[];

  constructor(violations: readonly ValidationEntry[]) {
    const more = violations.length > 1 ? ` (and ${violations.length - 1} more)` : '';
    super(`${violations[0]?.message ?? 'Rule broken.'}${more}`);
    this.name = 'ChangesetRejectedError';
    this.violations = violations;
  }
}

/** The draft names a scenario the tenant does not have. */
export class ScenarioNotFoundError extends Error {
  readonly scenarioId: ScenarioId;

  constructor(scenarioId: ScenarioId) {
    super(`Scenario ${scenarioId} does not exist.`);
    this.name = 'ScenarioNotFoundError';
    this.scenarioId = scenarioId;
  }
}
