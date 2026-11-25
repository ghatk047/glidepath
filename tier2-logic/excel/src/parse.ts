import ExcelJS from 'exceljs';
import { VALUE_ROLES, hashRow, scenarioColumnId, type SnapshotValue } from './build';
import type { ColumnDef, ColumnRole, ListDef, RowDef, SheetDef } from './types';

/**
 * parse.ts: an uploaded .xlsx buffer -> `ParsedWorkbook` (docs/architecture/05_excel_roundtrip.md section 1,
 * docs/spec/05_excel_template.md section 3 steps 1 and 2).
 *
 * - Sheets are found by name, columns by header text (never by position, except for the per-scenario columns,
 *   whose header is the scenario label: see `ParseOptions.scenarios`). Unknown sheets and columns are reported
 *   and ignored.
 * - Rows are read by key, so sorting, filtering, hidden rows and cell comments change nothing.
 * - Cells are normalised the way `build.ts` writes the export snapshot: `35%` and `0.35` are 0.35, TRUE/FALSE
 *   are 1/0, dropdown labels are codes, blank is `null` (= inherit the default).
 * - `_meta` is read. A workbook without a usable `_meta` is in foreign mode (two-way diff against the database).
 *
 * Pure: no IO. ExcelJS reads the buffer in memory. Nothing here validates ranges or compares with the snapshot;
 * that is `validate.ts` and `diff.ts`.
 */

// ----------------------------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------------------------

export type ParseIssueSeverity = 'error' | 'warning' | 'info';

export type ParseIssueCode =
  | 'unknown_sheet'
  | 'missing_sheet'
  | 'no_header'
  | 'unknown_column'
  | 'missing_column'
  | 'missing_key_column'
  | 'missing_key'
  | 'duplicate_row'
  | 'scenario_columns'
  | 'meta_missing'
  | 'meta_incomplete';

export interface ParseIssue {
  readonly severity: ParseIssueSeverity;
  readonly code: ParseIssueCode;
  readonly message: string;
  readonly sheet?: string;
  /** 1-based row of the sheet. */
  readonly row?: number;
  /** Header text or column id. */
  readonly column?: string;
}

/** `import_pipeline` step 1 input: the `_meta` sheet as read. */
export interface ParsedMeta {
  /** Every `_meta` field as text, by the template's field name (`tenant_id`, `export_job_id`, ...). */
  readonly fields: Readonly<Record<string, string>>;
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly modelVersion: string;
  readonly templateVersion: string;
  readonly exportJobId: string;
  /** `null` when the field is missing or not a date. */
  readonly exportedAt: Date | null;
  readonly exportedBy: string;
  /** Scenario ids of the export, in column order. */
  readonly scenarioKeys: readonly string[];
  readonly workbookChecksum: string;
}

/** A header the importer recognised. */
export interface ParsedColumn {
  /** Column id as `build.ts` uses it in the snapshot and in row hashes (`scenarioColumnId(...)` for scenario columns). */
  readonly id: string;
  /** `ColumnDef.id`. */
  readonly defId: string;
  readonly role: ColumnRole;
  /** Header text as found in the file. */
  readonly header: string;
  /** 1-based column of the sheet. */
  readonly position: number;
  /** Scenario columns: the scenario id (from `options.scenarios` or `_meta`), when known. */
  readonly scenarioId?: string;
  /** Scenario columns: the label as written in the header. */
  readonly scenarioLabel?: string;
}

/** A header that matches no column of the template. Its cells are ignored. */
export interface UnknownColumn {
  readonly header: string;
  readonly position: number;
}

export interface ParsedRow {
  /** 1-based row of the sheet. */
  readonly rowNumber: number;
  /** Text of the `key` column (Line_Items: `member_key`, Overrides: `node_key`). Blank for a new row. */
  readonly key: string;
  /** Text of the `member` column (Line_Items: the key again, Overrides: `member_key`). */
  readonly member: string;
  /** Table sheet row with a blank key and some content: an insert. */
  readonly isNew: boolean;
  /** `DELETE` or another text of the action column; `null` when blank or no action column. */
  readonly action: string | null;
  /** Normalised value of every recognised column except key, member, `_hash` and the row check, by column id. Blank is `null`. */
  readonly cells: Readonly<Record<string, SnapshotValue>>;
  /** The `_hash` cell as read; `null` when blank (new rows have none). */
  readonly exportedHash: string | null;
  /** `hashRow` of the row's editable cells as parsed: equals `exportedHash` when the row is unchanged. `null` when no editable cell. */
  readonly hash: string | null;
}

