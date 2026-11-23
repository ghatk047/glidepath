import {
  LINE_ITEM_ATTRIBUTES,
  LINE_ITEM_DIM,
  type Change,
  type ChangesetDraft,
  type JsonObject,
  type JsonValue,
  type StructuralChange,
  type ValueChange,
} from '@glidepath/domain';
import type { CellTarget, DiffValue } from './diff';
import type { BuiltReport, CellItem, ReportItem, RowItem } from './report';

/**
 * toChangeset.ts: delta report + the user's decisions -> changeset drafts (docs/spec/05_excel_template.md section 3
 * steps 6 and 7, docs/architecture/05_excel_roundtrip.md section 2 step 4).
 *
 * The drafts are `ChangesetDraft` of `@glidepath/domain` with origin `excel_import`; the worker hands them to
 * `applyChangeset`. A draft has one scenario (or the tenant defaults), so an import that touches several scenarios
 * gives one draft per scenario layer.
 *
 * What is applied (default action of the status table, then the user's decisions):
 *
 * | Status                        | `accept: 'all'`                  | `accept: 'selected'`           |
 * |-------------------------------|----------------------------------|--------------------------------|
 * | changed_in_excel, new_row, deleted_row | applied, unless decided `app` | applied only when decided `excel` |
 * | conflict                      | the decision (required)          | the decision (required)        |
 * | changed_in_app, already_applied | keep the app value               | keep the app value             |
 * | missing_row                   | warning only, never applied      | never applied                  |
 * | invalid                       | never applied                    | never applied                  |
 *
 * A conflict without a decision throws `ToChangesetError` (the API answers 422). A decision for `changed_in_app`
 * or `already_applied` is ignored: the app's value stays.
 *
 * Decisions are matched by (sheet, key, member, scenario), the contract's `ImportDecision`. Cells of one row that
 * share those four (Default, Note and attribute cells of a row) are decided together, unless a decision names the
 * `column` (and, for new rows, the `rowNumber`), which wins over one that does not. `column` and `rowNumber` are
 * not in `contract/api-contract` yet (see the XL-06 report).
 *
 * Pure: no IO. The caller passes what only it knows (base versions, scenario uuids, current rows, new keys).
 */

// ----------------------------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------------------------

/** `ImportDecision` of CON-03, mirrored, plus the optional `column` and `rowNumber` that tell cells of one row apart. */
export interface ImportDecision {
  readonly sheet: string;
  readonly key: string;
  readonly member: string;
  readonly scenario: string | null;
  /** Take the workbook value (`excel`) or keep the database value (`app`). */
  readonly take: 'excel' | 'app';
  /** Snapshot column id (`default`, `note`, `scenario@C`, `name`); absent: every cell of the row. */
  readonly column?: string | null;
  /** 1-based file row; tells apart new rows, which all have the key `''`. */
  readonly rowNumber?: number;
}

/** `ImportApplyRequest` of CON-03 (without `clientRequestId`): accept all or only the rows decided `excel`. */
export interface ApplyDecisions {
  readonly accept: 'all' | 'selected';
  readonly decisions: readonly ImportDecision[];
}

/** A scenario layer: the scenario's uuid and the `scenario.version` the review started from. */
export interface LayerBase {
  readonly id: string;
  readonly version: number;
}

export interface ChangesetOptions {
  /** The base version of the tenant defaults (`ChangesetDraft.base_scenario_version` with `scenario_id` null). Needed when any default is written. */
  readonly defaultsVersion?: number;
  /** Scenario uuid and base version by the report's scenario key (`C`). Needed for each scenario the changes touch. */
  readonly scenarios?: Readonly<Record<string, LayerBase>>;
  /**
   * The value of a cell a note or reason was edited on while its value was not (a note-only edit): the tenant
   * default of the variable, or the pin of a node. Without it such an edit is skipped (`needs_value`).
   */
  readonly currentValue?: (cell: {
    readonly target: 'variable' | 'override';
    readonly key: string;
    readonly member_key: string;
    readonly scenario: string | null;
  }) => number | null | undefined;
  /**
   * The stored row of a line (`line_item` columns), to edit one attribute without losing the others. Without it an
   * attribute edit is skipped (`needs_member_row`): a structural `set` replaces the whole row.
   */
  readonly memberRow?: (dim: string, member_key: string) => JsonObject | null | undefined;
  /** The key of a new line: the app assigns it. Without it a new row is skipped (`needs_member_key`). */
  readonly newMemberKey?: (row: {
    readonly sheet: string;
    readonly rowNumber: number | null;
    readonly cells: Readonly<Record<string, DiffValue>>;
  }) => string | undefined;
}

