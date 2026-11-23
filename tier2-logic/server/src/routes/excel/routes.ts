import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  DeltaReport,
  ExcelSheet,
  ExportRequest,
  ExportResult,
  FileParams,
  ImportApplyRequest,
  ImportApplyResult,
  ImportJob,
  ImportParams,
  ImportUploadQuery,
  Problem,
  TenantParams,
  Violation,
} from '@glidepath/api-contract';
import { BUCKETS, createImportJob, getExportJob, getImportJob, listScenarios } from '@glidepath/data-access';
import type { Bucket, ImportJobRecord, ObjectMeta } from '@glidepath/data-access';
import type { Context, Hono } from 'hono';
import { ApiError } from '../../app/problem';
import type { AppEnv } from '../../app/tenant';
import { checked } from '../read/mappers';
import { guarded, toViolation } from '../write/errors';
import { afterCommit } from '../write/hub';
import type { ExcelRoutesDeps, ExcelWho } from './jobs';
import { importMaxBytes } from './limits';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ALWAYS_PRESENT = new Set<string>(['README', '_lists', '_meta']);

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const whoOf = (c: Context<AppEnv>): ExcelWho => ({ tenantId: c.get('tenant').tenantId, userId: c.get('tenant').userId });

// ----------------------------------------------------------------------------- errors

/** Worker-tier error codes (`ExcelJobError.code`) that are not a plain 422. */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  import_not_found: 404,
  scenario_not_found: 404,
  tenant_not_found: 404,
  file_not_found: 404,
  not_reviewable: 409,
};

/**
 * The jobs' own errors as problems. They are recognised by name, not class: the server does not import the worker
 * or the excel package. `ExcelJobError` (code + a message the user can act on), `ToChangesetError` (a conflict
 * without a decision, ...) and `ParseError` (not a workbook) are the caller's to fix: 404, 409 or 422.
 */
function mapJobError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  if (err.name === 'ExcelJobError') {
    const status = STATUS_BY_CODE[(err as { code?: string }).code ?? ''] ?? 422;
    return new ApiError({ status, title: status === 404 ? 'Not found' : status === 409 ? 'Conflict' : 'Validation failed', detail: oneLine(err.message), });
  }
  if (err.name === 'ToChangesetError' || err.name === 'ParseError') {
    return new ApiError({ status: 422, title: 'Validation failed', detail: oneLine(err.message) });
  }
  return err;
}

/** `guarded` (409 version conflict, domain errors) after the job errors have been mapped. */
const run = (c: Context<AppEnv>, fn: () => Promise<Response>): Promise<Response> =>
  guarded(c, async () => {
    try {
      return await fn();
    } catch (err) {
      throw mapJobError(err);
    }
  });

// ----------------------------------------------------------------------------- helpers

type Uploaded = { readonly bytes: Uint8Array } | { readonly tooLarge: true };

/** The request body, refused as soon as it passes `limit` bytes (the declared length is checked first). */
async function readCapped(c: Context<AppEnv>, limit: number): Promise<Uploaded> {
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > limit) return { tooLarge: true };
  const body = c.req.raw.body;
  if (body === null) return { bytes: new Uint8Array(0) };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of chunks) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  return { bytes };
}

/** A file name that is safe as the tail of an object key and in a header: no path separators or control characters. */
export function safeFileName(name: string): string {
  const cleaned = [...name.replace(/[\\/]+/g, '_')]
    .filter((ch) => ch !== '"' && ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f)
    .join('')
    .trim();
  return (cleaned === '' || cleaned === '.' || cleaned === '..' ? 'upload' : cleaned).slice(0, 200);
}

/** `<bucket>/<key>` of a stored file (`file_uri`), or null when it is not one. */
function parseUri(uri: string): { bucket: Bucket; key: string } | null {
  const slash = uri.indexOf('/');
  const bucket = uri.slice(0, slash);
  if (slash <= 0 || !(BUCKETS as readonly string[]).includes(bucket)) return null;
  return { bucket: bucket as Bucket, key: uri.slice(slash + 1) };
}

const tailOf = (key: string): string => key.slice(key.lastIndexOf('/') + 1);

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** The stored report of an import job, as far as the route reads it. */
interface StoredReport {
  report?: unknown;
  ignored?: { sheets?: string[]; columns?: { sheet: string; header: string }[] };
  violations?: unknown[];
  error?: { code?: string; message?: string };
}

const storedReport = (row: ImportJobRecord): StoredReport =>
  row.report !== null && typeof row.report === 'object' && !Array.isArray(row.report) ? (row.report as StoredReport) : {};

