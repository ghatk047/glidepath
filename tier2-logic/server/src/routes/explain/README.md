# Explain and search routes (API-08)

`registerExplainRoutes(app, { specBundle })` mounts two routes of 04 section 3 on `/api/t/:tenant/*`, after the tenant middleware. `createApp` calls it. Bodies are validated against their contract schemas before they are sent.

| Route | Answer | Source |
|---|---|---|
| `GET nodes/:cell/explain?scenario=` | `ExplainResponse` | engine `explain` + `upstream` over the scenario's resolved inputs and pins |
| `GET search?q=&limit=` | `SearchResponse`, at most 9 ranked results | model bundle labels + tenant members (tier 3) + the 8 screens |

## Explain

- `:cell` is the contract key `id[member]` (`res.net[]` for a scalar, URL-encoded); the engine's key for a scalar is `id` (`keys.ts` converts). Not `id[member]`: 422. A cell the model does not have: 404. A scenario that is not the tenant's: 404.
- The model is compiled per (model version, members hash) and kept (`model-cache.ts`); each request evaluates the scenario's `loadResolvedInputs` values and pins (`evaluate`), then calls `explain(cell, at)`.
- `value`, `expression`, `words`, `label`, `unit` come from the engine. `upstream` is the engine's `upstream(cell, depth)` read level by level (`depth` 1 = read directly), nearest first, at most `UPSTREAM_LIMIT` cells. `drivers` are the engine's drivers by |sensitivity|, the top `TOP_DRIVERS`; `impact` is the engine's `sensitivity` (change of the cell for a 100% change of the driver, in the cell's unit). Non-finite numbers are `null`.
- The "pinned" flag of the IA is `override`: `{ value, reason }` when the scenario pins this cell (the reason is the stored one), else `null`. A pinned cell has no drivers (engine).

## Search

- Indexed: every variable (`input`, 194 in the AA model), every node with `output` (`node`, 98), the tenant's `lever` and `line` members (`loadMembers`: RLS scopes them to the caller's tenant), and the 8 screens. Intermediate (non-output) nodes are not offered.
- Matching: every query token must match the label, id, group or hint; a whole label word or id part beats a prefix, which beats a substring, which beats group text; exact id or label gets a bonus. Ties: lever, input, node, line, screen, then label, id. `limit` can only narrow below 9.
- `module` is where Enter jumps, from the spec layer (levers -> `levers`, corporate/pnl/bridge/valuation -> `market`, results/target -> `cockpit`, baseline -> `baseline`, vp -> `vps`, simulation -> `path`). A line's `unit` is the unit of node `base.pool_outlay`.

Tests: `explain.pg.test.ts` (pg-local, AA seed from `../read/testing/aa-db.ts`).