export type SkipReason =
  /** Validation blocks the entry (type, range, list, cross-row rule, unknown key). */
  | 'invalid'
  /** Decided `app`, or a status whose default is to keep the app value. */
  | 'keep_app'
  /** `accept: 'selected'` and the entry was not decided `excel`. */
  | 'not_selected'
  /** `missing_row`: a warning, never a delete. */
  | 'missing_row'
  /** The note or reason belongs to a pin that the same import removes. */
  | 'superseded'
  /** A blank cell does not clear a tenant default (it cannot be unset) or an attribute. */
  | 'blank_keeps_value'
  /** A value that is not a number reached a numeric cell. */
  | 'not_numeric'
  /** A note or reason was edited, and the cell's value is not known (`options.currentValue`). */
  | 'needs_value'
  | 'needs_member_row'
  | 'needs_member_key'
  | 'already_deleted'
  /** A pin without a scenario, or a sheet and target this module does not write. */
  | 'unsupported';

export interface SkippedEntry {
  /** Index into `report.changes`. */
  readonly index: number;
  readonly reason: SkipReason;
}

export interface ChangesetPlan {
  /** Drafts to apply, tenant defaults first, then scenarios in order of first change. Empty when nothing is applied. */
  readonly drafts: readonly ChangesetDraft[];
  /** Indexes into `report.changes` that produced at least one change. */
  readonly applied: readonly number[];
  readonly skipped: readonly SkippedEntry[];
  /** Decisions that matched no entry of the report. */
  readonly unmatchedDecisions: readonly ImportDecision[];
}

/** A conflict without a decision, or a layer without its base version. */
export class ToChangesetError extends Error {
  override readonly name = 'ToChangesetError';
  /** Indexes into `report.changes` of the conflicts nobody decided. */
  readonly undecided: readonly number[];

  constructor(message: string, undecided: readonly number[] = []) {
    super(message);
    this.undecided = undecided;
  }
}

// ----------------------------------------------------------------------------------------------
// Constants (names of the template's sheets and columns, no business numbers)
// ----------------------------------------------------------------------------------------------

const ORIGIN = 'excel_import';
const LINE_ITEMS_SHEET = 'Line_Items';
const OVERRIDES_SHEET = 'Overrides';
const OVERRIDE_VALUE = 'value';
const OVERRIDE_REASON = 'reason';
const NODE_KEY_COLUMN = 'node_key';
const MEMBER_KEY_COLUMN = 'member_key';
/** line_item columns that are booleans: the workbook holds 1/0. */
const FLAG_COLUMNS: ReadonlySet<string> = new Set(['in_scope', 'memo']);
/** `line` member attribute -> line_item column (the inverse of `LINE_ITEM_ATTRIBUTES`). */
const COLUMN_OF_ATTR: ReadonlyMap<string, string> = new Map(
  Object.entries(LINE_ITEM_ATTRIBUTES).map(([column, attr]) => [attr, column]),
);

// ----------------------------------------------------------------------------------------------
// Decisions
// ----------------------------------------------------------------------------------------------

interface Subject {
  readonly sheet: string;
  readonly key: string;
  readonly member: string;
  readonly scenario: string | null;
  readonly column: string | null;
  readonly rowNumber: number | null;
}

/** How well a decision fits an entry: -1 no match; higher is more specific (column, then row). */
function fit(d: ImportDecision, s: Subject): number {
  if (d.sheet !== s.sheet || d.key !== s.key || d.member !== s.member || d.scenario !== s.scenario)
    return -1;
  let score = 0;
  if (d.column !== undefined && d.column !== null) {
    if (d.column !== s.column) return -1;
    score += 2;
  }
  if (d.rowNumber !== undefined) {
    if (d.rowNumber !== s.rowNumber) return -1;
    score += 1;
  }
  return score;
}

function decisionFor(
  decisions: readonly ImportDecision[],
  s: Subject,
  used: Set<ImportDecision>,
): ImportDecision | undefined {
  let best: ImportDecision | undefined;
  let bestScore = -1;
  for (const d of decisions) {
    const score = fit(d, s);
    if (score < 0) continue;
    used.add(d);
    if (score >= bestScore) {
      best = d; // later decisions of equal specificity win
      bestScore = score;
    }
  }
  return best;
}

