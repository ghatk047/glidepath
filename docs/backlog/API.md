# API · Tier 2 server

Hono REST + WebSocket in the `logic` container: auth, tenancy, routes of 04 §3, what-if sessions.

12 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| API-01 | Server skeleton: Hono app, config, healthz, problem JSON, tenant middleware | M0 | sonnet/high | M | CON-01, DATA-04 |
| API-02 | Auth: magic link, session cookies, /api/me, /api/tenants, roles | M2 | opus/xhigh | M | API-01, DATA-05, DATA-11 |
| API-03 | Passkey login (WebAuthn) | M4 | opus/high | M | API-02 |
| API-04 | Read routes: bundle, members, scenarios, inputs, history | M1 | sonnet/high | M | API-01, DATA-05, CON-04 |
| API-05 | Write routes: changesets, revert, scenarios, calc | M1 | sonnet/high | M | API-04, DOM-04, DOM-05, DATA-06 |
| API-06 | What-if session core: ModelCache, subscribe, preview, delta | M1 | opus/xhigh | M | API-01, CON-02, ENG-07, DATA-05 |
| API-07 | Session lifecycle: commit broadcast, warnings, idle close, reconnect | M1 | opus/xhigh | M | API-06, API-05, DOM-05 |
| API-08 | Explain and search routes | M2 | sonnet/high | M | API-04, ENG-09 |
| API-09 | Solver routes: quick (in-session) and jobs | M3 | sonnet/high | M | API-07, JOB-02, SOL-03, SOL-07, SOL-08, CON-03 |
| API-10 | Excel and file routes | M3 | sonnet/high | M | XL-08, CON-03, DATA-07 |
| API-11 | AI reconfig and market refresh routes | M4 | sonnet/high | M | AI-06, CON-03, API-05 |
| API-12 | Session view subscriptions (ADR-021) | M2 | sonnet/high | S | API-07, DOM-06 |

## API-01 · Server skeleton: Hono app, config, healthz, problem JSON, tenant middleware

```yaml
id: API-01
title: "Server skeleton: Hono app, config, healthz, problem JSON, tenant middleware"
epic: API
milestone: M0
priority: must
status: done
stream: B
model: sonnet
effort: high
depends_on: [CON-01, DATA-04]
tier: 2
package: "tier2-logic/server/src/app"
contract: "dist/server.js on :8080"
inputs:
  - "docs/architecture/04_data_and_api.md#3. Tier 2 API (the contract with tier 1)"
  - "docs/architecture/11_docker_deployment.md#4. Configuration (12-factor)"
  - "docs/adr/ADR-015-database-portability.md"
  - "docs/adr/ADR-022-env-settings.md"
acceptance:
  - "GET /healthz returns 200 when the DB answers via DATABASE_URL, 503 otherwise (test on pg-local)"
  - "config read from env only with zod; startup fails listing missing vars (test)"
  - "errors map to RFC 9457 problem JSON per contract (test)"
  - "tenant middleware resolves membership for /api/t/:tenant/* and wraps handlers in withTenant; no membership → 404 problem (test; stubbed membership until DATA-05)"
  - "JSON logs never contain AUTH_SECRET, DB passwords or cookies (test)"
gates: [G1, G2]
size: M
notes: ""
merged_at: "2026-11-23"
```

The logic container's shell.

## API-02 · Auth: magic link, session cookies, /api/me, /api/tenants, roles

```yaml
id: API-02
title: "Auth: magic link, session cookies, /api/me, /api/tenants, roles"
epic: API
milestone: M2
priority: must
status: done
stream: B
model: opus
effort: xhigh
depends_on: [API-01, DATA-05, DATA-11]
tier: 2
package: "tier2-logic/server/src/auth"
contract: "POST /api/auth/magic-link, GET /api/auth/callback, GET /api/me, GET /api/tenants"
inputs:
  - "docs/architecture/01_architecture_overview.md#4. Key decisions (ADR summary) (ADR-014)"
  - "docs/architecture/11_docker_deployment.md#1. Containers (mail)"
  - "docs/adr/ADR-023-manual-migrations.md"
acceptance:
  - "magic link sent via SMTP_URL (mailpit locally); token hashed in auth_token, single use, expiry from AUTH_LINK_TTL_MIN (test)"
  - "session cookie HttpOnly, Secure, SameSite=Lax, signed with AUTH_SECRET, rotated at login (test)"
  - "/api/me returns user, memberships and roles owner/editor/viewer; /api/tenants lists only the user's tenants (test)"
  - "role guard: viewer cannot POST changesets (test); state-changing routes require same-origin + CSRF token (test)"
  - "seeded demo user can log in with no internet (test with local SMTP sink)"
gates: [G1, G2, G7]
size: M
notes: "Security item: opus/xhigh per rubric."
merged_at: "2026-11-23"
```

