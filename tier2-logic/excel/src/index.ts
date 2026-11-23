export const packageName = '@glidepath/excel';

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
