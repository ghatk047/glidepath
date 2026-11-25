import ExcelJS from 'exceljs';
import { memberKey, type InputValueRow, type NodeOverrideRow } from '@glidepath/domain';
import { sha256Hex } from '@glidepath/spec';
import type { ColumnDef, ColumnRole, ListDef, RowDef, SheetDef } from './types';

/**
 * build.ts: sheet definitions (`buildTemplate`) + resolved values of the chosen scenarios + `_meta` ->
 * an ExcelJS workbook and the export snapshot (docs/architecture/05_excel_roundtrip.md sections 1 and 3).
 * Pure: no IO. `buildWorkbook` returns the workbook object; `writeWorkbook` turns it into bytes in memory and
 * the caller (worker) stores the file and the snapshot.
 *
 * Formatting (docs/spec/excel_template.json -> cell_rules): editable cells light yellow; locked cells
 * protected, no password; data validation from the variables' min/max; dropdowns from `_lists`; percent
 * stored as decimals with the template's formats; frozen header row; `key`, `member` and `_hash` columns
 * hidden; `_lists` hidden; `_meta` hidden and protected. Text of the README comes from the template.
 */

// ----------------------------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------------------------

/** A value in the snapshot and in a row hash: what the importer reads back from the cell, normalised. */
export type SnapshotValue = string | number | boolean | null;

/** One node of a scenario at export time, for the Outputs sheet. */
export interface OutputValue {
  readonly node_key: string;
  readonly member_key: string;
  readonly value: number;
}

/** One note of the Note column (`variable_value.note`). */
export interface NoteRow {
  readonly var_key: string;
  readonly member_key: string;
  readonly note: string;
}

/** One exported scenario. */
export interface ExportScenario {
  /** Scenario id (the key users know it by, e.g. `C`). Used verbatim in column ids and the file name. */
  readonly id: string;
  /** Header text of the scenario's columns. */
  readonly label: string;
  /** The scenario's own `scenario_value` rows. A cell without a row is exported blank (= inherit the default). */
  readonly values: readonly InputValueRow[];
  /** The scenario's pinned nodes (`node_override`). The Overrides sheet lists those of the first scenario. */
  readonly overrides?: readonly NodeOverrideRow[];
  /** Key results at export time (Outputs sheet). */
  readonly outputs?: readonly OutputValue[];
}

/** Resolved values to export: tenant defaults (`variable_value`) and the chosen scenarios, in column order. */
export interface ExportValues {
  readonly defaults: readonly InputValueRow[];
  readonly scenarios: readonly ExportScenario[];
  readonly notes?: readonly NoteRow[];
}

/** The `_meta` fields of `excel_template.json` plus the template facts that `SheetDef[]` does not carry. */
export interface ExportMeta {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly modelVersion: string;
  /** `template_version` of excel_template.json. */
  readonly templateVersion: string;
  readonly exportJobId: string;
  /** Pure code cannot read the clock: the caller passes the export time (UTC is used for the file name). */
  readonly exportedAt: Date;
  readonly exportedBy: string;
  /** `file.name_pattern` of excel_template.json. Default: `DEFAULT_FILE_NAME_PATTERN`. */
  readonly fileNamePattern?: string;
  /** Blank, unlocked rows added to the end of table sheets for new rows. Default: `NEW_ROW_SLOTS`. */
  readonly newRowSlots?: number;
}

/**
 * The export snapshot: what a three-way diff needs of the export (E). Values are normalised the way
 * `parse.ts` normalises a cell (percent as decimal, dropdown label as code, blank as null).
 */
export interface ExportSnapshot {
  readonly exportJobId: string;
  readonly templateVersion: string;
  readonly scenarioIds: readonly string[];
  /** `snapshotKey(sheet, key, member, column)` -> value. Every data cell of the input sheets. */
  readonly cells: Readonly<Record<string, SnapshotValue>>;
  /** `rowKey(sheet, key, member)` -> `hashRow(...)` of the row's editable cells (the hidden `_hash`). */
  readonly rowHashes: Readonly<Record<string, string>>;
  /** sha256 over the row hashes: the `workbook_checksum` of `_meta`. */
  readonly checksum: string;
}

