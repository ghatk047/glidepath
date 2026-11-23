# What-if sessions (API-06, API-07)

`WS /ws/session?tenant&scenario` (03 §2, ADR-004, contract CON-02/CON-05 `src/ws.ts`): the warm engine behind every slider. Previews never touch tier 3; sessions are a cache of it, rebuilt on every connection.

| File | What |
|---|---|
| `hub.ts` | `createSessionHub(deps)`: `route(app)` mounts the handshake `GET /ws/session`; `listen(server, app.fetch)` takes the node server's `upgrade` events; `sessions`; idle close; `changeApplied` / `scenarioChanged` (the write routes' `SessionHub`); `close()` (1001 to every client). |
| `broadcast.ts` | `broadcastChange(sessions, notice, loader)`: who hears of a commit, one tier 3 read, `Session.applyCommit` each. |
| `warnings.ts` | `previewViolations(model, at)`: DOM `validatePreview` on a scratch, as contract violations. |
| `clock.ts` | `Clock` port (`now`, `after`) for the rerun cap and idle close; `testing/fake-clock.ts` for tests. |
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
- `cancelPreview{seq}` voids queued previews and the scratch; `delta{seq}` carries the cells that go back to their committed value (empty when none), then `warnings{seq, []}` when warnings showed.
- Any other frame first runs queued previews, so answers keep the order of requests.
- `open{scenarioId}`: queued previews are void, the scenario is loaded (frames after it wait), the scratch dropped, subscriptions kept, `snapshot` of every subscribed cell; unknown or another tenant's → 404 `error`, the session stays.
- `subscribeView` / `unsubscribeView` → 501 `error` until API-12 serves views.
- Bad JSON, unknown `type` or `v`, malformed body → 400 `error` with the parser's detail. The socket stays open.

Later item: views (API-12).

## Lifecycle (API-07)

- **Rate.** Reruns are capped at the contract's `PREVIEW_MAX_PER_SECOND` per connection (token bucket of that size, so a burst runs at once). A faster client is never refused: its previews wait for the next token and coalesce.
- **Warnings.** After a rerun the scratch is checked with DOM `validatePreview` (input rules on the scratch's resolved inputs, VR05/VR08 on its evaluation with `upstream`). The check is deferred behind the frames already received (it costs a few reruns, so it never delays a `delta`) and skipped when a newer preview is queued. `warnings{seq, violations}` is pushed when the list differs from the one last pushed, so a slider moving within the same violations sends nothing new. The seed's own VR04 warnings count too: the list is about the scratch state, not about what the preview changed.
- **Commit broadcast.** The hub is the write routes' `SessionHub` (`createApp` uses `sessions` as `hub` unless a test hands its own). After a changeset or revert committed (`afterCommitMiddleware`, before the POST answers) the scenario is read once from tier 3 and every session of the tenant on it queues, behind the frames it already received: `changeset{scenarioId, version, editsCount, forkedFrom?, changesetId, origin, author}`, then `delta{null}` (subscribed cells whose committed value changed; without a scratch also any cell the client shows otherwise), then, with a scratch, the rebase: its cells re-applied on the new committed state in one rerun, `delta{S}` (cells where scratch and committed differ or the client shows another value) and `warnings{S}`. A rebase the engine cannot evaluate drops the scratch. A session that switched scenario meanwhile ignores it; a state not newer than the session's (racing notices) sends only the `changeset`.
- **Fork.** When a commit forks a locked preset, the author's sessions on the preset follow (`changeset{forkedFrom}`, their scenario is the fork from then on); other users' sessions on the preset get nothing.
- **Idle.** A session whose client sent no frame for `SESSION_IDLE_MIN` (ADR-022; `startServer` passes it as `idleMs`) is closed with `IDLE_CLOSE_CODE` 4000. Server pushes do not count as activity. The client reconnects; the handshake rebuilds the session from tier 3.
- `scenarioChanged` (create, rename, lock, archive) sends nothing: no WS message carries the scenario list.

## Tests and bench

- `session.test.ts`: the session over the spec seed without a socket or DB (manual scheduler: a burst is exact). `model-cache.test.ts`: cache keys, order guard, LRU, shared evaluations, cell keys.
- `ws.pg.test.ts` (pg-local, the read routes' seed database, magic-link cookies): handshake and ModelCache key, golden C snapshot, 100 rapid previews, no SQL during previews (every pool client's statements recorded from its first connection), `open`. `start.pg.test.ts`: `startServer` wiring and shutdown.
- `lifecycle.test.ts` (no DB, fake clock): warnings with the preview seq, broadcast to two sessions, rebase, fork-follow, scenario switch, rate cap. `lifecycle.pg.test.ts` (real sockets, `POST /changesets` through the app, fake clock): two clients hear a commit, rebase, fork, switch re-targets, idle close and reconnect with identical values.
- `pnpm --filter @glidepath/server bench` (`session.bench.ts`, G8): `ws.preview` round trip at the contract's preview rate, printed as p95 against the 25 ms budget.
