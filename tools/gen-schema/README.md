# @glidepath/gen-schema

Generates DB schema artifacts from `docs/spec/schema.json` (source of truth).

## DATA-01: DDL migration

`tier3-data/migrations/0001_schema.sql`: citext extension (allow-listed, trusted in PG 13+), 18 enum types, the 27 tables in dependency order (columns, PKs, FKs, unique constraints), the indexes of `docs/architecture/04_data_and_api.md` section 1, and `COMMENT ON` from the spec descriptions. Plain DDL: runs as a non-superuser owner (Neon). Views are DATA-03.

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

## Tests

`src/testing/db.ts` (ADR-016): `TEST_DATABASE_URL` (a superuser URL, e.g. the CI service) gets a fresh database per test file, bootstrapped by the init SQL; otherwise a `tools/pg-local` cluster started with `--init tier3-data/postgres/init`. Roles are cluster-wide and other packages' tests may share the server, so tests never rename or re-privilege `glidepath_app` / `glidepath_owner` (negative cases use throwaway roles).
