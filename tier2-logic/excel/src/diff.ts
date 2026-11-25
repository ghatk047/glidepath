import { memberKey } from '@glidepath/domain';
import { VALUE_ROLES, rowKey, snapshotKey, type ExportSnapshot, type SnapshotValue } from './build';
import type { ParsedColumn, ParsedRow, ParsedSheet, ParsedWorkbook } from './parse';
import type { ColumnDef, RowDef, SheetDef } from './types';

/**
 * diff.ts: export snapshot (E) + parsed workbook (W) + current database (D) -> per-cell and per-row status
 * (docs/spec/05_excel_template.md section 3 step 4, excel_template.json `import_pipeline[3]`,
 * docs/architecture/05_excel_roundtrip.md section 1).
 *
 * Per cell, three-way (an export with its snapshot):
 *
 * | E vs W    | E vs D    | status           |
 * |-----------|-----------|------------------|
 * | same      | same      | unchanged        |
 * | different | same      | changed_in_excel |
 * | same      | different | changed_in_app   |
 * | different | different, W != D | conflict |
 * | different | different, W = D  | already_applied |
 *
 * Foreign workbook (no `_meta`, no snapshot): W against D by key columns, two-way: equal = unchanged, else
 * changed_in_excel.
 *
 * Rows: blank key on a table sheet = `new_row`; `DELETE` in the action column = `deleted_row`; a row of the export
 * (three-way) or of the app (foreign) that the sheet no longer has = `missing_row`, a warning that never deletes.
 *
 * Numbers are equal when they agree to the precision a workbook keeps (`EXPORT_PRECISION_DIGITS` significant
 * digits), so a re-save by LibreOffice or Excel, which rewrites `0.30000000000000004` as `0.3`, changes nothing.
 * A row whose parsed `hash` equals the snapshot's row hash (and the app's) is skipped without a cell compare.
 *
 * Pure: no IO. Validation (types, ranges, unknown keys, locked columns) is `validate.ts`; this module only compares
 * the editable cells, the ones the row `_hash` covers.
 */

// ----------------------------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------------------------

/** A normalised cell value as the delta report carries it: booleans are 1/0, blank is `null`. */
export type DiffValue = number | string | null;

/** `delta_report_schema.mode`: `three_way` with an export snapshot, `foreign` without. */
export type DiffMode = 'three_way' | 'foreign';

/** Status of one cell (import_pipeline step 4). */
export type CellStatus =
  'unchanged' | 'changed_in_excel' | 'changed_in_app' | 'conflict' | 'already_applied';

/** Status of one row: blank key = new, `DELETE` = deleted, gone from the sheet = missing (warning only). */
export type RowStatus = 'new_row' | 'deleted_row' | 'missing_row';

/** Every status a delta report entry can have; `invalid` is set by validation, never by the diff. */
export type DeltaEntryStatus = CellStatus | RowStatus | 'invalid';

/**
 * One entry of `delta_report_schema.changes[]` (excel_template.json), keys verbatim (snake_case). This mirrors
 * `DeltaChange` of `contract/api-contract` (CON-03) without importing it: tier 2 core packages stay off the
 * contract. A test keeps the keys equal to the spec's.
 */
export interface DeltaEntry {
  readonly sheet: string;
  /** Variable id of the cell (`lev.L05.nb`, `lev.start`, `org.dom_share`); the row key for table attributes and pins; `''` for a new row. */
  readonly key: string;
  /** Member key of the cell (`L05`, `commercial_applications,vp_infra`, `fy27`); `''` for scalars. */
  readonly member: string;
  /** Scenario id of a scenario column (`C`); `null` for the Default and other tenant-wide columns. */
  readonly scenario: string | null;
  /** Value in the export snapshot (E); `null` in foreign mode and for blank cells. */
  readonly export: DiffValue;
  /** Value in the workbook (W). */
  readonly workbook: DiffValue;
  /** Value in the app now (D). */
  readonly current: DiffValue;
  readonly status: DeltaEntryStatus;
  readonly messages: readonly string[];
}

