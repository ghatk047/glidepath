# DATA · Tier 3 and data-access

Schema, RLS and views generated from `schema.json`, the data-access package (the only tier-2 package that touches tier 3), seed, object store, leak test. Database configured by `DATABASE_URL` / `DATABASE_URL_MIGRATE` only (ADR-015) so the owner can move to Neon later.

11 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| DATA-01 | tools/gen-schema: DDL migrations from schema.json | M0 | sonnet/high | M | FND-05, FND-01 |
| DATA-02 | RLS policies, roles and grants | M0 | opus/xhigh | M | DATA-01 |
| DATA-03 | Views v_inputs_resolved and v_dimension_members | M0 | sonnet/high | S | DATA-02 |
| DATA-11 | Manual migrations: solver_run progress/cancel and auth tables | M0 | sonnet/medium | S | DATA-02 |
| DATA-04 | data-access: DB client config, Drizzle schema and migration runner | M0 | sonnet/high | M | DATA-01, FND-07 |
| DATA-05 | Tenant-scoped transactions and read repositories | M1 | opus/xhigh | M | DATA-04, DATA-03, DOM-01 |
| DATA-06 | Write repositories implementing the domain ChangesetStore port | M1 | sonnet/high | M | DATA-05, DOM-01 |
| DATA-07 | Object store client and buckets | M3 | sonnet/medium | S | DATA-04 |
| DATA-08 | migrate entry: model defs + AA seed through applyChangeset | M1 | sonnet/medium | M | DATA-06, DOM-03, SPEC-03 |
| DATA-09 | Neon readiness: migrations, seed and runtime over sslmode=require | M4 | sonnet/high | M | DATA-08, FND-07 |
| DATA-10 | RLS catalog check and repository-level leak test | M1 | opus/xhigh | S | DATA-06 |

## DATA-01 · tools/gen-schema: DDL migrations from schema.json

```yaml
id: DATA-01
title: "tools/gen-schema: DDL migrations from schema.json"
epic: DATA
milestone: M0
priority: must
status: done
stream: B
model: sonnet
effort: high
depends_on: [FND-05, FND-01]
tier: 3
package: "tools/gen-schema (writes tier3-data/migrations/NNNN_*.sql)"
contract: "Generated DDL for the 27 tables"
inputs:
  - "docs/architecture/04_data_and_api.md#Generation, not hand-writing"
  - "docs/architecture/04_data_and_api.md#Indexes that matter"
  - "docs/spec/schema.json (tables)"
  - "docs/spec/01_data_model.md#2. Entity map"
  - "docs/adr/ADR-015-database-portability.md"
acceptance:
  - "emits CREATE TABLE for all 27 tables in schema.json with columns, types, PKs, FKs, unique constraints (test: applies cleanly on pg-local; catalog has 27 tables)"
  - "indexes of 04 §1: variable_value(tenant_id, var_key, member_key) unique; scenario_value(tenant_id, scenario_id, var_key, member_key) unique; change(tenant_id, changeset_id); calc_run(tenant_id, scenario_id, input_hash) unique; solver_run(tenant_id, status) (test: catalog query)"
  - "no superuser-only statements (no CREATE EXTENSION outside an allow-list, no ALTER SYSTEM) so migrations run as a Neon owner role (test: grep + run as non-superuser owner on pg-local)"
  - "CI regenerate-and-diff check (test)"
gates: [G1, G2]
size: M
notes: ""
merged_at: "2026-11-23"
```

Schema from the spec, never hand-written.

## DATA-02 · RLS policies, roles and grants

```yaml
id: DATA-02
title: "RLS policies, roles and grants"
epic: DATA
milestone: M0
priority: must
status: in_progress
stream: B
model: opus
effort: xhigh
depends_on: [DATA-01]
tier: 3
package: "tools/gen-schema (writes tier3-data/migrations/NNNN_rls.sql) + tier3-data/postgres/init"
contract: "RLS on every scope=tenant table"
inputs:
  - "docs/architecture/04_data_and_api.md#Tenancy and row-level security"
  - "docs/spec/schema.json (tables.*.scope, principles)"
  - "docs/adr/ADR-015-database-portability.md"
acceptance:
  - "every table with scope tenant (and tenant-root) gets ENABLE + FORCE ROW LEVEL SECURITY and a policy USING/WITH CHECK tenant_id = current_setting('app.tenant_id')::uuid (test: catalog query, all tenant tables covered)"
  - "global tables (model_version, *_def, canonical_pool, addr_tag, lever_template, app_user) are SELECT-only to glidepath_app (test: INSERT as app fails)"
  - "role bootstrap in tier3-data/postgres/init (local only): glidepath_owner (owns objects) and glidepath_app (LOGIN, NOSUPERUSER, NOBYPASSRLS); migrations assume roles exist and only GRANT (test on pg-local --init)"
  - "app role with no app.tenant_id set sees 0 rows in every tenant table (test)"
gates: [G1, G2, G7]
size: M
notes: "Neon: roles are created in the Neon console; migrations never CREATE ROLE."
```

