# @glidepath/domain

Changesets, VR01-VR10, scenario resolution/fork/undo, hashing. Pure: no IO (`eslint.config.js` rejects node builtins, DB/HTTP clients, `fetch`, `process` and dynamic `import()` in `src`). State is read and written through the ports in `src/ports.ts` (ADR-019).

DOM-01 provides the vocabulary of every write. DOM-02 adds the input validation rules. DOM-03 adds `applyChangeset`, the single write path; the engine step (Recompute) follows in DOM-05.

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
- For values, `old_value` is the cell's value before this change, as resolved at the changeset's base version: the level's own row, else what the cell inherits (ancestor scenarios, then the tenant default), with the changeset's earlier changes applied. That gives the tray its "from → to". `new_value` is the row's new value, or null when the row is removed. For structural rows, both are row contents.
- A change may carry a `note`. `applyChangeset` keeps it on the change row, in `change.messages.note` (change has no note column). It is also persisted to `variable_value.note` (a tenant default) or `node_override.reason` (an override). `scenario_value`, `dimension_member` and `line_item` have no note column.
- `checkDraft(draft)` throws a `ChangesetDraftError` listing every problem that makes a draft invalid whatever the state (`draftIssues` returns the list):
  - `unset` on tenant defaults (`scenario_id` null). The tenant default is the last level, so the cell would have no value. Set a value instead.
  - An override without a scenario.
  - A `new_value` that does not fit the op.
  - A negative or fractional `base_scenario_version`.
  - No changes.
- Versions: a scenario draft starts from `scenario.version`. Tenant defaults have no scenario row, so their version is the number of tenant-default changesets ever applied (status `applied` or `reverted`). A tenant-default draft is current when `changesSince(null, base_scenario_version)` is empty, and nothing is bumped.
- A draft names no author. `applyChangeset` takes the actor (a user id) as an explicit argument and writes it to `changeset.created_by` and `audit_log.actor`. It never reads the actor from ambient context, because the store's context carries only the tenant.

## applyChangeset (`src/apply.ts`)

`applyChangeset(store, draft, options)` is the write path of docs/architecture/04_data_and_api.md section 2. It runs in one `store.transaction` and writes nothing before steps 1 to 4 pass:

```ts
const result = await applyChangeset(store, draft, {
  actor: userId,              // changeset.created_by, audit_log.actor, a fork's created_by
  bundle,                     // the tenant's pinned model: variables, nodes, dimensions
  clientRequestId: 'rq-7f3a', // optional, the contract's idempotency key
  recompute,                  // optional; noRecompute until DOM-05
});
// { changesetId, scenarioId, version, editsCount, forkedFrom?, changeset, warnings, clamped, replayed, recomputed }
```

| Step | What happens | Failure (nothing written) |
|---|---|---|
| 1 | Lock the scenario row (`loadScenarioForUpdate`) or the tenant-default lock (`lockTenantDefaults`). A `clientRequestId` the actor already applied returns that changeset's result (`replayed: true`). Then `base_scenario_version` must be the stored version. | `ScenarioNotFoundError`; `ChangesetConflictError { serverVersion, changesSince }` |
| 2 | A locked scenario forks: `createScenario` of kind `user`, key `custom-<key>`, label `Custom (from <key>)` (then `... 2`, `... 3`), parent the preset, version 0. The draft is retargeted to the fork, and `forkedFrom` is the preset. Only origin `seed` writes a locked preset in place. The preset's node overrides are not inherited, so the fork copies them in a changeset of their own first. | |
| 3 | A value a draft sets outside its variable's registry min/max follows `BOUNDS_POLICY`: `ui` clamps it to the nearest bound (`clamped`); `excel_import`, `api` and `ai_reconfig` reject it with the cell's VR04 entry as an error; `seed`, `solver` and `market_refresh` write it and VR04 stays a warning. The seed keeps the spec's values, some of which pass a registry max. | `ChangesetRejectedError { violations }` |
| 4 | `validateInputs` on the post-change state: the target's resolved inputs with every change applied, and the members with every structural change applied (`memberOfRow`). | `ChangesetRejectedError` with the error entries |
| 5 | `insertChangeset` (the changeset row and its change rows), then one `writeValue` / `writeMember` per change in draft order, then `setChangesetStatus(reverted, 'reverted')` for an undo. | |
| 6 | `bumpVersion`, then `appendAudit`, then the Recompute hook, all before the commit. A throw from the hook rolls everything back. | whatever the hook throws |

