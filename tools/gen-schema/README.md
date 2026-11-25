# @glidepath/gen-schema

Generates DB schema artifacts from `docs/spec/schema.json` (source of truth).

## DATA-01: DDL migration

`tier3-data/migrations/0001_schema.sql`: citext extension (allow-listed, trusted in PG 13+), 18 enum types, the 27 tables in dependency order (columns, PKs, FKs, unique constraints), the indexes of `docs/architecture/04_data_and_api.md` section 1, and `COMMENT ON` from the spec descriptions. Plain DDL: runs as a non-superuser owner (Neon). Views are DATA-03 (below).

- `pnpm --filter @glidepath/gen-schema generate`: rewrite the migration files.
- `pnpm --filter @glidepath/gen-schema check`: regenerate in memory and fail on any diff (CI check; also a test).

Reading rules (see `src/model.ts`): columns are NOT NULL unless the spec says `nullable`; `pk part` columns get `tenant_id` prepended; `fk dimension_member(vendor|domain)` cannot be a Postgres FK (discriminated target) and is left to VR09 in tier 2 (noted as a comment in the DDL); tables with no pk in the spec use `NATURAL_KEYS`.

## DATA-02: RLS, roles and grants

`tier3-data/migrations/0002_rls.sql`, from each table's `scope` (`src/rls.ts`):

- **Tenant-scoped** (`tenant`, `tenant-root`, `tenant or global`; 19 tables): `ENABLE` + `FORCE ROW LEVEL SECURITY` and policy `tenant_isolation` `USING`/`WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)` (`id = ...` on `tenant`). `missing_ok` + `NULLIF` make an unset or reset setting NULL, so no tenant context means no rows (not an error). FORCE applies it to the owner too: seeds set the tenant like the app.
- Extra policies, each tested: `source` global rows (`tenant_id IS NULL`) are readable by all and writable only by the owner (`global_rows_read`, `global_rows_owner` `TO CURRENT_USER`); before a tenant is chosen (`app.tenant_id` unset), `app.user_id` reads its own `tenant_membership` rows and those `tenant` rows (`own_memberships`, `own_tenants`; login, `/api/me`, resolving `/api/t/:tenant`); FKs to another tenant-scoped table that do not carry `tenant_id` (`change.changeset_id`, `line_item.source_id`) get a RESTRICTIVE `*_same_tenant` policy, because FK checks bypass RLS.
- **Grants to `glidepath_app`**: global tables `SELECT`; tenant tables `SELECT, INSERT, UPDATE, DELETE`; `tenant` without `DELETE`; `audit_log` `SELECT, INSERT` (append-only) plus its sequence. Never `TRUNCATE` (bypasses RLS).
- **Roles are not created by migrations** (ADR-015). The file starts with a check: `glidepath_app` must exist and be `NOSUPERUSER NOBYPASSRLS` (else the file aborts); a membership in a SUPERUSER/BYPASSRLS role raises a WARNING.
- Tenant context per transaction only: `SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`.

Local role bootstrap: `tier3-data/postgres/init` (docker `/docker-entrypoint-initdb.d`, or `pnpm pg:local start --init tier3-data/postgres/init`): `01_roles.sql` creates `glidepath_owner` and `glidepath_app` (LOGIN, NOSUPERUSER, NOBYPASSRLS, no memberships; cluster-wide, idempotent, so other test harnesses can run it alone), `02_database_owner.sql` gives the current database to `glidepath_owner`, `03_role_passwords.sh` (docker only) sets passwords from `OWNER_DB_PASSWORD` / `APP_DB_PASSWORD`. On Neon create the roles there; create `glidepath_app` with plain SQL so it is not a member of a privileged role.

## DATA-03: views

`tier3-data/migrations/0003_views.sql` (`src/views.ts`): `v_inputs_resolved` and `v_dimension_members`, both `WITH (security_invoker = true)` so the caller's RLS applies (a default view runs as its owner and would bypass it); `SELECT` granted to `glidepath_app`, comments from the `views` of schema.json.

