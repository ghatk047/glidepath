# 04 · Data tier and the logic tier's API

The data model is already specified in `model-spec/01_data_model.md` and `schema.json` (27 tables, 2 views, VR01–VR10). This page covers tier 3 (Postgres + MinIO), the tier 2 data-access layer, and the API that tier 2 exposes to tier 1. Tier 1 never sees SQL, tables or storage keys.

## 1. Tier 3 · Database

### Generation, not hand-writing

`tools/gen-schema` reads `schema.json` and emits:
- `tier2-logic/data-access/src/schema.ts` (Drizzle tables, enums, relations) for tier 2;
- `tier3-data/migrations/NNNN_*.sql` (DDL, indexes, unique constraints);
- `tier3-data/migrations/NNNN_rls.sql` (RLS policies for every table with `scope = tenant`);
- views `v_inputs_resolved` and `v_dimension_members` as SQL.

A CI check regenerates and fails on diff, so the spec stays the source of truth. Hand-written SQL is allowed only in `tier3-data/migrations/manual/` with an ADR note.

### Tenancy and row-level security

- Only `tier2-logic/data-access` opens database connections. Every request runs inside a transaction that first executes `SET LOCAL app.tenant_id = $1` and `SET LOCAL app.user_id = $2`, set by middleware from the authenticated membership.
- Policy on each tenant table: `USING (tenant_id = current_setting('app.tenant_id')::uuid)` and the same `WITH CHECK`.
- The app connects as role `glidepath_app` (no `BYPASSRLS`). Migrations and seeding use `glidepath_owner`.
- Global tables (`model_version`, `*_def`, `canonical_pool`, `addr_tag`, `lever_template`) are `SELECT`-only to `glidepath_app`.
- **Cross-tenant leak test** (testkit): seed two tenants, run every API route as tenant A, assert no tenant B row is ever returned or written. Runs in CI on every PR.

### Seed

A one-shot `migrate` container (tier 2 image, command `migrate && seed`) applies `tier3-data/migrations` and loads a tenant seed folder (`model-spec/seed/aa/`) through the same `applyChangeset()` path with `origin = seed`, so seeding is validated like any other write. The five presets are created locked. `pnpm seed --tenant aa` is idempotent (upserts by keys).

### Indexes that matter

`variable_value (tenant_id, var_key, member_key)` unique; `scenario_value (tenant_id, scenario_id, var_key, member_key)` unique; `change (tenant_id, changeset_id)`; `calc_run (tenant_id, scenario_id, input_hash)` unique; `solver_run (tenant_id, status)`.

## 2. Tier 2 · Domain: one write path

`tier2-logic/domain` exports `applyChangeset(tx, draft)`:

