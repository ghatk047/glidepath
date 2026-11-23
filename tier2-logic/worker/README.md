# @glidepath/worker

`worker` container: pg-boss consumers (solvers, Excel, AI, golden runs).

Skeleton only: no feature code yet.

## DATA-08: migrate entry (`src/seed`)

`dist/migrate.js` (esbuild bundle of `src/seed/migrate.ts`, `pnpm --filter @glidepath/worker build`) is what the compose `migrate` service runs: `node dist/migrate.js --seed aa`; `pnpm seed --tenant aa` runs it from source. Settings are environment variables: `DATABASE_URL_MIGRATE` (owner role), `DEMO_USER_EMAIL` (optional; fictitious demo user with an owner membership), `DEMO_USER_NAME`, `TIER3_DATA_DIR` (default: nearest `tier3-data` above the module).

Steps: data-access `migrate()`; global definitions from `tier3-data/seed/{variables,formula_graph}.json` (model_version, dimension_def, variable_def, node_def, lever_template, canonical_pool, addr_tag; pool, addr_tag and lever library come from the tenant folder; a published model_version with other contents is an error); then `tier3-data/seed/<tenant>` in one tenant transaction: tenant, sources, locked presets (rows through the store port's `createScenario`, DOM-04 owns scenario ops), members, lines and tenant defaults in one `applyChangeset` of origin `seed`, one changeset per preset, `line_item_lever` rows. Ids are deterministic (UUIDv5). Idempotent: a rerun writes only what is missing; tenant members and defaults are never overwritten, preset cells that differ from the seed are repaired.

`tier3-data/seed` is a copy of `docs/spec`: `pnpm --filter @glidepath/worker seed:sync` refreshes it, a test fails when it drifts. Tests: `src/seed/seed.pg.test.ts` (pg-local, compose-like role bootstrap), `src/seed/seed.test.ts`.

## XL-08: Excel jobs (`src/jobs/excel`)

Handlers `excel.export`, `excel.import`, `excel.apply` (registered from `handlers.ts`). Each is a plain function (`runExport`, `runImport`, `runApply`, plus `undoImport`) over an `ExcelJobContext` and `ExcelJobDeps` (spec files, object store, model cache, clock), so tests pass their own; `defaultExcelDeps()` reads `SPEC_DIR` (default: the repo's `docs/spec`, needs `excel_template.json`, `variables.json`, `formula_graph.json`) and keeps files in the Postgres object store (`DATABASE_URL`, app role).

- **export**: payload `{ exportJobId?, scenarioIds, sheets? }` (xlsx only). Stores `exports/<id>/<file name>` and `export-snapshots/<id>.json` (`StoredExportSnapshot`: snapshot, scenarios as uuid/key/label, sheets), writes `export_job` (`file_uri` = `exports/<key>`, `snapshot` = the same envelope).
- **import**: payload `{ importJobId }`; the upload route creates the `import_job` (its `file_uri` = `imports/<key>`). Identify (`_meta`, tenant, template major), parse, validate, diff E/W/D, impact per affected scenario (conflicts previewed as file wins), then `import_job.report` = `StoredImportReport` (`report` is the contract's `DeltaReport`, beside it `items`, `impacts`, `base` versions, `ignored`, `violations`) and status `awaiting_review`; a failure sets `failed` and `report.error`. A workbook without `_meta` is foreign: scenario columns match by label, two-way diff.
- **apply**: payload `{ importJobId, accept, decisions, clientRequestId? }`. `toChangeset` then `applyChangeset` for every draft in one `withTenant` transaction (all layers or none), each at the version the preview saw (a moved scenario fails with `ChangesetConflictError`), with the recompute hook. A locked preset forks. Job becomes `applied` with `changeset_id` = first changeset and `report.applied` (all ids). A repeat returns the stored result. `undoImport` reverts the changesets, newest first.

Tests: `units.test.ts`, `jobs.pg.test.ts` (pg-local with the AA seed, `testing/fs-object-store.ts`).

## AI-06: AI jobs (`src/jobs/ai`)

Handlers `ai.reconfig` and `ai.apply` (registered from `handlers.ts`), the rehearse CLI and the cache bundle. Plain functions over an `AiJobContext` and `AiJobDeps` (env, spec files, ModelClient factory, object store, db, clock), so tests pass a fake client; `defaultAiDeps()` reads `ANTHROPIC_API_KEY` etc. from the environment (never logged: `redact.ts` scrubs anything stored or rethrown) and `tier3-data/seed` for the registry and the reference tenant (AA) whose presets step 3 copies.

- **`ai.reconfig`** (payload `{ jobId?, prompt?, dryRun? }`; the API route creates the `queued` row): computes the cost estimate (`cost.ts`, figures in `cost-model.json`) and stores it first, then steps 1-7 of 06 section 2 (`pipeline.ts`: scope, research, seed draft, validate, calibrate, lever tuning, review payload). `ai_reconfig_job.plan` is a `StoredReconfigJob` (step, progress, plan, estimate, usage, the `ReconfigReview`, error, applied); `status` is `running`, then `review` (or `estimated` for a dry run, `failed`, `cancelled`, `budget_exceeded`). Objects: the client's `ai/<job-id>/<seq>-<step>-*.json`, plus `review.json` and `usage.json`. Cost guard: `AI_MAX_TOKENS_PER_JOB` (default in `settings.ts`, ADR-022) counts input, output and cache tokens of every call (`budget.ts`); no call starts once it is spent, a call past it stops the job. Tuning an existing tenant (plan intent `tune`) is not run yet: it needs the tenant's current inputs as the draft.
- **`ai.apply`** (payload `{ jobId, accept, clientRequestId? }`): `applyDraft` of `@glidepath/ai` over `createApplyPort` (`withTenant`; on create the tenant row `active` with the job tenant's pinned model, an owner membership for the accepting user, `line_item_lever` rows). Answers the contract's `ReconfigApplyResult`: one `changesetId` per kind (the first changeset of that kind; all ids in `plan.applied.changesets`), `editsCount` = the draft's change count. `ai_reconfig_job.changeset_id` is set only when the changesets are in the job's own tenant (tuning). A repeat returns the stored result.
- **`pnpm ai:rehearse --tenant ua [--prompt <text>] [--out <dir>] [--home <slug>]`** (`rehearse.ts`, `rehearse-cli.ts`): runs the pipeline once with the real client (loads the repo's `.env` when present), prints the estimate before the first call, writes the bundle `tier3-data/seed/ai-cache/<tenant>`: `manifest.json`, `review.json`, `audit/*`. No database.
- **`migrate --ai-cache <dir> [--ai-cache-tenant <slug>]`** (`cache.ts`, `seed/run.ts`): after the seed, imports the bundle as an `ai_reconfig_job` of the home tenant (manifest `homeTenant`, default `aa`) in status `review`, with its objects under `ai/<job-id>/`. Deterministic ids, a rerun writes nothing.

Tests: `units.test.ts` (estimate, budget, settings, key handling, compose-config check, CLI, bundle), `reconfig.pg.test.ts` (pg-local with the AA seed, fake client in `testing/fake-model.ts`).
