/**
 * Rebase (docs/architecture/04_data_and_api.md sections 2 and 4): when a commit gets a version
 * conflict (`ChangesetConflictError` with `serverVersion` and `changesSince`), the pending edits are
 * re-sent on the new version. `rebase` retargets them and reports the cells someone else changed
 * meanwhile. Pure.
 */
import {
  CHANGE_ROW_TARGET_KIND,
  type Change,
  type ChangeRowOp,
  type ChangesetDraft,
  type ChangesetId,
  type ChangesetOrigin,
  type Changeset,
  type ChangeTarget,
  type JsonObject,
  type JsonValue,
  type Timestamp,
  type UserId,
} from './changeset';
import { APPLIED_ROW_STATUSES } from './reverse';
import { toCellKey } from './validation';

/** One change a changeset since the pending base made to a row the pending draft also changes. */
export interface TheirChange {
  readonly changeset_id: ChangesetId;
  readonly origin: ChangesetOrigin;
  readonly created_by: UserId;
  readonly created_at: Timestamp;
  readonly op: ChangeRowOp;
  readonly old_value: JsonValue;
  readonly new_value: JsonValue;
}

/** A pending change to a row that changesets since its base changed (and did not change back). */
export interface RebaseConflict {
  /** The change's index in the pending draft. */
  readonly index: number;
  /** CellKey `key[member_key]` of the row (a structural row: `dim[member]`). */
  readonly cell: string;
  readonly target: ChangeTarget;
  /** The pending change as given. */
  readonly change: Change;
  /** Their changes to the row, oldest first. */
  readonly theirs: readonly TheirChange[];
  /**
   * `mine`: the pending change is kept and overwrites theirs (the edits are re-sent, as the client
   * means them); `same`: the row already is what the change makes it, so the change is dropped.
   */
  readonly resolution: 'mine' | 'same';
}

export interface RebaseResult {
  /** The pending edits on `version`; null when every change is already in effect. */
  readonly draft: ChangesetDraft | null;
  /** The version the edits now start from: the version after the last changeset since. */
  readonly version: number;
  /** In pending change order. */
  readonly conflicts: readonly RebaseConflict[];
}

/** A row's state: its stored value or row, or undefined when there is no row. */
type RowState = JsonValue | undefined;

const rowId = (target: ChangeTarget, key: string, memberKey: string): string =>
  `${target}|${key}|${memberKey}`;

/** JSON equality, object keys in any order; undefined (no row) equals only itself. */
function same(a: RowState, b: RowState): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const y = b as readonly JsonValue[];
    return a.length === y.length && a.every((v: JsonValue, i) => same(v, y[i]));
  }
  const x = a as { readonly [k: string]: JsonValue };
  const y = b as { readonly [k: string]: JsonValue };
  const keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length &&
    keys.every((k) => Object.hasOwn(y, k) && same(x[k], y[k]))
  );
}

/**
 * Rebase `pending` (a draft that started from `pending.base_scenario_version`) onto the changesets
 * applied since, `changesSince` (as `ChangesetConflictError.changesSince` or
 * `ChangesetTx.changesSince(scenario, base)` give them: that scenario's, oldest first, one per
 * version from the base on).
 *
 * The result starts from the version after the last of them and keeps origin, scenario and
 * `reverts_id`. A pending change to a row that no changeset since changed, or that they changed and
 * changed back, stays as it is. A change to a row they did change is a conflict:
 * - if the row already is what the change makes it (the same value or row, or already gone), the
 *   change is dropped (`same`);
 * - else it is kept (`mine`): an `unset`, `delete` or `set` as before, a structural `insert` of a row
 *   they added becomes a `set` and a `set` of a row they deleted an `insert`; a given `old_value`
 *   becomes the row's value now (left out for an input value whose row they removed: the inherited
 *   value is not in the history).
 *
 * Throws an Error when `changesSince` is not the history since the pending base of its scenario.
 */
export function rebase(pending: ChangesetDraft, changesSince: readonly Changeset[]): RebaseResult {
  const base = pending.base_scenario_version;
  changesSince.forEach((c, i) => {
    if (c.scenario_id !== pending.scenario_id || c.base_scenario_version !== base + i) {
      throw new Error(
        `rebase: changesSince must be the changesets of scenario ${pending.scenario_id ?? 'tenant defaults'} from version ${base} on, oldest first; changeset ${c.id} is not`,
      );
    }
  });
  const version = base + changesSince.length;

  // Per row their changes touched: its state at the pending base, its state now, their changes.
  const rows = new Map<string, { before: RowState; now: RowState; theirs: TheirChange[] }>();
  for (const c of changesSince) {
    for (const r of [...c.changes].sort((a, b) => a.seq - b.seq)) {
      if (!APPLIED_ROW_STATUSES.includes(r.status)) continue;
      const target = CHANGE_ROW_TARGET_KIND[r.target];
      const structural = target === 'structural';
      const before = r.op === 'insert' ? (structural ? null : undefined) : r.old_value;
      const after = r.op === 'delete' ? (structural ? null : undefined) : r.new_value;
      const id = rowId(target, r.key, r.member_key);
      const row = rows.get(id) ?? { before, now: after, theirs: [] };
      rows.set(id, row);
      row.now = after;
      row.theirs.push({
        changeset_id: c.id,
        origin: c.origin,
        created_by: c.created_by,
        created_at: c.created_at,
        op: r.op,
        old_value: r.old_value,
        new_value: r.new_value,
      });
    }
  }

  const changes: Change[] = [];
  const conflicts: RebaseConflict[] = [];
  /** A conflicting row's state with the pending changes so far applied. */
  const state = new Map<string, RowState>();
  pending.changes.forEach((change, index) => {
    const id = rowId(change.target, change.key, change.member_key);
    const row = rows.get(id);
    if (row === undefined || same(row.before, row.now)) {
      changes.push(change);
      return;
    }
    const structural = change.target === 'structural';
    const current = state.has(id) ? state.get(id) : row.now;
    const intent: RowState =
      change.new_value === null ? (structural ? null : undefined) : change.new_value;
    state.set(id, intent);
    const resolution = same(current, intent) ? 'same' : 'mine';
    conflicts.push({
      index,
      cell: toCellKey(change.key, change.member_key),
      target: change.target,
      change,
      theirs: row.theirs,
      resolution,
    });
    if (resolution === 'mine') changes.push(retarget(change, current));
  });

  return {
    draft: changes.length === 0 ? null : { ...pending, base_scenario_version: version, changes },
    version,
    conflicts,
  };
}

/** A kept conflicting change, on the row as it now is (`current`). */
function retarget(change: Change, current: RowState): Change {
  if (change.target === 'structural') {
    const { old_value: given, ...rest } = change;
    const row = (current ?? null) as JsonObject | null;
    return {
      ...rest,
      op: change.op === 'delete' ? 'delete' : row === null ? 'insert' : 'set',
      ...(given === undefined ? {} : { old_value: row }),
    };
  }
  const { old_value: given, ...rest } = change;
  // An input value without its own row resolves to what it inherits, which the history does not hold.
  const known = change.target === 'override' || current !== undefined;
  return {
    ...rest,
    ...(given === undefined || !known
      ? {}
      : { old_value: typeof current === 'number' ? current : null }),
  };
}