1. Load scenario row `FOR UPDATE`; reject if `draft.baseVersion ≠ scenario.version` (409 with the server's version and the changes made since, so the client can rebase).
2. If the scenario is a locked preset, fork `Custom (from X)` and retarget the draft.
3. Clamp or reject values outside registry min/max (UI clamps; import and API reject with a validation entry).
4. Run VR01–VR10 on the post-change state (domain ownership sums to 100%, one shared-services VP, managed services ≥ 0, retirement split ≤ 100%, …). Rules are pure functions over resolved inputs. Tier 1 learns about violations only from tier 2 responses (the WS session also returns rule warnings for previews, so the UI can show them before commit without knowing the rules).
5. Write `changeset` + `change` rows (old value, new value, var, member, origin, user, note) and upsert `scenario_value` / `variable_value` / `node_override` / structural rows (line items, members).
6. Bump `scenario.version`; recompute with the server engine; upsert `calc_run`.
7. Return `{ scenarioId, version, inputHash, outputs: headline nodes }`.

Undo = `applyChangeset(reverse(changeset))` with `origin` preserved and a `reverts` link.

## 3. Tier 2 API (the contract with tier 1)

Hono on Node in the `logic` container. Schemas live in `contract/api-contract` (zod), which is the only code shared by tiers 1 and 2. All routes are tenant-scoped by path and checked against membership. Tier 1 reaches them through Caddy at `/api` and `/ws`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/me` | User, memberships, roles |
| GET | `/api/tenants` | Tenants visible to the user |
| GET | `/api/t/:tenant/bundle` | Model bundle for the pinned `model_version` (variables, nodes, dims), cached by ETag |
| GET | `/api/t/:tenant/members` | Dimension members with attributes (+ `members_hash`) |
| GET | `/api/t/:tenant/scenarios` | Scenarios with kind, parent, version, locked |
| GET | `/api/t/:tenant/scenarios/:id/inputs` | Resolved inputs and overrides (`v_inputs_resolved`) |
| POST | `/api/t/:tenant/scenarios` | Create (copy, blend, empty child) |
| PATCH | `/api/t/:tenant/scenarios/:id` | Rename, lock, archive |
| POST | `/api/t/:tenant/changesets` | Apply a changeset (UI edits, batched) |
| POST | `/api/t/:tenant/changesets/:id/revert` | Undo |
| GET | `/api/t/:tenant/scenarios/:id/changesets` | History |
| GET | `/api/t/:tenant/scenarios/:id/calc` | Latest `calc_run` outputs (cold start, printing, export) |
| POST | `/api/t/:tenant/solver-runs` | Start a solver job |
| POST | `/api/t/:tenant/solver-runs/quick` | Run a short solver synchronously in the session (≤ 2 s) |
| GET/DELETE | `/api/t/:tenant/solver-runs/:id` | Status, result / cancel |
| POST | `/api/t/:tenant/exports` | Start an export (scenarios, sheets) → file URL |
| POST | `/api/t/:tenant/imports` | Upload a workbook → preview job |
| GET | `/api/t/:tenant/imports/:id` | Delta report, conflicts, validation, impact |
| POST | `/api/t/:tenant/imports/:id/apply` | Apply accepted rows as one changeset |
| POST | `/api/ai/reconfig` | Start an AI reconfiguration job (new or existing tenant) |
| GET | `/api/ai/reconfig/:id` | Plan, draft changeset, calibration report, open questions |
| POST | `/api/ai/reconfig/:id/apply` | Accept → create/update tenant through `applyChangeset` |
| POST | `/api/t/:tenant/market/refresh` | Manual market snapshot (price, Brent, crack) as a changeset |
| GET | `/api/t/:tenant/nodes/:cell/explain` | Formula in words, upstream chain, top drivers (trace drawer) |
| GET | `/api/t/:tenant/search?q=` | ⌘K index: inputs, levers, nodes, lines, screens |
| WS | `/ws/session?tenant&scenario` | What-if session: `subscribe`, `preview`, `cancelPreview` in; `snapshot`, `delta`, `warnings`, `job`, `changeset` out |

Errors use RFC 9457 problem JSON with a one-line human message suitable for the UI's error chip (IA §6).

## 4. How tier 1 uses the contract

- TanStack Query caches `bundle` (definitions and labels for rendering), `members`, `scenarios` (long stale times; invalidated by `changeset` WS messages).
- The WS session pushes values for the cells the open screen subscribes to; tier 1 stores them as view state only.
- Edits: drag → `preview`; release or typed entry → `POST /changesets` (debounced 400 ms, batched). On 409 (someone else committed), tier 2 returns the new version and changes; tier 1 re-sends its pending edits on the new version.
- Tier 1 never computes a value; if the WS drops, numbers dim and a "reconnecting" chip shows until the session is restored.

## 5. Tier 3 · Object storage (MinIO)

S3-compatible MinIO container locally; any S3 service later (same client, different endpoint). Buckets: `exports/` (generated workbooks, 30-day lifecycle), `export-snapshots/` (E snapshot JSON per export id, kept as long as the export row), `imports/` (uploaded files), `ai/` (research notes and sources per reconfig job). Downloads stream through tier 2 (`/api/.../files/:id`), so tier 1 never holds storage URLs or credentials.