/** Where an accepted cell is written (the changeset target). */
export type CellTarget =
  /** `variable_value` (`scenario` null) or `scenario_value`. */
  | {
      readonly kind: 'value';
      readonly var_key: string;
      readonly member_key: string;
      readonly scenario: string | null;
    }
  /** `variable_value.note` of the row's variable and own members. */
  | { readonly kind: 'note'; readonly var_key: string; readonly member_key: string }
  /** A member attribute (Line_Items: name, l2, pool, ...). */
  | { readonly kind: 'attr'; readonly member_key: string; readonly attr: string }
  /** A field of a pinned node (`node_override`) of the scenario the Overrides sheet lists. */
  | {
      readonly kind: 'override';
      readonly node_key: string;
      readonly member_key: string;
      readonly field: string;
      readonly scenario: string | null;
    };

/** One editable cell whose status is not `unchanged`. */
export interface CellDiff extends DeltaEntry {
  readonly status: CellStatus;
  /** Column id as in the snapshot and in row hashes (`default`, `scenario@C`, `lev.start@C`, `iyear.fy27`, `name`). */
  readonly column: string;
  /** 1-based row of the sheet in the workbook. */
  readonly rowNumber: number;
  readonly target: CellTarget;
}

export interface RowDiff {
  readonly sheet: string;
  /** Row key as written (`it_001`; Overrides: the node); `''` for a new row. */
  readonly key: string;
  /** Row member as written (Line_Items: the key again; Overrides: the member key). */
  readonly member: string;
  /** Overrides: the scenario whose pins the sheet lists; else `null`. */
  readonly scenario: string | null;
  readonly status: RowStatus;
  /** 1-based row of the sheet; `null` for a missing row. */
  readonly rowNumber: number | null;
  /** The row is in the export snapshot (always false in foreign mode). */
  readonly inExport: boolean;
  /** The row is in the app now. A `deleted_row` that is not is already deleted. */
  readonly inApp: boolean;
  /** Workbook values for new and deleted rows, the app's values for a missing row; by column id. */
  readonly cells: Readonly<Record<string, DiffValue>>;
  readonly messages: readonly string[];
}

export type UnmatchedReason = 'unknown_row' | 'unknown_cell' | 'duplicate_row';

/** A row or cell of the workbook that cannot be placed in the export or the app. Never applied. */
export interface UnmatchedDiff {
  readonly sheet: string;
  readonly key: string;
  readonly member: string;
  /** `null` for a whole row. */
  readonly column: string | null;
  readonly rowNumber: number;
  readonly reason: UnmatchedReason;
  readonly message: string;
}

/** The current database (D) in the snapshot's form: `buildWorkbook(defs, currentValues, meta).snapshot`. */
export type CurrentSnapshot = Pick<ExportSnapshot, 'scenarioIds' | 'cells' | 'rowHashes'>;

export interface DiffOptions {
  /** Skip rows whose parsed hash equals the snapshot's (and the app's) row hash. Default true. */
  readonly fastPath?: boolean;
}

export interface DiffResult {
  readonly mode: DiffMode;
  /** Editable cells whose status is not `unchanged`, in workbook order. */
  readonly cells: readonly CellDiff[];
  readonly rows: readonly RowDiff[];
  readonly unmatched: readonly UnmatchedDiff[];
  /** Cells per status (unchanged cells are counted, not listed) and rows per status. */
  readonly counts: Readonly<Record<CellStatus | RowStatus, number>>;
  readonly stats: {
    /** Keyed rows compared (fast path included). */
    readonly rows: number;
    /** Rows the `_hash` fast path settled without a cell compare. */
    readonly rowsSkipped: number;
    readonly cellsCompared: number;
  };
}

/** Thrown when the snapshot does not belong to the workbook. */
export class DiffError extends Error {
  override readonly name = 'DiffError';
}

// ----------------------------------------------------------------------------------------------
// Constants (format facts only: no business numbers)
// ----------------------------------------------------------------------------------------------

/**
 * Significant digits a workbook keeps: Excel stores 15, LibreOffice writes 15 on save. Two numbers that agree to
 * within one unit of the 15th significant digit are the same value (one unit, not half, so that a 17-digit text
 * rounded once more by the reader still matches).
 */
