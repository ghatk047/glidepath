import type { JsonValue } from '@glidepath/domain';
import type { DeltaImpact, DeltaReport, ExportSnapshot, ReportItem, UnmatchedDiff } from '@glidepath/excel';
import type { JobContext, JobPayload } from '../../runtime';

/** Queue names of the Excel handlers (JOB-01: `excel.*`). */
export const QUEUE_EXPORT = 'excel.export';
export const QUEUE_IMPORT = 'excel.import';
export const QUEUE_APPLY = 'excel.apply';

/** What the handlers use of the runtime's JobContext (tests pass a plain object). */
export type ExcelJobContext = Pick<JobContext, 'tenantId' | 'userId' | 'withTenant' | 'progress' | 'signal'>;

export interface ExportPayload extends JobPayload {
  /** `export_job.id`; the API route creates the id so it can answer before the job runs. Default: a new uuid. */
  readonly exportJobId?: string;
  /** Scenario uuids, in column order. */
  readonly scenarioIds: readonly string[];
  /** Sheet names to export; absent = every sheet. README, `_lists` and `_meta` are always added. */
  readonly sheets?: readonly string[];
  /** Only `xlsx` is built here. */
  readonly format?: 'xlsx' | 'csv';
}

export interface ImportPayload extends JobPayload {
  /** The `import_job` row the upload route created; its `file_uri` names the stored upload. */
  readonly importJobId: string;
}

export interface ApplyDecisionPayload {
  readonly sheet: string;
  readonly key: string;
  readonly member: string;
  readonly scenario: string | null;
  readonly take: 'excel' | 'app';
  readonly column?: string | null;
  readonly rowNumber?: number | null;
}

export interface ApplyPayload extends JobPayload {
  readonly importJobId: string;
  readonly accept: 'all' | 'selected';
  readonly decisions: readonly ApplyDecisionPayload[];
  readonly clientRequestId?: string;
}

/** What is kept of an export beside the workbook: `export_job.snapshot` and `export-snapshots/<id>.json`. */
export interface StoredExportSnapshot {
  readonly snapshot: ExportSnapshot;
  /** The exported scenarios, in column order: `id` is the scenario uuid, `key` the id used in the columns. */
  readonly scenarios: readonly { readonly id: string; readonly key: string; readonly label: string }[];
  /** Sheets the export carries (input sheets only, in template order). */
  readonly sheets: readonly string[];
  readonly fileUri: string;
  readonly fileName: string;
}

/** Result of `excel.export` (the contract's ExportResult, in storage terms). */
export interface ExportJobResult {
  readonly id: string;
  readonly templateVersion: string;
  readonly scenarioIds: readonly string[];
  readonly sheets: readonly string[];
  readonly fileUri: string;
  readonly snapshotUri: string;
  readonly fileName: string;
  readonly checksum: string;
  readonly size: number;
}

/** A scenario a delta report touches, with the version the preview was made at. */
export interface LayerVersion {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly version: number;
}

/** The impact preview of one scenario: engine `rerun` before -> after on the hero outputs. */
export type ScenarioImpact = DeltaImpact;

/** What `excel.apply` did, kept on the import job. */
export interface AppliedImport {
  readonly changesetIds: readonly string[];
  readonly scenarios: readonly {
    readonly scenarioId: string | null;
    readonly changesetId: string;
    readonly version: number;
    readonly editsCount: number;
    readonly forkedFrom?: string;
  }[];
  readonly editsCount: number;
  readonly warnings: readonly JsonValue[];
  /** Indexes into `report.changes` that were applied / skipped (with the reason). */
  readonly applied: readonly number[];
  readonly skipped: readonly { readonly index: number; readonly reason: string }[];
}

/**
 * What `import_job.report` holds. `report` is the contract's DeltaReport (strict); the rest is what
 * apply needs (`items`, the versions the preview was made at) and what the screen shows besides it.
 */
export interface StoredImportReport {
  readonly report: DeltaReport;
  /** `built.items`: toChangeset needs them. */
  readonly items: readonly ReportItem[];
  readonly unmatched: readonly UnmatchedDiff[];
  readonly warnings: readonly JsonValue[];
  /** One impact preview per affected scenario; `report.impact` is the first of them. */
  readonly impacts: readonly ScenarioImpact[];
  /** Why a part of the impact preview is missing (structural changes are not previewed). */
  readonly impactNotes: readonly string[];
  /** Versions at preview time: apply is version-checked against these. `defaultsVersion` = tenant default changeset count. */
  readonly base: {
    readonly defaultsVersion: number;
    /** By the report's scenario key (`C`, or the column label in a foreign workbook). */
    readonly scenarios: Readonly<Record<string, LayerVersion>>;
  };
  /** Sheets and columns not read: unknown ones are reported and ignored. */
  readonly ignored: {
    readonly sheets: readonly string[];
    readonly columns: readonly { readonly sheet: string; readonly header: string }[];
  };
  /** Validation entries as `validate.ts` returns them (cross-row rules VR01-VR10 among them). */
  readonly violations: readonly JsonValue[];
  readonly filename: string | null;
  readonly applied?: AppliedImport;
  readonly error?: { readonly code: string; readonly message: string };
}