Who is calling, and for which airline.

## API-03 · Passkey login (WebAuthn)

```yaml
id: API-03
title: "Passkey login (WebAuthn)"
epic: API
milestone: M4
priority: should
status: done
stream: B
model: opus
effort: high
depends_on: [API-02]
tier: 2
package: "tier2-logic/server/src/auth"
contract: "POST /api/auth/passkey/*"
inputs:
  - "docs/architecture/01_architecture_overview.md#4. Key decisions (ADR summary) (ADR-014)"
  - "docs/architecture/README.md#Assumptions taken (all reversible, each becomes an ADR) (4)"
acceptance:
  - "register and authenticate a passkey with RP id from PUBLIC_BASE_URL; credentials in passkey table (test with a virtual authenticator)"
  - "magic link remains the fallback (test)"
gates: [G1, G2]
size: M
notes: "Not in the 09 §3 must column; magic link covers the demo."
merged_at: "2026-11-23"
```

Nicer demo login if time allows.

## API-04 · Read routes: bundle, members, scenarios, inputs, history

```yaml
id: API-04
title: "Read routes: bundle, members, scenarios, inputs, history"
epic: API
milestone: M1
priority: must
status: done
stream: B
model: sonnet
effort: high
depends_on: [API-01, DATA-05, CON-04]
tier: 2
package: "tier2-logic/server/src/routes/read"
contract: "GET bundle, members, scenarios, scenarios/:id/inputs, scenarios/:id/changesets"
inputs:
  - "docs/architecture/04_data_and_api.md#3. Tier 2 API (the contract with tier 1)"
  - "docs/architecture/04_data_and_api.md#4. How tier 1 uses the contract"
  - "contract/api-contract (CON-01 schemas)"
acceptance:
  - "GET bundle (variables, nodes, dims of the pinned model_version) with ETag / 304 (test)"
  - "GET members with members_hash; GET scenarios (kind, parent, version, locked); GET scenarios/:id/inputs; GET scenarios/:id/changesets (test on pg-local + AA seed)"
  - "every response passes assertContract (test)"
  - "path tenant not in memberships → 404 problem (test)"
gates: [G1, G2, G7]
size: M
notes: ""
merged_at: "2026-11-23"
```

Definitions and labels tier 1 renders from.

## API-05 · Write routes: changesets, revert, scenarios, calc

```yaml
id: API-05
title: "Write routes: changesets, revert, scenarios, calc"
epic: API
milestone: M1
priority: must
status: done
stream: B
model: sonnet
effort: high
depends_on: [API-04, DOM-04, DOM-05, DATA-06]
tier: 2
package: "tier2-logic/server/src/routes/write"
contract: "POST changesets, POST changesets/:id/revert, POST/PATCH scenarios, GET scenarios/:id/calc"
inputs:
  - "docs/architecture/04_data_and_api.md#2. Tier 2 · Domain: one write path"
  - "docs/architecture/04_data_and_api.md#3. Tier 2 API (the contract with tier 1)"
  - "docs/architecture/01_architecture_overview.md#5. Runtime flows (Release / typed edit)"
acceptance:
  - "POST changesets → applyChangeset; returns version, editsCount, inputHash, headline outputs, warnings; 409 with server version and changes since (test)"
  - "first edit on a locked preset returns forkedFrom and the new scenario (test)"
  - "revert (undo), scenario create (copy, blend, empty child) and PATCH (rename, lock, archive) (test)"
  - "GET calc returns the latest calc_run (test); commit p95 < 150 ms on the seeded DB (bench api.commit, G8)"
  - "after commit notifies the session hub (interface; real hub in API-07) (test with fake hub)"
gates: [G1, G2, G7, G8]
size: M
notes: "Numbers-dependent: after ENG-06 via DOM-05."
merged_at: "2026-11-23"
```

Edits that persist.

## API-06 · What-if session core: ModelCache, subscribe, preview, delta

```yaml
id: API-06
title: "What-if session core: ModelCache, subscribe, preview, delta"
epic: API
milestone: M1
priority: must
status: done
stream: B
model: opus
effort: xhigh
depends_on: [API-01, CON-02, ENG-07, DATA-05]
tier: 2
package: "tier2-logic/server/src/session"
contract: "WS /ws/session (snapshot, preview → delta)"
inputs:
  - "docs/architecture/03_engine_and_solvers.md#2. Where the engine runs: what-if sessions in tier 2"
  - "docs/architecture/01_architecture_overview.md#5. Runtime flows (Slider drag)"
  - "contract/api-contract (CON-02 protocol)"
  - "docs/architecture/07_frontend.md#3. Editing feel without local math"
acceptance:
  - "WS /ws/session?tenant&scenario authenticates the cookie and membership; opens Session(user, tenant, scenario) with a CompiledModel from ModelCache keyed (tenant, model_version, members_hash) (test)"
  - "subscribe → snapshot of only the subscribed cells; on AA C headline cells equal golden C within 1e-6 (test)"
  - "preview coalescing: latest seq per cell wins; rerun on a scratch copy; delta carries only subscribed cells whose value changed (test: 100 rapid previews)"
  - "a preview issues no SQL (test: query spy)"
  - "preview round trip p95 < 25 ms locally (bench ws.preview, G8)"
gates: [G1, G2, G8]
size: M
notes: "Numbers-dependent: after ENG-06."
merged_at: "2026-11-23"
```

