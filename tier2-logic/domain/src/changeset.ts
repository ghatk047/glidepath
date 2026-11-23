/**
 * The vocabulary of every write (ADR-007): changesets and their changes, in two layers.
 *
 * - Drafts (`ChangesetDraft`, `Change`) say what a caller wants: set or unset a variable value or a
 *   node override; insert, set or delete a structural row (a dimension member or a line item).
 * - Rows (`ChangesetRow`, `ChangeRow`, `Changeset`) are what `applyChangeset` persists, column for
 *   column as `docs/spec/schema.json` tables.changeset and tables.change, enums verbatim.
 *
 * Tenant rows in this package omit `tenant_id`: the ChangesetStore is opened inside a tenant context
 * and adds it (ADR-015, ADR-019).
 */
import type { DimId, MemberId, NodeId, VarId } from '@glidepath/spec';
import type { MemberKey } from './member-key';

/** A jsonb value. */
export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

/** uuid of a scenario. */
export type ScenarioId = string;
/** uuid of a changeset. */
export type ChangesetId = string;
/** uuid of an app user. */
export type UserId = string;
/** ISO 8601 timestamp (timestamptz). */
export type Timestamp = string;

/** The RLS key every tenant table carries; the store sets it from the tenant context. */
export const TENANT_COLUMN = 'tenant_id';

// ---------------------------------------------------------------------------------- schema enums

/** changeset.origin */
export const CHANGESET_ORIGINS = [
  'ui',
  'excel_import',
  'api',
  'solver',
  'ai_reconfig',
  'market_refresh',
  'seed',
] as const;
export type ChangesetOrigin = (typeof CHANGESET_ORIGINS)[number];

/** changeset.status */
export const CHANGESET_STATUSES = ['pending', 'applied', 'rejected', 'reverted'] as const;
export type ChangesetStatus = (typeof CHANGESET_STATUSES)[number];

/** change.target: the table a change row wrote. */
export const CHANGE_ROW_TARGETS = [
  'variable_value',
  'scenario_value',
  'node_override',
  'line_item',
  'dimension_member',
] as const;
export type ChangeRowTarget = (typeof CHANGE_ROW_TARGETS)[number];

/** change.op: what happened to the row. */
export const CHANGE_ROW_OPS = ['insert', 'update', 'delete'] as const;
export type ChangeRowOp = (typeof CHANGE_ROW_OPS)[number];

/** change.status (review state, e.g. of an Excel import row). */
export const CHANGE_ROW_STATUSES = [
  'clean',
  'conflict',
  'invalid',
  'accepted',
  'rejected',
] as const;
export type ChangeRowStatus = (typeof CHANGE_ROW_STATUSES)[number];

// ---------------------------------------------------------------------------------- drafts

/** What a draft change addresses: an input value, a node override, or a structural row. */
export const CHANGE_TARGETS = ['variable', 'override', 'structural'] as const;
export type ChangeTarget = (typeof CHANGE_TARGETS)[number];

/** What a draft change does. `set`/`unset` apply to values; `insert`/`set`/`delete` to structural rows. */
export const CHANGE_OPS = ['set', 'unset', 'insert', 'delete'] as const;
export type ChangeOp = (typeof CHANGE_OPS)[number];

/**
 * Set or unset one cell of an input variable (`variable`: variable_value when the changeset has no
 * scenario, else scenario_value) or of a node override (`override`: node_override).
 * `set` writes `new_value` into this level's row; `unset` removes the row (`new_value` null), so the
 * cell resolves to what it inherits again. Tenant defaults cannot be unset (`checkDraft`): they are
 * the last level, so the cell would have no value at all.
 */
export interface ValueChange {
  readonly target: 'variable' | 'override';
  /** var_key or node_key, verbatim (e.g. `corp.lab_hc_g`, `base.pool_outlay`). */
  readonly key: VarId | NodeId;
  /** Member ids in the definition's dims order (`memberKey`), `''` for scalars. */
  readonly member_key: MemberKey;
  readonly op: 'set' | 'unset';
  /**
   * The cell's value before this change, as resolved at the changeset's base version: this level's
   * own row, else what the cell inherits (an ancestor scenario, then the tenant default), with the
   * changeset's earlier changes applied. null when no level sets it. Optional in a draft: when given,
   * applyChangeset checks it is still current; it is always stored on the change row.
   */
  readonly old_value?: number | null;
  /** The row's new value; null for `unset`. */
  readonly new_value: number | null;
  /**
   * Why the value was set, persisted with the row: `variable_value.note` for a tenant default
   * (`scenario_id` null) and `node_override.reason` for an override. scenario_value has no note
   * column, so a scenario value does not store it.
   */
  readonly note?: string;
}

