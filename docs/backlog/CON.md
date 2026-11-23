# CON · API contract

The only code shared by tier 1 and tier 2: REST schemas, WS protocol, job/Excel/AI schemas, typed client and mock session. Contract first: tier-1 and tier-2 items build against these.

4 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| CON-01 | REST core schemas and problem JSON | M0 | opus/high | M | FND-01 |
| CON-02 | WebSocket session protocol (incl. view subscriptions) | M0 | opus/high | S | FND-05, CON-01 |
| CON-03 | Jobs, solver, Excel, AI and market schemas | M2 | opus/high | M | CON-01 |
| CON-04 | Typed client, contract fixtures and mock session | M1 | opus/high | M | CON-02 |

## CON-01 · REST core schemas and problem JSON

```yaml
id: CON-01
title: "REST core schemas and problem JSON"
epic: CON
milestone: M0
priority: must
status: done
stream: B
model: opus
effort: high
depends_on: [FND-01]
tier: contract
package: "contract/api-contract"
contract: "zod schemas for 04 §3 core routes"
inputs:
  - "docs/architecture/04_data_and_api.md#3. Tier 2 API (the contract with tier 1)"
  - "docs/architecture/04_data_and_api.md#4. How tier 1 uses the contract"
  - "docs/architecture/04_data_and_api.md#2. Tier 2 · Domain: one write path"
  - "docs/ux/02_information_architecture.md#6. Screen states"
  - "docs/spec/schema.json (tables.changeset, tables.change, tables.scenario)"
acceptance:
  - "zod request/response schemas for /api/me, /api/tenants, /t/:tenant/bundle, members, scenarios (GET/POST/PATCH), scenarios/:id/inputs, changesets (POST, :id/revert, history), scenarios/:id/calc, nodes/:cell/explain, search (test: schemas.spec.ts round-trips one fixture per route)"
  - "RFC 9457 problem schema: type, title, status, detail (one-line UI message), optional violations[{rule VR01–VR10, cells, severity, message}] (test)"
  - "changeset request {baseVersion, changes[{target variable|override|structural, key, member, value, note?}]}; response {scenarioId, version, editsCount, inputHash, outputs, warnings, forkedFrom?}; 409 body {serverVersion, changesSince[]} (test)"
  - "ids are plain branded strings; the package imports nothing from tier2-logic or tier3-data (G13 lint)"
gates: [G1, G2, G13]
size: M
notes: "Contract first: tier 1 and tier 2 items consume this; changes after merge need a new CON item and an ADR note."
merged_at: "2026-11-23"
```

The REST half of the only code shared by tiers 1 and 2.

## CON-02 · WebSocket session protocol (incl. view subscriptions)

```yaml
id: CON-02
title: "WebSocket session protocol (incl. view subscriptions)"
epic: CON
milestone: M0
priority: must
status: done
stream: B
model: opus
effort: high
depends_on: [FND-05, CON-01]
tier: contract
package: "contract/api-contract"
contract: "WS /ws/session message union"
inputs:
  - "docs/architecture/04_data_and_api.md#3. Tier 2 API (the contract with tier 1)"
  - "docs/architecture/03_engine_and_solvers.md#2. Where the engine runs: what-if sessions in tier 2"
  - "docs/architecture/07_frontend.md#3. Editing feel without local math"
  - "docs/adr/ADR-021-view-models.md"
acceptance:
  - "client→server: subscribe{cells[]}, unsubscribe{cells[]}, subscribeView{view, params}, preview{var, member, value, seq}, cancelPreview{seq}; server→client: snapshot{cells}, delta{seq, cells}, view{view, params, payload}, warnings{seq, violations}, job{id, status, progress, note}, changeset{scenarioId, version, editsCount, forkedFrom?} (test: ws-protocol.spec.ts)"
  - "every message has `type` and protocol `v`; unknown types are rejected by the parser (test)"
  - "coalescing contract documented on the schema: client sends ≤ 30 previews/s, server answers the latest seq per cell (test fixture)"
  - "view names enumerated: bridge, baseline.groups, baseline.summary, levers.families, levers.monthly, levers.scale, vps.domain_outlay (test)"
gates: [G1, G2, G13]
size: S
notes: ""
merged_at: "2026-11-23"
```

The streaming half of the contract: previews in, deltas out.

## CON-03 · Jobs, solver, Excel, AI and market schemas