export interface ParsedSheet {
  /** Template name of the sheet (`Targets`). */
  readonly name: string;
  /** Name as written in the file (may differ in case or spacing). */
  readonly fileName: string;
  readonly kind: SheetDef['kind'];
  /** 1-based row that holds the headers. */
  readonly headerRow: number;
  /** Recognised columns in template order (scenario columns in scenario order). */
  readonly columns: readonly ParsedColumn[];
  readonly unknownColumns: readonly UnknownColumn[];
  /** Ids of template columns that have no header in the file (scenario columns excluded). */
  readonly missingColumns: readonly string[];
  readonly rows: readonly ParsedRow[];
}

export type ImportMode = 'export' | 'foreign';

export interface ParsedWorkbook {
  /** `export`: usable `_meta`, the snapshot can be loaded. `foreign`: no `_meta`, match by key and diff two-way. */
  readonly mode: ImportMode;
  readonly meta: ParsedMeta | null;
  /** Input sheets found, in template order. */
  readonly sheets: readonly ParsedSheet[];
  /** Sheets of the file that the template does not know. Ignored. */
  readonly unknownSheets: readonly string[];
  /** Sheets that are read by no one on import: README, Outputs, `_lists`. */
  readonly ignoredSheets: readonly string[];
  /** Input sheets of the template that the file lacks. */
  readonly missingSheets: readonly string[];
  readonly issues: readonly ParseIssue[];
}

export interface ParseOptions {
  /**
   * The exported scenarios in column order (the worker knows them from `_meta.scenario_keys`). Scenario columns
   * are headed by the scenario label, so with this list they are matched by label (duplicates in order) and get
   * their scenario id. Without it, scenario columns are taken by position and numbered by `_meta.scenario_keys`;
   * with neither (foreign workbook) they keep their label as id.
   */
  readonly scenarios?: readonly { readonly id: string; readonly label: string }[];
}

/** Thrown when the buffer is not a readable .xlsx file. */
export class ParseError extends Error {
  override readonly name = 'ParseError';
}

// ----------------------------------------------------------------------------------------------
// Constants (layout only: no business numbers)
// ----------------------------------------------------------------------------------------------

/** `build.ts` writes the headers in row 1; foreign files may have title rows above them. */
const HEADER_SCAN_ROWS = 10;
/** `build.ts` writes block headers as `<block> · <scenario label>`. */
const SCENARIO_HEADER_SEPARATOR = '·';
const SYSTEM_KINDS: ReadonlySet<SheetDef['kind']> = new Set([
  'readme',
  'snapshot',
  'lists',
  'meta',
]);
/** `_meta` fields without which an export cannot be identified. */
const META_REQUIRED = ['tenant_id', 'template_version', 'export_job_id'] as const;
const KEY_SEPARATOR = '\u0001';

// ----------------------------------------------------------------------------------------------
// Text and number normalisation
// ----------------------------------------------------------------------------------------------

type Raw = string | number | boolean | null;

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** The value of a cell as plain data: formulas give their result, rich text its text, errors their code. */
function fromCellValue(v: ExcelJS.CellValue | undefined): Raw {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if ('richText' in v) return v.richText.map((t) => t.text).join('');
  if ('error' in v) return String(v.error);
  if ('formula' in v || 'sharedFormula' in v) return fromCellValue(v.result);
  if ('text' in v) return String(v.text);
  return null;
}

function cellRaw(cell: ExcelJS.Cell): Raw {
  // The other cells of a merged range repeat the master's value in ExcelJS: count them blank.
  if (cell.type === ExcelJS.ValueType.Merge) return null;
  return fromCellValue(cell.value);
}

function trimmed(raw: Raw): string | null {
  if (raw === null) return null;
  const text =
    typeof raw === 'string'
      ? raw.trim()
      : typeof raw === 'number'
        ? String(raw)
        : raw
          ? 'TRUE'
          : 'FALSE';
  return text === '' ? null : text;
}

const PLAIN_NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i;
const GROUPED_NUMBER = /^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;

/**
 * A number typed as text: `0.35`, `-1.5`, `1e-3`, `1,234.5`, and `35%` (-> 0.35). The percent shift is done on
 * the decimal text (`35e-2`), so `35%` is exactly the double of `0.35`. `null` when the text is not a number.
 */
