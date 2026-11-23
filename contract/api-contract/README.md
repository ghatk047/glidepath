# @glidepath/api-contract

The only code shared by tier 1 and tier 2: zod schemas, WS message types, typed client.
It imports `zod` and nothing else (G13; enforced by `eslint.config.js` and `src/boundaries.spec.ts`).

## REST core (CON-01)

- `coreRoutes` (`src/routes.ts`): method, path, success status, and `params` / `query` / `body` /
  `response` schemas for the core routes of `docs/architecture/04_data_and_api.md` §3
  (me, tenants, bundle, members, scenarios GET/POST/PATCH, inputs, changesets POST / revert /
  history, calc, explain, search). Solver, export, import, AI and market routes come with CON-03.
- Errors are RFC 9457 `Problem` (`application/problem+json`): `type`, `title`, `status`,
  one-line `detail` for the UI error chip, optional `violations[{rule VR01–VR10, cells, severity, message}]`.
  The changeset routes answer 409 with `ChangesetConflict` (a problem plus `serverVersion`, `changesSince[]`).
- `ChangesetRequest {scenarioId, baseVersion, changes[{target, key, member, value, note?}]}` →
  `ChangesetResult {changesetId, scenarioId, version, editsCount, inputHash, outputs, warnings, forkedFrom?}`.
- Ids are plain branded strings (`ScenarioId`, `ChangesetId`, `VarKey`, `NodeKey`, …). Cells are
  `CellKey` = `id[member]` as in the engine (`res.net[]`, `hc.rate[pilots,fy27]`); `toCellKey()` formats one.
- Field names are camelCase; spec ids and enum values are verbatim from `docs/spec`.

`src/fixtures/core.ts` holds one wire fixture per route; `schemas.spec.ts` round-trips them.

## WebSocket session (CON-02)

`src/ws.ts`: `WS /ws/session?tenant&scenario` (`SessionQuery`). Every frame is one JSON object
with `type` and protocol `v` (`WS_PROTOCOL_VERSION` = 1). `parseClientMessage` /
`parseServerMessage` take JSON text or an object and reject an unknown `type`, another `v` or a
malformed body with a one-line `detail`.

- Client → server: `subscribe{cells}`, `unsubscribe{cells}`, `subscribeView{view, params}`,
  `unsubscribeView{view, params}`, `preview{var, member, value, seq}`, `cancelPreview{seq}`.
- Server → client: `snapshot{scenarioId, version, cells}`, `delta{seq, cells}`,
  `view{view, params, seq, payload}`, `warnings{seq, violations, problem?}`,
  `job{id, status, progress, note}`, `changeset{scenarioId, version, editsCount, forkedFrom?}`.
- Coalescing (documented on `PREVIEW_MAX_PER_SECOND`): the client sends ≤ 30 previews/s per
  input cell; `seq` is one increasing counter per connection; the server keeps the latest `seq`
  per cell, drops superseded previews unanswered and answers each rerun with the highest `seq`
  it applied. `seq: null` on `delta` / `view` / `warnings` means a commit or job, not a preview.
  `cancelPreview` carries a fresh `seq` and voids the scratch copy.
- Views (ADR-021, `viewSchemas`): `bridge`, `baseline.groups` (`by` pool | domain | vp),
  `baseline.summary`, `levers.families`, `levers.monthly`, `levers.scale`, `vps.domain_outlay`;
  each has strict `params` and a typed `payload` computed by tier 2 (DOM-06), so tier 1 draws
  without arithmetic.

`src/fixtures/ws.ts` holds one fixture per message type and per view, plus the coalescing
walk-through; `ws-protocol.spec.ts` checks them.