export const EXPORT_PRECISION_DIGITS = 15;
const DECIMAL_BASE = 10;
/** The action value that deletes a row (`sheets[].row_actions` of excel_template.json, verbatim). */
const DELETE_ACTION = 'DELETE';
/** Overrides rows are identified by these fields (as in parse.ts); they are the key, not values. */
const OVERRIDE_KEY = 'node_key';
const OVERRIDE_MEMBER = 'member_key';
const ROW_ID_SEPARATOR = '\u0001';

// ----------------------------------------------------------------------------------------------
// Values
// ----------------------------------------------------------------------------------------------

/** A parsed or snapshot value as the report carries it: TRUE/FALSE as 1/0, missing as `null`. */
export function toDiffValue(v: SnapshotValue | undefined): DiffValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

function sameNumber(a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  const unit = DECIMAL_BASE ** (Math.floor(Math.log10(scale)) - (EXPORT_PRECISION_DIGITS - 1));
  return Math.abs(a - b) <= unit;
}

const lines = (s: string): string => s.replace(/\r\n?/g, '\n');

/**
 * Are two cell values the same? Numbers at the workbook's precision (`EXPORT_PRECISION_DIGITS`), text with
 * line ends normalised, blank only equals blank, a number never equals a text.
 */
export function sameValue(a: DiffValue, b: DiffValue): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return sameNumber(a, b);
  if (typeof a === 'string' && typeof b === 'string') return lines(a) === lines(b);
  return false;
}

/** The three-way table of import_pipeline step 4 for one cell: export E, workbook W, current D. */
export function cellStatus(e: DiffValue, w: DiffValue, d: DiffValue): CellStatus {
  if (sameValue(w, e)) return sameValue(d, e) ? 'unchanged' : 'changed_in_app';
  if (sameValue(d, e)) return 'changed_in_excel';
  return sameValue(w, d) ? 'already_applied' : 'conflict';
}

/** Foreign mode: the workbook against the app only. */
const twoWayStatus = (w: DiffValue, d: DiffValue): CellStatus =>
  sameValue(w, d) ? 'unchanged' : 'changed_in_excel';

/** Pick the `delta_report_schema.changes[]` keys of a cell or row diff, nothing else. */
export function toDeltaEntry(diff: CellDiff | RowDiff): DeltaEntry {
  if ('column' in diff) {
    const { sheet, key, member, scenario, status, messages } = diff;
    return {
      sheet,
      key,
      member,
      scenario,
      export: diff.export,
      workbook: diff.workbook,
      current: diff.current,
      status,
      messages,
    };
  }
  return {
    sheet: diff.sheet,
    key: diff.key,
    member: diff.member,
    scenario: diff.scenario,
    export: null,
    workbook: null,
    current: null,
    status: diff.status,
    messages: diff.messages,
  };
}

// ----------------------------------------------------------------------------------------------
// Sheets, rows and cells
// ----------------------------------------------------------------------------------------------

/** A cell the app's snapshot does not hold at all (as opposed to a blank cell, `null`). */
const ABSENT = Symbol('absent');
type Looked = DiffValue | typeof ABSENT;

interface SheetCtx {
  readonly def: SheetDef;
  readonly parsed: ParsedSheet;
  readonly cols: ReadonlyMap<string, ColumnDef>;
  readonly rowDefs: ReadonlyMap<string, RowDef>;
  /** `rowKey(...)` of each defined row -> its key and member. */
  readonly rowKeys: ReadonlyMap<string, { readonly key: string; readonly member: string }>;
  readonly table: boolean;
  readonly overrides: boolean;
  /** Scenario of the Overrides pins: the first exported scenario. */
  readonly pinScenario: string | null;
  /** Header of the action column, for messages. */
  readonly actionHeader: string | undefined;
}