export function parseNumberText(text: string): number | null {
  const s = text.replace(/\s+/g, '').replace(/\u2212/g, '-');
  const percent = s.endsWith('%');
  let body = percent ? s.slice(0, -1) : s;
  if (GROUPED_NUMBER.test(body)) body = body.replace(/,/g, '');
  if (!PLAIN_NUMBER.test(body)) return null;
  if (!percent) return Number(body);
  const [mantissa = '', exponent = ''] = body.toLowerCase().split('e');
  return Number(`${mantissa}e${(exponent === '' ? 0 : Number(exponent)) - 2}`);
}

type Kind = 'text' | 'number' | 'bool' | 'enum' | 'list' | 'value';

interface KindOf {
  readonly kind: Kind;
  readonly list?: ListDef;
}

function findEntry(list: ListDef | undefined, text: string): string | number | undefined {
  if (list === undefined) return undefined;
  const byCode = list.entries.find((e) => String(e.code) === text);
  if (byCode !== undefined) return byCode.code;
  const wanted = squash(text);
  return list.entries.find((e) => squash(e.label) === wanted)?.code;
}

function normalise(raw: Raw, k: KindOf): SnapshotValue {
  if (raw === null) return null;
  switch (k.kind) {
    case 'text':
      return trimmed(raw);
    case 'number': {
      if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
      const t = trimmed(raw);
      if (t === null) return null;
      return parseNumberText(t) ?? t;
    }
    case 'bool': {
      if (typeof raw === 'boolean') return raw ? 1 : 0;
      if (typeof raw === 'number') return raw;
      const t = trimmed(raw);
      if (t === null) return null;
      const upper = t.toUpperCase();
      if (upper === 'TRUE') return 1;
      if (upper === 'FALSE') return 0;
      return parseNumberText(t) ?? t;
    }
    case 'enum':
    case 'list': {
      if (typeof raw === 'boolean') return raw ? 1 : 0;
      const t = trimmed(raw);
      if (t === null) return null;
      const code = findEntry(k.list, t);
      if (code !== undefined) return code;
      if (typeof raw === 'number') return raw;
      return (k.kind === 'enum' ? parseNumberText(t) : null) ?? t;
    }
    case 'value': {
      if (typeof raw === 'boolean') return raw ? 1 : 0;
      if (typeof raw === 'number') return raw;
      const t = trimmed(raw);
      if (t === null) return null;
      return parseNumberText(t) ?? t;
    }
  }
}

// ----------------------------------------------------------------------------------------------
// What a cell holds: from the sheet definition
// ----------------------------------------------------------------------------------------------

const TEXT_ROLES: ReadonlySet<ColumnRole> = new Set<ColumnRole>([
  'key',
  'member',
  'group',
  'label',
  'unit',
  'source',
  'confidence',
  'note',
  'action',
  'text',
]);
/** Roles of value cells that take their type from the variable of the row. */
const ROW_TYPED_ROLES: ReadonlySet<ColumnRole> = new Set<ColumnRole>([
  'default',
  'scenario',
  'value',
  'year',
  'matrix_col',
  'block',
]);
const KEY_ROLE: ColumnRole = 'key';
const MEMBER_ROLE: ColumnRole = 'member';
const HASH_ROLE: ColumnRole = 'hash';
const CHECK_ROLE: ColumnRole = 'check';
const ACTION_ROLE: ColumnRole = 'action';
const OVERRIDE_KEY = 'node_key';
const OVERRIDE_MEMBER = 'member_key';
const OVERRIDE_VALUE = 'value';

/** The Overrides sheet: a table without a `key` column whose rows are the pins (identified by node and member). */
const isOverrides = (def: SheetDef): boolean =>
  def.kind === 'table' && def.columns.some((c) => c.id === OVERRIDE_KEY);

interface Lists {
  readonly byId: ReadonlyMap<string, ListDef>;
}

function kindFromFacts(
  type: ColumnDef['type'],
  listRef: string | undefined,
  lists: Lists,
): KindOf | undefined {
  const list = listRef === undefined ? undefined : lists.byId.get(listRef);
  if (type === 'bool' || listRef === 'bool') return { kind: 'bool' };
  if (type === 'enum' || listRef?.startsWith('enum.') === true)
    return { kind: 'enum', ...(list === undefined ? {} : { list }) };
  if (type === 'number' || type === 'int') return { kind: 'number' };
  if (listRef !== undefined) return { kind: 'list', ...(list === undefined ? {} : { list }) };
  return undefined;
}

