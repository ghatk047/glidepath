# session

WebSocket session client (WEB-03) for `WS /ws/session?tenant&scenario` (CON-02; 07 §3, §5).

- `createSessionClient({ tenant, scenario, origin?, connect?, requestFrame? })` → `SessionClient`.
- `subscribe(cells)` / `subscribeView(view, params)`: reference-counted; each returns its release.
  Changes in one tick go out as one `subscribe` / `unsubscribe` frame (strict-mode remounts send nothing).
- `preview(var, member, value)`: ≤ 1 per `PREVIEW_MIN_INTERVAL_MS` per input cell, latest wins;
  one `seq` counter for `preview` and `cancelPreview`. `cancelPreview()`; `cancelOnEscape(target)`.
- `store` (zustand vanilla): `status`, cell map, view map, `warnings`, `jobs`, `changeset`.
  Read with `useStore(client.store, selectCell(key))` / `selectView(view, params)`.
- Server frames: `parseServerMessage`, queued, applied once per animation frame by
  `applyMessages` (`state.ts`, the one dispatcher); a `seq` below the last applied or the last
  cancel is ignored.
- Drop: values kept and flagged `stale` (dim them), status `reconnecting`, exponential backoff,
  then resubscribe. Nothing is ever filled in locally.
- `state.ts` does no arithmetic: `eslint-rule.ts` (`noArithmeticLintConfig`), checked by `lint.test.ts`.
  Tests run against `createMockSession` from `@glidepath/api-contract/testing`.
