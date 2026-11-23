# @glidepath/gen-schema

Generates DB schema artifacts from `docs/spec/schema.json` (source of truth).

## DATA-01: DDL migration

`tier3-data/migrations/0001_schema.sql`: citext extension (allow-listed, trusted in PG 13+), 18 enum types, the 27 tables in dependency order (columns, PKs, FKs, unique constraints), the indexes of `docs/architecture/04_data_and_api.md` section 1, and `COMMENT ON` from the spec descriptions. Plain DDL: runs as a non-superuser owner (Neon). Roles, RLS and views are other items (DATA-02, DATA-03).

- `pnpm --filter @glidepath/gen-schema generate`: rewrite the migration files.
- `pnpm --filter @glidepath/gen-schema check`: regenerate in memory and fail on any diff (CI check; also a test).

Reading rules (see `src/model.ts`): columns are NOT NULL unless the spec says `nullable`; `pk part` columns get `tenant_id` prepended; `fk dimension_member(vendor|domain)` cannot be a Postgres FK (discriminated target) and is left to VR09 in tier 2 (noted as a comment in the DDL); tables with no pk in the spec use `NATURAL_KEYS`.

Tests need Postgres 16 binaries (`/usr/lib/postgresql/16/bin`, override `PG_BIN_DIR`) or `TEST_DATABASE_URL` (ADR-016).