function kindOf(def: SheetDef, row: RowDef | undefined, col: ColumnDef, lists: Lists): KindOf {
  const role = col.role;
  if (role === 'min' || role === 'max') return { kind: 'number' };
  if (TEXT_ROLES.has(role)) return { kind: 'text' };
  if (role === 'field' && col.varId === undefined) {
    if (isOverrides(def) && col.id === OVERRIDE_VALUE) return { kind: 'number' };
    return kindFromFacts(undefined, col.listRef, lists) ?? { kind: 'text' };
  }
  const own =
    col.varId !== undefined
      ? kindFromFacts(col.type, col.listRef, lists)
      : row === undefined
        ? undefined
        : kindFromFacts(row.type, row.listRef, lists);
  if (own !== undefined) return own;
  return ROW_TYPED_ROLES.has(role) || role === 'field' ? { kind: 'value' } : { kind: 'text' };
}

/** Is the cell part of the row's `_hash`? The same rule as `build.ts` (a test keeps the two equal). */
function isHashed(col: ColumnDef, row: RowDef | undefined): boolean {
  if (!col.editable) return false;
  if (col.role === ACTION_ROLE) return true;
  if (col.role === 'note') return row?.varId !== undefined;
  if (!VALUE_ROLES.has(col.role)) return false;
  if (row === undefined) return true;
  if (row.cells !== undefined && !row.cells.includes(col.id)) return false;
  return !(col.perScenario && row.scenarioVaries === false);
}

// ----------------------------------------------------------------------------------------------
// Header text -> columns
// ----------------------------------------------------------------------------------------------

interface HeaderCell {
  readonly text: string;
  readonly norm: string;
  readonly position: number;
  used: boolean;
}

function readHeaders(ws: ExcelJS.Worksheet, headerRow: number): HeaderCell[] {
  const out: HeaderCell[] = [];
  const row = ws.getRow(headerRow);
  for (let c = 1; c <= ws.columnCount; c += 1) {
    const text = trimmed(cellRaw(row.getCell(c)));
    if (text !== null) out.push({ text, norm: squash(text), position: c, used: false });
  }
  return out;
}

/** The row that holds most of the template's fixed headers; the first one on a tie. 0 when none matches. */
function detectHeaderRow(ws: ExcelJS.Worksheet, def: SheetDef): number {
  const wanted = new Set(def.columns.filter((c) => !c.perScenario).map((c) => squash(c.header)));
  let best = 0;
  let bestScore = 0;
  const last = Math.min(HEADER_SCAN_ROWS, ws.rowCount);
  for (let r = 1; r <= last; r += 1) {
    const found = new Set(
      readHeaders(ws, r)
        .map((h) => h.norm)
        .filter((n) => wanted.has(n)),
    );
    if (found.size > bestScore) {
      best = r;
      bestScore = found.size;
    }
  }
  return best;
}

interface Scenarios {
  /** Known scenarios in column order (from the caller or `_meta`); labels only with the caller's list. */
  readonly known: readonly { readonly id: string; readonly label?: string }[];
  readonly byLabel: boolean;
}

interface Matched {
  readonly col: ColumnDef;
  readonly header: HeaderCell;
  readonly scenario?: { readonly index: number; readonly id?: string; readonly label: string };
}

/**
 * Give scenario columns of one template column (`candidates`, in sheet order) their scenario: by label when the
 * caller passes the scenarios, else by position. Returns the matched ones; the rest stay unknown columns.
 */
function assignScenarios(
  col: ColumnDef,
  candidates: readonly { header: HeaderCell; label: string }[],
  sc: Scenarios,
): Matched[] {
  const out: Matched[] = [];
  const taken = new Set<number>();
  candidates.forEach((cand, order) => {
    let index = -1;
    if (sc.byLabel) {
      const wanted = squash(cand.label);
      index = sc.known.findIndex((s, i) => !taken.has(i) && squash(s.label ?? '') === wanted);
    } else if (sc.known.length === 0 || order < sc.known.length) index = order;
    if (index < 0) return;
    taken.add(index);
    const id = sc.known[index]?.id;
    cand.header.used = true;
    out.push({
      col,
      header: cand.header,
      scenario: { index, ...(id === undefined ? {} : { id }), label: cand.label },
    });
  });
  return out;
}

interface Layout {
  readonly columns: readonly ParsedColumn[];
  /** `ParsedColumn.id` -> its `ColumnDef`. */
  readonly defs: ReadonlyMap<string, ColumnDef>;
  readonly unknown: readonly UnknownColumn[];
  readonly missing: readonly string[];
}