Tenant isolation in the database itself.

## DATA-03 · Views v_inputs_resolved and v_dimension_members

```yaml
id: DATA-03
title: "Views v_inputs_resolved and v_dimension_members"
epic: DATA
milestone: M0
priority: must
status: todo
stream: B
model: sonnet
effort: high
depends_on: [DATA-02]
tier: 3
package: "tools/gen-schema (writes tier3-data/migrations/NNNN_views.sql)"
contract: "v_inputs_resolved(tenant, scenario), v_dimension_members"
inputs:
  - "docs/spec/schema.json (views)"
  - "docs/spec/01_data_model.md#4. How a scenario resolves"
  - "docs/architecture/04_data_and_api.md#Generation, not hand-writing"
acceptance:
  - "v_inputs_resolved returns definition → tenant default → parent chain → scenario, last wins, plus the scenario's node overrides (test: 3-level scenario chain fixture on pg-local)"
  - "v_dimension_members = UNION of global members (canonical_pool, addr_tag, system dims), dimension_member and line_item with attrs as jsonb (test)"
  - "views are security_invoker so RLS applies to the caller (test as glidepath_app)"
gates: [G1, G2, G7]
size: S
notes: ""
```

What the engine loads, resolved in SQL.

## DATA-11 · Manual migrations: solver_run progress/cancel and auth tables

```yaml
id: DATA-11
title: "Manual migrations: solver_run progress/cancel and auth tables"
epic: DATA
milestone: M0
priority: must
status: todo
stream: B
model: sonnet
effort: medium
depends_on: [DATA-02]
tier: 3
package: "tier3-data/migrations/manual"
contract: "ADR-023 columns and tables"
inputs:
  - "docs/adr/ADR-023-manual-migrations.md"
  - "docs/architecture/03_engine_and_solvers.md#4. Job runtime"
  - "docs/architecture/01_architecture_overview.md#4. Key decisions (ADR summary) (ADR-014)"
acceptance:
  - "solver_run gains progress real, progress_note text, cancel_requested boolean default false, updated_at (test: catalog)"
  - "global tables auth_token (hashed single-use token, expires_at), auth_session (id, user_id, expires_at), passkey (credential id, public key, user_id) with grants to glidepath_app (test)"
  - "each manual migration file names ADR-023 in a header comment (test: grep)"
gates: [G1, G2]
size: S
notes: "Spec gap: schema.json has no progress/cancel or auth storage."
```

Small, explicit additions to the generated schema.

## DATA-04 · data-access: DB client config, Drizzle schema and migration runner

```yaml
id: DATA-04
title: "data-access: DB client config, Drizzle schema and migration runner"
epic: DATA
milestone: M0
priority: must
status: in_progress
stream: B
model: sonnet
effort: high
depends_on: [DATA-01, FND-07]
tier: 2
package: "tier2-logic/data-access"
contract: "createDb(DATABASE_URL), migrate(DATABASE_URL_MIGRATE)"
inputs:
  - "docs/adr/ADR-015-database-portability.md"
  - "docs/architecture/04_data_and_api.md#1. Tier 3 · Database"
  - "docs/architecture/11_docker_deployment.md#4. Configuration (12-factor)"
  - "docs/spec/schema.json (tables)"
acceptance:
  - "Drizzle table definitions generated from schema.json by data-access/scripts/gen-drizzle.ts; checked in; CI regenerate-and-diff (test)"
  - "createDb reads only DATABASE_URL; TLS from the URL (sslmode=require works against pg-local --ssl) (test)"
  - "pool is transaction-pooler safe: no session-level SET, prepared statements off by default, configurable pool size (test: config unit)"
  - "migrate() applies tier3-data/migrations (generated, then manual) in order with a tracking table, idempotent, using DATABASE_URL_MIGRATE as a non-superuser owner (test on pg-local)"
gates: [G1, G2]
size: M
notes: ""
```

