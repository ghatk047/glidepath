# @glidepath/data-access

Repositories over tier 3: Drizzle schema, queries, RLS session, object store client. The only tier-2 package that opens database connections.

## DATA-10: G7 leak tests (`pnpm test:leak`)

`test/leak/` (also part of `pnpm test`), on a migrated pg-local database with two tenants (`seed.ts`: the DATA-05 minimal seed plus rows of A and B in every tenant table it leaves empty), as `glidepath_app`:

- `rls-catalog.spec.ts`: tenant tables are discovered (schema.json scope other than `global`, plus any table with a `tenant_id` column, so manual tables such as `stored_object` and later ones count). `catalog.ts` `rlsViolations()` requires ENABLE + FORCE RLS, a permissive `key = app.tenant_id` policy for every command the app role is granted, no permissive policy that widens it, no TRUNCATE/REFERENCES/TRIGGER or ownership for the app role, a restrictive same-tenant policy on every FK between tenant tables that does not carry the tenant, `security_invoker` on views over tenant tables, SELECT-only global tables, and `glidepath_app` without SUPERUSER/BYPASSRLS (nor membership of such a role). A self-test adds a careless table, policy, FK, view and BYPASSRLS in rolled-back transactions and expects each violation. Every tenant table is then probed: as tenant A no B row is visible, updatable or deletable, a row with B's id (or an FK to a B row) is refused by RLS, and without a tenant nothing is visible.
- `leak.repos.spec.ts`: every function or class data-access exports is a repository with a leak case, an error class, or listed in `NOT_REPOSITORIES` (checked not to call a scope guard); `ChangesetTx` methods and `PostgresObjectStore` methods are read from the objects. Each repository runs as tenant A (works, no B data), aimed at B's ids (nothing found / refused), and with tenant B's id in data-access's scope over a connection whose `app.tenant_id` is A (writes refused, nothing of B read). "B data" is every value found only in B's rows (catalog-wide), and B's stored rows are compared after every call.

## DATA-06: write repositories (the domain ChangesetStore port)

`src/write` implements `ChangesetStore` / `ChangesetTx` of `@glidepath/domain` (ADR-019) over Postgres, so `applyChangeset` writes through it. Every method runs on the transaction of a live `withTenant` (`tenantScope` check, `TenantScopeError` otherwise), `tenant_id` comes from that scope, and RLS applies.

- `createChangesetStore(tx)`: the store bound to the caller's `withTenant` transaction. `transaction(fn)` runs `fn` in a savepoint, so a throw undoes what `fn` wrote and the caller's transaction stays usable; commit is the caller's.
- `createTenantChangesetStore(db, tenantId, userId)`: for the server; each `transaction(fn)` is its own `withTenant` (commit on return, rollback on a throw).
- `changesetTx(tx)`: the port view alone.