/** Match the headers of a sheet to the template's columns. */
function matchColumns(def: SheetDef, headers: HeaderCell[], sc: Scenarios): Layout {
  const matched = new Map<ColumnDef, Matched[]>();
  const fixed = def.columns.filter((c) => !c.perScenario);

  // 1. Fixed columns: exact header text (case and spacing aside). Prefer a header right of the last match.
  let last = 0;
  for (const col of fixed) {
    const want = squash(col.header);
    const free = headers.filter((h) => !h.used && h.norm === want);
    const header = free.find((h) => h.position > last) ?? free[0];
    if (header === undefined) continue;
    header.used = true;
    last = header.position;
    matched.set(col, [{ col, header }]);
  }

  // 2. Block columns ("<block> · <scenario label>"): by header prefix, longest prefix first.
  const perScenario = def.columns.filter((c) => c.perScenario);
  const blocks = perScenario.filter((c) => c.role !== 'scenario');
  for (const col of [...blocks].sort((a, b) => b.header.length - a.header.length)) {
    const prefix = squash(`${col.header} ${SCENARIO_HEADER_SEPARATOR}`);
    const from = Math.max(0, col.header.trim().length - 1);
    const candidates = headers
      .filter((h) => !h.used && h.norm.startsWith(prefix))
      .map((h) => ({
        header: h,
        label: h.text.slice(h.text.indexOf(SCENARIO_HEADER_SEPARATOR, from) + 1).trim(),
      }));
    matched.set(col, assignScenarios(col, candidates, sc));
  }

  // 3. Scenario columns (headed by the label alone): the unused headers between their template neighbours.
  for (const col of perScenario.filter((c) => c.role === 'scenario')) {
    const at = def.columns.indexOf(col);
    const before = def.columns
      .slice(0, at)
      .reverse()
      .find((c) => matched.has(c) && !c.perScenario);
    const after = def.columns.slice(at + 1).find((c) => matched.has(c) && !c.perScenario);
    const from = before === undefined ? 0 : (matched.get(before)?.[0]?.header.position ?? 0);
    const to =
      after === undefined ? Infinity : (matched.get(after)?.[0]?.header.position ?? Infinity);
    const candidates = headers
      .filter((h) => !h.used && h.position > from && h.position < to)
      .map((h) => ({ header: h, label: h.text }));
    matched.set(col, assignScenarios(col, candidates, sc));
  }

  const columns: ParsedColumn[] = [];
  const defs = new Map<string, ColumnDef>();
  for (const col of def.columns) {
    const found = matched.get(col) ?? [];
    const ordered = col.perScenario
      ? [...found].sort((a, b) => (a.scenario?.index ?? 0) - (b.scenario?.index ?? 0))
      : found;
    for (const m of ordered) {
      const s = m.scenario;
      const id =
        s === undefined
          ? col.id
          : scenarioColumnId(col.id, s.id ?? uniqueLabelId(s.label, columns, col.id));
      defs.set(id, col);
      columns.push({
        id,
        defId: col.id,
        role: col.role,
        header: m.header.text,
        position: m.header.position,
        ...(s?.id === undefined ? {} : { scenarioId: s.id }),
        ...(s === undefined ? {} : { scenarioLabel: s.label }),
      });
    }
  }
  return {
    columns,
    defs,
    unknown: headers.filter((h) => !h.used).map((h) => ({ header: h.text, position: h.position })),
    missing: fixed.filter((c) => !matched.has(c)).map((c) => c.id),
  };
}

/** Scenario column without a known id: the label stands in; a repeated label gets `#2`, `#3`. */
function uniqueLabelId(label: string, done: readonly ParsedColumn[], defId: string): string {
  const same = done.filter((c) => c.defId === defId && c.scenarioLabel === label).length;
  return same === 0 ? label : `${label}#${same + 1}`;
}

// ----------------------------------------------------------------------------------------------
// _meta
// ----------------------------------------------------------------------------------------------

function readMeta(ws: ExcelJS.Worksheet, def: SheetDef): Record<string, string> {
  const headerRow = detectHeaderRow(ws, def) || 1;
  const headers = readHeaders(ws, headerRow);
  const find = (id: string, fallback: number): number =>
    headers.find((h) => h.norm === squash(def.columns.find((c) => c.id === id)?.header ?? id))
      ?.position ?? fallback;
  const fieldCol = find('field', 1);
  const valueCol = find('value', 2);
  const out: Record<string, string> = {};
  for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const field = trimmed(cellRaw(row.getCell(fieldCol)));
    if (field === null) continue;
    out[field] = trimmed(cellRaw(row.getCell(valueCol))) ?? '';
  }
  return out;
}

