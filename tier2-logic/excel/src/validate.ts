import {
  RULE_TOLERANCE,
  VALIDATION_RULES,
  memberKey,
  toCellKey,
  validateInputs,
  type InputValueRow,
  type RuleId,
  type Severity,
} from '@glidepath/domain';
import type { ModelBundle, TenantMembers } from '@glidepath/spec';
import { VALUE_ROLES, type SnapshotValue } from './build';
import type { ParsedColumn, ParsedRow, ParsedSheet, ParsedWorkbook } from './parse';
import type { ColumnDef, ColumnRole, ListDef, RowDef, SheetDef, ValueType } from './types';

/**
 * validate.ts: `ParsedWorkbook` -> validation entries (docs/spec/05_excel_template.md section 3 step 3,
 * docs/architecture/05_excel_roundtrip.md section 1).
 *
 * Per cell (what `parse.ts` leaves as typed): unknown key, type, min/max (VR04), enum / dropdown membership and
 * edits to locked columns and cells. Across rows: the input rules of DOM-02 (`validateInputs`: VR01 ownership
 * sums, VR02 one shared-services VP, VR03 usage keys, VR06, VR07), run on the state the workbook would produce
 * (the current values with the workbook's cells on top), once for the default layer and once for each scenario.
 *
 * Pure: no IO. Entries carry the contract's CellKeys (`id[member_key]`) and the position in the file, so
 * `report.ts` can show each one on its row.
 */

// ----------------------------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------------------------

export type ValidationCode =
  /** A row whose key (and member) is not in the template, or an override of an unknown node. */
  | 'unknown_key'
  /** A value of the wrong type: text in a number cell, a fraction in a whole-number cell. */
  | 'type'
  /** VR04: a number outside the variable's min/max. */
  | 'out_of_range'
  /** A value that is not one of the cell's dropdown choices (enum, bool, pool, domain, action, ...). */
  | 'not_in_list'
  /** A locked column or cell that differs from the template. */
  | 'locked_edit'
  /** A rule that reads several rows: VR01, VR02, VR03, VR06, VR07 (from `@glidepath/domain`). */
  | 'cross_row';

/** Where an entry points in the workbook. */
export interface CellLocation {
  readonly sheet: string;
  /** 1-based row of the sheet. */
  readonly row: number;
  readonly key: string;
  readonly member: string;
  /** `ParsedColumn.id` (`scenario@C` for a scenario column). */
  readonly column: string;
  /** Scenario columns: the scenario of the column. */
  readonly scenarioId?: string;
}

export interface ValidationEntry {
  readonly code: ValidationCode;
  /** The schema.json validation rule behind the entry: VR04 for `out_of_range`, VR01.. for `cross_row`. */
  readonly rule?: RuleId;
  /** `error` blocks the cell or row (it is not applied); `warning` is reported only. */
  readonly severity: Severity;
  /** One line of cause and fix, for the delta report. */
  readonly message: string;
  /** The contract's CellKeys the entry is about (`g.target_net[]`, `org.dom_share[commercial_applications,vp_commercial]`). */
  readonly cells: readonly string[];
  /** The cells of the workbook the entry is about (cross-row rules: those the workbook sets). */
  readonly locations: readonly CellLocation[];
  /** A cross-row entry found in the state of this scenario (absent: the default layer). */
  readonly scenarioId?: string;
}

/** The values the importer starts from: the tenant's stored inputs before the workbook is applied. */
export interface CurrentValues {
  /** `variable_value` rows. */
  readonly defaults: readonly InputValueRow[];
  /** Each scenario's own `scenario_value` rows, by scenario id. */
  readonly scenarios?: Readonly<Record<string, readonly InputValueRow[]>>;
}

/**
 * What `validateParsed` needs besides the parsed workbook (the contract's `bundle`): the sheet definitions the
 * workbook was parsed with, the pinned model, the tenant's members and, optionally, the stored values.
 */
export interface ValidationBundle {
  /** `buildTemplate(...)`: column facts, row facts and dropdown lists. */
  readonly sheets: readonly SheetDef[];
  /** The pinned model: `variables` (cell variables, min/max) and `nodes` (override targets). */
  readonly model: Pick<ModelBundle, 'variables' | 'nodes'>;
  /** The tenant's dimension members (VR01 to VR03 sum over them). */
  readonly members: TenantMembers;
  /**
   * The stored values, so that a workbook with some sheets only is checked against the rest. Without it the
   * cross-row rules see only what the workbook carries.
   */
  readonly current?: CurrentValues;
}

// ----------------------------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------------------------