```yaml
id: CON-03
title: "Jobs, solver, Excel, AI and market schemas"
epic: CON
milestone: M2
priority: must
status: done
stream: B
model: opus
effort: high
depends_on: [CON-01]
tier: contract
package: "contract/api-contract"
contract: "Schemas for solver-runs, exports, imports, ai/reconfig, market/refresh, files"
inputs:
  - "docs/architecture/04_data_and_api.md#3. Tier 2 API (the contract with tier 1)"
  - "docs/architecture/03_engine_and_solvers.md#3. Package `tier2-logic/solvers`"
  - "docs/spec/solvers.json (problems)"
  - "docs/spec/excel_template.json (delta_report_schema)"
  - "docs/architecture/06_multitenancy_and_ai.md#2. AI reconfiguration pipeline (tier 2: `tier2-logic/ai`, run by the `worker` as job `ai.reconfig`)"
acceptance:
  - "solver-runs (POST, POST quick, GET, DELETE) params for every problem id in solvers.json and SolverResult as in 03 §3 (test: one fixture per problem id)"
  - "delta report schema equals excel_template.json delta_report_schema field for field (test compares key sets)"
  - "ai/reconfig (POST, GET, POST apply) with plan, sources, draft changeset summaries, calibration report, open questions, cost estimate; market/refresh request (test)"
  - "files/:id is a byte stream; no schema contains bucket names or storage URLs (test greps the JSON schemas)"
gates: [G1, G2, G13]
size: M
notes: "Needed by M3 work; scheduled early so both tiers build against it."
merged_at: "2026-11-23"
```

Contract for the long-running and file-based features.

## CON-04 · Typed client, contract fixtures and mock session

```yaml
id: CON-04
title: "Typed client, contract fixtures and mock session"
epic: CON
milestone: M1
priority: must
status: done
stream: B
model: opus
effort: high
depends_on: [CON-02]
tier: contract
package: "contract/api-contract"
contract: "createClient(), assertContract(), createMockSession()"
inputs:
  - "docs/architecture/04_data_and_api.md#4. How tier 1 uses the contract"
  - "docs/spec/reference/golden_results.json (scenarios.C)"
  - "docs/architecture/07_frontend.md#2. Binding model"
acceptance:
  - "createClient(baseUrl, fetch) covers every CON-01 route with zod-validated responses (test with msw)"
  - "contract fixtures (bundle, members, scenarios, snapshot for C) are generated by a script from docs/spec JSON and golden_results.json, never hand-typed (test: regenerate-and-diff)"
  - "createMockSession() replays snapshot/delta/view/job messages for tier-1 tests (test)"
  - "assertContract(route, response) helper used by tier-2 route tests (test)"
gates: [G1, G2, G13]
size: M
notes: "Extended for CON-03 routes by the items that consume them."
merged_at: "2026-11-23"
```

Lets tier 1 build and test against the contract before tier 2 serves real numbers.

## CON-05 · Review fixes: scenario switch, batched preview, scratch lifecycle

```yaml
id: CON-05
title: "WS/REST contract review fixes: open{scenarioId}, batched preview, scratch lifecycle, error message"
epic: CON
milestone: M1
priority: must
status: done
stream: B
model: opus
effort: high
depends_on: [CON-04]
tier: contract
package: "contract/api-contract"
contract: "ClientMessage open/preview(changes[]); ServerMessage error; Scenario.editsCount; ChangesetRequest.clientRequestId"
inputs:
  - "docs/architecture/03_engine_and_solvers.md#2"
  - "docs/architecture/04_data_and_api.md#4"
  - "docs/ux/05_demo_storyline.md"
  - "contract/api-contract/README.md"
acceptance:
  - "client message open{scenarioId} answered by snapshot + re-sent subscribed views; documented that a session follows changeset{forkedFrom} it caused (test: ws-protocol.spec.ts)"
  - "preview carries changes:[{var,member,value}] (1..n cells applied atomically, e.g. two org.dom_share cells) with seq; single-cell form removed or normalised (test)"
  - "scratch lifecycle documented and typed: previews rebased onto each commit; tier 1 sends cancelPreview after its POST resolves or fails; changeset message precedes its delta{seq:null} (test: fixture order)"
  - "preview rate limit is 30/s per connection (PREVIEW_MAX_PER_SECOND doc + fixture) (test)"
  - "new server message error{problem} for rejected frames; warnings never used for frame errors (test)"
  - "changeset message gains optional changesetId, origin, author; Scenario gains editsCount; ChangesetRequest gains optional clientRequestId (idempotency) (test)"
  - "NodeDef is strict so expr/cases can never leak to tier 1 (test that fails on extra keys); 409 fixture text says tier 1 re-sends its edits; Scenario doc no longer says a child inherits overrides (test)"
gates: [G1, G2, G13]
size: M
notes: "From the opus review of CON-01/CON-02 (2026-11-23). Contract change: WEB-03 and API-06/07 consume it."
merged_at: "2026-11-23"
```

Fixes the blocking contract findings before the session manager and WS client depend on them.
