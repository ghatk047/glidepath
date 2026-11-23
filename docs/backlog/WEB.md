# WEB · Tier 1 shell

`tier1-presentation/web`: router, view store, data hooks, WS session client, binding hooks, commit path, global layer.

8 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| WEB-01 | App scaffold: Vite, router, view store, code splitting | M1 | sonnet/high | M | FND-01, UI-01 |
| WEB-02 | Data hooks over the typed client | M2 | sonnet/high | S | WEB-01, CON-04 |
| WEB-03 | WebSocket session client | M2 | opus/high | M | WEB-01, CON-04 |
| WEB-04 | Binding hooks and bound components | M2 | opus/high | M | WEB-02, WEB-03, UI-08, UI-09 |
| WEB-05 | Commit path, fork, undo/redo | M2 | opus/high | M | WEB-04 |
| WEB-06 | Global layer I: rail, scenario bar, flight strip, tray, theme, states | M2 | opus/high | M | WEB-05, UI-05, UI-06, UI-07 |
| WEB-07 | Global layer II: ⌘K, edit popover, trace drawer wired | M2 | opus/high | M | WEB-06, UI-09, UI-18 |
| WEB-08 | Job progress and empty-state plumbing | M2 | sonnet/high | S | WEB-03, CON-03 |

## WEB-01 · App scaffold: Vite, router, view store, code splitting

```yaml
id: WEB-01
title: "App scaffold: Vite, router, view store, code splitting"
epic: WEB
milestone: M1
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [FND-01, UI-01]
tier: 1
package: "tier1-presentation/web/src/app"
contract: "Routes /:tenant/:scenario/:module ?lever ?group ?key ?node"
inputs:
  - "docs/architecture/07_frontend.md#1. Structure"
  - "docs/ux/02_information_architecture.md#1. Site map"
  - "docs/ux/02_information_architecture.md#5. State model (for architecture)"
  - "docs/architecture/01_architecture_overview.md#4. Key decisions (ADR summary) (ADR-009)"
acceptance:
  - "Vite + React 19 SPA; TanStack Router routes for the 8 modules with search params lever, group, key, node (test: route parsing)"
  - "Zustand view store: selection, open panels, drag state, theme, edits counter as reported by tier 2 (test)"
  - "code split per module; cockpit, levers and path preloaded (test: build manifest has 8 module chunks)"
  - "imports only contract/api-contract and tier1-presentation/ui (G13 lint + tier-check on the build)"
gates: [G1, G2, G13]
size: M
notes: ""
merged_at: "2026-11-23"
```

The SPA shell.

## WEB-02 · Data hooks over the typed client

```yaml
id: WEB-02
title: "Data hooks over the typed client"
epic: WEB
milestone: M2
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [WEB-01, CON-04]
tier: 1
package: "tier1-presentation/web/src/data"
contract: "useMe, useTenants, useBundle, useMembers, useScenarios, useInputs, useCalc, useHistory"
inputs:
  - "docs/architecture/04_data_and_api.md#4. How tier 1 uses the contract"
  - "docs/architecture/07_frontend.md#2. Binding model"
acceptance:
  - "TanStack Query hooks for me, tenants, bundle (ETag), members, scenarios, inputs, calc, history with long stale times (test with msw + contract fixtures)"
  - "a `changeset` WS message invalidates scenarios, history and calc (test)"
gates: [G1, G2, G13]
size: S
notes: ""
```

Server state, cached.

## WEB-03 · WebSocket session client

```yaml
id: WEB-03
title: "WebSocket session client"
epic: WEB
milestone: M2
priority: must
status: todo
stream: C
model: opus
effort: high
depends_on: [WEB-01, CON-04]
tier: 1
package: "tier1-presentation/web/src/session"
contract: "SessionClient: subscribe, preview, cancelPreview, cell map, view map"
inputs:
  - "docs/architecture/07_frontend.md#3. Editing feel without local math"
  - "docs/architecture/07_frontend.md#5. Performance rules"
  - "contract/api-contract (CON-02, createMockSession)"
  - "docs/architecture/04_data_and_api.md#4. How tier 1 uses the contract"
acceptance:
  - "connects /ws/session?tenant&scenario; reference-counted subscribe/unsubscribe per cell and per view (test with mock session)"
  - "previews ≤ 1 per 33 ms per cell, latest wins, seq increments; cancelPreview on Escape (test with fake timers)"
  - "deltas applied in one batch per animation frame; stale seq ignored (test)"
  - "on drop: values dim, 'reconnecting' state, backoff, resubscribe; never invents values (test)"
  - "no arithmetic on received values (lint rule + review)"
gates: [G1, G2, G13]
size: M
notes: ""
```

The pipe the live numbers flow through.

## WEB-04 · Binding hooks and bound components