The warm engine behind every slider.

## API-07 · Session lifecycle: commit broadcast, warnings, idle close, reconnect

```yaml
id: API-07
title: "Session lifecycle: commit broadcast, warnings, idle close, reconnect"
epic: API
milestone: M1
priority: must
status: done
stream: B
model: opus
effort: xhigh
depends_on: [API-06, API-05, DOM-05]
tier: 2
package: "tier2-logic/server/src/session"
contract: "SessionManager hub"
inputs:
  - "docs/architecture/03_engine_and_solvers.md#2. Where the engine runs: what-if sessions in tier 2"
  - "docs/adr/ADR-022-env-settings.md"
  - "contract/api-contract (CON-02 protocol)"
acceptance:
  - "after POST /changesets every session on that scenario receives delta + changeset (test with two clients)"
  - "preview warnings: DOM validatePreview results pushed as `warnings` with the preview seq (test)"
  - "idle sessions close after SESSION_IDLE_MIN; reconnect rebuilds the session from tier 3 with identical values (test with fake clock)"
  - "scenario switch re-targets the session and sends a fresh snapshot (test)"
gates: [G1, G2]
size: M
notes: ""
merged_at: "2026-11-23"
```

Sessions as a cache, never the source of truth.

## API-08 · Explain and search routes

```yaml
id: API-08
title: "Explain and search routes"
epic: API
milestone: M2
priority: must
status: done
stream: B
model: sonnet
effort: high
depends_on: [API-04, ENG-09]
tier: 2
package: "tier2-logic/server/src/routes/explain"
contract: "GET nodes/:cell/explain, GET search?q="
inputs:
  - "docs/architecture/04_data_and_api.md#3. Tier 2 API (the contract with tier 1)"
  - "docs/ux/02_information_architecture.md#2. Global layer (on every module)"
  - "docs/ux/04_component_inventory.md#Shell (6) (#4 Command palette)"
acceptance:
  - "explain returns value, node id, formula in words, upstream chain, top drivers, pinned flag (test on res.net)"
  - "search indexes 194 inputs, 17 levers, 98 output nodes, tenant lines and 8 screens; ≤ 9 ranked results with kind and unit; 'COLA', 'cloud', 'headcount' return relevant first hits (test)"
  - "labels from the bundle, lines from tier 3 for the caller's tenant only (test)"
gates: [G1, G2, G7]
size: M
notes: ""
merged_at: "2026-11-23"
```

Trace drawer and ⌘K, served by tier 2.

## API-09 · Solver routes: quick (in-session) and jobs

```yaml
id: API-09
title: "Solver routes: quick (in-session) and jobs"
epic: API
milestone: M3
priority: must
status: done
stream: B
model: sonnet
effort: high
depends_on: [API-07, JOB-02, SOL-03, SOL-07, SOL-08, CON-03]
tier: 2
package: "tier2-logic/server/src/routes/solver"
contract: "POST solver-runs/quick, POST/GET/DELETE solver-runs"
inputs:
  - "docs/architecture/04_data_and_api.md#3. Tier 2 API (the contract with tier 1)"
  - "docs/architecture/03_engine_and_solvers.md#2. Where the engine runs: what-if sessions in tier 2 (Short solvers)"
  - "contract/api-contract (CON-03)"
acceptance:
  - "quick runs goal_seek, breakeven, scenario_blend, sensitivity (tornado), stress_presets on the session model with a 2 s limit; over the limit → 202 + job id (test)"
  - "POST solver-runs enqueues; GET returns status/result; DELETE sets cancel_requested (test)"
  - "responses pass assertContract (test)"
gates: [G1, G2, G7]
size: M
notes: "Also own the server composition (start.ts): a pg-boss client in the server (send + await result, direct URL so Neon/pgbouncer works), wire the JOB-02 relay (createJobRelay ... .start()/stop()), implement API-10's ExcelJobs port on it and pass excel deps with importMaxBytes() (add IMPORT_MAX_BYTES to config.ts). Map problem ids to solver_run kind here (JOB-02 note)."
merged_at: "2026-11-23"
```

