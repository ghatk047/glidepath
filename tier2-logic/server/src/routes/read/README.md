# Read routes (API-04)

`registerReadRoutes(app, { specBundle })` mounts the read half of 04 section 3 on `/api/t/:tenant/*`, after the tenant middleware (authenticated, path tenant resolved against memberships: no membership is a 404 problem, handler inside `withTenant`). `createApp` calls it; `AppDeps.specBundle` overrides the spec source.

| Route | Answer (`@glidepath/api-contract`) | Source |
|---|---|---|
| `GET bundle` | `BundleResponse`, `ETag` (SHA-256 of the body), `304` on `If-None-Match` (lists, `W/`, `*`) | `loadModelDefs` + spec bundle |
| `GET members` | `MembersResponse`: every member (active or not) per dimension of the pinned model, in spec order, plus `membersHash` | `loadMembers` |
| `GET scenarios` | `ScenariosResponse` (kind, parent, version, locked, archived, `editsCount`) | `listScenarios` + history |
| `GET scenarios/:id/inputs` | `InputsResponse`: resolved inputs with provenance, the scenario's own overrides | `getScenario`, `loadResolvedInputs` |
| `GET scenarios/:id/changesets?cursor&limit` | `ChangesetHistoryResponse`, newest first, keyset `nextCursor` | `listChangesetHistory` |

Every body is checked against its contract schema before it is sent (`mappers.ts` `checked`); a mismatch is a server bug and answers 500, never 422. A scenario that is not the tenant's, or whose id is not a uuid, is a 404 problem. A malformed cursor is 400, a bad `limit` 422.

## Bundle: fields filled from the spec

`variable_def` and `dimension_def` lack `kind`, `scenario_varies`, `source`, `confidence`, `note` and the dimension `label`. `buildBundle` takes those from the spec bundle (`@glidepath/spec`) of the tenant's pinned model version and everything else from the database. Lists follow the spec's order. `SpecBundleSource` (`spec-source.ts`) answers the bundle for a `model_version.semver`; the default reads `variables.json` and `formula_graph.json` from `SPEC_DIR`, else the repository's `docs/spec`, and answers only for the version the spec declares (`spec_version`). No bundle for the pinned version is a 500. Deployment note: the `logic` image does not contain `docs/`, so it needs `SPEC_DIR` pointing at a copy of the spec files (or a migration adding the columns, which makes the spec source unnecessary).

## editsCount

Not stored. Defined here as the number of change rows of the scenario's applied changesets that were not undone: a changeset with status `reverted`, a revert itself (`reverts_id` set) and `seed` origin do not count; presets have none. `GET scenarios` computes it by paging `listChangesetHistory` per scenario (a data-access aggregate would be cheaper; API-05 must report the same number after a commit).

## Contract readings

- Changeset `summary` (`OneLine | null`) is the stored text when the stored summary is a one-line string, else `null` (the stored JSON holds counts, not text). Per-changeset `editsCount` is its number of change rows.
- Change `target` is mapped from the stored table with the domain's `CHANGE_ROW_TARGET_KIND`; `key` and `member` are the stored ones. `note` is omitted (change rows keep none).

## Tests

`read.pg.test.ts` runs on pg-local with the AA seed loaded by `testing/aa-db.ts` (spec model version, 415 baseline lines, tenant defaults, the five presets, a user scenario with a five-changeset history, and a second tenant `zz`), as role `glidepath_app` (RLS applies). `units.test.ts` covers ETag matching and the spec source.
