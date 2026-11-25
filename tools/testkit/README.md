# @glidepath/testkit

Shared test infrastructure (QA-01; docs/architecture/08 §2, ADR-016). Test-only: import it from `devDependencies`, never from app code.

## `withTestDatabase(opts?, fn?)`

A fresh, migrated, optionally seeded Postgres database per call.

- Server: `TEST_DATABASE_URL`, else a throwaway `@glidepath/pg-local` cluster, else Testcontainers when `TESTCONTAINERS=1` and a Docker daemon answers (chosen by `getTestDatabaseUrl` of pg-local; `opts.source` injects fakes).
- Isolation: one new database per call (use one per test file), owned by a fresh non-superuser role like `glidepath_owner`; `close()` drops both. If the server role cannot create roles, the database is owned by that role instead (`db.role === null`).
- `migrate` (default true) runs `@glidepath/data-access` `migrate()` on `tier3-data/migrations` (`migrationsDir` overrides).
- `seed`: a `.sql` file, a directory of `*.sql` (sorted), an async `(db) => ...`, or a list of these; runs as the owner after migrations. A failing migration or seed drops the database and rethrows.

```ts
const db = await withTestDatabase({ seed: (d) => insertFictitiousUsers(d.url) }); // afterAll(() => db.close())
await withTestDatabase({}, async (db) => { await db.query('select 1'); }); // always closed
```

`db.url` is the owner URL (DATABASE_URL / DATABASE_URL_MIGRATE), `db.query`, `db.withClient`, `db.adminUrl`, `db.database`.

## Golden results

`golden(scenario, key)` reads `docs/spec/reference/golden_results.json`: flat spec keys verbatim (`golden('C', 'res.net')`, `'pl.eps[fy27b]'`) and nested cells `levers.L02.rr`, `vp.vp_commercial.net`. Unknown scenario or key throws. Also `goldenScenarios()`, `goldenEntries(scenario)`, `goldenDeltaV03()`, `closeToGolden(actual, expected, rel=1e-6, abs=1e-9)`.

## AA seed

`aaSeed()` (validated `TenantSeed` of `docs/spec/seed/aa`), `aaTenantData(scenarioId?)` (inputs resolved against the spec bundle), `aaScenarioIds()`, `aaDefaultScenario()`, `aaMembers(dim)`, `specBundle()`. All cached per process. The second tenant `zz` is QA-02.

## Fictitious users

`fictitiousUsers` and `insertFictitiousUsers(url)`: invented names, `@example.test` addresses (reserved TLD). The test `no-personal-data.test.ts` fails on any other e-mail address in testkit or the AA seed.

## Excel fixtures

`fixtures/excel/` with `README.md` (how each file was produced), `index.json`, `make_fixtures.py`. API: `fixturesDir`, `listFixtures()`, `fixturePath(file)`, `readFixture(file)`, `fixtureIndex()`.
