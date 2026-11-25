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
status: done
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
merged_at: "2026-11-23"
```

Server state, cached.

## WEB-03 · WebSocket session client

```yaml
id: WEB-03
title: "WebSocket session client"
epic: WEB
milestone: M2
priority: must
status: done
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
merged_at: "2026-11-23"
```

The pipe the live numbers flow through.

## WEB-04 · Binding hooks and bound components

```yaml
id: WEB-04
title: "Binding hooks and bound components"
epic: WEB
milestone: M2
priority: must
status: done
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
merged_at: "2026-11-23"
```

Components bind to ids; values come from tier 2.

## WEB-05 · Commit path, fork, undo/redo

```yaml
id: WEB-05
title: "Commit path, fork, undo/redo"
epic: WEB
milestone: M2
priority: must
status: done
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
merged_at: "2026-11-23"
```

Edits that stick, with no client-side rules.

## WEB-06 · Global layer I: rail, scenario bar, flight strip, tray, theme, states

```yaml
id: WEB-06
title: "Global layer I: rail, scenario bar, flight strip, tray, theme, states"
epic: WEB
milestone: M2
priority: must
status: done
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
merged_at: "2026-11-23"
```

Everything that is on every screen, part 1.

## WEB-07 · Global layer II: ⌘K, edit popover, trace drawer wired

```yaml
id: WEB-07
title: "Global layer II: ⌘K, edit popover, trace drawer wired"
epic: WEB
milestone: M2
priority: must
status: done
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
merged_at: "2026-11-23"
```

Every number findable and editable — a 09 §3 must.

## WEB-08 · Job progress and empty-state plumbing

```yaml
id: WEB-08
title: "Job progress and empty-state plumbing"
epic: WEB
milestone: M2
priority: must
status: done
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
merged_at: "2026-11-23"
```

Shared by Cockpit, VPs, Path and Airlines.

## WEB-09 · CSRF header and global overlays mounted (E2E fixes)

```yaml
id: WEB-09
title: "CSRF header and global overlays mounted (E2E fixes)"
epic: WEB
milestone: M2
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [WEB-07, QA-04]
tier: 1
package: "tier1-presentation/web/src/data, src/app"
contract: "x-csrf-token on state-changing /api calls; GlobalOverlays in GlobalLayout"
inputs:
  - "tier2-logic/server/src/auth/service.ts (CSRF check)"
  - "e2e/tests/fixtures.ts (header workaround to remove)"
acceptance:
  - "every POST/PUT/PATCH/DELETE from tier 1 sends x-csrf-token from the gp_csrf cookie (test); the E2E fixture no longer injects it"
  - "GlobalOverlays and the shared Tooltip are mounted at the app root; ⌘K opens in the real app tree (test)"
  - "E2E smoke edits a lever via ⌘K and popover, then undoes it (G9)"
gates: [G1, G2, G9, G12, G13]
size: S
notes: "Found by QA-04 on the real stack; msw unit tests hid both."
merged_at: "2026-11-23"
```

## WEB-10 · Percent-point units shown correctly everywhere

```yaml
id: WEB-10
title: "Percent-point units shown correctly everywhere"
epic: WEB
milestone: M3
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [MOD-08, WEB-07]
tier: 1
package: "contract/api-contract (bundle), tier2-logic (bundle builder), tier1-presentation/ui/src/format, web bind and overlays"
contract: "ModelBundle variables and nodes carry a percent scale (fraction or points) set by tier 2"
inputs:
  - "docs/spec/variables.json (unit '%': layer corporate values are percentage points, e.g. corp.gdp 2.0 = 2.0%; others are fractions, e.g. g.target_pct 0.1 = 10%)"
  - "tier1-presentation/web/src/modules/market/format.ts (local workaround to remove)"
acceptance:
  - "tier 2 sets the percent scale per variable/node in the bundle from registry data (no ids hard-coded in tier 1); a test proves every corporate % variable is 'points' and g.target_pct is 'fraction'"
  - "ui fmt and the shared BoundEditable, slider and edit popover display and parse both scales correctly (tests: corp.gdp 2 shows 2.0%; g.target_pct 0.1 shows 10.0%; typing 2.5 for a points var commits 2.5)"
  - "Market module drops its local scaling and uses the shared path (test)"
gates: [G1, G2, G3, G13]
size: S
notes: "From MOD-08 review."
merged_at: "2026-11-23"
```

```yaml
id: WEB-11
title: "Screens match the UX renders: self-hosted Geist, inherited fonts, scenario labels, then re-approve visual baselines"
epic: WEB
milestone: M4
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [QA-06, SOL-13]
tier: 1
package: "tier1-presentation/ui (tokens, glass), tier1-presentation/web, e2e/visual/baselines"
contract: "No contract change. Fonts load from the web bundle (no Google Fonts at runtime); every control inherits the token font."
inputs:
  - "docs/ux/01_moodboard.md (Geist for everything, Geist Mono for labels and axis text, tabular figures)"
  - "docs/ux/screens/ (cockpit render: scenario chips R Rates only / A Commercial / B Op-model reset / C Balanced / D Full stretch)"
  - "QA-06 report in e2e/README.md and the visual report"
acceptance:
  - "Geist and Geist Mono (open licence) are self-hosted in the web bundle via @fontsource or vendored woff2 with the licence file; no request leaves for fonts.googleapis.com (test)"
  - "button, input, select, textarea inherit the token font; no element renders in a browser serif fallback (test: computed font-family on every control in a module render)"
  - "scenario chips show the short scenario labels from tier 2 (bundle/preset short name, not hard-coded in tier 1) matching the cockpit render (test)"
  - "visual baselines re-approved once with `pnpm e2e:visual -- --update` against a fresh stack on develop, compare run passes twice; old baselines replaced, not added"
gates: [G1, G2, G3, G11, G13]
size: S
notes: "From QA-06 review. If short scenario labels need a tier 2 bundle field, add it in the bundle builder and contract (the only allowed out-of-tier change) and say so."
merged_at: "2026-11-23"
```

```yaml
id: WEB-12
title: "The bare URL opens the viewer's airline on its default scenario"
epic: WEB
milestone: M4
priority: must
status: done
stream: C
model: opus
effort: medium
depends_on: [OPS-09, DATA-14]
tier: 1
package: "tier1-presentation/web (router), contract/api-contract (ScenariosResponse), tier2-logic/server (scenarios route), tier2-logic/data-access, tier2-logic/worker (seed), tier3-data/migrations/manual/0007"
contract: "ScenariosResponse gains defaultScenarioId (nullable, defaults to null): the preset the tenant seed names as default_scenario"
inputs:
  - "Owner report 2026-11-23: https://glidepath.wafflebot.us shows a blank dark page after sign-in (the `/` route had no screen)"
  - "tier3-data/seed/aa/scenarios.json default_scenario"
acceptance:
  - "`/` redirects to /<first membership tenant>/<defaultScenarioId, else first non-archived scenario>/cockpit (test)"
  - "with no membership, no scenario, or tier 2 unreachable, `/` shows one line saying so instead of a blank page (test)"
  - "scenario.is_default (manual migration 0007, overlay entry) is set by the seeder for the seed's default_scenario only, also on a re-run (test)"
  - "GET /api/t/:tenant/scenarios returns defaultScenarioId = the seed default preset (test)"
gates: [G1, G2, G3, G7, G13]
size: S
notes: "Choosing which tenant/scenario to open is navigation; the default itself comes from tier 2 (seed), not tier 1."
merged_at: "2026-11-23"
```