The only package that opens DB connections; configured by URL alone so Neon is a config change.

## DATA-05 · Tenant-scoped transactions and read repositories

```yaml
id: DATA-05
title: "Tenant-scoped transactions and read repositories"
epic: DATA
milestone: M1
priority: must
status: todo
stream: B
model: opus
effort: xhigh
depends_on: [DATA-04, DATA-03, DOM-01]
tier: 2
package: "tier2-logic/data-access"
contract: "withTenant(tenantId, userId, fn); read repositories"
inputs:
  - "docs/architecture/04_data_and_api.md#Tenancy and row-level security"
  - "docs/spec/schema.json (tables, views)"
  - "tier2-logic/domain/src/ports.ts (DOM-01)"
acceptance:
  - "withTenant runs fn in one transaction that first executes SET LOCAL app.tenant_id and app.user_id (test: settings visible inside, gone after commit)"
  - "read repos: model bundle defs (global tables), members via v_dimension_members (+ members_hash), scenarios, resolved inputs via v_inputs_resolved, changeset history, latest calc_run, memberships (test with pg-local + minimal seed)"
  - "a repo call outside withTenant throws (test)"
  - "all queries parameterised; no string-built SQL (lint + test)"
gates: [G1, G2, G7]
size: M
notes: ""
```

Every read goes through RLS with the tenant set per transaction.

## DATA-06 · Write repositories implementing the domain ChangesetStore port

```yaml
id: DATA-06
title: "Write repositories implementing the domain ChangesetStore port"
epic: DATA
milestone: M1
priority: must
status: todo
stream: B
model: sonnet
effort: high
depends_on: [DATA-05, DOM-01]
tier: 2
package: "tier2-logic/data-access"
contract: "ChangesetStore (DOM-01 port) implementation"
inputs:
  - "tier2-logic/domain/src/ports.ts (DOM-01)"
  - "docs/architecture/04_data_and_api.md#2. Tier 2 · Domain: one write path"
  - "docs/spec/schema.json (tables.changeset, change, scenario_value, variable_value, node_override, line_item, dimension_member, calc_run, audit_log)"
acceptance:
  - "implements loadScenarioForUpdate (SELECT … FOR UPDATE), writeChangeset + change rows, upserts for scenario_value / variable_value / node_override / structural rows, bumpVersion, upsertCalcRun, audit_log rows, inside the caller's withTenant transaction (test per method on pg-local)"
  - "job repos: solver_run, export_job, import_job, ai_reconfig_job CRUD (test)"
  - "writing a row with another tenant_id fails the RLS WITH CHECK (test)"
gates: [G1, G2, G7]
size: M
notes: ""
```

The persistence side of the single write path.

## DATA-07 · Object store client and buckets

```yaml
id: DATA-07
title: "Object store client and buckets"
epic: DATA
milestone: M3
priority: must
status: todo
stream: B
model: sonnet
effort: medium
depends_on: [DATA-04]
tier: 2
package: "tier2-logic/data-access/src/objects"
contract: "ObjectStore port: put/get/stream/list/delete"
inputs:
  - "docs/architecture/04_data_and_api.md#5. Tier 3 · Object storage (MinIO)"
  - "docs/architecture/11_docker_deployment.md#4. Configuration (12-factor)"
acceptance:
  - "S3 client configured by S3_ENDPOINT/keys only; buckets exports, export-snapshots, imports, ai created idempotently by migrate; 30-day lifecycle on exports (test against MinIO when S3_ENDPOINT set, else the in-memory/fs adapter)"
  - "in-memory and filesystem adapters implement the same port for tests without MinIO (test: shared contract suite)"
  - "no storage URL ever leaves tier 2: stream API only (test)"
gates: [G1, G2]
size: S
notes: ""
```

Workbooks and AI audit files, behind a port so tests need no MinIO.

## DATA-08 · migrate entry: model defs + AA seed through applyChangeset

