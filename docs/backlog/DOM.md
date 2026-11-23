# DOM · Domain

Changesets, validation rules VR01–VR10, scenario fork/undo/rebase, post-commit recompute and the tier-2 view-models for derived display series. Pure package; IO through ports.

6 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| DOM-01 | Changeset model, member keys, scenario resolution, ports | M0 | opus/xhigh | M | FND-05, SPEC-02 |
| DOM-02 | Validation rules VR01–VR04, VR06, VR07, VR09, VR10 (input rules) | M1 | opus/xhigh | M | DOM-01 |
| DOM-03 | applyChangeset core (version check, fork, clamp, rules, write) | M1 | opus/xhigh | M | DOM-02 |
| DOM-04 | Scenario operations, undo/redo and rebase | M1 | opus/xhigh | M | DOM-03 |
| DOM-05 | Post-commit recompute, calc_run, VR05 and VR08 | M1 | opus/xhigh | M | DOM-03, ENG-07 |
| DOM-06 | Display view-models for derived series (ADR-021) | M2 | opus/high | M | ENG-07, DOM-01 |

## DOM-01 · Changeset model, member keys, scenario resolution, ports

```yaml
id: DOM-01
title: "Changeset model, member keys, scenario resolution, ports"
epic: DOM
milestone: M0
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [FND-05, SPEC-02]
tier: 2
package: "tier2-logic/domain"
contract: "ChangesetDraft, Change, reverse(), resolveInputs(), ChangesetStore port"
inputs:
  - "docs/architecture/04_data_and_api.md#2. Tier 2 · Domain: one write path"
  - "docs/spec/01_data_model.md#4. How a scenario resolves"
  - "docs/spec/01_data_model.md#3. Dimensions"
  - "docs/spec/schema.json (tables.changeset, tables.change, principles)"
  - "docs/adr/ADR-019-domain-ports.md"
acceptance:
  - "types ChangesetDraft and Change (target variable|override|structural, key, member_key, op set|unset|insert|delete, old/new) and origin (ui, excel_import, solver, ai_reconfig, seed, market) match schema.json changeset/change columns (test)"
  - "memberKey joins member ids in the variable's dims order, '' for scalars (test incl. 'pilots,fy27')"
  - "resolveInputs(defaults, scenarioChain, overrides) = v_inputs_resolved semantics (test: 3-level chain fixture shared with DATA-03)"
  - "reverse(changeset) builds the undo draft with reverts_id (test)"
  - "ports.ts declares ChangesetStore and ModelCache interfaces; package imports no IO modules (lint)"
gates: [G1, G2]
size: M
notes: "No engine numbers involved; allowed before the parity gate."
```

The vocabulary of every write.

## DOM-02 · Validation rules VR01–VR04, VR06, VR07, VR09, VR10 (input rules)

```yaml
id: DOM-02
title: "Validation rules VR01–VR04, VR06, VR07, VR09, VR10 (input rules)"
epic: DOM
milestone: M1
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [DOM-01]
tier: 2
package: "tier2-logic/domain"
contract: "validateInputs(state): ValidationEntry[]"
inputs:
  - "docs/spec/schema.json (validation_rules)"
  - "docs/spec/01_data_model.md#6. Validation"
  - "docs/architecture/04_data_and_api.md#2. Tier 2 · Domain: one write path (step 3–4)"
acceptance:
  - "one pure function per rule with severity from schema.json: VR01 org.dom_share sums to 1 per domain except out_of_scope_memo (sums to 0); VR02 exactly one org.ss_flag when g.chargeback_on = 1; VR03 org.usage_override sums to 1 when org.usage_override_on = 1; VR04 within variable_def min/max; VR06 lev.L09.split_sw + lev.L09.split_cloud ≤ 1; VR07 lev.L09.n ≤ portfolio.apps; VR09 line_item pool/domain/vendor keys exist; VR10 corp inputs present for every year an expression uses (one pass + one fail fixture per rule)"
  - "entries carry rule, severity, cells and a one-line message suitable for the UI error chip (test)"
  - "AA seed for every preset passes all rules (test)"
gates: [G1, G2]
size: M
notes: "VR05 and VR08 read engine outputs and live in DOM-05 after the parity gate."
```

Rules as data-driven pure functions.

## DOM-03 · applyChangeset core (version check, fork, clamp, rules, write)

```yaml
id: DOM-03
title: "applyChangeset core (version check, fork, clamp, rules, write)"
epic: DOM
milestone: M1
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [DOM-02]
tier: 2
package: "tier2-logic/domain"
contract: "applyChangeset(store, draft)"
inputs:
  - "docs/architecture/04_data_and_api.md#2. Tier 2 · Domain: one write path"
  - "docs/ux/02_information_architecture.md#3. Objects"
  - "docs/adr/ADR-019-domain-ports.md"
acceptance:
  - "baseVersion ≠ scenario.version → Conflict with server version and changes since (test with in-memory store)"
  - "locked preset → fork 'Custom (from X)' and retarget the draft; result carries forkedFrom (test)"
  - "origin ui clamps to registry min/max; excel_import, ai_reconfig and API origins reject with a VR04 entry (test)"
  - "input rules run on the post-change resolved state; any error → nothing written (test)"
  - "writes changeset + change rows (old, new, var, member, origin, user, note) and upserts through the store inside store.transaction (test asserts call order)"
  - "origin seed loads a full tenant seed (test with AA seed and the in-memory store)"
  - "a Recompute hook is called inside the transaction before commit; default no-op until DOM-05 (test)"
gates: [G1, G2]
size: M
notes: ""
```

