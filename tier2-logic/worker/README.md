# @glidepath/worker

`worker` container: pg-boss consumers (solvers, Excel, AI, golden runs).

Skeleton only: no feature code yet.

## DATA-08: migrate entry (`src/seed`)

`dist/migrate.js` (esbuild bundle of `src/seed/migrate.ts`, `pnpm --filter @glidepath/worker build`) is what the compose `migrate` service runs: `node dist/migrate.js --seed aa`; `pnpm seed --tenant aa` runs it from source. Settings are environment variables: `DATABASE_URL_MIGRATE` (owner role), `DEMO_USER_EMAIL` (optional; fictitious demo user with an owner membership), `DEMO_USER_NAME`, `TIER3_DATA_DIR` (default: nearest `tier3-data` above the module).

Steps: data-access `migrate()`; global definitions from `tier3-data/seed/{variables,formula_graph}.json` (model_version, dimension_def, variable_def, node_def, lever_template, canonical_pool, addr_tag; pool, addr_tag and lever library come from the tenant folder; a published model_version with other contents is an error); then `tier3-data/seed/<tenant>` in one tenant transaction: tenant, sources, locked presets (rows through the store port's `createScenario`, DOM-04 owns scenario ops), members, lines and tenant defaults in one `applyChangeset` of origin `seed`, one changeset per preset, `line_item_lever` rows. Ids are deterministic (UUIDv5). Idempotent: a rerun writes only what is missing; tenant members and defaults are never overwritten, preset cells that differ from the seed are repaired.

`tier3-data/seed` is a copy of `docs/spec`: `pnpm --filter @glidepath/worker seed:sync` refreshes it, a test fails when it drifts. Tests: `src/seed/seed.pg.test.ts` (pg-local, compose-like role bootstrap), `src/seed/seed.test.ts`.