/** The rules that read several rows and that this step reuses from the domain. VR04 is checked per cell here. */
export const CROSS_ROW_RULES: ReadonlySet<RuleId> = new Set<RuleId>([
  'VR01',
  'VR02',
  'VR03',
  'VR06',
  'VR07',
]);

const KEY_SEPARATOR = '\u0001';
const DEFAULT_LAYER = '';
const OVERRIDE_KEY = 'node_key';
const OVERRIDE_VALUE = 'value';
/** Roles that are text copies of the row's facts: locked, compared with the template. */
const FACT_ROLES: ReadonlySet<ColumnRole> = new Set<ColumnRole>([
  'group',
  'label',
  'unit',
  'source',
  'confidence',
  'min',
  'max',
]);
/** Types whose cells hold whole numbers. */
const WHOLE_TYPES: ReadonlySet<ValueType | undefined> = new Set<ValueType | undefined>([
  'int',
  'bool',
  'enum',
]);
const PERCENT = 100;
const SIGNIFICANT_DIGITS = 6;

// ----------------------------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------------------------

const isOverrides = (def: SheetDef): boolean =>
  def.kind === 'table' && def.columns.some((c) => c.id === OVERRIDE_KEY);

const rowId = (key: string, member: string): string => `${key}${KEY_SEPARATOR}${member}`;

const asText = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim());

const number = (x: number): string => String(Number(x.toPrecision(SIGNIFICANT_DIGITS)));

