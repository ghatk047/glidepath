import {
  CHANGE_ROW_TARGET_KIND,
  type Change,
  type ChangeRow,
  type ChangeRowStatus,
  type Changeset,
  type ChangesetDraft,
  type JsonObject,
  type JsonValue,
} from './changeset';

/** Change rows that were written; `rejected`, `invalid` and `conflict` rows were not. */
export const APPLIED_ROW_STATUSES: readonly ChangeRowStatus[] = ['clean', 'accepted'];

function numberOrNull(v: JsonValue, row: ChangeRow): number | null {
  if (v === null || typeof v === 'number') return v;
  throw new Error(
    `reverse: ${row.target} ${row.key}[${row.member_key}] holds ${JSON.stringify(v)}, not a number`,
  );
}

function objectOrNull(v: JsonValue, row: ChangeRow): JsonObject | null {
  if (v === null || (typeof v === 'object' && !Array.isArray(v))) return v as JsonObject | null;
  throw new Error(
    `reverse: ${row.target} ${row.key}[${row.member_key}] holds ${JSON.stringify(v)}, not an object`,
  );
}

/** The draft change that undoes one applied change row. */
function undoOf(row: ChangeRow): Change {
  const id = { key: row.key, member_key: row.member_key };
  const kind = CHANGE_ROW_TARGET_KIND[row.target];
  if (kind === 'structural') {
    const before = objectOrNull(row.old_value, row);
    const after = objectOrNull(row.new_value, row);
    switch (row.op) {
      case 'insert':
        return { target: kind, ...id, op: 'delete', old_value: after, new_value: null };
      case 'update':
        return { target: kind, ...id, op: 'set', old_value: after, new_value: before };
      case 'delete':
        return { target: kind, ...id, op: 'insert', old_value: null, new_value: before };
    }
  }
  const before = numberOrNull(row.old_value, row);
  const after = numberOrNull(row.new_value, row);
  switch (row.op) {
    // The row did not exist: remove it, so the cell inherits again.
    case 'insert':
      return { target: kind, ...id, op: 'unset', old_value: after, new_value: null };
    case 'update':
      return { target: kind, ...id, op: 'set', old_value: after, new_value: before };
    // The row is gone and the cell now resolves to what it inherits, which the row does not record.
    case 'delete':
      return { target: kind, ...id, op: 'set', new_value: before };
  }
}

/**
 * The undo draft of an applied changeset: same origin and scenario, `reverts_id` = its id, and the
 * inverse of each applied change row in reverse `seq` order. Undo is `applyChangeset(reverse(cs))`;
 * redo is the reverse of the applied undo.
 *
 * `baseVersion` is the scenario version the undo starts from; it defaults to the version this
 * changeset produced (`base_scenario_version + 1`), so undoing anything but the latest changeset
 * needs the current version (applyChangeset rejects a stale one with a conflict).
 */
export function reverse(
  changeset: Changeset,
  baseVersion: number = changeset.base_scenario_version + 1,
): ChangesetDraft {
  if (changeset.status !== 'applied') {
    throw new Error(
      `reverse: changeset ${changeset.id} is ${changeset.status}; only an applied changeset can be reversed`,
    );
  }
  const changes = changeset.changes
    .filter((row) => APPLIED_ROW_STATUSES.includes(row.status))
    .sort((a, b) => b.seq - a.seq)
    .map(undoOf);
  return {
    origin: changeset.origin,
    scenario_id: changeset.scenario_id,
    base_scenario_version: baseVersion,
    reverts_id: changeset.id,
    changes,
  };
}