// ----------------------------------------------------------------------------------------------
// Draft assembly
// ----------------------------------------------------------------------------------------------

/** One layer's changes: structural rows first, then values; a note rides on its value's change. */
class Layer {
  readonly structural: Change[] = [];
  readonly values: ValueChange[] = [];
  readonly valueAt = new Map<string, number>();

  value(change: ValueChange): void {
    const k = `${change.target}\u0001${change.key}\u0001${change.member_key}`;
    const at = this.valueAt.get(k);
    if (at === undefined) {
      this.valueAt.set(k, this.values.length);
      this.values.push(change);
    } else this.values[at] = change;
  }

  find(target: 'variable' | 'override', key: string, member: string): ValueChange | undefined {
    const at = this.valueAt.get(`${target}\u0001${key}\u0001${member}`);
    return at === undefined ? undefined : this.values[at];
  }

  get changes(): Change[] {
    return [...this.structural, ...this.values];
  }
}

const isNumber = (v: DiffValue): v is number => typeof v === 'number' && Number.isFinite(v);

/** A line_item column of a workbook value: flags are booleans. */
const rowValue = (column: string, v: number | string): JsonValue =>
  FLAG_COLUMNS.has(column) ? v !== 0 && v !== '0' && v !== '' : v;

/**
 * The changeset drafts of an import.
 *
 * - `built`: `buildReport(...)`; `decisions`: the user's choices (see the table above); `options`: base versions and
 *   the lookups only the caller has.
 * - Cell targets: `variable_value` / `scenario_value` (`set`; a blank scenario cell or pin `unset`s the row, so the
 *   cell inherits again; a blank Default is skipped), a note rides on the default's change, a pin's reason on the
 *   pin's change, a line attribute is a structural `set` of the line's row, a new line a structural `insert` (plus
 *   its numbers), a `DELETE` row a structural `delete`.
 * - Throws `ToChangesetError` for a conflict without a decision and for a layer without its base version.
 */
