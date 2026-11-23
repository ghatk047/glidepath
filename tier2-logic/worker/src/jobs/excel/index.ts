/**
 * Excel jobs (XL-08): `excel.export`, `excel.import`, `excel.apply`. Importing this module registers
 * the three handlers; tests import the `run*` functions instead and pass their own dependencies.
 */
import './register';

export { runExport } from './export';
export { runImport } from './import';
export type { ImportJobResult } from './import';
export { runApply, undoImport, newKeyGenerator } from './apply';
export type { ApplyJobResult } from './apply';
export { defaultExcelDeps, CompiledModelCache, findSpecDir, DEFAULT_IMPACT_NODES, DEFAULT_MAX_IMPACT_SCENARIOS } from './deps';
export type { ExcelJobDeps, DefaultDepsOptions } from './deps';
export { previewImpact, applyDraftsToState } from './impact';
export { ExcelJobError } from './state';
export { fromUri, toUri, exportKey, snapshotKey } from './storage';
export { QUEUE_APPLY, QUEUE_EXPORT, QUEUE_IMPORT } from './types';
export type {
  AppliedImport,
  ApplyDecisionPayload,
  ApplyPayload,
  ExcelJobContext,
  ExportJobResult,
  ExportPayload,
  ImportPayload,
  LayerVersion,
  ScenarioImpact,
  StoredExportSnapshot,
  StoredImportReport,
} from './types';
