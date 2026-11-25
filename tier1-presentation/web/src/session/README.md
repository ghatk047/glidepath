# session

WebSocket session client (WEB-03, CON-05) for `WS /ws/session?tenant&scenario` (07 §3, §5).

- `createSessionClient({ tenant, scenario, origin?, connect?, requestFrame? })` → `SessionClient`.
- `subscribe(cells)` / `subscribeView(view, params)`: reference-counted; each returns its release.
  Changes in one tick go out as one `subscribe` / `unsubscribe` frame (strict-mode remounts send nothing).
- `preview(var, member, value)` / `previewChanges(cells)`: batched `preview{seq, changes}`, ≤ 1 per
  `PREVIEW_MIN_INTERVAL_MS` **per connection** (30/s across all cells). Changes made meanwhile wait in
  one pending slot, merged per cell (latest wins); cells passed together always share a frame.
  One `seq` counter for `preview` and `cancelPreview`.
- `cancelPreview()`: no precondition, always sends with a fresh seq while connected.
  `settleCommit(postPromise)`: the commit path wraps its `POST /changesets` (after a 409, its re-send)
  and `cancelPreview` goes out once it settles, resolved or rejected. `cancelOnEscape(target)`.
- `open(scenarioId)`: switches the scenario on the same connection; drops pending previews, voids
  answers to earlier ones (seq floor), keeps subscriptions. `store.opening` holds the target until its
  `snapshot`; meanwhile old-scenario `delta` / `view` / `warnings` / `changeset` are ignored. An open
  asked for while down is sent on reconnect; reconnects use the scenario the session is on (incl. a fork).
- `store` (zustand vanilla): `status`, `scenarioId`, `version`, `editsCount`, `opening`, cell map,
  view map, `warnings`, `jobs`, `changeset`, `lastError` (the `error{problem}` tier 2 sent).
  Read with `useStore(client.store, selectCell(key))` / `selectView(view, params)`.
- Server frames: `parseServerMessage`, queued, applied once per animation frame by
  `applyMessages` (`state.ts`, the one dispatcher, incl. `error`). A `seq` below the last applied or
  the floor is ignored; an equal `seq` applies (the rebase after a commit); `seq: null` always applies.
  `changeset` (before its `delta{seq: null}`) sets `version` / `editsCount` and follows a fork.
- Drop: values kept and flagged `stale` (dim them), status `reconnecting`, exponential backoff,
  then resubscribe. Nothing is ever filled in locally.
- `state.ts` does no arithmetic: `eslint-rule.ts` (`noArithmeticLintConfig`), checked by `lint.test.ts`.
  Tests run against `createMockSession` from `@glidepath/api-contract/testing`, including the
  `scratchLifecycleFixtures` timelines.
