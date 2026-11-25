# Excel and file routes (API-10)

`registerExcelRoutes(app, { jobs, objects, maxUploadBytes? })` mounts the Excel half of 04 section 3 on `/api/t/:tenant/*`, after the tenant middleware and the CSRF and role guards (every POST is owner or editor). `createApp({ excel })` calls it; without `excel` the routes are not mounted.

| Route | Answer (`@glidepath/api-contract`) |
|---|---|
| `POST exports` | 201 `ExportResult` (the job ran: `file` is a `FileRef`, no URL); 404 unknown scenario; 422 csv / unknown sheet |
| `GET files/:id` | the bytes, `content-disposition: attachment`, `cache-control: private, no-store`; 404 |
| `POST imports?filename=` (raw bytes) | 201 `ImportJob` with `status: null` (preview started after the row committed); 413 over the limit; 400 empty |
| `GET imports/:id` | `ImportJob`: `report` (DeltaReport, unwrapped from the stored envelope), `violations`, `ignored`; `failed` carries `error` |
| `POST imports/:id/apply` | `ImportApplyResult`; 409 version conflict (`ChangesetConflict`) or not reviewable; 422 conflict without a decision / nothing to apply; 404 |

## Contract readings

- **File id** = the `export_job.id` of an export (an upload's id = its `import_job.id` also works). The route looks the row up and streams `file_uri` from the object store; bucket, key and URL never appear in a response.
- **Jobs are a port** (`ExcelJobs`): the server does not import the worker. The composition root wires the worker's `runExport` / `runImport` / `runApply` (same process) or a pg-boss relay. Export awaits the job (the answer carries the file); import returns at once and the job runs after the `import_job` row committed (`afterCommit`); the client polls `GET imports/:id` (ADR-024). Apply awaits the job.
- **ImportJob.status** is `null` until the preview has stored its report (the row is `parsed` with an empty report before that). `progress` is 0 then 1 (the worker keeps no import progress); `createdAt` is the upload's `stored_object.created_at`; `createdBy` is `null` (`import_job` has no author column).
- **Apply**: `scenarios` lists the scenario layers written (a tenant-defaults changeset has no scenario, so an import that edits only defaults answers `scenarios: []` and still one `changesetId`). `changesetId` is the first changeset (`import_job.changeset_id`). `warnings` keep only entries that name a rule (VR01-VR10).
- **Size limit**: `IMPORT_MAX_BYTES` (bytes, default 10 MiB, never above the object store's 50 MiB cap); `importMaxBytes(env)` reads it. Declared `content-length` is checked first, then the stream is cut at the limit.
- ExportResult.sheets lists the sheets in the workbook (README, `_lists`, `_meta` always, plus the exported input sheets), in template order.

## Tests

`excel.pg.test.ts` runs on the AA test database as `glidepath_app` with the real XL-08 jobs in-process (`testing/worker-jobs.ts`) and the Postgres object store: one test per acceptance line, plus failure paths.