Path and Cockpit solver hooks.

## API-10 · Excel and file routes

```yaml
id: API-10
title: "Excel and file routes"
epic: API
milestone: M3
priority: must
status: done
stream: B
model: sonnet
effort: high
depends_on: [XL-08, CON-03, DATA-07]
tier: 2
package: "tier2-logic/server/src/routes/excel"
contract: "POST exports, POST imports, GET imports/:id, POST imports/:id/apply, GET files/:id"
inputs:
  - "docs/architecture/05_excel_roundtrip.md#2. Flow in the app"
  - "docs/architecture/04_data_and_api.md#5. Tier 3 · Object storage (MinIO)"
  - "contract/api-contract (CON-03)"
acceptance:
  - "export → job → files/:id streams the xlsx; no storage URL in any response (test)"
  - "import upload (size limit from env) → preview job; GET returns a contract-valid delta report; apply with decisions creates one changeset (test)"
  - "File/App conflict decisions honoured (test)"
gates: [G1, G2, G7]
size: M
notes: ""
merged_at: "2026-11-23"
```

Tier 1 only uploads, downloads and renders.

## API-11 · AI reconfig and market refresh routes

```yaml
id: API-11
title: "AI reconfig and market refresh routes"
epic: API
milestone: M4
priority: must
status: done
stream: B
model: sonnet
effort: high
depends_on: [AI-06, CON-03, API-05]
tier: 2
package: "tier2-logic/server/src/routes/ai"
contract: "POST/GET /api/ai/reconfig, POST /api/ai/reconfig/:id/apply, POST market/refresh"
inputs:
  - "docs/architecture/04_data_and_api.md#3. Tier 2 API (the contract with tier 1)"
  - "docs/architecture/06_multitenancy_and_ai.md#3. Demo scope (Dec 4)"
  - "contract/api-contract (CON-03)"
acceptance:
  - "POST reconfig returns a cost estimate and job id; GET returns plan, sources, draft changeset summaries, calibration, open questions; apply (owner only) → applyChangeset origin=ai_reconfig (test with a fake model client)"
  - "the cached UA rehearsal is returned when present (test)"
  - "POST market/refresh stores a market_snapshot row and applies it (share price, Brent, crack) as a changeset origin=market from a typed payload; no live feed (test)"
gates: [G1, G2, G7]
size: M
notes: ""
merged_at: "2026-11-23"
```

Airlines module and the freeze-day market refresh.

## API-12 · Session view subscriptions (ADR-021)

```yaml
id: API-12
title: "Session view subscriptions (ADR-021)"
epic: API
milestone: M2
priority: must
status: done
stream: B
model: sonnet
effort: high
depends_on: [API-07, DOM-06]
tier: 2
package: "tier2-logic/server/src/session"
contract: "subscribeView → view messages"
inputs:
  - "docs/adr/ADR-021-view-models.md"
  - "contract/api-contract (CON-02 view messages)"
acceptance:
  - "subscribeView{view, params} → `view` message after the snapshot and after every rerun/commit that changes it (test for bridge and baseline.groups)"
  - "unknown view or params → problem in a `warnings` message, session stays open (test)"
gates: [G1, G2]
size: S
notes: ""
merged_at: "2026-11-23"
```

Derived series reach tier 1 the same way cells do.

## API-13 · Solver result lookup without side effects (Cockpit tiles)

```yaml
id: API-13
title: "Solver result lookup without side effects (Cockpit tiles)"
epic: API
milestone: M3
priority: must
status: done
stream: B
model: sonnet
effort: high
depends_on: [API-09, JOB-03, MOD-02]
tier: 2
package: "contract/api-contract, tier2-logic/server/src/routes/solver, tier1-presentation/web/src/modules/cockpit"
contract: "cache-only solver lookup; save flag on job payload; wire-form metric keys"
inputs:
  - "tier1-presentation/web/src/modules/cockpit/runs.ts (probe-and-cancel to remove)"
  - "tier2-logic/server/src/jobs/cache.ts, submit.ts"
acceptance:
  - "contract and server offer a side-effect-free lookup of a cached/latest solver result for (scenario, problem, params) that never enqueues (test)"
  - "job submissions carry save (default false for tile lookups; Path's explicit run decides) and JOB-03 honours it (test)"
  - "solver result metrics use the contract's wire cell keys consistently (res.net[]), mapped in one place (test)"
  - "Cockpit Odds and Fastest path use the lookup; no cancelled solver_run rows from looking at the Cockpit (test)"
  - "the trial count shown on 'Run N trials' comes from tier 2 (registry/solver defaults), not a literal in tier 1 (test)"
gates: [G1, G2, G13]
size: S
notes: "From MOD-02 review."
merged_at: "2026-11-23"
```