/** A cell value for a message: text quoted, a share as a percent when the row's unit is `%`. */
function show(v: SnapshotValue, unit: string): string {
  if (v === null) return 'blank';
  if (typeof v === 'number') return unit === '%' ? `${number(v * PERCENT)}%` : number(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${v}'`;
}

function formatList(items: readonly string[], max = 6): string {
  const head = items.slice(0, max).join(', ');
  return items.length > max ? `${head} and ${items.length - max} more` : head;
}

/** How far past a bound float noise may go (as DOM-02's VR04). */
const slack = (bound: number): number => RULE_TOLERANCE * Math.max(1, Math.abs(bound));

interface Facts {
  readonly type?: ValueType;
  readonly min?: number | null;
  readonly max?: number | null;
  readonly listRef?: string;
  readonly unit?: string;
}

/** Is the cell of this row and column locked (not part of the sheet's editable cells)? */
function lockedCell(row: RowDef, col: ColumnDef): boolean {
  if (!col.editable) return true;
  if (row.cells !== undefined && !row.cells.includes(col.id)) return true;
  return col.perScenario && row.scenarioVaries === false;
}

// ----------------------------------------------------------------------------------------------
// validateParsed
// ----------------------------------------------------------------------------------------------

interface LayerCell {
  readonly layer: string;
  readonly varId: string;
  readonly memberKey: string;
  readonly value: number | null;
  readonly loc: CellLocation;
}

class Collector {
  readonly entries: ValidationEntry[] = [];
  readonly cells: LayerCell[] = [];
  readonly scenarioLabels = new Map<string, string>();
}

interface SheetContext {
  readonly def: SheetDef;
  readonly sheet: ParsedSheet;
  readonly colDefs: ReadonlyMap<string, ColumnDef>;
  readonly lists: ReadonlyMap<string, ListDef>;
  readonly vars: ReadonlyMap<string, { readonly dims: readonly string[] }>;
  readonly nodes: ReadonlySet<string>;
  readonly out: Collector;
}

/**
 * Validate a parsed workbook (import pipeline step 3).
 *
 * - `parsed`: `parseWorkbook(...)` of the upload.
 * - `bundle`: the sheet definitions, model, tenant members and (optionally) stored values.
 *
 * Returns every entry, per-cell ones first in sheet and row order, then the cross-row ones by layer. Empty when
 * the workbook is valid. Sheets or columns that the file lacks produce no entry (`parse.ts` reports them).
 */
export function validateParsed(
  parsed: ParsedWorkbook,
  bundle: ValidationBundle,
): ValidationEntry[] {
  const defs = new Map(bundle.sheets.map((d) => [d.name, d]));
  const lists = new Map(bundle.sheets.flatMap((d) => d.lists ?? []).map((l) => [l.id, l]));
  const vars = new Map(bundle.model.variables.map((v) => [v.id, v]));
  const nodes = new Set(bundle.model.nodes.map((n) => n.id));
  const out = new Collector();

  for (const sheet of parsed.sheets) {
    const def = defs.get(sheet.name);
    if (def === undefined) continue;
    const colDefs = new Map<string, ColumnDef>();
    for (const pc of sheet.columns) {
      const cd = def.columns.find((c) => c.id === pc.defId);
      if (cd !== undefined) colDefs.set(pc.id, cd);
    }
    validateSheet({ def, sheet, colDefs, lists, vars, nodes, out });
  }

  return [...out.entries, ...crossRow(bundle, out)];
}

// ----------------------------------------------------------------------------------------------
// Per-cell checks
// ----------------------------------------------------------------------------------------------

function validateSheet(sc: SheetContext): void {
  const { def, sheet, out } = sc;
  const overrides = isOverrides(def);
  const index = new Map(def.rows.map((r) => [rowId(r.key, r.member), r]));

  for (const row of sheet.rows) {
    let rowDef: RowDef | undefined;
    if (overrides) {
      if (!sc.nodes.has(row.key)) {
        out.entries.push(unknownKey(def, row, `node '${row.key}'`));
        continue;
      }
    } else if (!row.isNew) {
      rowDef = index.get(rowId(row.key, row.member));
      if (rowDef === undefined) {
        const known = def.rows.some((r) => r.key === row.key);
        out.entries.push(
          unknownKey(
            def,
            row,
            known && row.member !== row.key
              ? `member '${row.member}' of '${row.key}'`
              : `key '${row.key}'`,
          ),
        );
        continue;
      }
    }
    for (const pc of sheet.columns) {
      if (!(pc.id in row.cells)) continue;
      const col = sc.colDefs.get(pc.id);
      if (col === undefined) continue;
      checkCell(sc, row, rowDef, pc, col, row.cells[pc.id] ?? null, overrides);
    }
  }
}

function unknownKey(def: SheetDef, row: ParsedRow, what: string): ValidationEntry {
  return {
    code: 'unknown_key',
    severity: 'error',
    message: `${def.name} row ${row.rowNumber}: ${what} is not in the template; the row is ignored. Edit the exported rows, or add a line on Line_Items with a blank key.`,
    cells: [toCellKey(row.key, row.member === row.key ? '' : row.member)],
    locations: [
      { sheet: def.name, row: row.rowNumber, key: row.key, member: row.member, column: '' },
    ],
  };
}

/** The type, range and list facts that apply to one cell. */
function factsOf(row: RowDef | undefined, col: ColumnDef): Facts {
  const varId = col.varId ?? row?.varId;
  if (varId === undefined)
    return { ...(col.listRef === undefined ? {} : { listRef: col.listRef }) };
  const src = col.varId !== undefined || row === undefined ? col : row;
  return {
    ...(src.type === undefined ? {} : { type: src.type }),
    ...(src.min === undefined ? {} : { min: src.min }),
    ...(src.max === undefined ? {} : { max: src.max }),
    ...(src.listRef === undefined ? {} : { listRef: src.listRef }),
    ...(row === undefined ? {} : { unit: row.unit }),
  };
}

function checkCell(
  sc: SheetContext,
  row: ParsedRow,
  rowDef: RowDef | undefined,
  pc: ParsedColumn,
  col: ColumnDef,
  value: SnapshotValue,
  overrides: boolean,
): void {
  const { def, out } = sc;
  const loc: CellLocation = {
    sheet: def.name,
    row: row.rowNumber,
    key: row.key,
    member: row.member,
    column: pc.id,
    ...(pc.scenarioId === undefined ? {} : { scenarioId: pc.scenarioId }),
  };
  const subject = `${def.name} row ${row.rowNumber}, ${describeRow(row, rowDef)} (${pc.header})`;
  const push = (
    code: ValidationCode,
    severity: Severity,
    message: string,
    cells: readonly string[],
    rule?: RuleId,
  ): void => {
    out.entries.push({
      code,
      ...(rule === undefined ? {} : { rule }),
      severity,
      message: `${subject}: ${message}`,
      cells,
      locations: [loc],
    });
  };

  // Locked columns: copies of the template's facts. Nothing is applied from them; a change is only reported.
  if (FACT_ROLES.has(col.role)) {
    if (rowDef === undefined) return;
    const theirs = factText(rowDef, col.role);
    if (asText(value) !== theirs) {
      push(
        'locked_edit',
        'warning',
        `'${pc.header}' is locked and was changed to ${show(value, '')}; it stays ${theirs === '' ? 'blank' : `'${theirs}'`}, nothing is applied from it.`,
        [],
      );
    }
    return;
  }

  if (col.role === 'action') {
    const choices = (col.choices ?? []).filter((c) => c !== '');
    if (value !== null && !choices.some((c) => c === value)) {
      push(
        'not_in_list',
        'error',
        `${show(value, '')} is not an action; leave it blank or use ${formatList(choices.map((c) => `'${c}'`))}.`,
        [],
      );
    }
    return;
  }

  if (!VALUE_ROLES.has(col.role)) return;

  // Cells that the template locks for this row: no value may be typed there.
  if (rowDef !== undefined && lockedCell(rowDef, col)) {
    if (value !== null) {
      push(
        'locked_edit',
        'error',
        `this cell is locked (${rowDef.scenarioVaries === false && col.perScenario ? 'the input does not vary by scenario' : 'it holds no value'}); ${show(value, rowDef.unit)} is not applied. Edit the Default column instead.`,
        [],
      );
    }
    return;
  }

  const varId = col.varId ?? rowDef?.varId;
  const cellKey = cellKeyOf(sc, rowDef, col, varId, row);
  const facts = factsOf(rowDef, col);
  const unit = facts.unit ?? '';

  if (value === null) {
    recordCell(sc, loc, pc, varId, cellKey, null);
    return;
  }

  // Dropdowns: the value must be one of the list's codes.
  const list = facts.listRef === undefined ? undefined : sc.lists.get(facts.listRef);
  if (list !== undefined) {
    if (!list.entries.some((e) => String(e.code) === String(value))) {
      const choices = list.entries.slice(0, 6).map((e) => `${e.label}`);
      push(
        'not_in_list',
        'error',
        `${show(value, unit)} is not one of the choices (${formatList(choices)}${list.entries.length > 6 ? ', ...' : ''}); pick one from the dropdown.`,
        cellKey === undefined ? [] : [cellKey],
      );
      return;
    }
    recordCell(sc, loc, pc, varId, cellKey, typeof value === 'number' ? value : null);
    return;
  }

  // Numbers.
  const numeric = (overrides && col.id === OVERRIDE_VALUE) || varId !== undefined;
  if (!numeric) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    push(
      'type',
      'error',
      `${show(value, unit)} is not a number; enter a value such as 12.5${unit === '%' ? ' or 35%' : ''}.`,
      cellKey === undefined ? [] : [cellKey],
    );
    return;
  }
  if (WHOLE_TYPES.has(facts.type) && !Number.isInteger(value)) {
    push(
      'type',
      'error',
      `${show(value, unit)} is not a whole number; enter a whole number.`,
      cellKey === undefined ? [] : [cellKey],
    );
    return;
  }
  recordCell(sc, loc, pc, varId, cellKey, value);

  const { min = null, max = null } = facts;
  const below = min !== null && value < min - slack(min);
  const above = max !== null && value > max + slack(max);
  if (below || above) {
    const range =
      min !== null && max !== null
        ? `keep it within ${show(min, unit)} to ${show(max, unit)}`
        : below
          ? `keep it at ${show(min, unit)} or more`
          : `keep it at ${show(max, unit)} or less`;
    push(
      'out_of_range',
      VALIDATION_RULES.VR04.severity,
      `${show(value, unit)} is ${below ? `below the minimum ${show(min, unit)}` : `above the maximum ${show(max, unit)}`}; ${range}.`,
      cellKey === undefined ? [] : [cellKey],
      'VR04',
    );
  }
}

