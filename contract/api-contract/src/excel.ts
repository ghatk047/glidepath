import { z } from 'zod';
import {
  ChangesetId,
  ClientRequestId,
  ExportId,
  FileId,
  JobId,
  MemberKey,
  OneLine,
  ScenarioId,
  TenantSlug,
  Timestamp,
  UserId,
} from './ids';
import { Problem, Violation } from './problem';
import { ChangesetResult } from './changeset';
import { JobProgressFraction } from './ws';

/**
 * Excel export / import (CON-03, `docs/spec/05_excel_template.md`, `excel_template.json`) and
 * file downloads. Files never leave tier 2 as URLs: an export answers a `FileRef` and tier 1
 * downloads the bytes with `GET /api/t/:tenant/files/:id` (04 §5, ADR-025).
 */

/** Sheet names, verbatim from `excel_template.json` `sheets[].name`. */
export const ExcelSheet = z.enum([
  'README',
  'Targets',
  'Workforce',
  'Pools',
  'Levers',
  'Lever_Timing',
  'Org_Map',
  'Line_Items',
  'Corporate',
  'Overrides',
  'Outputs',
  '_lists',
  '_meta',
]);
export type ExcelSheet = z.infer<typeof ExcelSheet>;

/** Workbook (`xlsx`) or one sheet as CSV (05 §4: same keys, same import path). */
export const ExportFormat = z.enum(['xlsx', 'csv']);
export type ExportFormat = z.infer<typeof ExportFormat>;

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** A file tier 2 holds for the tenant. Download: `GET /api/t/:tenant/files/:id`. */
export const FileRef = z.object({
  id: FileId,
  /** Download name, e.g. per `excel_template.json` `file.name_pattern`. */
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().nonnegative(),
  /** When tier 2 drops the file (exports: 30-day lifecycle); `null` = kept. */
  expiresAt: Timestamp.nullable(),
});
export type FileRef = z.infer<typeof FileRef>;

export const FileParams = z.object({ tenant: TenantSlug, id: FileId });

/** Raw bytes on the wire (not JSON): a download body or an upload body. */
export const Bytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array, {
  message: 'expected bytes (Uint8Array)',
});

/**
 * `GET /api/t/:tenant/files/:id` is a byte stream: the body is the file itself with its
 * `content-type` and `content-disposition: attachment; filename="…"`. The typed client and
 * `assertContract` hand it back as this object (never as JSON on the wire).
 */
export const FileDownload = z.object({
  bytes: Bytes,
  contentType: z.string().min(1),
  /** From `content-disposition`; `null` if the header names none. */
  filename: z.string().min(1).nullable(),
  size: z.number().int().nonnegative(),
});
export type FileDownload = z.infer<typeof FileDownload>;

// ---------------------------------------------------------------------------
// POST /api/t/:tenant/exports
// ---------------------------------------------------------------------------

/**
 * Export scenarios to a workbook. `sheets` absent = every sheet; tier 2 always adds README,
 * `_lists` and `_meta`. `csv` exports exactly one sheet.
 */
export const ExportRequest = z
  .object({
    scenarioIds: z.array(ScenarioId).min(1),
    sheets: z.array(ExcelSheet).min(1).optional(),
    format: ExportFormat.optional(),
  })
  .refine((r) => r.format !== 'csv' || r.sheets?.length === 1, {
    message: 'a csv export names exactly one sheet',
    path: ['sheets'],
  });
export type ExportRequest = z.infer<typeof ExportRequest>;

/** The export (`export_job`): its server-side snapshot is kept for the 3-way diff. */
export const ExportResult = z.object({
  id: ExportId,
  templateVersion: z.string().min(1),
  format: ExportFormat,
  scenarioIds: z.array(ScenarioId).min(1),
  sheets: z.array(ExcelSheet).min(1),
  file: FileRef,
  checksum: z.string().min(1),
  createdBy: UserId.nullable(),
  createdAt: Timestamp,
});
export type ExportResult = z.infer<typeof ExportResult>;

// ---------------------------------------------------------------------------
// Delta report: excel_template.json `delta_report_schema`, field for field
// ---------------------------------------------------------------------------

/** `delta_report_schema.mode`. */
export const DeltaMode = z.enum(['three_way', 'foreign']);
export type DeltaMode = z.infer<typeof DeltaMode>;

/**
 * Status of one cell or row (05 §3 step 4): the diff statuses, `invalid`, and the row
 * statuses (blank key = new, `DELETE` = deleted, row missing from the sheet = warning only).
 * `summary` counts them; `already_applied` and `missing_row` are counted as `ignored`.
 */
export const DeltaStatus = z.enum([
  'unchanged',
  'changed_in_excel',
  'changed_in_app',
  'conflict',
  'already_applied',
  'invalid',
  'new_row',
  'deleted_row',
  'missing_row',
]);
export type DeltaStatus = z.infer<typeof DeltaStatus>;

/** A normalised cell value (05: `$M`, decimals for %, booleans 0/1, enum codes); `null` = blank. */
export const DeltaValue = z.union([z.number(), z.string()]).nullable();

const Count = z.number().int().nonnegative();