```yaml
id: DATA-08
title: "migrate entry: model defs + AA seed through applyChangeset"
epic: DATA
milestone: M1
priority: must
status: todo
stream: B
model: sonnet
effort: medium
depends_on: [DATA-06, DOM-03, SPEC-03]
tier: 2
package: "tier2-logic/worker/src/seed"
contract: "`node dist/migrate.js --seed aa` and `pnpm seed --tenant aa`"
inputs:
  - "docs/architecture/04_data_and_api.md#Seed"
  - "docs/spec/01_data_model.md#7. What the AA seed contains"
  - "docs/spec/seed/aa/"
  - "docs/spec/07_multitenancy_reconfiguration.md#1. What is global and what is per airline"
acceptance:
  - "migrate.js runs data-access migrate(), loads global defs (model_version, dimension_def, variable_def, node_def, canonical_pool, addr_tag, lever_template) from docs/spec JSON copied to tier3-data/seed (test on pg-local)"
  - "loads tier3-data/seed/aa (copied from docs/spec/seed/aa) through applyChangeset with origin = seed: tenant, dimension_member, line_item, line_item_lever, source, variable_value, scenario, scenario_value rows; five presets created locked; default scenario C (test)"
  - "idempotent: a second run makes 0 changes (test)"
  - "creates a fictitious demo user + owner membership from env (DEMO_USER_EMAIL) (test)"
  - "after seed, resolved inputs for C equal seedToTenantData(C) cell for cell (test)"
gates: [G1, G2, G3]
size: M
notes: "M0 exit 'AA seed loaded' is met at M0 by raw JSON in tests (SPEC-03) and in the DB here, early M1; recorded in plan.md."
```

Seeding uses the same validated write path as every other write.

## DATA-09 · Neon readiness: migrations, seed and runtime over sslmode=require

```yaml
id: DATA-09
title: "Neon readiness: migrations, seed and runtime over sslmode=require"
epic: DATA
milestone: M4
priority: should
status: todo
stream: B
model: sonnet
effort: high
depends_on: [DATA-08, FND-07]
tier: 2
package: "tier2-logic/data-access (+ docs/ops/neon.md)"
contract: "ADR-015 portability promises"
inputs:
  - "docs/adr/ADR-015-database-portability.md"
  - "docs/architecture/11_docker_deployment.md#5. Moving to a cloud server later"
  - "docs/architecture/04_data_and_api.md#Tenancy and row-level security"
acceptance:
  - "migrations + AA seed run against a URL with sslmode=require (test: neon-readiness.spec.ts on pg-local --ssl)"
  - "full repository suite passes as an app role without SUPERUSER, CREATEROLE or BYPASSRLS (test)"
  - "pooler compatibility: tenant context via SET LOCAL only; no session SET, session advisory locks or LISTEN/NOTIFY in request paths; works with prepared statements disabled (test; through pgbouncer transaction mode if the binary is available)"
  - "docs/ops/neon.md: create roles in Neon, DATABASE_URL (pooled) and DATABASE_URL_MIGRATE (direct), run the migrate container, pg-boss connection note (test: file exists with these headings)"
gates: [G1, G2, G7]
size: M
notes: "POST-safe: nothing depends on it; if M4 is tight the orchestrator moves it to POST."
```

Proves the owner can switch DATABASE_URL to Neon later without code changes.

## DATA-10 · RLS catalog check and repository-level leak test

```yaml
id: DATA-10
title: "RLS catalog check and repository-level leak test"
epic: DATA
milestone: M1
priority: must
status: todo
stream: B
model: opus
effort: xhigh
depends_on: [DATA-06]
tier: 2
package: "tier2-logic/data-access (test/leak)"
contract: "`pnpm test:leak` (repository layer, G7)"
inputs:
  - "docs/architecture/04_data_and_api.md#Tenancy and row-level security"
  - "docs/architecture/08_quality_and_testing.md#1. Gates (G7)"
  - "docs/spec/schema.json (tables.*.scope)"
acceptance:
  - "catalog test: every scope=tenant table has relrowsecurity and relforcerowsecurity; glidepath_app has no BYPASSRLS (G7)"
  - "two tenants seeded; every read repo as tenant A returns 0 tenant-B rows and every write with tenant B's id fails (test: leak.repos.spec.ts)"
  - "the repository list is discovered from data-access exports so a new repo without a leak case fails the test (test)"
gates: [G1, G2, G7]
size: S
notes: "Route-level leak test (3 tenants) is QA-03."
```

First half of G7.
