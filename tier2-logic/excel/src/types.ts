import type { AttrValue, DimId, MemberId, VarId } from '@glidepath/spec';

/**
 * Sheet definitions: what `buildTemplate()` returns and `build.ts`, `parse.ts` and `validate.ts` read.
 * They describe structure only (columns, rows, validation lists). Values come later from the resolved
 * scenario inputs, so nothing here depends on a scenario or on a stored value.
 */

/** Layout families of `excel_template.json` (`sheets[].kind`), plus the three that have no kind. */
export type SheetKind =
  | 'readme'
  | 'scalar_inputs'
  | 'member_inputs'
  | 'matrix'
  | 'table'
  | 'year_matrix'
  | 'snapshot'
  | 'lists'
  | 'meta';

/**
 * What a column holds. The scalar-input roles follow the headers of `scalar_inputs_columns`;
 * the others belong to the matrix, table and system sheets.
 */
export type ColumnRole =
  | 'key'
  | 'member'
  | 'group'
  | 'label'
  | 'unit'
  | 'min'
  | 'max'
  | 'default'
  | 'scenario'
  | 'source'
  | 'confidence'
  | 'note'
  | 'hash'
  /** Single value of a row that has no year or VP cells (Corporate, Org_Map). */
  | 'value'
  /** One member of the year dimension (Corporate). */
  | 'year'
  /** One member of the matrix column dimension (Org_Map: one per VP). */
  | 'matrix_col'
  /** One block of a per-scenario matrix (Lever_Timing: lev.start, lev.ramp, lev.conf, lev.on). */
  | 'block'
  /** Row check of a matrix, e.g. `sum = 100%`. */
  | 'check'
  /** A column of a table sheet (Line_Items, Overrides). */
  | 'field'
  /** `DELETE` marker column of a table sheet. */
  | 'action'
  /** Plain text (README, _meta). */
  | 'text'
  /** Code or label column of a validation list on `_lists`. */
  | 'list_code'
  | 'list_label';

export interface ColumnDef {
  /** Stable id of the column inside its sheet (never shown). */
  readonly id: string;
  /** Header text. The importer finds columns by this text. For per-scenario columns this is a template; `build.ts` writes the scenario label. */
  readonly header: string;
  readonly role: ColumnRole;
  /** Cells are protected. True for every column that users do not edit. */
  readonly locked: boolean;
  /** Users edit the cells of this column (yellow). */
  readonly editable: boolean;
  /** `key`, `member` and `_hash` columns are hidden (docs/architecture/05 section 3). */
  readonly hidden: boolean;
  /** One column per exported scenario: `build.ts` repeats this column for each. */
  readonly perScenario: boolean;
  /** Template text: what a blank cell means, e.g. `inherit default`. */
  readonly blankMeans?: string;
  /** Where the cell is stored: `variable_value`, `scenario_value`, `variable_value.note`. */
  readonly mapsTo?: string;
  /** Variable whose value the column holds (cell column of a matrix, Line_Items numeric column). */
  readonly varId?: VarId;
  /** Member attribute the column reads and writes (Line_Items). */
  readonly attr?: string;
  /** Dimension members this column binds (Org_Map: `{ vp }`, Corporate: `{ iyear }`). */
  readonly bind?: Readonly<Record<DimId, MemberId>>;
  /** Validation list that offers the column's values, when it has one. */
  readonly listRef?: string;
  /** Fixed choices, when the column is a dropdown without a validation list (action column). */
  readonly choices?: readonly string[];
  readonly width?: number;
  readonly note?: string;
}

export type ValueType = 'number' | 'int' | 'bool' | 'enum';

/**
 * One row of a sheet. For input rows `varId` and `bind` name the cell (`memberKey(def, bind)` gives its member
 * key); matrix cells add the column's `bind`.
 */
export interface RowDef {
  /** Unique within the sheet. */
  readonly id: string;
  /** Text of the hidden `key` column: the variable id, node id or row key. */
  readonly key: string;
  /** Text of the hidden `member` column: the row's own member ids, comma-joined in the variable's dims order. */
  readonly member: string;
  readonly varId?: VarId;
  readonly bind: Readonly<Record<DimId, MemberId>>;
  readonly group: string;
  readonly label: string;
  readonly unit: string;
  readonly type?: ValueType;
  readonly min?: number | null;
  readonly max?: number | null;
  /** Excel number format from `cell_rules.number_formats`, when the unit has one. */
  readonly numberFormat?: string;
  readonly source?: string;
  readonly confidence?: string;
  /** False: scenario cells of this row are locked (the variable does not vary by scenario). */
  readonly scenarioVaries?: boolean;
  /** Validation list for enum and bool rows. */
  readonly listRef?: string;
  /** Matrix and year rows: ids of the columns that carry a value for this row. */
  readonly cells?: readonly string[];
  /** Matrix rows that take part in the row check. */
  readonly checked?: boolean;
  /** Line_Items: member attributes of the baseline line. */
  readonly attrs?: Readonly<Record<string, AttrValue | undefined>>;
}

export interface ListEntry {
  readonly code: string | number;
  readonly label: string;
}

/** One validation list on `_lists`. */
export interface ListDef {
  readonly id: string;
  readonly entries: readonly ListEntry[];
}

export interface SheetDef {
  readonly name: string;
  readonly kind: SheetKind;
  readonly hidden: boolean;
  readonly protected: boolean;
  /** Users edit values on this sheet (false for README, Outputs, `_lists`, `_meta`). */
  readonly editable: boolean;
  readonly columns: readonly ColumnDef[];
  readonly rows: readonly RowDef[];
  /** README and `_meta`: text from the template. */
  readonly text?: readonly string[];
  /** `_meta` (and the README lines that `build.ts` fills in): field names from the template. */
  readonly fields?: readonly string[];
  /** `_lists`: all validation lists. */
  readonly lists?: readonly ListDef[];
  /** Matrix sheets with a row check: its column id and the template's rule text. */
  readonly rowCheck?: { readonly column: string; readonly rule: string };
  /** Table sheets with a row action column. */
  readonly rowActions?: {
    readonly column: string;
    readonly values: readonly string[];
    readonly newRows: string;
  };
  /** Matrix sheets: the dimension of the rows and, when the columns are members of one, of the matrix columns. */
  readonly matrix?: { readonly rows: DimId; readonly cols?: DimId };
  /** Template note for the sheet. */
  readonly note?: string;
}