- **Draft against state.** These problems throw a `ChangesetDraftError` with one issue per change:
  - an unknown variable or node, or a structural change to a dimension that is not a tenant dimension;
  - a member key of the wrong arity, or a `set` naming a member that does not exist;
  - an `insert` of an existing member, or a `set` / `delete` of a missing one;
  - an `unset` of a row the level does not have;
  - a bad `reverts_id`: unknown, on another scenario, not `applied`, or on a locked scenario.

  A draft `old_value` that differs from the stored value is a `ChangesetConflictError` with `stale` cells.
- **Change rows.**
  - `seq` is the change's index in the draft.
  - `old_value` is the cell's resolved value before the change (inherited if the level has no row; a pin's own value for an override), or the structural row before it.
  - `op` is `insert`, `update` or `delete`.
  - `messages` is `ChangeMessages`: `{ note?, warnings? }`, where the warnings are the post-change warnings on that cell.
- **Summary and the edits counter.** `changeset.summary` is `ChangesetSummaryData`:
  - `changes`: the number of change rows.
  - `edits`: what this changeset adds to the counter. That is the change count for an edit, 0 for the seed or a fork's pin copy, and minus the undone changeset's `edits` for an undo, so a redo adds them back.
  - `edits_count`: the scenario's counter after this changeset. It is the contract's `editsCount`. A scenario's current count is the `edits_count` of its changeset with `base_scenario_version = version - 1`, or 0 if it has none. A preset seeded with origin `seed` stays at 0.
  - `client_request_id`: the idempotency key, when given.
  - `forked_from`: the preset, when this changeset forked one.

  `summaryOf` and `messagesOf` read the stored JSON back.
- **Undo.** A draft with `reverts_id` (`reverse()`) marks that changeset `reverted` and appends a `changeset.revert` audit entry. DOM-04 builds `revert()` on this.
- **Tenant defaults** (`scenario_id` null) have no scenario row. Their version is the count of their changesets, so no version is bumped. The rules run on the tenant-default state only, not on every scenario that inherits it.
- **Audit.** Each changeset appends `changeset.apply`, and each fork appends `scenario.fork`.

### Members of structural rows (`src/member-rows.ts`)

`memberOfRow(dim, member_key, row, previous?)` maps a stored row to the member it becomes, as `v_dimension_members` maps it (tier3-data/migrations/0003_views.sql). A test checks the mapping against that SQL and the `line` dimension's attributes.

- A dimension_member row `{ label, attrs, sort, active }` becomes `{ id, label, ...attrs }`.
- A line_item row becomes `{ id, label: name, ... }`, with its columns renamed by `LINE_ITEM_ATTRIBUTES` (`pool_id` to `pool`, `domain_key` to `domain`, and so on). Flags become 0/1.
- `lever_ids` and `source` come from other tables, so a changed line keeps the values its member had.
- An inactive row is no member.

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

## Validation (`src/validation/`)

`validateInputs(state): ValidationEntry[]` runs the input rules on one post-change state (step 4 of the write path) and returns their entries in rule order. It returns an empty list when every rule holds. A changeset is rejected when any entry has severity `error`.

```ts
const entries = validateInputs({ bundle, members, values: resolveInputs(...).values });
// [{ rule: 'VR01', severity: 'error', cells: ['org.dom_share[commercial_applications,vp_commercial]', ...],
//    message: 'Commercial applications ownership sums to 90%; its VP shares must add up to 100%.' }]
```

- **State.** `ValidationState` has three parts:
  - `bundle`: the pinned model's `variables` and `nodes`.
  - `members`: the tenant's dimension members with attributes, as `loadMembers` returns them.
  - `values`: the resolved input cells.

  An absent cell counts as 0 in a sum. A comparison with an absent side is not made.