export const DeltaSummary = z.strictObject({
  unchanged: Count,
  changed_in_excel: Count,
  changed_in_app: Count,
  conflict: Count,
  invalid: Count,
  new_rows: Count,
  deleted_rows: Count,
  ignored: Count,
});
export type DeltaSummary = z.infer<typeof DeltaSummary>;

/** One row of `changes`: export (E), workbook (W) and current database (D) values. */
export const DeltaChange = z.strictObject({
  sheet: ExcelSheet,
  /** `var_key` or row key; `''` for a new row until tier 2 assigns one. */
  key: z.string(),
  member: MemberKey,
  /** Scenario key of the value column (`C`); `null` for the Default column. */
  scenario: z.string().min(1).nullable(),
  /** `null` in foreign mode (no export snapshot) and for blank cells. */
  export: DeltaValue,
  workbook: DeltaValue,
  current: DeltaValue,
  status: DeltaStatus,
  messages: z.array(z.string()),
});
export type DeltaChange = z.infer<typeof DeltaChange>;

/**
 * Impact preview: `scenario` key plus, per hero node id (`res.net`, `res.gap`, `br.eps27` …),
 * `[before, after]` as recomputed by tier 2.
 */
export const DeltaImpact = z
  .object({ scenario: z.string().min(1) })
  .catchall(z.union([z.string(), z.tuple([z.number(), z.number()])]))
  .superRefine((impact, ctx) => {
    for (const [key, value] of Object.entries(impact)) {
      if (key !== 'scenario' && !Array.isArray(value)) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'expected [before, after]' });
      }
    }
  });
export type DeltaImpact = z.infer<typeof DeltaImpact>;

/**
 * `excel_template.json` `delta_report_schema` (stored as `import_job.report`). Keys are the
 * spec's, verbatim (snake_case), not camelCased: it is a spec document, not an API envelope.
 */
export const DeltaReport = z.strictObject({
  import_job_id: JobId,
  export_job_id: ExportId.nullable(),
  mode: DeltaMode,
  summary: DeltaSummary,
  changes: z.array(DeltaChange),
  impact: DeltaImpact,
});
export type DeltaReport = z.infer<typeof DeltaReport>;

// ---------------------------------------------------------------------------
// Imports: POST (upload), GET :id, POST :id/apply
// ---------------------------------------------------------------------------

/** `import_job.status`, verbatim from `docs/spec/schema.json`. */
export const ImportStatus = z.enum(['parsed', 'validated', 'awaiting_review', 'applied', 'failed']);
export type ImportStatus = z.infer<typeof ImportStatus>;

/**
 * `POST /api/t/:tenant/imports` is a raw upload: the body is the workbook (or CSV) bytes,
 * `content-type: application/octet-stream`, and the query names the file.
 */
export const ImportUploadQuery = z.object({ filename: z.string().trim().min(1) });
export type ImportUploadQuery = z.infer<typeof ImportUploadQuery>;

export const ImportParams = z.object({ tenant: TenantSlug, id: JobId });

/**
 * The import preview job. `status` is `null` while the job is queued or parsing (`progress`
 * and `progressNote` as on `solver_run`, DATA-11); `report` is set from `awaiting_review` on.
 * `violations` are the cross-row rule results (VR01–VR10); unknown sheets and columns are
 * reported in `ignored`, never read.
 */
export const ImportJob = z.object({
  id: JobId,
  filename: z.string().min(1),
  exportId: ExportId.nullable(),
  status: ImportStatus.nullable(),
  progress: JobProgressFraction,
  progressNote: OneLine.nullable(),
  report: DeltaReport.nullable(),
  violations: z.array(Violation),
  ignored: z.object({
    sheets: z.array(z.string()),
    columns: z.array(z.object({ sheet: z.string(), header: z.string() })),
  }),
  changesetId: ChangesetId.nullable(),
  error: Problem.nullable(),
  createdBy: UserId.nullable(),
  createdAt: Timestamp,
});
export type ImportJob = z.infer<typeof ImportJob>;

/** A per-row decision: take the workbook value (`excel`) or keep the database value (`app`). */
export const ImportDecision = z.object({
  sheet: ExcelSheet,
  key: z.string(),
  member: MemberKey,
  scenario: z.string().min(1).nullable(),
  take: z.enum(['excel', 'app']),
});
export type ImportDecision = z.infer<typeof ImportDecision>;

/**
 * Apply accepted rows as one changeset (origin `excel_import`). `all`: every row with a default
 * action of apply (05 §3), with `decisions` overriding rows; `selected`: only rows decided
 * `excel`. Every `conflict` row needs a decision (else 422).
 */
export const ImportApplyRequest = z.object({
  accept: z.enum(['all', 'selected']),
  decisions: z.array(ImportDecision),
  clientRequestId: ClientRequestId.optional(),
});
export type ImportApplyRequest = z.infer<typeof ImportApplyRequest>;

/** The applied changeset and the version each touched scenario reached. */
export const ImportApplyResult = z.object({
  importId: JobId,
  changesetId: ChangesetId,
  editsCount: z.number().int().nonnegative(),
  scenarios: z.array(
    ChangesetResult.pick({ scenarioId: true, version: true, editsCount: true, forkedFrom: true }),
  ),
  warnings: z.array(Violation),
});
export type ImportApplyResult = z.infer<typeof ImportApplyResult>;