/** Excel validation entries as contract violations: only entries that name a rule (VR01-VR10) are rule results. */
function violationsOf(entries: readonly unknown[] | undefined): Violation[] {
  const out: Violation[] = [];
  for (const e of entries ?? []) {
    const entry = e as { rule?: string; severity?: 'error' | 'warning'; message?: string; cells?: string[] };
    if (entry.rule === undefined) continue;
    const parsed = Violation.safeParse(
      toViolation({ rule: entry.rule, cells: entry.cells ?? [], severity: entry.severity ?? 'warning', message: entry.message ?? '' } as never),
    );
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** `import_job` as the contract's ImportJob. `status` is null until the preview has produced its report. */
function toImportJob(row: ImportJobRecord, uploaded: ObjectMeta | undefined, now: Date): ImportJob {
  const stored = storedReport(row);
  const reported = stored.report !== undefined && stored.report !== null;
  const failed = row.status === 'failed';
  const error: Problem | null = failed
    ? checked('import error', Problem, {
        type: 'about:blank',
        title: 'Import failed',
        status: 422,
        detail: oneLine(stored.error?.message ?? 'The workbook could not be read. Check the file and upload it again.') || 'Import failed.',
      })
    : null;
  const status = failed ? 'failed' : reported ? row.status : null;
  return checked('import job', ImportJob, {
    id: row.id,
    filename: tailOf(row.file_uri),
    exportId: row.export_job_id,
    status,
    progress: status === null ? 0 : 1,
    progressNote: status === null ? 'reading the workbook' : null,
    report: reported && !failed ? checked('delta report', DeltaReport, stored.report) : null,
    violations: violationsOf(stored.violations),
    ignored: { sheets: stored.ignored?.sheets ?? [], columns: stored.ignored?.columns ?? [] },
    changesetId: row.changeset_id,
    error,
    createdBy: null,
    createdAt: (uploaded?.createdAt ?? now).toISOString(),
  });
}

// ----------------------------------------------------------------------------- routes

/**
 * Excel and file routes of 04 section 3 on `/api/t/:tenant/*` (API-10), after the tenant middleware (authenticated,
 * member, handler inside `withTenant`) and the CSRF and role guards (every POST here is state-changing: owner or
 * editor). The work is the worker tier's (`ExcelJobs`); these routes map the contract onto it. Files never leave
 * as URLs: an export answers a `FileRef`, and `GET files/:id` streams the bytes through tier 2.
 */
export function registerExcelRoutes(app: Hono<AppEnv>, deps: ExcelRoutesDeps): void {
  const newId = deps.newId ?? randomUUID;
  const maxUpload = deps.maxUploadBytes ?? importMaxBytes();

  // Export: build the workbook (job), answer the export with its file.
  app.post('/api/t/:tenant/exports', (c) =>
    run(c, async () => {
      TenantParams.parse(c.req.param());
      const req = ExportRequest.parse(await c.req.json());
      const known = new Set((await listScenarios(c.get('tenant').tx)).map((s) => s.id));
      const missing = req.scenarioIds.filter((s) => !known.has(s));
      if (missing.length > 0) throw ApiError.notFound(`No such scenario in this tenant: ${missing.join(', ')}. Check the scenario ids.`);
      const who = whoOf(c);
      const id = newId();
      const out = await deps.jobs.exportWorkbook(who, {
        exportJobId: id,
        scenarioIds: req.scenarioIds,
        ...(req.sheets === undefined ? {} : { sheets: req.sheets }),
        ...(req.format === undefined ? {} : { format: req.format }),
      });
      const row = await getExportJob(c.get('tenant').tx, out.id);
      if (row === null) throw new Error('the export job finished but its row is not visible');
      const parsed = parseUri(row.file_uri);
      const meta = parsed === null ? undefined : (await deps.objects(who).list(parsed.bucket, parsed.key)).find((m) => m.key === parsed.key);
      const present = new Set<string>([...out.sheets, ...ALWAYS_PRESENT]);
      const body = checked('export', ExportResult, {
        id: row.id,
        templateVersion: row.template_version,
        format: 'xlsx',
        scenarioIds: [...row.scenario_ids],
        sheets: ExcelSheet.options.filter((s) => present.has(s)),
        file: {
          id: row.id,
          filename: out.fileName,
          contentType: meta?.contentType ?? XLSX_TYPE,
          size: meta?.size ?? 0,
          expiresAt: meta?.expiresAt?.toISOString() ?? null,
        },
        checksum: row.checksum,
        createdBy: row.created_by,
        createdAt: row.created_at,
      });
      return c.json(body, 201);
    }),
  );

  // Download: the bytes of an export (id = export id) or of an upload (id = import id), streamed; no storage URL.
  app.get('/api/t/:tenant/files/:id', (c) =>
    run(c, async () => {
      const { id } = FileParams.parse(c.req.param());
      const tx = c.get('tenant').tx;
      const uri = (await getExportJob(tx, id))?.file_uri ?? (await getImportJob(tx, id))?.file_uri;
      const where = uri === undefined ? null : parseUri(uri);
      if (where === null) throw ApiError.notFound('No such file in this tenant, or it has expired. Export again.');
      const found = await deps.objects(whoOf(c)).stream(where.bucket, where.key);
      if (found === null) throw ApiError.notFound('No such file in this tenant, or it has expired. Export again.');
      return new Response(Readable.toWeb(found.stream) as ReadableStream<Uint8Array>, {
        status: 200,
        headers: {
          'content-type': found.meta.contentType,
          'content-length': String(found.meta.size),
          'content-disposition': contentDisposition(tailOf(where.key)),
          'cache-control': 'private, no-store',
        },
      });
    }),
  );

  // Upload a workbook: store it, record the import, start the preview once the row has committed.
  app.post('/api/t/:tenant/imports', (c) =>
    run(c, async () => {
      TenantParams.parse(c.req.param());
      const { filename } = ImportUploadQuery.parse(c.req.query());
      const upload = await readCapped(c, maxUpload);
      if ('tooLarge' in upload) {
        throw new ApiError({
          status: 413,
          title: 'Payload too large',
          detail: `The file is larger than the ${maxUpload} byte limit. Import a smaller workbook or one sheet at a time.`,
        });
      }
      if (upload.bytes.byteLength === 0) throw ApiError.badRequest('The upload is empty. Choose a workbook and try again.');
      const who = whoOf(c);
      const id = newId();
      const key = `${id}/${safeFileName(filename)}`;
      const meta = await deps.objects(who).put('imports', key, upload.bytes, {
        contentType: 'application/octet-stream',
      });
      const row = await createImportJob(c.get('tenant').tx, { id, file_uri: `imports/${key}`, status: 'parsed', report: {} });
      afterCommit(c, () => deps.jobs.startImport(who, id));
      return c.json(toImportJob(row, meta, new Date()), 201);
    }),
  );

  app.get('/api/t/:tenant/imports/:id', (c) =>
    run(c, async () => {
      const { id } = ImportParams.parse(c.req.param());
      const row = await getImportJob(c.get('tenant').tx, id);
      if (row === null) throw ApiError.notFound('No such import in this tenant. Upload the workbook again.');
      const parsed = parseUri(row.file_uri);
      const uploaded = parsed === null ? undefined : (await deps.objects(whoOf(c)).list(parsed.bucket, parsed.key)).find((m) => m.key === parsed.key);
      return c.json(toImportJob(row, uploaded, new Date()));
    }),
  );

  // Apply the accepted rows: one changeset per affected layer (the import's scenario: one), version-checked.
  app.post('/api/t/:tenant/imports/:id/apply', (c) =>
    run(c, async () => {
      const { id } = ImportParams.parse(c.req.param());
      const req = ImportApplyRequest.parse(await c.req.json());
      const out = await deps.jobs.applyImport(whoOf(c), {
        importJobId: id,
        accept: req.accept,
        decisions: req.decisions.map((d) => ({ sheet: d.sheet, key: d.key, member: d.member, scenario: d.scenario, take: d.take })),
        ...(req.clientRequestId === undefined ? {} : { clientRequestId: req.clientRequestId }),
      });
      if (out.changesetId === null) {
        throw new ApiError({
          status: 422,
          title: 'Validation failed',
          detail: 'Nothing to apply: none of the accepted rows changes a value. Accept another row or cancel the import.',
        });
      }
      const body = checked('import apply', ImportApplyResult, {
        importId: id,
        changesetId: out.changesetId,
        editsCount: out.applied.editsCount,
        scenarios: out.applied.scenarios.flatMap((s) =>
          s.scenarioId === null
            ? []
            : [{ scenarioId: s.scenarioId, version: s.version, editsCount: s.editsCount, ...(s.forkedFrom === undefined ? {} : { forkedFrom: s.forkedFrom }) }],
        ),
        warnings: violationsOf(out.applied.warnings),
      });
      return c.json(body);
    }),
  );
}