/**
 * Insert, replace or delete one structural row: a dimension member (dimension_member) or a baseline
 * line (line_item, the members of dimension `line`). Row content is the table's columns other than
 * tenant_id, dim_key and member_key (e.g. `{ label, attrs, sort, active }` for a member).
 */
export interface StructuralChange {
  readonly target: 'structural';
  /** The dimension id, verbatim (e.g. `vp`, `line`). */
  readonly key: DimId;
  /** The member id (dimension_member.member_key / line_item.member_key). */
  readonly member_key: MemberId;
  readonly op: 'insert' | 'set' | 'delete';
  /** The row before this change, null when absent. Optional in a draft, as for values. */
  readonly old_value?: JsonObject | null;
  /** The row after the change; null for `delete`. */
  readonly new_value: JsonObject | null;
  /**
   * Why the row changed. Unlike variable_value.note and node_override.reason, dimension_member and
   * line_item have no note column (a line's own `notes` is row content, in `new_value`), so the row
   * does not store it.
   */
  readonly note?: string;
}

export type Change = ValueChange | StructuralChange;

/**
 * A set of changes to apply atomically to one scenario (or to the tenant defaults).
 *
 * A draft names no author: `applyChangeset` takes the actor (a UserId) as an explicit argument and
 * writes it to changeset.created_by and audit_log.actor. It never reads the actor from ambient
 * context; the store's context carries the tenant only.
 */
export interface ChangesetDraft {
  readonly origin: ChangesetOrigin;
  /** null = tenant defaults (variable_value). */
  readonly scenario_id: ScenarioId | null;
  /**
   * The version the author started from (optimistic concurrency): `scenario.version` for a scenario.
   * Tenant defaults have no scenario row, so their version is the number of tenant-default
   * changesets ever applied (status `applied` or `reverted`); a tenant-default draft is current when
   * `ChangesetTx.changesSince(null, base_scenario_version)` is empty, and no scenario version bumps.
   */
  readonly base_scenario_version: number;
  /** Set when this draft undoes (or redoes) another changeset. */
  readonly reverts_id?: ChangesetId | null;
  /** Applied in order. */
  readonly changes: readonly Change[];
}

// ---------------------------------------------------------------------------------- rows

/** One changeset row (schema.json tables.changeset, without tenant_id). */
export interface ChangesetRow {
  readonly id: ChangesetId;
  readonly origin: ChangesetOrigin;
  readonly scenario_id: ScenarioId | null;
  readonly base_scenario_version: number;
  readonly status: ChangesetStatus;
  /** Counts, impact preview. */
  readonly summary: JsonValue;
  readonly created_by: UserId;
  readonly created_at: Timestamp;
  readonly reverts_id: ChangesetId | null;
}

/**
 * One change row (schema.json tables.change, without tenant_id). `(target, key, member_key)` names
 * the row written: `(var_key, member_key)`, `(node_key, member_key)` or `(dim_key, member_key)`.
 * For values, `old_value` is the cell's value before this change as resolved at the changeset's base
 * version (`ValueChange.old_value`) and `new_value` the row's new value (null when deleted); for
 * structural rows both are row contents (null when absent).
 * `op` records whether the row was inserted, updated or deleted, which is what undo needs.
 */
export interface ChangeRow {
  readonly changeset_id: ChangesetId;
  readonly seq: number;
  readonly target: ChangeRowTarget;
  readonly key: string;
  readonly member_key: string;
  readonly op: ChangeRowOp;
  readonly old_value: JsonValue;
  readonly new_value: JsonValue;
  /** Value at export time (Excel 3-way diff). */
  readonly export_value: JsonValue | null;
  readonly status: ChangeRowStatus;
  /** Validation messages. */
  readonly messages: JsonValue;
}

/** A stored changeset with its change rows. */
export interface Changeset extends ChangesetRow {
  readonly changes: readonly ChangeRow[];
}

