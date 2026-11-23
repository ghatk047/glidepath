# @glidepath/api-contract

The only code shared by tier 1 and tier 2: zod schemas, WS message types, typed client.
It imports `zod` and nothing else (G13; enforced by `eslint.config.js` and `src/boundaries.spec.ts`).

## REST core (CON-01)

- `coreRoutes` (`src/routes.ts`): method, path, success status, and `params` / `query` / `body` /
  `response` schemas for the core routes of `docs/architecture/04_data_and_api.md` §3
  (me, tenants, bundle, members, scenarios GET/POST/PATCH, inputs, changesets POST / revert /
  history, calc, explain, search). Solver, export, import, AI and market routes: `jobRoutes` (CON-03).
- Errors are RFC 9457 `Problem` (`application/problem+json`): `type`, `title`, `status`,
  one-line `detail` for the UI error chip, optional `violations[{rule VR01–VR10, cells, severity, message}]`.
  The changeset routes answer 409 with `ChangesetConflict` (a problem plus `serverVersion`, `changesSince[]`).
- `ChangesetRequest {scenarioId, baseVersion, changes[{target, key, member, value, note?}], clientRequestId?}` →
  `ChangesetResult {changesetId, scenarioId, version, editsCount, inputHash, outputs, warnings, forkedFrom?}`.
- Ids are plain branded strings (`ScenarioId`, `ChangesetId`, `VarKey`, `NodeKey`, …). Cells are
  `CellKey` = `id[member]` as in the engine (`res.net[]`, `hc.rate[pilots,fy27]`); `toCellKey()` formats one.
- Field names are camelCase; spec ids and enum values are verbatim from `docs/spec`.

`src/fixtures/core.ts` holds one wire fixture per route; `schemas.spec.ts` round-trips them.

## WebSocket session (CON-02)

`src/ws.ts`: `WS /ws/session?tenant&scenario` (`SessionQuery`). Every frame is one JSON object
with `type` and protocol `v` (`WS_PROTOCOL_VERSION` = 1). `parseClientMessage` /
`parseServerMessage` take JSON text or an object and reject an unknown `type`, another `v` or a
malformed body with a one-line `detail`.

- Client → server: `subscribe{cells}`, `unsubscribe{cells}`, `subscribeView{view, params}`,
  `unsubscribeView{view, params}`, `preview{seq, changes[{var, member, value}]}`,
  `cancelPreview{seq}`, `open{scenarioId}`.
- Server → client: `snapshot{scenarioId, version, cells}`, `delta{seq, cells}`,
  `view{view, params, seq, payload}`, `warnings{seq, violations}`,
  `job{id, status, progress, note}`,
  `changeset{scenarioId, version, editsCount, forkedFrom?, changesetId?, origin?, author?}`,
  `error{problem}`.
- Coalescing (documented on `PREVIEW_MAX_PER_SECOND`): the client sends ≤ 30 previews/s **per
  connection**; `seq` is one increasing counter per connection; the server keeps the latest
  value per cell, applies the cells of one preview atomically, drops superseded previews
  unanswered and answers each rerun with the highest `seq` it applied. `seq: null` on
  `delta` / `view` / `warnings` means a commit, `open` or job, not a preview.
  `cancelPreview` carries a fresh `seq` and voids the scratch copy.
- Views (ADR-021, `viewSchemas`): `bridge`, `baseline.groups` (`by` pool | domain | vp),
  `baseline.summary`, `levers.families`, `levers.monthly`, `levers.scale`, `vps.domain_outlay`;
  each has strict `params` and a typed `payload` computed by tier 2 (DOM-06), so tier 1 draws
  without arithmetic.

`src/fixtures/ws.ts` holds one fixture per message type and per view, plus the coalescing
walk-through; `ws-protocol.spec.ts` checks them.

### Review fixes (CON-05)

- `open{scenarioId}` switches the session (scenario bar): tier 2 drops the scratch, keeps the
  subscriptions and answers `snapshot` of every subscribed cell, then each subscribed `view`
  (`seq: null`); an unknown scenario gets `error`. The author's sessions on a locked preset
  **follow** `changeset{forkedFrom}` onto the fork their commit created; other sessions stay.
- `preview{seq, changes}` carries 1..n cells applied atomically (e.g. two `org.dom_share`
  cells). `parseClientMessage` still normalises the CON-02 single-cell frame on the wire.
- Scratch lifecycle (`SessionStep` / `SessionTimeline`, typed timelines in
  `scratchLifecycleFixtures`): the scratch stays while the POST is in flight; every commit
  reaches the session as `changeset` then `delta{seq: null}` (before the POST answers), then
  the scratch is rebased (`delta{seq: S}`); tier 1 sends `cancelPreview` once its POST
  settled (after a 409 it first re-sends its edits on `serverVersion`).
- Rejected frames get `error{problem}`; `warnings` carry rule results only.
- `ChangesetRequest.clientRequestId` (idempotency key), `Scenario.editsCount`, strict
  `NodeDef` (an `expr` / `cases` key fails the bundle).

## Jobs, solver, Excel, AI and market (CON-03)

`jobRoutes` (`src/routes.ts`), spread into `apiRoutes`. A job start answers 201 with the job
resource; progress then arrives as WS `job` messages (now with optional `kind`
solver | import | ai.reconfig and `cancelRequested`) and from the `GET` route.