- **Entries.** An entry has the same shape as the contract's `Violation`: `rule`, `severity`, `cells` and a one-line `message` (cause and fix) for the UI error chip.
  - Cells use the contract's CellKey format, `id[member_key]`. A scalar is `g.chargeback_on[]`.
  - A line item is `line[it_001]`.
- **Severity.** `VALIDATION_RULES` is schema.json `validation_rules` verbatim, and a test fails on drift. VR04 is a `warning`; every other rule is an `error`.
- **Tolerance.** Sums and bounds allow float noise of `RULE_TOLERANCE` (1e-9), so `0.3 + 0.6 + 0.1` sums to 1.
- **Rules.** `INPUT_RULES` maps each rule id to its pure function:

  | Rule | Function | Checks |
  |---|---|---|
  | VR01 | `vr01DomainOwnership` | `org.dom_share` sums to 1 over `vp` for each domain, and to 0 for `out_of_scope_memo` |
  | VR02 | `vr02SharedServicesOwner` | exactly one `org.ss_flag` = 1 when `g.chargeback_on` = 1 |
  | VR03 | `vr03UsageKeys` | `org.usage_override` sums to 1 when `org.usage_override_on` = 1 |
  | VR04 | `vr04RegistryBounds` | each value within its variable's `min`/`max` (a null bound is open) |
  | VR06 | `vr06RetirementSplit` | `lev.L09.split_sw + lev.L09.split_cloud <= 1` |
  | VR07 | `vr07RetiredApps` | `lev.L09.n <= portfolio.apps` |
  | VR09 | `vr09LineItemKeys` | each line's `pool` is a `pool` member and its `domain` a `domain` member; its `vendor_key`, when set, is a `vendor` member |
  | VR10 | `vr10CorpInputYears` | every corporate-layer input cell an expression reads has a value |

- **VR09.** It reads the line attributes `pool` and `domain` and falls back to the line_item columns `pool_id` and `domain_key`. The vendor key comes from `vendor_key`, because a line's `vendor` attribute is free text (`vendor_text`).
- **VR10.** It expands each node over its dims (or `members` subset) and picks the case per cell. It then resolves the corp references statically, as `deps` in `reference/engine.py` does: `year.in`, member literals, implicit indexing, and aggregates filtered by `where`. Both branches of an `IF` count.

  So `corp.asm_g` needs fy26 and fy27 but not fy25, because fy25 takes the base-year case. A reference that cannot be indexed, such as a year without an `in` attribute, is also an entry.

  `src/validation/expr.ts` holds a port of the reference parser for this purpose. VR10 can move to the engine's dependency queries once ENG-03 exists.
- **Not here.** VR05 and VR08 read engine outputs and follow in DOM-05.

## Ports (`src/ports.ts`)

- `ChangesetStore.transaction(fn)` runs `fn(tx: ChangesetTx)` in one transaction, inside the caller's tenant context. data-access implements it (DATA-06).

  | Group | Methods |
  |---|---|
  | Locks | `loadScenarioForUpdate`, `lockTenantDefaults` |
  | Reads | `loadScenarios`, `loadInputs` (the arguments of `resolveInputs`), `loadMembers` (active members), `loadMemberRows` (raw structural rows), `loadChangeset`, `findChangesetByClientRequest`, `changesSince` (status `applied` or `reverted`) |
  | Writes | `createScenario`, `insertChangeset`, `setChangesetStatus`, `writeValue`, `writeMember`, `bumpVersion`, `findCalcRun`, `upsertCalcRun`, `appendAudit` |

  `loadInputs(scenario).chain` ends with a level for the scenario itself, which may have no rows. `src/test-support/memory-store.ts` is the in-memory implementation the tests use.
- `ModelCache<TModel>.getOrCompile(key, compile)` is keyed by `ModelCacheKey` `(tenant_id, model_version_id, members_hash)`. `modelCacheKey()` builds the key with `membersHash` from `@glidepath/spec`.

## Tests

Run `pnpm turbo run typecheck lint test --filter=@glidepath/domain...`. `vitest run` enforces at least 90% line coverage (G2).