```yaml
id: WEB-04
title: "Binding hooks and bound components"
epic: WEB
milestone: M2
priority: must
status: todo
stream: C
model: opus
effort: high
depends_on: [WEB-02, WEB-03, UI-08, UI-09]
tier: 1
package: "tier1-presentation/web/src/bind"
contract: "useNode, useVariable, useView, useTrace; <Value>, <BoundEditable>, <BoundSlider>"
inputs:
  - "docs/architecture/07_frontend.md#2. Binding model"
  - "docs/adr/ADR-018-binding-split.md"
  - "docs/ux/04_component_inventory.md#Inputs (9) (#7, #9)"
acceptance:
  - "useNode(id, member?) subscribes on mount, unsubscribes on unmount, re-renders on change (test)"
  - "useVariable(id, member?) returns the definition from the bundle (label, unit, min, max, step, kind, source, confidence, default), current value, preview(v), commit(v) (test)"
  - "bound wrappers compose ui components; ghost ticks read C and D values from tier 2 scenario inputs (test)"
  - "useView(view, params) for ADR-021 views (test)"
gates: [G1, G2, G13]
size: M
notes: ""
```

Components bind to ids; values come from tier 2.

## WEB-05 · Commit path, fork, undo/redo

```yaml
id: WEB-05
title: "Commit path, fork, undo/redo"
epic: WEB
milestone: M2
priority: must
status: todo
stream: C
model: opus
effort: high
depends_on: [WEB-04]
tier: 1
package: "tier1-presentation/web/src/commit"
contract: "commit queue → POST /changesets"
inputs:
  - "docs/architecture/07_frontend.md#3. Editing feel without local math"
  - "docs/architecture/04_data_and_api.md#4. How tier 1 uses the contract"
  - "docs/ux/02_information_architecture.md#3. Objects"
acceptance:
  - "release or typed entry → POST /changesets debounced 400 ms and batched (test with fake timers)"
  - "409 → pending edits re-sent on the server's version (test)"
  - "fork response switches URL and scenario bar to 'Custom (from X)' (test)"
  - "edits counter and warnings shown exactly as tier 2 reports them; undo/redo call revert (test)"
gates: [G1, G2, G13]
size: M
notes: ""
```

Edits that stick, with no client-side rules.

## WEB-06 · Global layer I: rail, scenario bar, flight strip, tray, theme, states

```yaml
id: WEB-06
title: "Global layer I: rail, scenario bar, flight strip, tray, theme, states"
epic: WEB
milestone: M2
priority: must
status: todo
stream: C
model: opus
effort: high
depends_on: [WEB-05, UI-05, UI-06, UI-07]
tier: 1
package: "tier1-presentation/web/src/global/shell"
contract: "GlobalLayout"
inputs:
  - "docs/ux/02_information_architecture.md#2. Global layer (on every module)"
  - "docs/ux/02_information_architecture.md#6. Screen states"
  - "docs/ux/04_component_inventory.md#Shell (6)"
  - "docs/ux/screens/cockpit-dark-390.jpg"
acceptance:
  - "Rail with 8 modules and tenant monogram → Airlines; Scenario bar R/A/B/C/D + customs/paths from /scenarios; switching updates the URL and every bound number rolls (test)"
  - "Flight strip bound via useNode to res.net, res.bar, res.gap, res.risk, br.eps27; hidden on Cockpit (test)"
  - "Edits tray from tier 2 history with undo, redo, save as scenario, discard (test)"
  - "theme toggle Cruise ⇄ Daylight; toast after commit (test); loading skeletons, error chip with problem.detail, reconnecting chip, stale chip (test)"
gates: [G1, G2, G12, G13]
size: M
notes: ""
```

Everything that is on every screen, part 1.

## WEB-07 · Global layer II: ⌘K, edit popover, trace drawer wired

```yaml
id: WEB-07
title: "Global layer II: ⌘K, edit popover, trace drawer wired"
epic: WEB
milestone: M2
priority: must
status: todo
stream: C
model: opus
effort: high
depends_on: [WEB-06, UI-09, UI-18]
tier: 1
package: "tier1-presentation/web/src/global/overlays"
contract: "Palette, popover and drawer controllers"
inputs:
  - "docs/ux/02_information_architecture.md#2. Global layer (on every module)"
  - "docs/architecture/07_frontend.md#2. Binding model (useTrace)"
  - "contract/api-contract (search, explain, changesets)"
acceptance:
  - "⌘K calls /search; Enter navigates to the module and focuses the control (test with msw)"
  - "edit popover for any input via useVariable; output 'Pin with reason' posts an override changeset (test)"
  - "trace drawer from /nodes/:cell/explain: value, node id, formula in words, upstream chain, top drivers (test)"
  - "all 194 inputs editable: for every variable in the bundle fixture, ⌘K finds it and the popover opens with its definition (test loops over the bundle)"
gates: [G1, G2, G12, G13]
size: M
notes: ""
```

Every number findable and editable — a 09 §3 must.

## WEB-08 · Job progress and empty-state plumbing

```yaml
id: WEB-08
title: "Job progress and empty-state plumbing"
epic: WEB
milestone: M2
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [WEB-03, CON-03]
tier: 1
package: "tier1-presentation/web/src/jobs"
contract: "useJob(id), JobHeader, EmptyState"
inputs:
  - "docs/ux/02_information_architecture.md#6. Screen states"
  - "contract/api-contract (job message, solver-runs)"
acceptance:
  - "`job` messages → useJob(id) with progress, note and cancel (DELETE) (test with mock session)"
  - "panel header inline progress ('Searching … combinations') + cancel link; rest of the screen stays usable (test)"
  - "EmptyState: one line + one action, e.g. 'This scenario has not been simulated.' + 'Run 2,000 trials' (test)"
gates: [G1, G2, G13]
size: S
notes: ""
```

Shared by Cockpit, VPs, Path and Airlines.