/** The template's text of a locked fact column of a row (`min` and `max` as numbers). */
function factText(row: RowDef, role: ColumnRole): string {
  switch (role) {
    case 'group':
      return asText(row.group);
    case 'label':
      return asText(row.label);
    case 'unit':
      return asText(row.unit);
    case 'source':
      return asText(row.source);
    case 'confidence':
      return asText(row.confidence);
    case 'min':
      return asText(row.min);
    default:
      return asText(row.max);
  }
}

function describeRow(row: ParsedRow, rowDef: RowDef | undefined): string {
  const label = rowDef?.label !== undefined && rowDef.label !== '' ? rowDef.label : row.key;
  const member =
    row.member !== '' && row.member !== row.key && rowDef?.varId !== undefined
      ? ` [${row.member}]`
      : '';
  return `'${label === '' ? 'new row' : label}'${member}`;
}

/** The contract CellKey of a cell: `varId[member_key]`; a Line_Items attribute is `line[it_001]`. */
function cellKeyOf(
  sc: SheetContext,
  row: RowDef | undefined,
  col: ColumnDef,
  varId: string | undefined,
  parsed: ParsedRow,
): string | undefined {
  if (row === undefined) return undefined;
  if (varId === undefined) {
    const line = Object.entries(row.bind)[0];
    return line === undefined ? toCellKey(parsed.key) : toCellKey(line[0], line[1]);
  }
  const def = sc.vars.get(varId);
  if (def === undefined) return undefined;
  try {
    return toCellKey(varId, memberKey(def, { ...row.bind, ...col.bind }));
  } catch {
    return undefined;
  }
}