- **Solver runs** (`src/solvers.ts`): `POST /solver-runs` (worker job), `POST /solver-runs/quick`
  (≤ 2 s in `logic`: goal_seek, breakeven, scenario_blend, sensitivity except sobol,
  stress_presets: `quickProblems`), `GET` / `DELETE /solver-runs/:id` (status / cancel).
  Body `{scenarioId, spec: SolverSpec, save?}`; `SolverSpec` = `{problem, params}` for every
  `solvers.json` problem id, names verbatim (objectives, constraint ids, decision sets,
  methods). Optional params are tier 2's defaults. Answer: `SolverRun` with the DATA-11 job
  state (`status`, `progress` 0..1, `progressNote`, `cancelRequested`), `result: SolverResult`
  (03 §3, plus optional `detail` display series per problem) and `resultScenarioId`.
- **Excel** (`src/excel.ts`): `POST /exports` → `ExportResult` with a `FileRef`;
  `POST /imports` is a raw upload (`requestType: 'bytes'`, `?filename=`) → `ImportJob`;
  `GET /imports/:id` → `ImportJob` with `report: DeltaReport`; `POST /imports/:id/apply`
  (`accept`, per-row `decisions`) → one changeset. `DeltaReport` is `excel_template.json`
  `delta_report_schema` field for field, keys verbatim (snake_case, strict).
- **Files**: `GET /api/t/:tenant/files/:id` is a byte stream (`responseType: 'bytes'`); the
  client and `assertContract` return a `FileDownload {bytes, contentType, filename, size}`.
  No schema names a bucket, storage key or URL (`jobs.spec.ts` greps every JSON schema); the
  only URL is the public web page an AI research source cites.
- **AI reconfiguration** (`src/ai.ts`): `POST /api/ai/reconfig` (`dryRun` answers `estimated`
  with plan and cost estimate before anything runs), `GET /api/ai/reconfig/:id` (plan, sources,
  facts, draft changeset summaries, validation, calibration report, open questions, cost
  estimate and usage), `POST /api/ai/reconfig/:id/apply {drafts: seed | lever_tuning}`.
- **Market** (`src/market.ts`): `POST /market/refresh` `{source: feed}` or
  `{source: manual, asOf, values[{var, member, value}]}` → snapshot and changeset.

Fixtures: `jobRouteFixtures`, `solverProblemFixtures` / `solverRunFixtures` (one per problem
id), `deltaReportFixture`, and `apiRouteFixtures` (every route) on the testing entry.

## Typed client, contract fixtures and mock session (CON-04)

- `createClient(baseUrl, fetch)` (`src/client.ts`): one method per route of `apiRoutes`
  (CON-01 core routes; CON-03 adds its own there), e.g. `client.bundle({ params: { tenant } })`.
  Params, query and body are checked with the route schemas before sending; a success body
  is zod-parsed and returned typed. A body that breaks the schema, or another 2xx status,
  throws `ContractError`; a non-2xx answer throws `ApiError` with the parsed `problem`
  (`isChangesetConflict(err)` for the 409 `ChangesetConflict`). A non-problem error body
  (a proxy page) gets a one-line problem built from the status line (`synthetic: true`).
  `fetch` is structural (`FetchLike`): browser `fetch`, Node `fetch` or a test double.
- `assertContract(route, response, status?)` (`src/assert.ts`) for tier-2 route tests:
  `await assertContract('bundle', await app.request(...))` checks the success status,
  `application/json` and the response schema; with an error status it checks
  `application/problem+json`, the route's error schema (or `Problem`) and `body.status`.
  Returns the parsed, typed body; throws `ContractError` naming the route and the part.

Test-only exports live on **`@glidepath/api-contract/testing`** (kept off the main entry so
app bundles never carry fixture JSON):

- `specFixtures` / `presetSnapshot(key)`: wire fixtures **generated** by
  `scripts/generate-fixtures.ts` (`pnpm --filter @glidepath/api-contract gen:fixtures`) from
  `docs/spec` (registry, formula graph, seed) and `reference/golden_results.json` into
  `src/fixtures/spec/*.json`: `bundle`, `members`, `scenarios` (the locked presets) and one
  WS `snapshot` per preset (`rates`, `A`…`D`; default `C`) holding every golden output cell
  (`levers.L01.iy` → `lev.iy[L01]`, `vp.vp_x.net` → `vp.net[vp_x]`) plus the preset's
  resolved input cells (preset value, else tenant default). Never edit them by hand:
  `spec-fixtures.spec.ts` regenerates and diffs. Ids tier 3 assigns are derived
  (`sc-<key>`, `mv-<semver>`).
- `createMockSession(options?)`: a WebSocket factory (`session.connect(url)`) standing in for
  `WS /ws/session`. It replays and never calculates: `subscribe` → `snapshot` of those cells
  from the preset snapshot (`null` if absent), `subscribeView` → a configured `views`
  fixture, `cancelPreview` → `delta{seq}` with the committed values of the subscribed cells,
  `open` → `snapshot` + subscribed views, a bad frame → `error{problem}`; `preview` gets no
  answer unless a `respond.preview` responder scripts one. An emitted
  `changeset{forkedFrom}` of the open scenario moves the mock onto the fork (`scenarioId`). Tests push `snapshot` / `delta` / `view` / `job` / `changeset` with
  `emit()` / `replay()`, simulate drops with `drop()`, and read `sent`, `subscribed`, `views`.
- The hand-written CON-01 / CON-02 / CON-05 fixtures (`coreRouteFixtures`,
  `changesetConflictFixture`, `serverMessageFixtures`, `openFixture`,
  `scratchLifecycleFixtures`, …).