| Port method | Postgres |
|---|---|
| `loadScenarioForUpdate` | `select ... from scenario ... for update` |
| `lockTenantDefaults` | `pg_advisory_xact_lock(hashtextextended('glidepath:tenant-defaults:<tenant>', 0))` (transaction scoped, pooler safe) |
| `loadScenarios`, `loadInputs`, `loadMembers`, `loadMemberRows`, `loadChangeset`, `findChangesetByClientRequest`, `changesSince` | `loadInputs` reads the stored rows (variable_value, scenario_value per level of the chain, node_override), the last level being the scenario itself even without rows; `loadMembers` is `members` of the read repository (active only); `changesSince` is status `applied` or `reverted`; `findChangesetByClientRequest` matches `changeset.summary ->> 'client_request_id'` |
| `createScenario`, `insertChangeset` (+ change rows), `setChangesetStatus`, `appendAudit` | inserts / update; the change note is in `change.messages`, `client_request_id` and `edits_count` in `changeset.summary` |
| `writeValue` | upsert (`on conflict`) or delete of variable_value (`note`, `changeset_id`, `updated_at`), scenario_value, node_override (`reason`); the scenario must be the tenant's |
| `writeMember` | line_item / dimension_member: update the named columns of an existing row, else insert; `row: null` deletes (a line's line_item_lever rows go with it); a column the table lacks is an error |
| `bumpVersion` | `update scenario set version = from + 1 where version = from`; `ScenarioVersionError` if it moved |
| `findCalcRun`, `upsertCalcRun` | `calc_run` keyed `(scenario_id, input_hash)`; `ms` is rounded (integer column) |

Choices the port leaves open: a new `variable_value` row gets confidence `M` (`DEFAULT_NEW_VALUE_CONFIDENCE`, option `newValueConfidence`), an existing row keeps its confidence and source; a value write without a note clears the row's note (as the in-memory store does); JSON `null` in a NOT NULL jsonb column is written as `'null'::jsonb`. `findChangesetByClientRequest` scans the author's changesets (no index on `created_by` or the summary key); add one in a manual migration if history grows large.

`src/jobs` holds the job repositories, all tenant-scoped like the read repositories: `create/get/list/update/delete` for `solver_run` (incl. progress, `cancel_requested`), `export_job`, `import_job` and `ai_reconfig_job`.

`write/changeset-store.pg.test.ts` runs each method on pg-local, the DOM-03 behaviours (replay, fork, conflict, clamp, undo, note, edits count) through the real `applyChangeset`, a cross-tenant WITH CHECK test per written table, and lock tests on two connections; `jobs/jobs.pg.test.ts` covers the job repositories.

## DATA-04: DB client, Drizzle schema, migration runner

- `createDb(DATABASE_URL, options?)` returns `{ db, pool, close() }` (Drizzle over a `pg` pool). It reads only the URL it is given: host, role, database and TLS (`sslmode`, libpq semantics: `require` = encrypted without certificate verification, `verify-ca`/`verify-full` = verified). Pooler safe (ADR-015): no startup options, no session-level SET, named prepared statements dropped unless `preparedStatements: true`, pool size via `poolMax` (default 10). `dbOptionsFromEnv()` reads the optional `DB_POOL_MAX` / `DB_PREPARED_STATEMENTS` for callers that want them. Tenant context belongs in `db.transaction` with `SET LOCAL` / `set_config(..., true)`.
- `migrate(DATABASE_URL_MIGRATE, { dir? })` applies `tier3-data/migrations/*.sql` (generated) then `tier3-data/migrations/manual/*.sql` (ADR-023), each in its own transaction with a row in `schema_migration` (id, sha256 checksum, applied_at). Idempotent; an applied file that changed is an error; concurrent runs are serialised with a transaction-scoped advisory lock. Runs as the non-superuser owner role.
- `src/schema.ts` is generated by `scripts/gen-drizzle.ts` from `docs/spec/schema.json` (same relational model as the DDL, via `tools/gen-schema`) plus the manual overlay (`tools/gen-schema/src/manual-overlay.ts`: columns and tables added by ADR-023 manual migrations, e.g. `scenario.archived`, `solver_run` progress columns, `auth_token`, `auth_session`, `passkey`, `stored_object`). A new manual migration that adds columns or tables needs an overlay entry; `migrate.pg.test.ts` compares `schema.ts` and the model with the fully migrated database. `pnpm --filter @glidepath/data-access gen:drizzle` rewrites it; `check:drizzle` regenerates and fails on diff (also a test).

Tests use `TEST_DATABASE_URL` or a throwaway `tools/pg-local` cluster (ADR-016); the TLS tests always start `pg-local --ssl`.

## DATA-07: ObjectStore port (ADR-025)

`ObjectStore` (`src/objects`): `put / get / stream / list / delete` plus `purgeExpired`, bound to one tenant, buckets `exports`, `export-snapshots`, `imports`, `ai` as a key prefix. `PostgresObjectStore(db, tenantId, userId)` stores in `stored_object` (manual migration `tier3-data/migrations/manual/0003_stored_object.sql`, FORCE RLS) via `withTenant`; `MemoryObjectStore` is the in-memory twin. Both run the shared suite in `objects/contract.ts`. Objects over 50 MB are rejected, sha256 is stored and verified on read, `exports` expire after 30 days, expired objects are invisible. Only bytes/streams leave the port, never a URL.

## DATA-05: tenant-scoped transactions and read repositories

- `withTenant(db, tenantId, userId, fn)` runs `fn` in one transaction whose first statement is `select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)` (= `SET LOCAL`, values bound; gone at COMMIT/ROLLBACK). The contract's `withTenant(tenantId, userId, fn)` is this bound to the app's `Db` (server `bindWithTenant`). Empty ids are refused. `withUser(db, userId, fn)` is the pre-tenant twin: `app.user_id` set, `app.tenant_id` cleared, so RLS shows only the user's own memberships and tenants (`own_memberships`, `own_tenants`).
- Read repositories (`src/repos`) take the transaction handed to `fn` and throw `TenantScopeError` before any SQL for anything else: the plain `Db`, a bare `db.transaction`, or a transaction kept after its `withTenant` returned. Savepoints opened from it (`tx.transaction(...)`) keep the scope.

| Repository | Reads | Returns |
|---|---|---|
| `loadModelDefs(tx)` | model_version, dimension_def, variable_def, node_def, lever_template of the pinned model version | `ModelDefs` (lists by key) |
| `loadMembers(tx)` | v_dimension_members, dims of the pinned model | `{ rows, members: TenantMembers, membersHash }` |
| `listScenarios(tx)`, `getScenario(tx, id)` | scenario | `ScenarioRecord` (domain `ScenarioRow` + archived) |
| `loadEditsCounts(tx, scenarioIds)` | scenario, changeset | `Map<scenarioId, editsCount>`: `summary.edits_count` of the applied changeset with `base_scenario_version = version - 1` (the domain's stored counter, DOM-03), 0 if none; one query for all ids |
| `loadResolvedInputs(tx, scenarioId \| null)` | v_inputs_resolved | `{ scenario_id, values, overrides }` (domain `ResolvedInputs` shape + provenance) |
| `listChangesetHistory(tx, scenarioId \| null, { limit, cursor })`, `getChangeset(tx, id)` | changeset, change, app_user | domain `Changeset` + `created_by_name`, newest first, keyset cursor |
| `getLatestCalcRun(tx, scenarioId)` | calc_run | domain `CalcRunRow` |
| `getTenant`, `listTenantMembers`, `getCurrentUser` | tenant, tenant_membership, app_user | tenant scope (`getCurrentUser`: either) |
| `listMyMemberships(tx)`, `findMyMembership(tx, slug)` | tenant_membership, tenant | `withUser` scope: the user's tenants and roles |

- Member order is the spec's (engine SUM order, parity): `sort`, then `member_key` in code-point order. `members` holds active members only, as `{ id, label, ...attrs }`; `rows` holds every member with `active`.
- Ids that are not uuids answer "not found" without querying (a failed cast would abort the caller's transaction). A malformed history cursor throws `InvalidCursorError`.
- Every query is parameterised: drizzle `sql` tag or query builder only. This package's `eslint.config.js` rejects, in runtime `src` (not tests, `src/testing` or the migration runner), `.execute()` of anything but a `sql` template, `sql.raw()` of anything but a string literal, and node-postgres `.query()`. `src/sql-safety.test.ts` checks the rule; `src/repos/repos.pg.test.ts` checks on the wire that ids, slugs and cursors travel only as bind parameters.
- Tests run as `glidepath_app` (`src/testing/app-db.ts`) on a two-tenant seed (`src/testing/minimal-seed.ts`, the scenario chain of `tier2-logic/domain/fixtures/scenario-chain-3.json`), including a repository-level cross-tenant leak check (G7).
