# Write routes (API-05)

`registerWriteRoutes(app, { specBundle, hub? })` mounts the write half of 04 section 3 on `/api/t/:tenant/*`, after the tenant middleware (authenticated, member, handler inside `withTenant`). The API-02 guards still apply to all of them: same origin + `x-csrf-token` on `/api/*`, owner or editor role on state-changing tenant routes. `createApp` calls it; `AppDeps.hub` is the session hub.

| Route | Answer (`@glidepath/api-contract`) | Domain |
|---|---|---|
| `POST changesets` | `ChangesetResult` (version, editsCount, inputHash, headline outputs, warnings, `forkedFrom`); 409 `ChangesetConflict`; 422 with `violations` | `applyChangeset` + `recomputeHook` |
| `POST changesets/:id/revert` `{ baseVersion }` | `RevertResult`; 409; 404; 422 (already undone, locked) | `revert` |
| `POST scenarios` | 201 `Scenario` (copy, blend, empty child) | `createScenario` |
| `PATCH scenarios/:id` | `Scenario` (rename, lock, archive) | `patchScenario` |
| `GET scenarios/:id/calc` | `CalcResponse` (latest `calc_run`, `stale`); 404 before the first calculation | |

## Contract readings

- **Origin** of `POST changesets` is `ui` (clamp to registry bounds). A value `null` is `unset` (inherit again / drop the pin). A structural change is a `delete` for `null`, else an `insert` when the tenant has no such member, a `set` (replace) when it has; `value` is the row content as history shows it.
- **Fork**: the first edit of a locked preset answers the new scenario's id in `scenarioId` and the preset in `forkedFrom`, `version` is the fork's.
- **409**: `serverVersion` and `changesSince` (every change row committed since `baseVersion`, with its changeset id). Also for a stale `old_value`, then with no `changesSince`. Revert checks the client's `baseVersion` against the scenario's version first (it locks the row), then calls the domain `revert`.
- **Replay** (`clientRequestId` already applied): 200 with the first result's version and counters; `outputs` / `inputHash` are the scenario's current calc_run (nothing is recalculated), `warnings` the ones recorded on the changeset.
- **calc**: `stale` when the run's scenario version is older than the scenario's, or its model version is not the tenant's pinned one. The route picks the run with the highest `scenario_version`, then the newest: a recompute that finds its inputs already calculated (an undo) re-stamps the old row's version but not its `created_at`, so data-access `getLatestCalcRun` (newest `created_at` first) would answer the superseded run after an undo. Follow-up for DATA: order that function the same way.
- PATCH needs `ScenarioTx.updateScenario`, which data-access does not have yet: `support.ts` `scenarioStore` adds it over the request transaction with a tenant-scoped `update scenario` (data-access `sql`, as the auth store does). Move it into data-access when convenient.

## Session hub

`SessionHub` (`hub.ts`) is the interface API-07 implements: `changeApplied({ kind, result, origin, author, reverts? })` after a changeset or revert, `scenarioChanged({ change, scenario })` after create or PATCH (not for a no-op patch). Notices are queued by the handler and run by `afterCommitMiddleware()`, which `createApp` mounts before the tenant middleware: they fire only after the transaction committed, never for a 409, a 4xx or a rolled-back request, and a hub that throws is logged, never an error for the client.

## Tests

`write.pg.test.ts` runs on the AA test database (`../read/testing/aa-db`) as `glidepath_app`: every acceptance line, the guards (a fake guard stands in for API-02's), and `bench api.commit` (G8: commit p95 under 150 ms, warm model, 40 commits with distinct inputs). The bench is timing on a shared machine: run it alone when it fails near the budget.