The single write path, minus the engine step.

## DOM-04 · Scenario operations, undo/redo and rebase

```yaml
id: DOM-04
title: "Scenario operations, undo/redo and rebase"
epic: DOM
milestone: M1
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [DOM-03]
tier: 2
package: "tier2-logic/domain"
contract: "createScenario(), revert(), rebase()"
inputs:
  - "docs/architecture/04_data_and_api.md#2. Tier 2 · Domain: one write path (Undo)"
  - "docs/spec/01_data_model.md#5. Concurrency, history and caching"
  - "docs/ux/04_component_inventory.md#Shell (6) (#5 Edits counter + changeset tray)"
acceptance:
  - "create copy, empty child and blend-from(A, B, λ) drafts (test)"
  - "undo = applyChangeset(reverse(cs)) keeping origin with reverts link; redo = revert of the revert (test)"
  - "rebase(pending, changesSince) retargets pending edits to the new version and reports same-cell conflicts (test)"
  - "rename, lock, archive; editors cannot unlock presets (test)"
gates: [G1, G2]
size: M
notes: ""
```

Custom scenarios and undo, as in the demo cut.

## DOM-05 · Post-commit recompute, calc_run, VR05 and VR08

```yaml
id: DOM-05
title: "Post-commit recompute, calc_run, VR05 and VR08"
epic: DOM
milestone: M1
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [DOM-03, ENG-07]
tier: 2
package: "tier2-logic/domain"
contract: "Recompute hook implementation; validateOutputs()"
inputs:
  - "docs/architecture/04_data_and_api.md#2. Tier 2 · Domain: one write path (step 6–7)"
  - "docs/spec/schema.json (validation_rules VR05, VR08; tables.calc_run)"
  - "docs/spec/reference/golden_results.json (scenarios.C)"
acceptance:
  - "after write, the scenario is compiled via the ModelCache port and evaluated; result {scenarioId, version, inputHash, outputs: headline nodes}; on AA C outputs equal golden C within 1e-6 (test)"
  - "calc_run payload keyed (scenario, input_hash); unchanged inputs → cache hit without evaluation (test)"
  - "VR05 lv.ms0 ≥ 0 and VR08 lev.rr_check = 0 and vp.check = 0 evaluated on the post-change state before commit; violation → reject, nothing persisted (test with constructed violation)"
  - "validatePreview(state) returns rule warnings without writing (used by API-07) (test)"
gates: [G1, G2, G3]
size: M
notes: "Starts only after ENG-06 is green (ADR-020)."
```

Closes the write path with the engine.

## DOM-06 · Display view-models for derived series (ADR-021)

```yaml
id: DOM-06
title: "Display view-models for derived series (ADR-021)"
epic: DOM
milestone: M2
priority: must
status: todo
stream: A
model: opus
effort: high
depends_on: [ENG-07, DOM-01]
tier: 2
package: "tier2-logic/domain/src/views"
contract: "views.bridge/baseline/levers/vps(evaluation, members)"
inputs:
  - "docs/adr/ADR-021-view-models.md"
  - "docs/ux/03_screens.md#Cockpit · \"Path to the bar\""
  - "docs/ux/03_screens.md#Baseline · \"Where the money is\""
  - "docs/ux/03_screens.md#Levers · \"Lever studio\""
  - "docs/ux/03_screens.md#VPs · \"VP targets & ownership\""
  - "docs/spec/formula_graph.json (lev.iy, lev.start, lev.ramp, base.line_outlay, vp.pool_usd)"
acceptance:
  - "bridge: base, growth, savings, one-time, CY27 outlay and target outlay = base.total − res.target from node values (on AA C target outlay equals golden base.total − res.target) (test)"
  - "baseline.groups(by pool|domain|vp): two-level group → line values; pool groups equal base.pool_outlay; group totals sum to base.total; VP grouping splits lines by org.dom_share and its totals agree with the VP module's outlay figures, formula documented in the package README (test)"
  - "levers.families: Σ lev.iy by lever category, sums to res.tot_iy (test); levers.scale: max lev.iy across levers in preset D (test)"
  - "levers.monthly: 12 monthly values per lever derived with the formula graph's own ramp semantics so Σ months = lev.iy per lever (test)"
  - "vps.domain_outlay: outlay per domain for the ownership editor (test); all functions pure, no IO (lint)"
gates: [G1, G2]
size: M
notes: "Rubric deviation: opus/high (not xhigh) — derived display numbers, guarded by sum invariants."
```

Keeps every number on screen in tier 2, including series the formula graph does not name.