export function toChangeset(
  built: BuiltReport,
  decisions: ApplyDecisions,
  options: ChangesetOptions = {},
): ChangesetPlan {
  const { report, items } = built;
  const used = new Set<ImportDecision>();
  const skipped: SkippedEntry[] = [];
  const applied: number[] = [];
  const undecided: number[] = [];
  const layers = new Map<string | null, Layer>();
  const layer = (scenario: string | null): Layer => {
    let l = layers.get(scenario);
    if (l === undefined) layers.set(scenario, (l = new Layer()));
    return l;
  };
  const skip = (item: ReportItem, reason: SkipReason): void => {
    skipped.push({ index: item.index, reason });
  };

  // Which entries are taken from the workbook.
  const take = new Map<number, boolean>();
  for (const item of items) {
    const entry = report.changes[item.index];
    if (entry === undefined) continue;
    const subject: Subject = {
      sheet: entry.sheet,
      key: entry.key,
      member: entry.member,
      scenario: entry.scenario,
      column: item.kind === 'row' ? null : item.column,
      rowNumber: item.rowNumber,
    };
    const d = decisionFor(decisions.decisions, subject, used);
    const status = entry.status;
    if (status === 'invalid') skip(item, 'invalid');
    else if (status === 'missing_row') skip(item, 'missing_row');
    else if (status === 'changed_in_app' || status === 'already_applied') skip(item, 'keep_app');
    else if (status === 'conflict') {
      if (d === undefined) undecided.push(item.index);
      else if (d.take === 'excel') take.set(item.index, true);
      else skip(item, 'keep_app');
    } else if (status === 'unchanged') skip(item, 'keep_app');
    else if (decisions.accept === 'all') {
      if (d?.take === 'app') skip(item, 'keep_app');
      else take.set(item.index, true);
    } else if (d?.take === 'excel') take.set(item.index, true);
    else skip(item, d === undefined ? 'not_selected' : 'keep_app');
  }
  if (undecided.length > 0)
    throw new ToChangesetError(
      `${undecided.length} conflict(s) need a decision (File or App): report entries ${undecided.join(', ')}`,
      undecided,
    );

  const need = (scenario: string | null): void => {
    if (scenario === null) {
      if (options.defaultsVersion === undefined)
        throw new ToChangesetError(
          'toChangeset: options.defaultsVersion is needed for the tenant defaults',
        );
    } else if (options.scenarios?.[scenario] === undefined)
      throw new ToChangesetError(
        `toChangeset: options.scenarios has no entry for scenario '${scenario}'`,
      );
  };

  // Notes and reasons wait for their values.
  const pendingNotes: {
    item: CellItem;
    scenario: string | null;
    target: 'variable' | 'override';
    key: string;
    member: string;
    note: string;
  }[] = [];
  const done = (item: ReportItem): void => {
    applied.push(item.index);
  };

  const setValue = (
    item: ReportItem,
    scenario: string | null,
    target: 'variable' | 'override',
    key: string,
    member: string,
    value: DiffValue,
    note?: string,
  ): void => {
    const canUnset = scenario !== null;
    if (value === null) {
      if (!canUnset) return skip(item, 'blank_keeps_value');
      need(scenario);
      layer(scenario).value({ target, key, member_key: member, op: 'unset', new_value: null });
      return done(item);
    }
    if (!isNumber(value)) return skip(item, 'not_numeric');
    need(scenario);
    layer(scenario).value({
      target,
      key,
      member_key: member,
      op: 'set',
      new_value: value,
      ...(note === undefined ? {} : { note }),
    });
    done(item);
  };

  const attrRows = new Map<string, { row: JsonObject; items: ReportItem[] }>();

  for (const item of items) {
    if (!take.get(item.index)) continue;
    const entry = report.changes[item.index];
    if (entry === undefined) continue;
    if (item.kind === 'issue') continue;
    if (item.kind === 'row') {
      rowChange(item, entry.sheet, entry.key, entry.member, entry.scenario);
      continue;
    }
    cellChange(item, item.target, entry.workbook);
  }

  function cellChange(item: CellItem, target: CellTarget, workbook: DiffValue): void {
    switch (target.kind) {
      case 'value':
        return setValue(
          item,
          target.scenario,
          'variable',
          target.var_key,
          target.member_key,
          workbook,
        );
      case 'note':
        pendingNotes.push({
          item,
          scenario: null,
          target: 'variable',
          key: target.var_key,
          member: target.member_key,
          note: typeof workbook === 'string' ? workbook : workbook === null ? '' : String(workbook),
        });
        return;
      case 'override':
        if (target.scenario === null) return skip(item, 'unsupported');
        if (target.field === OVERRIDE_VALUE)
          return setValue(
            item,
            target.scenario,
            'override',
            target.node_key,
            target.member_key,
            workbook,
          );
        if (target.field === OVERRIDE_REASON) {
          pendingNotes.push({
            item,
            scenario: target.scenario,
            target: 'override',
            key: target.node_key,
            member: target.member_key,
            note: workbook === null ? '' : String(workbook),
          });
          return;
        }
        return skip(item, 'unsupported');
      case 'attr':
        return attrChange(item, target.member_key, target.attr, workbook);
    }
  }

  function attrChange(item: CellItem, member: string, attr: string, workbook: DiffValue): void {
    if (workbook === null) return skip(item, 'blank_keeps_value');
    if (options.memberRow === undefined) return skip(item, 'needs_member_row');
    const stored = options.memberRow(LINE_ITEM_DIM, member);
    if (stored === null || stored === undefined) return skip(item, 'needs_member_row');
    const column = COLUMN_OF_ATTR.get(attr) ?? attr;
    let at = attrRows.get(member);
    if (at === undefined) attrRows.set(member, (at = { row: { ...stored }, items: [] }));
    at.row = { ...at.row, [column]: rowValue(column, workbook) };
    at.items.push(item);
  }

  function rowChange(
    item: RowItem,
    sheet: string,
    key: string,
    member: string,
    scenario: string | null,
  ): void {
    if (item.diffStatus === 'new_row') return newRow(item, sheet, key, member, scenario);
    if (item.diffStatus !== 'deleted_row') return skip(item, 'unsupported');
    if (!item.inApp) return skip(item, 'already_deleted');
    if (sheet === LINE_ITEMS_SHEET) {
      need(null);
      const change: StructuralChange = {
        target: 'structural',
        key: LINE_ITEM_DIM,
        member_key: member,
        op: 'delete',
        new_value: null,
      };
      layer(null).structural.push(change);
      return done(item);
    }
    if (sheet === OVERRIDES_SHEET && scenario !== null) {
      need(scenario);
      layer(scenario).value({
        target: 'override',
        key,
        member_key: member,
        op: 'unset',
        new_value: null,
      });
      return done(item);
    }
    skip(item, 'unsupported');
  }

  function newRow(
    item: RowItem,
    sheet: string,
    key: string,
    member: string,
    scenario: string | null,
  ): void {
    if (sheet === OVERRIDES_SHEET) {
      const value = item.cells[OVERRIDE_VALUE] ?? null;
      const reason = item.cells[OVERRIDE_REASON];
      if (scenario === null || key === '') return skip(item, 'unsupported');
      if (value === null) return skip(item, 'blank_keeps_value');
      return setValue(
        item,
        scenario,
        'override',
        key,
        member,
        value,
        reason == null ? undefined : String(reason),
      );
    }
    if (sheet !== LINE_ITEMS_SHEET) return skip(item, 'unsupported');
    const newKey = options.newMemberKey?.({ sheet, rowNumber: item.rowNumber, cells: item.cells });
    if (newKey === undefined) return skip(item, 'needs_member_key');
    need(null);
    const row: Record<string, JsonValue> = { active: true };
    const numbers: [string, number][] = [];
    for (const [column, v] of Object.entries(item.cells)) {
      if (v === null || column === MEMBER_KEY_COLUMN || column === NODE_KEY_COLUMN) continue;
      // Variable ids are dotted (`line.amount`): their cells are values of the new line, not columns of its row.
      if (column.includes('.')) {
        if (isNumber(v)) numbers.push([column, v]);
      } else row[column] = rowValue(column, v);
    }
    layer(null).structural.push({
      target: 'structural',
      key: LINE_ITEM_DIM,
      member_key: newKey,
      op: 'insert',
      new_value: row,
    });
    for (const [varKey, v] of numbers)
      layer(null).value({
        target: 'variable',
        key: varKey,
        member_key: newKey,
        op: 'set',
        new_value: v,
      });
    done(item);
  }

  // Line attributes: one structural `set` per line.
  for (const [member, { row, items: cells }] of attrRows) {
    need(null);
    layer(null).structural.push({
      target: 'structural',
      key: LINE_ITEM_DIM,
      member_key: member,
      op: 'set',
      new_value: row,
    });
    for (const c of cells) done(c);
  }

  // Notes: with the value change of the same cell, else from `currentValue`.
  for (const n of pendingNotes) {
    const l = layers.get(n.scenario);
    const own = l?.find(n.target, n.key, n.member);
    if (own !== undefined && own.op === 'set') {
      l?.value({ ...own, note: n.note });
      done(n.item);
      continue;
    }
    if (own !== undefined) {
      skip(n.item, 'superseded'); // the pin is removed: its reason goes with it
      continue;
    }
    const v = options.currentValue?.({
      target: n.target,
      key: n.key,
      member_key: n.member,
      scenario: n.scenario,
    });
    if (v === undefined || v === null) {
      skip(n.item, 'needs_value');
      continue;
    }
    need(n.scenario);
    layer(n.scenario).value({
      target: n.target,
      key: n.key,
      member_key: n.member,
      op: 'set',
      new_value: v,
      note: n.note,
    });
    done(n.item);
  }

  const drafts: ChangesetDraft[] = [];
  const order = [...layers.keys()].sort((a, b) => (a === null ? -1 : b === null ? 1 : 0));
  for (const scenario of order) {
    const changes = layers.get(scenario)?.changes ?? [];
    if (changes.length === 0) continue;
    const base =
      scenario === null
        ? { id: null, version: options.defaultsVersion }
        : {
            id: options.scenarios?.[scenario]?.id ?? null,
            version: options.scenarios?.[scenario]?.version,
          };
    if (base.version === undefined)
      throw new ToChangesetError(`toChangeset: no base version for scenario '${scenario ?? ''}'`);
    drafts.push({
      origin: ORIGIN,
      scenario_id: base.id,
      base_scenario_version: base.version,
      changes,
    });
  }

  return {
    drafts,
    applied: [...new Set(applied)].sort((a, b) => a - b),
    skipped,
    unmatchedDecisions: decisions.decisions.filter((d) => !used.has(d)),
  };
}