const rowId = (key: string, member: string): string => `${key}${ROW_ID_SEPARATOR}${member}`;
const has = (record: Readonly<Record<string, unknown>>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

/** Is the cell one the user edits and the row `_hash` covers (the rule of build.ts and parse.ts), action aside? */
function isValueCell(col: ColumnDef, row: RowDef | undefined): boolean {
  if (!col.editable || col.role === 'action') return false;
  if (col.role === 'note') return row?.varId !== undefined;
  if (!VALUE_ROLES.has(col.role)) return false;
  if (row === undefined) return true;
  if (row.cells !== undefined && !row.cells.includes(col.id)) return false;
  return !(col.perScenario && row.scenarioVaries === false);
}

/** The columns of a parsed row that the diff compares. */
function valueColumns(
  ctx: SheetCtx,
  rowDef: RowDef | undefined,
): { readonly pc: ParsedColumn; readonly col: ColumnDef }[] {
  const out: { pc: ParsedColumn; col: ColumnDef }[] = [];
  for (const pc of ctx.parsed.columns) {
    const col = ctx.cols.get(pc.defId);
    if (col === undefined || !isValueCell(col, rowDef)) continue;
    if (ctx.overrides && (col.id === OVERRIDE_KEY || col.id === OVERRIDE_MEMBER)) continue;
    out.push({ pc, col });
  }
  return out;
}

interface Placed {
  readonly key: string;
  readonly member: string;
  readonly target: CellTarget;
}

/** Name the stored value of a cell: variable and member key (row binding plus column binding), note, attribute or pin. */
function placeCell(
  ctx: SheetCtx,
  row: ParsedRow,
  rowDef: RowDef | undefined,
  col: ColumnDef,
  scenario: string | null,
): Placed | undefined {
  if (ctx.overrides) {
    return {
      key: row.key,
      member: row.member,
      target: {
        kind: 'override',
        node_key: row.key,
        member_key: row.member,
        field: col.id,
        scenario,
      },
    };
  }
  if (col.role === 'note') {
    const varKey = rowDef?.varId;
    if (varKey === undefined) return undefined;
    return {
      key: varKey,
      member: row.member,
      target: { kind: 'note', var_key: varKey, member_key: row.member },
    };
  }
  const varKey = col.varId ?? rowDef?.varId;
  if (varKey === undefined) {
    if (!ctx.table) return undefined;
    return {
      key: row.key,
      member: row.member,
      target: { kind: 'attr', member_key: row.member, attr: col.attr ?? col.id },
    };
  }
  const dims = col.varId === undefined ? rowDef?.dims : col.dims;
  if (dims === undefined) return undefined;
  // A table row the current definitions no longer list (a line deleted in the app): its one dim is the row member.
  const [only] = dims;
  const bind =
    rowDef?.bind ??
    (ctx.table && dims.length === 1 && only !== undefined ? { [only]: row.member } : undefined);
  if (bind === undefined) return undefined;
  let mk: string;
  try {
    mk = memberKey({ id: varKey, dims }, { ...bind, ...col.bind });
  } catch {
    return undefined;
  }
  return {
    key: varKey,
    member: mk,
    target: { kind: 'value', var_key: varKey, member_key: mk, scenario },
  };
}

/** A value of E or D: `ABSENT` when the snapshot has the row but not the cell; `null` when it lacks the whole row. */
function look(
  cells: Readonly<Record<string, SnapshotValue>>,
  key: string,
  rowPresent: boolean,
): Looked {
  if (has(cells, key)) return toDiffValue(cells[key]);
  return rowPresent ? ABSENT : null;
}

function rowCells(ctx: SheetCtx, row: ParsedRow): Readonly<Record<string, DiffValue>> {
  const out: Record<string, DiffValue> = {};
  for (const pc of ctx.parsed.columns) {
    if (pc.role === 'action' || !has(row.cells, pc.id)) continue;
    out[pc.id] = toDiffValue(row.cells[pc.id]);
  }
  return out;
}

// ----------------------------------------------------------------------------------------------
// The diff
// ----------------------------------------------------------------------------------------------

const MSG = {
  notInApp: 'Row is no longer in the app.',
  notInExport: 'Row was not in the export.',
  cellNotInExport: 'Cell was not in the export.',
  hashMoved:
    'The hidden _hash of this row belongs to other values: check that the row was not moved without its key.',
  deletedInApp: 'Already deleted in the app.',
  changedInApp: 'Changed in the app since the export.',
  unknownRow: 'Key is in neither the export nor the app: row ignored.',
  unknownRowTable: 'Key is in neither the export nor the app: leave the key blank to add a row.',
  unknownCell: 'Cell is not in the app (unknown scenario or column): ignored.',
  duplicate: 'Key appears more than once: only its first row is read.',
  missingKept: 'Row is not in the workbook: the app keeps its values.',
} as const;

const missingDelete = (header: string): string =>
  `Row is not in the workbook: nothing is deleted. To delete it, write ${DELETE_ACTION} in the ${header} column.`;

class Collector {
  readonly cells: CellDiff[] = [];
  readonly rows: RowDiff[] = [];
  readonly unmatched: UnmatchedDiff[] = [];
  readonly counts: Record<CellStatus | RowStatus, number> = {
    unchanged: 0,
    changed_in_excel: 0,
    changed_in_app: 0,
    conflict: 0,
    already_applied: 0,
    new_row: 0,
    deleted_row: 0,
    missing_row: 0,
  };
  rowsCompared = 0;
  rowsSkipped = 0;
  cellsCompared = 0;

  cell(c: CellDiff): void {
    this.counts[c.status] += 1;
    if (c.status !== 'unchanged') this.cells.push(c);
  }

  row(r: RowDiff): void {
    this.counts[r.status] += 1;
    this.rows.push(r);
  }

  miss(
    ctx: SheetCtx,
    row: ParsedRow,
    column: string | null,
    reason: UnmatchedReason,
    message: string,
  ): void {
    this.unmatched.push({
      sheet: ctx.def.name,
      key: row.key,
      member: row.member,
      column,
      rowNumber: row.rowNumber,
      reason,
      message,
    });
  }
}

interface Sources {
  readonly mode: DiffMode;
  readonly e: ExportSnapshot | null;
  readonly d: CurrentSnapshot;
  readonly fastPath: boolean;
}

/** Compare the editable cells of one keyed row. */
function diffRowCells(
  ctx: SheetCtx,
  row: ParsedRow,
  rowDef: RowDef | undefined,
  rk: string,
  src: Sources,
  out: Collector,
): void {
  const { e, d, mode } = src;
  const inE = e !== null && has(e.rowHashes, rk);
  const inD = has(d.rowHashes, rk);
  const columns = valueColumns(ctx, rowDef);
  out.rowsCompared += 1;

  // Fast path: the row as read hashes to the exported hash (and the app's), so every editable cell is unchanged.
  const hashes = e === null ? [d.rowHashes[rk]] : [e.rowHashes[rk], d.rowHashes[rk]];
  if (src.fastPath && row.hash !== null && hashes.every((h) => h === row.hash)) {
    out.rowsSkipped += 1;
    out.counts.unchanged += columns.length;
    return;
  }

  const rowMessages: string[] = [];
  if (!inD) rowMessages.push(MSG.notInApp);
  if (mode === 'three_way' && !inE) rowMessages.push(MSG.notInExport);
  if (e !== null && inE && row.exportedHash !== null && row.exportedHash !== e.rowHashes[rk])
    rowMessages.push(MSG.hashMoved);

  for (const { pc, col } of columns) {
    let scenario: string | null = null;
    if (col.perScenario) {
      if (pc.scenarioId === undefined) {
        out.miss(ctx, row, pc.id, 'unknown_cell', MSG.unknownCell);
        continue;
      }
      scenario = pc.scenarioId;
    } else if (ctx.overrides) scenario = ctx.pinScenario;
    const placed = placeCell(ctx, row, rowDef, col, scenario);
    const k = snapshotKey(ctx.def.name, row.key, row.member, pc.id);
    const current = look(d.cells, k, inD);
    if (placed === undefined || current === ABSENT) {
      out.miss(ctx, row, pc.id, 'unknown_cell', MSG.unknownCell);
      continue;
    }
    const workbook = toDiffValue(row.cells[pc.id]);
    out.cellsCompared += 1;
    // Three-way: a row or cell the export did not have counts as blank there, so a blank workbook cell keeps the
    // app's value and a typed one that differs from the app is a conflict, never a silent overwrite.
    const exported = e === null ? null : toDiffValue(e.cells[k]);
    const status =
      e === null ? twoWayStatus(workbook, current) : cellStatus(exported, workbook, current);
    const messages =
      e !== null && inE && !has(e.cells, k) ? [...rowMessages, MSG.cellNotInExport] : rowMessages;
    out.cell({
      sheet: ctx.def.name,
      key: placed.key,
      member: placed.member,
      scenario,
      export: exported,
      workbook,
      current,
      status,
      messages,
      column: pc.id,
      rowNumber: row.rowNumber,
      target: placed.target,
    });
  }
}

function diffSheet(ctx: SheetCtx, src: Sources, out: Collector, keyMissing: boolean): void {
  const { e, d, mode } = src;
  const sheet = ctx.def.name;
  const seen = new Set<string>();
  const isDelete = (row: ParsedRow): boolean => row.action === DELETE_ACTION;

  for (const row of ctx.parsed.rows) {
    if (row.isNew) {
      // A blank-key row marked DELETE adds nothing and deletes nothing.
      if (!isDelete(row))
        out.row({
          sheet,
          key: '',
          member: '',
          scenario: null,
          status: 'new_row',
          rowNumber: row.rowNumber,
          inExport: false,
          inApp: false,
          cells: rowCells(ctx, row),
          messages: [],
        });
      continue;
    }
    const rk = rowKey(sheet, row.key, row.member);
    if (seen.has(rk)) {
      out.miss(ctx, row, null, 'duplicate_row', MSG.duplicate);
      continue;
    }
    seen.add(rk);
    const inE = e !== null && has(e.rowHashes, rk);
    const inD = has(d.rowHashes, rk);
    const scenario = ctx.overrides ? ctx.pinScenario : null;

    if (!inE && !inD) {
      // Overrides rows are identified by their content: a pin the sheet adds is a new row.
      if (ctx.overrides && !isDelete(row))
        out.row({
          sheet,
          key: row.key,
          member: row.member,
          scenario,
          status: 'new_row',
          rowNumber: row.rowNumber,
          inExport: false,
          inApp: false,
          cells: rowCells(ctx, row),
          messages: [],
        });
      else
        out.miss(
          ctx,
          row,
          null,
          'unknown_row',
          ctx.table && !ctx.overrides ? MSG.unknownRowTable : MSG.unknownRow,
        );
      continue;
    }

    if (isDelete(row)) {
      const messages: string[] = [];
      if (!inD) messages.push(MSG.deletedInApp);
      else if (e !== null && inE && e.rowHashes[rk] !== d.rowHashes[rk])
        messages.push(MSG.changedInApp);
      if (mode === 'three_way' && !inE) messages.push(MSG.notInExport);
      out.row({
        sheet,
        key: row.key,
        member: row.member,
        scenario,
        status: 'deleted_row',
        rowNumber: row.rowNumber,
        inExport: inE,
        inApp: inD,
        cells: rowCells(ctx, row),
        messages,
      });
      continue;
    }

    const rowDef = ctx.rowDefs.get(rowId(row.key, row.member));
    // Input sheets are the registry's rows: a key it does not know cannot be placed (validate.ts reports it).
    if (!ctx.table && rowDef === undefined) {
      out.miss(ctx, row, null, 'unknown_row', MSG.unknownRow);
      continue;
    }
    diffRowCells(ctx, row, rowDef, rk, src, out);
  }

  // Missing rows: in the export (three-way, and still in the app) or in the app (foreign), not in the sheet.
  if (keyMissing) return;
  const reference = e ?? d;
  const prefix = `${sheet}/`;
  for (const rk of Object.keys(reference.rowHashes)) {
    if (!rk.startsWith(prefix) || seen.has(rk) || !has(d.rowHashes, rk)) continue;
    const { key, member } = splitRowKey(ctx, rk);
    const cells: Record<string, DiffValue> = {};
    for (const pc of ctx.parsed.columns) {
      const k = snapshotKey(sheet, key, member, pc.id);
      if (pc.role !== 'action' && has(d.cells, k)) cells[pc.id] = toDiffValue(d.cells[k]);
    }
    out.row({
      sheet,
      key,
      member,
      scenario: ctx.overrides ? ctx.pinScenario : null,
      status: 'missing_row',
      rowNumber: null,
      inExport: mode === 'three_way',
      inApp: true,
      cells,
      messages: [
        ctx.actionHeader === undefined ? MSG.missingKept : missingDelete(ctx.actionHeader),
      ],
    });
  }
}

/** Key and member of a `rowKey(...)`: from the definitions when they list the row, else split at the first `/`. */
function splitRowKey(ctx: SheetCtx, rk: string): { key: string; member: string } {
  const known = ctx.rowKeys.get(rk);
  if (known !== undefined) return known;
  const rest = rk.slice(ctx.def.name.length + 1);
  const at = rest.indexOf('/');
  return at < 0
    ? { key: rest, member: '' }
    : { key: rest.slice(0, at), member: rest.slice(at + 1) };
}

/**
 * Diff a parsed workbook against its export snapshot and the current database.
 *
 * - `E`: the export snapshot (`buildWorkbook(...).snapshot`, stored with the export job), or `null` for a foreign
 *   workbook: then W is compared with D only (two-way, by key columns).
 * - `W`: `parseWorkbook(...)` of the upload. Parse it with the scenarios of the export (or, foreign, of the tenant)
 *   so that scenario columns carry their scenario id.
 * - `D`: the current values in the snapshot's form, for the same scenarios: `buildWorkbook(defs, current, meta).snapshot`.
 * - `defs`: `buildTemplate(...)` of the tenant now (the definitions W was parsed with); they name each cell's
 *   variable and member key and say which cells are editable.
 *
 * Returns the cells that differ (`CellDiff`), row statuses (`RowDiff`), what could not be placed (`unmatched`),
 * counts and fast-path stats. Throws `DiffError` when W names another export than E.
 */
export function diff(
  E: ExportSnapshot | null,
  W: ParsedWorkbook,
  D: CurrentSnapshot,
  defs: readonly SheetDef[],
  options: DiffOptions = {},
): DiffResult {
  if (E !== null && W.mode === 'export' && W.meta !== null && W.meta.exportJobId !== E.exportJobId)
    throw new DiffError(
      `diff: the workbook is export '${W.meta.exportJobId}', the snapshot is export '${E.exportJobId}'`,
    );
  const src: Sources = {
    mode: E === null ? 'foreign' : 'three_way',
    e: E,
    d: D,
    fastPath: options.fastPath ?? true,
  };
  const out = new Collector();
  const byName = new Map(defs.map((d) => [d.name, d]));
  const pinScenario = (E ?? D).scenarioIds[0] ?? null;

  for (const parsed of W.sheets) {
    const def = byName.get(parsed.name);
    if (def === undefined) continue;
    const actionCol = def.columns.find((c) => c.role === 'action');
    const ctx: SheetCtx = {
      def,
      parsed,
      cols: new Map(def.columns.map((c) => [c.id, c])),
      rowDefs: new Map(def.rows.map((r) => [rowId(r.key, r.member), r])),
      rowKeys: new Map(
        def.rows.map((r) => [rowKey(def.name, r.key, r.member), { key: r.key, member: r.member }]),
      ),
      table: def.kind === 'table',
      overrides: def.kind === 'table' && def.columns.some((c) => c.id === OVERRIDE_KEY),
      pinScenario,
      actionHeader: actionCol?.header,
    };
    const keyMissing = W.issues.some(
      (i) => i.code === 'missing_key_column' && i.sheet === parsed.name,
    );
    diffSheet(ctx, src, out, keyMissing);
  }

  return {
    mode: src.mode,
    cells: out.cells,
    rows: out.rows,
    unmatched: out.unmatched,
    counts: out.counts,
    stats: {
      rows: out.rowsCompared,
      rowsSkipped: out.rowsSkipped,
      cellsCompared: out.cellsCompared,
    },
  };
}