// ---------------------------------------------------------------------------------- mapping

/** The dimension whose members live in table line_item (all other tenant members: dimension_member). */
export const LINE_ITEM_DIM: DimId = 'line';

/** The draft target of each stored change target. */
export const CHANGE_ROW_TARGET_KIND: Readonly<Record<ChangeRowTarget, ChangeTarget>> = {
  variable_value: 'variable',
  scenario_value: 'variable',
  node_override: 'override',
  line_item: 'structural',
  dimension_member: 'structural',
};

/** The table a draft change writes, as stored in change.target. */
export function changeRowTarget(
  change: Pick<Change, 'target' | 'key'>,
  scenarioId: ScenarioId | null,
): ChangeRowTarget {
  switch (change.target) {
    case 'variable':
      return scenarioId === null ? 'variable_value' : 'scenario_value';
    case 'override':
      if (scenarioId === null) {
        throw new Error(
          `override ${change.key}: a node override belongs to a scenario (scenario_id is null)`,
        );
      }
      return 'node_override';
    case 'structural':
      return change.key === LINE_ITEM_DIM ? 'line_item' : 'dimension_member';
  }
}

// ---------------------------------------------------------------------------------- draft checks

/** One problem of a draft: the index of the change in `changes`, or null for the draft itself. */
export interface DraftIssue {
  readonly index: number | null;
  readonly message: string;
}

/** A draft that cannot be applied whatever the state; `issues` lists every problem. */
export class ChangesetDraftError extends Error {
  readonly issues: readonly DraftIssue[];

  constructor(issues: readonly DraftIssue[]) {
    const first = issues[0];
    const where = first === undefined || first.index === null ? 'draft' : `change ${first.index}`;
    const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : '';
    super(`${where}: ${first?.message ?? 'invalid'}${more}`);
    this.name = 'ChangesetDraftError';
    this.issues = issues;
  }
}

const isRow = (v: JsonValue): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);

/** What `op` needs in `new_value`, or null when it holds that. */
function newValueProblem(c: Change): string | null {
  if (c.target === 'structural') {
    if (c.op === 'delete') return c.new_value === null ? null : 'delete needs new_value null';
    return isRow(c.new_value) ? null : `${c.op} needs the row as new_value`;
  }
  if (c.op === 'unset') return c.new_value === null ? null : 'unset needs new_value null';
  return typeof c.new_value === 'number' && Number.isFinite(c.new_value)
    ? null
    : 'set needs a finite number as new_value';
}

/**
 * The problems that make a draft invalid whatever the stored state, in change order; empty when
 * there are none:
 * - `base_scenario_version` is not a non-negative integer;
 * - no changes: a changeset writes at least one row;
 * - `unset` of a tenant default (`scenario_id` null): the tenant default is the last level a cell
 *   resolves from, so removing it leaves the cell without a value; set a value instead;
 * - an override without a scenario (node_override.scenario_id is part of its key);
 * - a `new_value` that does not fit the op (a number for a value `set`, a row for `insert` and a
 *   structural `set`, null for `unset` and `delete`).
 */
export function draftIssues(draft: ChangesetDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const version = draft.base_scenario_version;
  if (!Number.isInteger(version) || version < 0) {
    issues.push({ index: null, message: `base_scenario_version ${version} is not a version` });
  }
  if (draft.changes.length === 0) {
    issues.push({ index: null, message: 'a changeset needs at least one change' });
  }
  draft.changes.forEach((c, index) => {
    const cell = `${c.target} ${c.key}[${c.member_key}]`;
    if (c.target === 'variable' && c.op === 'unset' && draft.scenario_id === null) {
      issues.push({
        index,
        message: `${cell}: tenant defaults cannot be unset (the cell would have no value); set a value instead`,
      });
    }
    if (c.target === 'override' && draft.scenario_id === null) {
      issues.push({ index, message: `${cell}: a node override belongs to a scenario` });
    }
    const problem = newValueProblem(c);
    if (problem !== null) issues.push({ index, message: `${cell}: ${problem}` });
  });
  return issues;
}

/** Throw a ChangesetDraftError listing `draftIssues(draft)`, if there are any. */
export function checkDraft(draft: ChangesetDraft): void {
  const issues = draftIssues(draft);
  if (issues.length > 0) throw new ChangesetDraftError(issues);
}
