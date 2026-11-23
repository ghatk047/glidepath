# @glidepath/domain

Changesets, VR01-VR10, scenario resolution/fork/undo, hashing. Pure: no IO (`eslint.config.js` rejects node builtins, DB/HTTP clients, `fetch`, `process` and dynamic `import()` in `src`). State is read and written through the ports in `src/ports.ts` (ADR-019).

DOM-01 provides the vocabulary of every write. `applyChangeset` follows in DOM-03.

## Changesets (`src/changeset.ts`)

There are two layers:

| Layer | Types | Vocabulary |
|---|---|---|
| Draft: what a caller wants | `ChangesetDraft`, `Change` (`ValueChange` / `StructuralChange`) | target `variable` / `override` / `structural`; op `set` / `unset` (values), `insert` / `set` / `delete` (structural rows) |
| Row: what is stored | `ChangesetRow`, `ChangeRow`, `Changeset` (row + its change rows) | `docs/spec/schema.json` tables.changeset and tables.change, column for column, enums verbatim |

- Field names are the schema columns (`member_key`, `base_scenario_version`, `reverts_id`, `old_value`, `new_value`). Tenant rows omit `tenant_id`, because the store adds it from the tenant context.
- Origins are the schema's: `ui`, `excel_import`, `api`, `solver`, `ai_reconfig`, `market_refresh`, `seed`.
- `(target, key, member_key)` names the row a change writes:
  - `variable`: `(var_key, member_key)`, stored as `variable_value` when the changeset has no scenario and as `scenario_value` otherwise.
  - `override`: `(node_key, member_key)` in `node_override`. It needs a scenario.
  - `structural`: `(dim_key, member_key)`, stored as `line_item` for dim `line` and as `dimension_member` for any other dim.

  `changeRowTarget(change, scenarioId)` and `CHANGE_ROW_TARGET_KIND` map between the two layers.
- `set` writes the row and `unset` removes it, so the cell inherits again. On a stored row, `op` records whether the row was inserted, updated or deleted.
- For values, `old_value` is the cell's resolved value before the change (it may be inherited, which gives the tray its "from → to"). `new_value` is the row's new value, or null when the row is removed. For structural rows, both are row contents.

## Member keys (`src/member-key.ts`)

`memberKey(def, binding)` joins member ids in the definition's `dims` order, and gives `''` for scalars:

```ts
memberKey(corpLabHcG, { iyear: 'fy27', lgroup: 'pilots' }); // 'pilots,fy27'
```

The binding may also be an array already in dims order. Bindings of other dims are ignored. `splitMemberKey` is the inverse. Both functions reject empty ids and ids that contain `,`.

## Scenario resolution (`src/resolve.ts`)

`resolveInputs(defaults, scenarioChain, overrides, { variables? })` follows the semantics of `v_inputs_resolved`. For each `(var_key, member_key)` cell, the levels are: variable definition, then tenant default, then each scenario from the root ancestor down to the scenario. The last level with a row wins. The result also includes the scenario's own node overrides, which are not inherited.

- A cell set only by a scenario is included.
- `variables` drops cells of variables that the pinned model version does not define.
- Each value carries `scenario_id`, the level that supplied it (`null` means the tenant default).
- Output is sorted by var_key, then member_key, in code-point order.

`resolveScenarioChain(scenarios, id)` gives the root-first chain and rejects unknown parents and cycles.

The fixture `fixtures/scenario-chain-3.json` (exported as `@glidepath/domain/fixtures/scenario-chain-3.json`) is shared with DATA-03. It holds a root, child and grandchild chain plus a sibling, with schema-shaped rows and the expected chain, values and overrides per scenario. Its `semantics` list states the rules above.

## Undo (`src/reverse.ts`)

`reverse(changeset, baseVersion?)` builds the undo draft of an applied changeset:

- Origin and scenario are kept, and `reverts_id` is set to the changeset's id.
- Each applied change row (status `clean` or `accepted`) is inverted, in reverse `seq` order:

  | Row | Undo |
  |---|---|
  | value inserted | `unset` |
  | value updated or deleted | `set` the old value |
  | structural insert | `delete` |
  | structural delete | `insert` |
  | structural update | `set` the old row |
- `baseVersion` defaults to `base_scenario_version + 1`.
- Redo is the reverse of the applied undo.

## Ports (`src/ports.ts`)

- `ChangesetStore.transaction(fn)` runs `fn(tx: ChangesetTx)` in one transaction, inside the caller's tenant context. data-access implements it (DATA-06).

  | Group | Methods |
  |---|---|
  | Reads | `loadScenarioForUpdate`, `loadScenarios`, `loadInputs` (the arguments of `resolveInputs`), `loadMembers`, `loadChangeset`, `changesSince` |
  | Writes | `createScenario`, `insertChangeset`, `setChangesetStatus`, `writeValue`, `writeMember`, `bumpVersion`, `findCalcRun`, `upsertCalcRun`, `appendAudit` |
- `ModelCache<TModel>.getOrCompile(key, compile)` is keyed by `ModelCacheKey` `(tenant_id, model_version_id, members_hash)`. `modelCacheKey()` builds the key with `membersHash` from `@glidepath/spec`.

## Tests

Run `pnpm turbo run typecheck lint test --filter=@glidepath/domain...`. `vitest run` enforces at least 90% line coverage (G2).