function toMeta(fields: Readonly<Record<string, string>>): ParsedMeta {
  const text = (name: string): string => fields[name] ?? '';
  const at = new Date(text('exported_at'));
  return {
    fields,
    tenantId: text('tenant_id'),
    tenantSlug: text('tenant_slug'),
    modelVersion: text('model_version'),
    templateVersion: text('template_version'),
    exportJobId: text('export_job_id'),
    exportedAt: text('exported_at') === '' || Number.isNaN(at.getTime()) ? null : at,
    exportedBy: text('exported_by'),
    scenarioKeys: text('scenario_keys')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
    workbookChecksum: text('workbook_checksum'),
  };
}

// ----------------------------------------------------------------------------------------------
// Rows
// ----------------------------------------------------------------------------------------------

interface RowIndex {
  readonly exact: ReadonlyMap<string, RowDef>;
  readonly byKey: ReadonlyMap<string, RowDef>;
}

const rowId = (key: string, member: string): string => `${key}${KEY_SEPARATOR}${member}`;

function indexRows(def: SheetDef): RowIndex {
  const exact = new Map<string, RowDef>();
  const byKey = new Map<string, RowDef>();
  for (const r of def.rows) {
    exact.set(rowId(r.key, r.member), r);
    if (!byKey.has(r.key)) byKey.set(r.key, r);
  }
  return { exact, byKey };
}

interface Reader {
  readonly def: SheetDef;
  readonly ws: ExcelJS.Worksheet;
  readonly layout: Layout;
  readonly index: RowIndex;
  readonly lists: Lists;
}

function readRows(rd: Reader, headerRow: number, issues: ParseIssue[]): ParsedRow[] {
  const { def, ws, layout, index, lists } = rd;
  const col = (role: ColumnRole): ParsedColumn | undefined =>
    layout.columns.find((c) => c.role === role);
  const byId = (id: string): ParsedColumn | undefined => layout.columns.find((c) => c.defId === id);
  const overrides = isOverrides(def);
  const keyCol = overrides ? byId(OVERRIDE_KEY) : col(KEY_ROLE);
  const memberCol = overrides ? byId(OVERRIDE_MEMBER) : col(MEMBER_ROLE);
  const hashCol = col(HASH_ROLE);
  const actionCol = col(ACTION_ROLE);
  const table = def.kind === 'table';
  const out: ParsedRow[] = [];
  const seen = new Set<string>();

  const dataCols = layout.columns.filter(
    (c) =>
      c.role !== KEY_ROLE &&
      c.role !== MEMBER_ROLE &&
      c.role !== HASH_ROLE &&
      c.role !== CHECK_ROLE,
  );

  for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const text = (c: ParsedColumn | undefined): string | null =>
      c === undefined ? null : trimmed(cellRaw(row.getCell(c.position)));
    const key = text(keyCol) ?? '';
    const member = memberCol === undefined ? key : (text(memberCol) ?? '');
    const exportedHash = text(hashCol);

    const rowDef = index.exact.get(rowId(key, member)) ?? index.byKey.get(key);
    const exactDef = index.exact.get(rowId(key, member));
    const cells: Record<string, SnapshotValue> = {};
    let content = key !== '' || member !== '' || exportedHash !== null;
    for (const c of dataCols) {
      const colDef = layout.defs.get(c.id);
      if (colDef === undefined) continue;
      const raw = cellRaw(row.getCell(c.position));
      const value =
        c.role === ACTION_ROLE
          ? normaliseAction(trimmed(raw), colDef)
          : normalise(raw, kindOf(def, rowDef, colDef, lists));
      cells[c.id] = value;
      if (value !== null) content = true;
    }
    if (!content) continue;

    let isNew = false;
    if (key === '') {
      if (table && !overrides) isNew = true;
      else {
        issues.push({
          severity: 'warning',
          code: 'missing_key',
          sheet: def.name,
          row: r,
          message: `${def.name} row ${r}: no key, row ignored`,
        });
        continue;
      }
    } else {
      const id = rowId(key, member);
      if (seen.has(id))
        issues.push({
          severity: 'warning',
          code: 'duplicate_row',
          sheet: def.name,
          row: r,
          message: `${def.name} row ${r}: key '${key}${member === key ? '' : `|${member}`}' appears more than once`,
        });
      seen.add(id);
    }

    const hashed: [string, SnapshotValue][] = [];
    for (const c of dataCols) {
      const colDef = layout.defs.get(c.id);
      if (colDef !== undefined && isHashed(colDef, exactDef))
        hashed.push([c.id, cells[c.id] ?? null]);
    }
    out.push({
      rowNumber: r,
      key,
      member,
      isNew,
      action: actionCol === undefined ? null : (cells[actionCol.id] as string | null),
      cells,
      exportedHash,
      hash: hashCol === undefined || hashed.length === 0 ? null : hashRow(hashed),
    });
  }
  return out;
}

