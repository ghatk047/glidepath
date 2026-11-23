export const packageName = '@glidepath/excel';

export {
  BuildError,
  CHECK_FAIL_FILL,
  DEFAULT_FILE_NAME_PATTERN,
  EDITABLE_FILL,
  HEADER_FILL,
  NEW_ROW_SLOTS,
  buildWorkbook,
  columnHeader,
  excelNumberFormat,
  exportFileName,
  hashRow,
  rowKey,
  scenarioColumnId,
  snapshotKey,
  writeWorkbook,
} from './build';
export type {
  BuiltWorkbook,
  ExportMeta,
  ExportScenario,
  ExportSnapshot,
  ExportValues,
  NoteRow,
  OutputValue,
  SnapshotValue,
} from './build';

// Pure: no IO. The caller passes in the template, bundle and members (loaded with @glidepath/spec).
export {
  LIST_BOOL,
  LIST_SCALE_DRIVERS,
  TemplateError,
  buildTemplate,
  cellRef,
  enumListId,
  placeVariables,
} from './template';
export type { TemplateSheet } from './template';
export type {
  ColumnDef,
  ColumnRole,
  ListDef,
  ListEntry,
  RowDef,
  SheetDef,
  SheetKind,
  ValueType,
} from './types';

export {
  ParseError,
  identifyWorkbook,
  parseLoadedWorkbook,
  parseNumberText,
  parseWorkbook,
} from './parse';
export type {
  Identity,
  ImportMode,
  ParseIssue,
  ParseIssueCode,
  ParseIssueSeverity,
  ParseOptions,
  ParsedColumn,
  ParsedMeta,
  ParsedRow,
  ParsedSheet,
  ParsedWorkbook,
  UnknownColumn,
} from './parse';

export { CROSS_ROW_RULES, validateParsed } from './validate';
export type {
  CellLocation,
  CurrentValues,
  ValidationBundle,
  ValidationCode,
  ValidationEntry,
} from './validate';
export {
  DiffError,
  EXPORT_PRECISION_DIGITS,
  cellStatus,
  diff,
  sameValue,
  toDeltaEntry,
  toDiffValue,
} from './diff';
export type {
  CellDiff,
  CellStatus,
  CellTarget,
  CurrentSnapshot,
  DeltaEntry,
  DeltaEntryStatus,
  DiffMode,
  DiffOptions,
  DiffResult,
  DiffValue,
  RowDiff,
  RowStatus,
  UnmatchedDiff,
  UnmatchedReason,
} from './diff';