export interface BuiltWorkbook {
  readonly workbook: ExcelJS.Workbook;
  readonly snapshot: ExportSnapshot;
  /** `file.name_pattern` filled in. */
  readonly fileName: string;
}

/** Thrown when the definitions, values and meta do not fit together. */
export class BuildError extends Error {
  override readonly name = 'BuildError';
}

// ----------------------------------------------------------------------------------------------
// Constants (layout only: no business numbers)
// ----------------------------------------------------------------------------------------------

/** `file.name_pattern` of excel_template.json (a test keeps the two equal). */
export const DEFAULT_FILE_NAME_PATTERN =
  '{tenant_slug}_it_savings_{scenario_keys}_{yyyymmdd-hhmm}.xlsx';
/** `cell_rules.editable_fill` "light yellow". Neutral palette: no tenant colours. */
export const EDITABLE_FILL = 'FFFFF2CC';
export const HEADER_FILL = 'FFE7E9EC';
/** Marks a row check that does not hold. */
export const CHECK_FAIL_FILL = 'FFF4CCCC';
/** Spare rows for new lines and pins on table sheets. */
export const NEW_ROW_SLOTS = 25;
const HEADER_ROW = 1;
const SCENARIO_SEPARATOR = '@';
const SCENARIO_KEYS_SEPARATOR = '+';
const TEXT_SHEETS = new Set(['readme', 'meta', 'lists']);

/** Roles of columns whose cells carry a variable's value. */
export const VALUE_ROLES: ReadonlySet<ColumnRole> = new Set<ColumnRole>([
  'default',
  'scenario',
  'value',
  'year',
  'matrix_col',
  'block',
  'field',
]);
const DEFAULT_WIDTH: Readonly<Partial<Record<ColumnRole, number>>> = {
  group: 24,
  label: 52,
  unit: 9,
  min: 11,
  max: 11,
  default: 14,
  scenario: 16,
  value: 14,
  year: 12,
  matrix_col: 18,
  block: 14,
  check: 12,
  source: 28,
  confidence: 11,
  note: 36,
  field: 22,
  action: 12,
  text: 110,
};

// ----------------------------------------------------------------------------------------------
// Keys, hashes, file name
// ----------------------------------------------------------------------------------------------

const KEY_SEPARATOR = '/';

/** Column id of a per-scenario column for one scenario, e.g. `scenario@C`, `lev.start@C`. */
export const scenarioColumnId = (columnId: string, scenarioId: string): string =>
  `${columnId}${SCENARIO_SEPARATOR}${scenarioId}`;

/** Key of one cell in `ExportSnapshot.cells`: sheet / key / member / column. */
export const snapshotKey = (sheet: string, key: string, member: string, column: string): string =>
  [sheet, key, member, column].join(KEY_SEPARATOR);

/** Key of one row in `ExportSnapshot.rowHashes`: sheet / key / member. */
export const rowKey = (sheet: string, key: string, member: string): string =>
  [sheet, key, member].join(KEY_SEPARATOR);

/**
 * The `_hash` of a row: sha256 (hex) of its editable cells as `[columnId, value]` pairs in column order.
 * `parse.ts` computes the same hash from the cells it reads, so an unchanged row is found without a cell diff.
 */
