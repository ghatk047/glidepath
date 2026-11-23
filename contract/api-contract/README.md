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