- **`v_inputs_resolved`**: a view cannot take parameters, so "(tenant, scenario)" means filtering on `tenant_id` and `scenario_id` (order in the caller). Per `(scenario, var_key, member_key)` the last level wins: tenant default (`variable_value`), then each scenario of the parent chain from the root down to the scenario itself (`scenario_value`; recursive CTE, a parent cycle ends the chain). Only variables of the tenant's pinned model version (`variable_def`) are returned. `variable_def` carries no default value, so the definition level only decides which variables exist; a variable no level sets has no row. Rows with `scenario_id` NULL are the tenant defaults alone. Columns: `tenant_id, scenario_id, kind` (`input` | `override`)`, key` (var_key or node_key)`, member_key, value, resolved_from` (`tenant` | `parent` | `scenario`, as `ResolvedFrom` in the api-contract)`, from_scenario_id, confidence, note, reason`. `kind = override` rows are the scenario's own `node_override`s (not inherited). Same semantics as `resolveInputs` in `tier2-logic/domain`; both are tested on `tier2-logic/domain/fixtures/scenario-chain-3.json`.
- **`v_dimension_members`**: `tenant_id` (NULL = global), `dim_key, member_key, label, attrs` (jsonb)`, sort, active, origin` (`global` | `system` | `tenant` | `line_item`). Global: `canonical_pool` as dim `pool` (attrs `third_party` 0/1, `order`), `addr_tag`, and the `system` dimensions of formula_graph.json (`akey`, `year`, `iyear`), whose members no table holds: they are rendered from the spec bundle (`docs/spec/seed/aa/dimension_members.json`) into the SQL, so the seed must not insert them into `dimension_member` (rows of a dimension served here are left out of the tenant branch). Tenant: `dimension_member`, and `line_item` as dim `line` with attrs named as in `formula_graph.json` (`pool, domain, addr, drv, vendor, lever_ids, in_scope, memo, source, ...`; generation fails if the two differ). Flags are 0/1 numbers as in the seed (`third_party == 1` in expressions). `sort` of `line` and `addr_tag` is the row order by key (their tables have no sort column).

## Tests

`src/testing/db.ts` (ADR-016): `TEST_DATABASE_URL` (a superuser URL, e.g. the CI service) gets a fresh database per test file, bootstrapped by the init SQL; otherwise a `tools/pg-local` cluster started with `--init tier3-data/postgres/init`. Roles are cluster-wide and other packages' tests may share the server, so tests never rename or re-privilege `glidepath_app` / `glidepath_owner` (negative cases use throwaway roles).

## Manual overlay (ADR-023, FIX-02)

`src/manual-overlay.ts` declares the columns and tables that hand-written migrations in `tier3-data/migrations/manual/` add on top of `schema.json` (`scenario.archived`, `solver_run` progress columns, `auth_token`, `auth_session`, `passkey`, `stored_object`, and the DATA-12 same-tenant keys: `UNIQUE (tenant_id, id)` on `scenario`/`changeset` and composite `(tenant_id, x)` foreign keys, via `addedKeys`). `buildFullModel` (spec model + overlay) feeds the typed Drizzle schema (`tier2-logic/data-access` `gen:drizzle`) only; the generated SQL still comes from `buildModel`, so the manual SQL stays the source of that DDL and `gen-schema check` is unaffected. Only what Drizzle models goes in the overlay: columns, primary/unique/foreign keys, indexes. CHECKs, triggers, RLS and grants stay in SQL.

`src/manual-overlay.pg.test.ts` applies generated + manual migrations to a database and compares them with the full model (`catalog-diff.ts`: table set, column order, types, nullability, defaults, keys, FK delete action, indexes, RLS of tenant tables); a changed type, nullability, default, key, index, or a column or table present on one side only fails it. Each manual migration that changes the schema needs an overlay entry.