/** Remember a valid cell with a variable: the cross-row rules read it. */
function recordCell(
  sc: SheetContext,
  loc: CellLocation,
  pc: ParsedColumn,
  varId: string | undefined,
  cellKey: string | undefined,
  value: number | null,
): void {
  if (varId === undefined || cellKey === undefined) return;
  const open = cellKey.indexOf('[');
  const layer =
    pc.scenarioId ?? (pc.scenarioLabel === undefined ? DEFAULT_LAYER : scenarioOfColumn(pc));
  if (layer !== DEFAULT_LAYER && pc.scenarioLabel !== undefined) {
    sc.out.scenarioLabels.set(layer, pc.scenarioLabel);
  }
  sc.out.cells.push({ layer, varId, memberKey: cellKey.slice(open + 1, -1), value, loc });
}

/** A scenario column of a foreign workbook has no scenario id: its column id (`scenario@Label`) names the layer. */
const scenarioOfColumn = (pc: ParsedColumn): string =>
  pc.id.startsWith(`${pc.defId}@`) ? pc.id.slice(pc.defId.length + 1) : pc.id;

// ----------------------------------------------------------------------------------------------
// Cross-row rules (DOM-02)
// ----------------------------------------------------------------------------------------------

const cellId = (varId: string, mk: string): string => `${varId}${KEY_SEPARATOR}${mk}`;

function crossRow(bundle: ValidationBundle, out: Collector): ValidationEntry[] {
  const byLayer = new Map<string, LayerCell[]>();
  for (const c of out.cells) byLayer.set(c.layer, [...(byLayer.get(c.layer) ?? []), c]);
  if (byLayer.size === 0) return [];

  // The stored state, then the workbook's default cells on top (a blank cell leaves the stored value).
  const defaults = new Map<string, InputValueRow>();
  for (const r of bundle.current?.defaults ?? []) defaults.set(cellId(r.var_key, r.member_key), r);
  for (const c of byLayer.get(DEFAULT_LAYER) ?? [])
    if (c.value !== null)
      defaults.set(cellId(c.varId, c.memberKey), {
        var_key: c.varId,
        member_key: c.memberKey,
        value: c.value,
      });

  const entries: ValidationEntry[] = [];
  const run = (layer: string, values: Map<string, InputValueRow>): void => {
    const cells = byLayer.get(layer) ?? [];
    const touched = new Map<string, CellLocation[]>();
    for (const c of cells) {
      const key = toCellKey(c.varId, c.memberKey);
      touched.set(key, [...(touched.get(key) ?? []), c.loc]);
    }
    const setCells = new Set(
      cells.filter((c) => c.value !== null).map((c) => toCellKey(c.varId, c.memberKey)),
    );
    if (setCells.size === 0) return;
    const found = validateInputs({
      bundle: bundle.model,
      members: bundle.members,
      values: [...values.values()],
    });
    for (const e of found) {
      if (!CROSS_ROW_RULES.has(e.rule) || !e.cells.some((c) => setCells.has(c))) continue;
      const label = layer === DEFAULT_LAYER ? undefined : (out.scenarioLabels.get(layer) ?? layer);
      entries.push({
        code: 'cross_row',
        rule: e.rule,
        severity: e.severity,
        message: label === undefined ? e.message : `${e.message} (scenario ${label})`,
        cells: e.cells,
        locations: e.cells.flatMap((c) => touched.get(c) ?? []),
        ...(layer === DEFAULT_LAYER ? {} : { scenarioId: layer }),
      });
    }
  };

  run(DEFAULT_LAYER, defaults);
  for (const layer of byLayer.keys()) {
    if (layer === DEFAULT_LAYER) continue;
    // A scenario's resolved state: defaults, then its own values; a blank cell drops the scenario's own value.
    const own = new Map<string, InputValueRow>();
    for (const r of bundle.current?.scenarios?.[layer] ?? [])
      own.set(cellId(r.var_key, r.member_key), r);
    for (const c of byLayer.get(layer) ?? []) {
      const id = cellId(c.varId, c.memberKey);
      if (c.value === null) own.delete(id);
      else own.set(id, { var_key: c.varId, member_key: c.memberKey, value: c.value });
    }
    run(layer, new Map([...defaults, ...own]));
  }
  return entries;
}