/** `delete` -> `DELETE`: a choice of the action column is matched without regard to case. */
function normaliseAction(text: string | null, col: ColumnDef | undefined): string | null {
  if (text === null) return null;
  return col?.choices?.find((c) => c !== '' && c.toUpperCase() === text.toUpperCase()) ?? text;
}

// ----------------------------------------------------------------------------------------------
// Entry points
// ----------------------------------------------------------------------------------------------

const metaIssues = (meta: ParsedMeta | null, sheetPresent: boolean): ParseIssue[] => {
  if (meta === null)
    return [
      {
        severity: 'warning',
        code: 'meta_missing',
        message: sheetPresent
          ? '_meta could not be read: treated as a foreign workbook (two-way diff against the app)'
          : 'No _meta sheet: treated as a foreign workbook (two-way diff against the app)',
      },
    ];
  const missing = META_REQUIRED.filter((f) => (meta.fields[f] ?? '') === '');
  return missing.length === 0
    ? []
    : [
        {
          severity: 'warning',
          code: 'meta_incomplete',
          message: `_meta lacks ${missing.join(', ')}: treated as a foreign workbook`,
        },
      ];
};

/**
 * Parse a loaded ExcelJS workbook. `parseWorkbook` loads the buffer and calls this; use it directly when you
 * already hold a workbook object.
 */
export function parseLoadedWorkbook(
  workbook: ExcelJS.Workbook,
  defs: readonly SheetDef[],
  options: ParseOptions = {},
): ParsedWorkbook {
  const issues: ParseIssue[] = [];
  const byName = new Map(defs.map((d) => [squash(d.name), d]));
  const lists: Lists = {
    byId: new Map(defs.flatMap((d) => d.lists ?? []).map((l) => [l.id, l])),
  };

  // Which template sheet is each worksheet?
  const found = new Map<SheetDef, ExcelJS.Worksheet>();
  const unknownSheets: string[] = [];
  for (const ws of workbook.worksheets) {
    const def = byName.get(squash(ws.name));
    if (def === undefined) {
      unknownSheets.push(ws.name);
      issues.push({
        severity: 'warning',
        code: 'unknown_sheet',
        sheet: ws.name,
        message: `Sheet '${ws.name}' is not part of the template: ignored`,
      });
    } else found.set(def, ws);
  }

  // Step 1: _meta.
  const metaDef = defs.find((d) => d.kind === 'meta');
  const metaWs = metaDef === undefined ? undefined : found.get(metaDef);
  const metaFields =
    metaDef === undefined || metaWs === undefined ? undefined : readMeta(metaWs, metaDef);
  const meta =
    metaFields === undefined || Object.keys(metaFields).length === 0 ? null : toMeta(metaFields);
  const problems = metaIssues(meta, metaWs !== undefined);
  issues.push(...problems);
  const mode: ImportMode = meta !== null && problems.length === 0 ? 'export' : 'foreign';

  // Step 2: input sheets.
  const known: Scenarios =
    options.scenarios !== undefined
      ? { known: options.scenarios, byLabel: true }
      : {
          known: (mode === 'export' ? (meta?.scenarioKeys ?? []) : []).map((id) => ({ id })),
          byLabel: false,
        };
  const sheets: ParsedSheet[] = [];
  const ignoredSheets: string[] = [];
  const missingSheets: string[] = [];
  for (const def of defs) {
    const ws = found.get(def);
    if (def.kind === 'meta') continue;
    if (SYSTEM_KINDS.has(def.kind)) {
      if (ws !== undefined) ignoredSheets.push(ws.name);
      continue;
    }
    if (ws === undefined) {
      missingSheets.push(def.name);
      issues.push({
        severity: 'warning',
        code: 'missing_sheet',
        sheet: def.name,
        message: `Sheet '${def.name}' is not in the workbook`,
      });
      continue;
    }
    const parsed = parseSheet(def, ws, known, lists, issues);
    if (parsed !== undefined) sheets.push(parsed);
  }

  return { mode, meta, sheets, unknownSheets, ignoredSheets, missingSheets, issues };
}

