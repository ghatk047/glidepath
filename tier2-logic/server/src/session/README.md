# What-if sessions (API-06)

`WS /ws/session?tenant&scenario` (03 §2, ADR-004, contract CON-02/CON-05 `src/ws.ts`): the warm engine behind every slider. Previews never touch tier 3; sessions are a cache of it, rebuilt on every connection.

| File | What |
|---|---|
| `hub.ts` | `createSessionHub(deps)`: `route(app)` mounts the handshake `GET /ws/session`; `listen(server, app.fetch)` takes the node server's `upgrade` events; `sessions`; `close()` (1001 to every client). |
| `session.ts` | `Session(user, tenant, scenario)`: subscriptions, snapshot, preview queue and coalescing, scratch copy, `cancelPreview`, `open`, `error{problem}`. |
| `loader.ts` | `ScenarioLoader` port; `dbScenarioLoader({ withTenant, specBundle, models })` over DATA-05 read repositories. |
| `model-cache.ts` | `ModelCache`: one `CompiledModel` per `(tenant, model_version, members_hash)`, shared committed evaluations. |
| `cells.ts` | Wire `id[member]` ↔ engine keys (`res.net[]` ↔ `res.net`), pushed values, diffs. |

## Handshake

The upgrade request runs through the app (request log, problem JSON). In order: same origin (`Origin` = PUBLIC_BASE_URL's origin, like the `/api/*` guard) → 403; cookie session (API-02 authenticator) → 401; `tenant` + `scenario` query → 400; membership → 404; the scenario loaded through the loader → 404 when it is not the tenant's. Only then is the socket upgraded. A plain `GET /ws/session` answers 426. Every member may preview (nothing is written); commits keep their REST role guard.

## Loading a scenario (one `withTenant` transaction, RLS applies)

`getScenario` (version first) → `getTenant` (pinned `model_version_id`) → `loadMembers` (members in evaluation order + `membersHash`) → `loadResolvedInputs` (v_inputs_resolved values, the scenario's own node overrides). The compiled model comes from the ModelCache; only a miss reads `loadModelDefs` (for the semver) and compiles the bundle of `specBundle(semver)`, the same source as the bundle route. The committed evaluation is shared: `CachedModel.committed(scenarioId, values, overrides)` evaluates once and hands the same immutable evaluation to every session whose inputs are bitwise the same (compared cell by cell; `inputHash` costs about one evaluate, so nothing on this path hashes inputs). `rerun` never modifies its start, so sharing is safe.

`membersHash` ignores member order but the engine sums in member order: a cache entry also remembers the order it was compiled with and recompiles when it differs.

## Frames

- `subscribe{cells}` → `snapshot{scenarioId, version, cells}` of exactly those cells, with the values the client sees now (the scratch while previews are live). Unknown cells and non-finite values are `null`. At most `MAX_SUBSCRIBED_CELLS` per session.
- `preview{seq, changes}`: `seq` must increase (across `cancelPreview` too); every cell must be an input variable with a member key of its dims (else 422, nothing applied). Previews queue and run after the frames already received (`setImmediate`): queued previews apply in `seq` order, latest per cell, in one `rerun` on the scratch copy, answered once by `delta{seq}` with the highest `seq`. A delta holds the subscribed cells whose value differs from the one last pushed to this client, so it may be empty. An engine error is a 422 `error`, the scratch stays as it was.
- `cancelPreview{seq}` voids queued previews and the scratch; `delta{seq}` carries the cells that go back to their committed value (empty when none).
- Any other frame first runs queued previews, so answers keep the order of requests.
- `open{scenarioId}`: queued previews are void, the scenario is loaded (frames after it wait), the scratch dropped, subscriptions kept, `snapshot` of every subscribed cell; unknown or another tenant's → 404 `error`, the session stays.
- `subscribeView` / `unsubscribeView` → 501 `error` until API-12 serves views.
- Bad JSON, unknown `type` or `v`, malformed body → 400 `error` with the parser's detail. The socket stays open.

Later items: commit broadcast, rebase, warnings, idle close, fork-follow (API-07), views (API-12).

## Tests and bench

- `session.test.ts`: the session over the spec seed without a socket or DB (manual scheduler: a burst is exact). `model-cache.test.ts`: cache keys, order guard, LRU, shared evaluations, cell keys.
- `ws.pg.test.ts` (pg-local, the read routes' seed database, magic-link cookies): handshake and ModelCache key, golden C snapshot, 100 rapid previews, no SQL during previews (every pool client's statements recorded from its first connection), `open`. `start.pg.test.ts`: `startServer` wiring and shutdown.
- `pnpm --filter @glidepath/server bench` (`session.bench.ts`, G8): `ws.preview` round trip, printed as p95 against the 25 ms budget.