export function hashRow(cells: readonly (readonly [string, SnapshotValue])[]): string {
  return sha256Hex(JSON.stringify(cells));
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `{yyyymmdd-hhmm}` of a time, in UTC. */
function stamp(at: Date): string {
  const date = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}`;
  return `${date}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`;
}

const safe = (text: string): string => text.replace(/[^A-Za-z0-9_+-]+/g, '_');

/** The file name of an export: the template's pattern with tenant slug, scenario ids and time filled in. */
export function exportFileName(
  pattern: string,
  tenantSlug: string,
  scenarioIds: readonly string[],
  exportedAt: Date,
): string {
  return pattern
    .replace('{tenant_slug}', safe(tenantSlug))
    .replace('{scenario_keys}', scenarioIds.map(safe).join(SCENARIO_KEYS_SEPARATOR))
    .replace('{yyyymmdd-hhmm}', stamp(exportedAt));
}

// ----------------------------------------------------------------------------------------------
// Columns and cells
// ----------------------------------------------------------------------------------------------

/** A column of the sheet as written: per-scenario columns once per scenario. */
interface LaidColumn {
  readonly col: ColumnDef;
  /** Column id in the snapshot and in row hashes. */
  readonly id: string;
  readonly header: string;
  readonly scenario?: ExportScenario;
  /** 1-based position in the sheet. */
  readonly index: number;
}

/** Header text of a column for one scenario (the scenario label; blocks add the block name). */
export function columnHeader(col: ColumnDef, scenario?: ExportScenario): string {
  if (scenario === undefined) return col.header;
  return col.role === 'scenario' ? scenario.label : `${col.header} · ${scenario.label}`;
}

function layoutColumns(def: SheetDef, scenarios: readonly ExportScenario[]): LaidColumn[] {
  const out: LaidColumn[] = [];
  for (const col of def.columns) {
    if (col.perScenario) {
      for (const scenario of scenarios) {
        out.push({
          col,
          id: scenarioColumnId(col.id, scenario.id),
          header: columnHeader(col, scenario),
          scenario,
          index: out.length + 1,
        });
      }
    } else out.push({ col, id: col.id, header: col.header, index: out.length + 1 });
  }
  return out;
}

const cellId = (varId: string, member: string): string => `${varId}\u0001${member}`;

function valueMap(rows: readonly InputValueRow[]): Map<string, number> {
  return new Map(rows.map((r) => [cellId(r.var_key, r.member_key), r.value]));
}

interface Lookups {
  readonly defaults: Map<string, number>;
  readonly scenarioValues: Map<string, Map<string, number>>;
  readonly outputs: Map<string, Map<string, number>>;
  readonly notes: Map<string, string>;
  readonly lists: Map<string, ListDef>;
}

/** What one cell holds and how it is formatted. */
interface CellSpec {
  /** What is written into the sheet. */
  readonly shown: ExcelJS.CellValue;
  /** What the importer reads back (code for a dropdown label). `undefined`: not in the snapshot. */
  readonly norm?: SnapshotValue;
  readonly editable: boolean;
  readonly numFmt?: string;
  readonly list?: string;
  readonly choices?: readonly string[];
  readonly number?: {
    readonly type: 'int' | 'number';
    readonly min: number | null;
    readonly max: number | null;
  };
}

const LOCKED_BLANK: CellSpec = { shown: null, editable: false };

/** Excel needs literal letters in a number format quoted: `0.00x` -> `0.00"x"`. */
export function excelNumberFormat(format: string): string {
  return format.includes('"') ? format : format.replace(/([A-Za-z]+)$/, '"$1"');
}

const asText = (v: unknown): string | null =>
  v === undefined || v === null || v === '' ? null : String(v);

const isEnumList = (id: string): boolean => id.startsWith('enum.');

function cellSpec(sheet: SheetDef, row: RowDef, lc: LaidColumn, look: Lookups): CellSpec {
  const { col } = lc;
  const role = col.role;
  switch (role) {
    case 'key':
      return { shown: row.key, editable: false };
    case 'member':
      return { shown: row.member, editable: false };
    case 'group':
    case 'label':
    case 'unit':
    case 'source':
    case 'confidence': {
      const text = asText(row[role]);
      return { shown: text, norm: text, editable: false };
    }
    case 'min':
    case 'max': {
      const n = row[role] ?? null;
      const fmt = row.numberFormat;
      return { shown: n, norm: n, editable: false, ...(fmt === undefined ? {} : { numFmt: fmt }) };
    }
    case 'note': {
      if (row.varId === undefined) return LOCKED_BLANK;
      // A note belongs to the row: its own member ids (a year row has one note for all its years).
      const note = look.notes.get(cellId(row.varId, row.member));
      return { shown: note ?? null, norm: note ?? null, editable: col.editable };
    }
    case 'action':
      return {
        shown: null,
        norm: null,
        editable: col.editable,
        choices: (col.choices ?? []).filter((c) => c !== ''),
      };
    default:
      break;
  }
  if (!VALUE_ROLES.has(role)) return LOCKED_BLANK;
  if (row.cells !== undefined && !row.cells.includes(col.id)) return LOCKED_BLANK;
  if (sheet.kind === 'snapshot') return outputCell(row, lc, look);

  // A cell without a variable: attribute columns of table sheets (Line_Items, Overrides).
  const varId = col.varId ?? row.varId;
  if (varId === undefined) {
    const raw = row.attrs?.[col.attr ?? col.id];
    // An empty text is a blank cell: it reads back as `null`.
    const value =
      raw === undefined || raw === null || raw === '' ? null : (raw as string | number | boolean);
    const shown =
      typeof value === 'string' || typeof value === 'number'
        ? value
        : value === null
          ? null
          : Number(value);
    return {
      shown,
      norm: shown,
      editable: col.editable,
      ...(col.listRef === undefined ? {} : { list: col.listRef }),
    };
  }

  // A cell with a variable: facts of the column when it names the variable, else of the row.
  const dims = col.varId === undefined ? row.dims : col.dims;
  if (dims === undefined)
    throw new BuildError(`${sheet.name}: '${row.id}' has no dims for ${varId}`);
  const facts = col.varId === undefined ? row : col;
  const mk = memberKey({ dims }, { ...row.bind, ...col.bind });
  const source =
    lc.scenario === undefined
      ? look.defaults
      : (look.scenarioValues.get(lc.scenario.id) ?? new Map());
  const value = source.get(cellId(varId, mk)) ?? null;
  const varies = !(lc.scenario !== undefined && row.scenarioVaries === false);
  const editable = col.editable && varies;
  const list = facts.listRef;
  let shown: ExcelJS.CellValue = value;
  if (list !== undefined && isEnumList(list) && value !== null) {
    shown = look.lists.get(list)?.entries.find((e) => e.code === value)?.label ?? value;
  }
  const numFmt = facts.numberFormat;
  const type = facts.type;
  return {
    shown,
    norm: value,
    editable,
    ...(numFmt === undefined ? {} : { numFmt }),
    ...(list === undefined ? {} : { list }),
    ...(list === undefined && (type === 'int' || type === 'number')
      ? { number: { type, min: facts.min ?? null, max: facts.max ?? null } }
      : {}),
  };
}

/** A spare row's cell: editable where the column is, with the column's list, choices and range. */
function blankSpec(col: ColumnDef): CellSpec {
  const editable = col.editable && col.role !== 'key' && col.role !== 'hash';
  const numeric = col.type === 'int' || col.type === 'number';
  return {
    shown: null,
    editable,
    ...(col.numberFormat === undefined ? {} : { numFmt: col.numberFormat }),
    ...(col.listRef === undefined ? {} : { list: col.listRef }),
    ...(col.choices === undefined ? {} : { choices: col.choices.filter((c) => c !== '') }),
    ...(col.listRef === undefined && numeric
      ? {
          number: {
            type: col.type as 'int' | 'number',
            min: col.min ?? null,
            max: col.max ?? null,
          },
        }
      : {}),
  };
}

function outputCell(row: RowDef, lc: LaidColumn, look: Lookups): CellSpec {
  const byNode = lc.scenario === undefined ? undefined : look.outputs.get(lc.scenario.id);
  const value = byNode?.get(cellId(row.key, row.member)) ?? null;
  return { shown: value, editable: false };
}

// ----------------------------------------------------------------------------------------------
// Writing
// ----------------------------------------------------------------------------------------------

const solid = (argb: string): ExcelJS.Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb },
});

function colLetter(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26))
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** Where each validation list sits on `_lists`: the range of the column a dropdown reads. */
function listRanges(lists: SheetDef | undefined): Map<string, string> {
  const out = new Map<string, string>();
  lists?.lists?.forEach((l, i) => {
    if (l.entries.length === 0) return;
    const letter = colLetter(i * 2 + (isEnumList(l.id) ? 2 : 1));
    out.set(l.id, `${lists.name}!$${letter}$2:$${letter}$${l.entries.length + 1}`);
  });
  return out;
}

function validation(
  spec: CellSpec,
  ranges: ReadonlyMap<string, string>,
): ExcelJS.DataValidation | undefined {
  if (!spec.editable) return undefined;
  if (spec.list !== undefined) {
    const range = ranges.get(spec.list);
    if (range === undefined) return undefined;
    return {
      type: 'list',
      allowBlank: true,
      formulae: [range],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Not in the list',
      error: 'Pick a value from the list.',
    };
  }
  if (spec.choices !== undefined && spec.choices.length > 0) {
    return {
      type: 'list',
      allowBlank: true,
      formulae: [`"${spec.choices.join(',')}"`],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Not in the list',
      error: 'Pick a value from the list.',
    };
  }
  const n = spec.number;
  if (n === undefined || (n.min === null && n.max === null)) return undefined;
  const type: 'whole' | 'decimal' = n.type === 'int' ? 'whole' : 'decimal';
  const shared = {
    type,
    allowBlank: true,
    showErrorMessage: true,
    errorStyle: 'stop' as const,
    errorTitle: 'Out of range',
  };
  if (n.min !== null && n.max !== null) {
    return {
      ...shared,
      operator: 'between',
      formulae: [n.min, n.max],
      error: `Enter a value from ${n.min} to ${n.max}.`,
    };
  }
  if (n.min !== null) {
    return {
      ...shared,
      operator: 'greaterThanOrEqual',
      formulae: [n.min],
      error: `Enter a value of at least ${n.min}.`,
    };
  }
  return {
    ...shared,
    operator: 'lessThanOrEqual',
    formulae: [n.max as number],
    error: `Enter a value of at most ${n.max as number}.`,
  };
}

function styleCell(cell: ExcelJS.Cell, spec: CellSpec, ranges: ReadonlyMap<string, string>): void {
  cell.protection = { locked: !spec.editable };
  if (spec.editable) cell.fill = solid(EDITABLE_FILL);
  if (spec.numFmt !== undefined) cell.numFmt = excelNumberFormat(spec.numFmt);
  const rule = validation(spec, ranges);
  if (rule !== undefined) cell.dataValidation = rule;
}

function styleHeader(cell: ExcelJS.Cell): void {
  cell.font = { bold: true };
  cell.fill = solid(HEADER_FILL);
  cell.alignment = { vertical: 'middle', wrapText: true };
  cell.border = { bottom: { style: 'thin' } };
  cell.protection = { locked: true };
}

/** Column widths, hidden columns, frozen header row and the filter over the header. */
function layoutSheet(
  ws: ExcelJS.Worksheet,
  def: SheetDef,
  laid: readonly LaidColumn[],
  lastRow: number,
): void {
  for (const lc of laid) {
    const column = ws.getColumn(lc.index);
    const width =
      lc.col.width !== undefined && lc.col.width > 0 ? lc.col.width : DEFAULT_WIDTH[lc.col.role];
    if (width !== undefined) column.width = width;
    if (lc.col.hidden) column.hidden = true;
  }
  const firstVisible = laid.find((lc) => !lc.col.hidden)?.index ?? 1;
  const label = laid.find((lc) => lc.col.role === 'label')?.index;
  ws.views = [
    { state: 'frozen', xSplit: label ?? firstVisible, ySplit: HEADER_ROW, showGridLines: true },
  ];
  if (!TEXT_SHEETS.has(def.kind) && laid.length > 0) {
    ws.autoFilter = {
      from: { row: HEADER_ROW, column: 1 },
      to: { row: Math.max(lastRow, HEADER_ROW), column: laid.length },
    };
  }
}

/** Every sheet is protected: the locked cells only mean something then. No password. */
function protect(ws: ExcelJS.Worksheet, def: SheetDef): void {
  const rows = def.kind === 'table';
  // The returned promise settles at once when there is no password to hash.
  void ws.protect('', {
    formatColumns: true,
    formatRows: true,
    sort: true,
    autoFilter: true,
    insertRows: rows,
  });
}

interface Collected {
  readonly cells: Map<string, SnapshotValue>;
  readonly rowHashes: Map<string, string>;
}

/** Rows of the Overrides sheet: the pinned nodes of the first scenario. */
function overrideRows(scenario: ExportScenario | undefined): RowDef[] {
  return (scenario?.overrides ?? []).map((o) => ({
    id: `${o.node_key}|${o.member_key}`,
    key: o.node_key,
    member: o.member_key,
    bind: {},
    group: '',
    label: o.node_key,
    unit: '',
    attrs: { node_key: o.node_key, member_key: o.member_key, value: o.value, reason: o.reason },
  }));
}

const isOverrides = (def: SheetDef): boolean =>
  def.kind === 'table' && def.rows.length === 0 && def.columns.some((c) => c.id === 'node_key');

function writeDataSheet(
  ws: ExcelJS.Worksheet,
  def: SheetDef,
  scenarios: readonly ExportScenario[],
  look: Lookups,
  ranges: ReadonlyMap<string, string>,
  slots: number,
  out: Collected,
): void {
  const laid = layoutColumns(def, scenarios);
  const rows = isOverrides(def) ? overrideRows(scenarios[0]) : def.rows;
  const hashCol = laid.find((lc) => lc.col.role === 'hash');
  const snapshot = def.kind !== 'snapshot';
  const checkText = def.rowCheck?.rule;
  const target = checkText === undefined ? undefined : /(\d+(?:\.\d+)?)\s*%/.exec(checkText)?.[1];

  laid.forEach((lc) => {
    const cell = ws.getCell(HEADER_ROW, lc.index);
    cell.value = lc.header;
    styleHeader(cell);
  });

  let r = HEADER_ROW;
  for (const row of rows) {
    r += 1;
    const hashed: [string, SnapshotValue][] = [];
    const specs = laid.map((lc) => cellSpec(def, row, lc, look));
    laid.forEach((lc, i) => {
      const spec = specs[i] as CellSpec;
      const cell = ws.getCell(r, lc.index);
      if (lc.col.role !== 'hash' && lc.col.role !== 'check') {
        cell.value = spec.shown;
        styleCell(cell, spec, ranges);
      }
      if (spec.norm !== undefined && snapshot) {
        const id = snapshotKey(def.name, row.key, row.member, lc.id);
        if (out.cells.has(id)) throw new BuildError(`${def.name}: duplicate cell ${id}`);
        out.cells.set(id, spec.norm);
        if (spec.editable) hashed.push([lc.id, spec.norm]);
      }
    });
    if (row.checked === true) writeRowCheck(ws, laid, row, r, target, specs);
    if (hashCol !== undefined) {
      const hash = hashed.length === 0 ? '' : hashRow(hashed);
      const cell = ws.getCell(r, hashCol.index);
      cell.value = hash;
      cell.protection = { locked: true };
      if (hash !== '') out.rowHashes.set(rowKey(def.name, row.key, row.member), hash);
    }
  }

  // Spare rows for new lines and pins: unlocked, yellow, with the validations of an existing row.
  if (def.kind === 'table' && def.editable) {
    for (let n = 0; n < slots; n += 1) {
      r += 1;
      for (const lc of laid) styleCell(ws.getCell(r, lc.index), blankSpec(lc.col), ranges);
    }
  }
  layoutSheet(ws, def, laid, r);
}

/** Org_Map row check: the sum of the row's cells, shaded when it is not the rule's target (`sum = 100%`). */
function writeRowCheck(
  ws: ExcelJS.Worksheet,
  laid: readonly LaidColumn[],
  row: RowDef,
  r: number,
  target: string | undefined,
  specs: readonly CellSpec[],
): void {
  const check = laid.find((lc) => lc.col.role === 'check');
  const cells = laid.filter((lc) => row.cells?.includes(lc.col.id) === true);
  const first = cells[0];
  const last = cells[cells.length - 1];
  if (check === undefined || first === undefined || last === undefined) return;
  const range = `${colLetter(first.index)}${r}:${colLetter(last.index)}${r}`;
  const cell = ws.getCell(r, check.index);
  const sum = laid.reduce((acc, lc, i) => {
    const norm = row.cells?.includes(lc.col.id) === true ? (specs[i] as CellSpec).norm : null;
    return typeof norm === 'number' ? acc + norm : acc;
  }, 0);
  cell.value = { formula: `SUM(${range})`, result: sum };
  cell.numFmt = row.numberFormat === undefined ? 'General' : excelNumberFormat(row.numberFormat);
  cell.protection = { locked: true };
  if (target !== undefined) {
    const want = Number(target) / 100;
    ws.addConditionalFormatting({
      ref: `${colLetter(check.index)}${r}`,
      rules: [
        {
          type: 'expression',
          priority: 1,
          formulae: [`ABS(${colLetter(check.index)}${r}-${want})>0.000001`],
          style: {
            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: CHECK_FAIL_FILL } },
          },
        },
      ],
    });
  }
}

const humanize = (token: string): string => {
  const spaced = token.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

function metaValues(
  meta: ExportMeta,
  scenarioIds: readonly string[],
  checksum: string,
): Record<string, string> {
  return {
    tenant_id: meta.tenantId,
    tenant_slug: meta.tenantSlug,
    model_version: meta.modelVersion,
    template_version: meta.templateVersion,
    export_job_id: meta.exportJobId,
    exported_at: meta.exportedAt.toISOString(),
    exported_by: meta.exportedBy,
    scenario_keys: scenarioIds.join(','),
    workbook_checksum: checksum,
  };
}

function writeReadme(ws: ExcelJS.Worksheet, def: SheetDef, values: Record<string, string>): void {
  const head = ws.getCell(HEADER_ROW, 1);
  head.value = def.columns[0]?.header ?? def.name;
  styleHeader(head);
  let r = HEADER_ROW;
  const line = (text: string, bold = false): void => {
    r += 1;
    const cell = ws.getCell(r, 1);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: 'top' };
    cell.protection = { locked: true };
    if (bold) cell.font = { bold: true };
  };
  for (const text of def.text ?? []) line(text);
  r += 1;
  for (const field of def.fields ?? []) {
    const value = values[field];
    if (value === undefined) throw new BuildError(`README: no value for field '${field}'`);
    line(`${humanize(field)}: ${value}`);
  }
  layoutSheet(ws, def, layoutColumns(def, []), r);
}

function writeMeta(ws: ExcelJS.Worksheet, def: SheetDef, values: Record<string, string>): void {
  const laid = layoutColumns(def, []);
  laid.forEach((lc) => {
    const cell = ws.getCell(HEADER_ROW, lc.index);
    cell.value = lc.header;
    styleHeader(cell);
  });
  let r = HEADER_ROW;
  for (const field of def.fields ?? []) {
    const value = values[field];
    if (value === undefined) throw new BuildError(`_meta: no value for field '${field}'`);
    r += 1;
    ws.getCell(r, 1).value = field;
    ws.getCell(r, 2).value = value;
    ws.getCell(r, 1).protection = { locked: true };
    ws.getCell(r, 2).protection = { locked: true };
  }
  layoutSheet(ws, def, laid, r);
}

function writeLists(ws: ExcelJS.Worksheet, def: SheetDef): void {
  const laid = layoutColumns(def, []);
  laid.forEach((lc) => {
    const cell = ws.getCell(HEADER_ROW, lc.index);
    cell.value = lc.header;
    styleHeader(cell);
  });
  let last = HEADER_ROW;
  def.lists?.forEach((l, i) => {
    l.entries.forEach((e, n) => {
      ws.getCell(HEADER_ROW + 1 + n, i * 2 + 1).value = e.code;
      ws.getCell(HEADER_ROW + 1 + n, i * 2 + 2).value = e.label;
    });
    last = Math.max(last, HEADER_ROW + l.entries.length);
  });
  layoutSheet(ws, def, laid, last);
}

// ----------------------------------------------------------------------------------------------
// Entry points
// ----------------------------------------------------------------------------------------------

function lookups(defs: readonly SheetDef[], values: ExportValues): Lookups {
  const lists = new Map<string, ListDef>();
  for (const d of defs) for (const l of d.lists ?? []) lists.set(l.id, l);
  return {
    defaults: valueMap(values.defaults),
    scenarioValues: new Map(values.scenarios.map((s) => [s.id, valueMap(s.values)])),
    outputs: new Map(
      values.scenarios.map((s) => [
        s.id,
        new Map((s.outputs ?? []).map((o) => [cellId(o.node_key, o.member_key), o.value])),
      ]),
    ),
    notes: new Map((values.notes ?? []).map((n) => [cellId(n.var_key, n.member_key), n.note])),
    lists,
  };
}

/**
 * Build the workbook of an export and its snapshot.
 *
 * - `defs`: `buildTemplate(template, bundle, members)`.
 * - `values`: tenant defaults and, per chosen scenario, its own `scenario_value` rows (a blank scenario cell
 *   means "inherit the default"), notes, node overrides and outputs.
 * - `meta`: the `_meta` fields and the template version.
 *
 * Scenario columns (`perScenario`) are repeated once per scenario in the order of `values.scenarios`. The
 * Overrides sheet has no scenario column, so it lists the pins of the first scenario.
 */
export function buildWorkbook(
  defs: readonly SheetDef[],
  values: ExportValues,
  meta: ExportMeta,
): BuiltWorkbook {
  if (values.scenarios.length === 0) throw new BuildError('buildWorkbook: no scenario to export');
  const ids = values.scenarios.map((s) => s.id);
  if (new Set(ids).size !== ids.length)
    throw new BuildError(`buildWorkbook: duplicate scenario ids ${ids.join(', ')}`);

  const look = lookups(defs, values);
  const ranges = listRanges(defs.find((d) => d.kind === 'lists'));
  const slots = meta.newRowSlots ?? NEW_ROW_SLOTS;
  const out: Collected = { cells: new Map(), rowHashes: new Map() };

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Glidepath';
  workbook.created = meta.exportedAt;
  workbook.modified = meta.exportedAt;

  // Data sheets first: the checksum (over their row hashes) goes into `_meta` and the README.
  const sheets = defs.map((def) => ({
    def,
    ws: workbook.addWorksheet(def.name, { state: def.hidden ? 'hidden' : 'visible' }),
  }));
  for (const { def, ws } of sheets) {
    if (def.kind === 'readme' || def.kind === 'meta' || def.kind === 'lists') continue;
    writeDataSheet(ws, def, values.scenarios, look, ranges, slots, out);
  }
  const checksum = sha256Hex(JSON.stringify([...out.rowHashes.entries()]));
  const metas = metaValues(meta, ids, checksum);
  for (const { def, ws } of sheets) {
    if (def.kind === 'readme') writeReadme(ws, def, metas);
    else if (def.kind === 'meta') writeMeta(ws, def, metas);
    else if (def.kind === 'lists') writeLists(ws, def);
  }
  for (const { def, ws } of sheets) protect(ws, def);

  const snapshot: ExportSnapshot = {
    exportJobId: meta.exportJobId,
    templateVersion: meta.templateVersion,
    scenarioIds: ids,
    cells: Object.fromEntries(out.cells),
    rowHashes: Object.fromEntries(out.rowHashes),
    checksum,
  };
  const fileName = exportFileName(
    meta.fileNamePattern ?? DEFAULT_FILE_NAME_PATTERN,
    meta.tenantSlug,
    ids,
    meta.exportedAt,
  );
  return { workbook, snapshot, fileName };
}

/** The bytes of the .xlsx file (in memory: the caller stores them). */
export async function writeWorkbook(workbook: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