function parseSheet(
  def: SheetDef,
  ws: ExcelJS.Worksheet,
  sc: Scenarios,
  lists: Lists,
  issues: ParseIssue[],
): ParsedSheet | undefined {
  const headerRow = detectHeaderRow(ws, def);
  if (headerRow === 0) {
    issues.push({
      severity: 'error',
      code: 'no_header',
      sheet: def.name,
      message: `${def.name}: no header row found, sheet ignored`,
    });
    return undefined;
  }
  const layout = matchColumns(def, readHeaders(ws, headerRow), sc);
  for (const u of layout.unknown)
    issues.push({
      severity: 'warning',
      code: 'unknown_column',
      sheet: def.name,
      column: u.header,
      message: `${def.name}: column '${u.header}' (${u.position}) is not part of the template: ignored`,
    });
  for (const id of layout.missing)
    issues.push({
      severity: def.columns.find((c) => c.id === id)?.role === KEY_ROLE ? 'error' : 'info',
      code: 'missing_column',
      sheet: def.name,
      column: id,
      message: `${def.name}: column '${def.columns.find((c) => c.id === id)?.header ?? id}' is not in the sheet`,
    });
  const scenarioCols = layout.columns.filter((c) => c.scenarioLabel !== undefined);
  if (def.columns.some((c) => c.perScenario) && scenarioCols.length === 0 && sc.known.length > 0)
    issues.push({
      severity: 'warning',
      code: 'scenario_columns',
      sheet: def.name,
      message: `${def.name}: none of the ${sc.known.length} scenario columns was found`,
    });

  const has = (pred: (c: ParsedColumn) => boolean): boolean => layout.columns.some(pred);
  const lacks = isOverrides(def)
    ? !has((c) => c.defId === OVERRIDE_KEY)
    : !has((c) => c.role === KEY_ROLE) ||
      (def.columns.some((c) => c.role === MEMBER_ROLE) && !has((c) => c.role === MEMBER_ROLE));
  const base = {
    name: def.name,
    fileName: ws.name,
    kind: def.kind,
    headerRow,
    columns: layout.columns,
    unknownColumns: layout.unknown,
    missingColumns: layout.missing,
  };
  if (lacks) {
    issues.push({
      severity: 'error',
      code: 'missing_key_column',
      sheet: def.name,
      message: `${def.name}: key column missing, rows cannot be matched: sheet ignored`,
    });
    return { ...base, rows: [] };
  }
  const rows = readRows({ def, ws, layout, index: indexRows(def), lists }, headerRow, issues);
  return { ...base, rows };
}

/**
 * Parse an uploaded .xlsx file.
 *
 * - `buffer`: the file's bytes (the worker holds them in memory).
 * - `defs`: `buildTemplate(...)` of the tenant: sheet and column headers, row types and dropdown lists.
 *
 * ExcelJS loads buffers asynchronously, so the result is a promise. Throws `ParseError` when the bytes are not an
 * .xlsx file.
 */
export async function parseWorkbook(
  buffer: Uint8Array | ArrayBuffer,
  defs: readonly SheetDef[],
  options: ParseOptions = {},
): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (err) {
    throw new ParseError(
      `Not a readable .xlsx file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseLoadedWorkbook(workbook, defs, options);
}

// ----------------------------------------------------------------------------------------------
// Identify (import_pipeline step 1)
// ----------------------------------------------------------------------------------------------

export interface Identity {
  readonly mode: ImportMode;
  /** `null` in foreign mode (no tenant in the file). */
  readonly tenantMatches: boolean | null;
  /** Same major version; minor versions are compatible. `null` in foreign mode. */
  readonly templateCompatible: boolean | null;
  readonly problems: readonly string[];
}

const majorOf = (version: string): string | undefined => {
  const major = /^\s*v?(\d+)(?:\.|$)/.exec(version)?.[1];
  return major;
};

/**
 * Step 1 check: does the workbook belong to this tenant and a compatible template version? Minor versions are
 * compatible (same major). A foreign workbook has nothing to check: it is matched by key.
 */
export function identifyWorkbook(
  parsed: ParsedWorkbook,
  expected: { readonly tenantId: string; readonly templateVersion: string },
): Identity {
  const meta = parsed.meta;
  if (parsed.mode === 'foreign' || meta === null)
    return { mode: 'foreign', tenantMatches: null, templateCompatible: null, problems: [] };
  const tenantMatches = meta.tenantId === expected.tenantId;
  const theirs = majorOf(meta.templateVersion);
  const templateCompatible = theirs !== undefined && theirs === majorOf(expected.templateVersion);
  const problems = [
    ...(tenantMatches
      ? []
      : [`Workbook belongs to tenant '${meta.tenantId}', not '${expected.tenantId}'`]),
    ...(templateCompatible
      ? []
      : [
          `Template version '${meta.templateVersion}' is not compatible with '${expected.templateVersion}'`,
        ]),
  ];
  return { mode: 'export', tenantMatches, templateCompatible, problems };
}
