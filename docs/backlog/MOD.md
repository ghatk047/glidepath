# MOD · Modules

The eight modules of `ux/03_screens.md` (Cockpit and Path split in two). Panel → node bindings copied from the screens doc; every value comes from tier 2.

10 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| MOD-01 | Cockpit hero: Net savings gauge, Bridge, Your inputs | M2 | opus/high | M | WEB-06, UI-12, UI-13, UI-10, UI-08 |
| MOD-02 | Cockpit tiles: VP rings, Shareholder, Odds, Fastest path | M2 | opus/high | M | MOD-01, UI-15, WEB-08 |
| MOD-03 | Baseline module | M3 | sonnet/high | M | WEB-07, UI-14, UI-10, API-12 |
| MOD-04 | Levers module | M3 | sonnet/high | M | WEB-07, UI-17, UI-10, API-12 |
| MOD-05 | VPs module | M3 | sonnet/high | M | WEB-07, UI-11, UI-12, UI-10, WEB-08, API-12 |
| MOD-06 | Path I: goal, objective, constraints, result, blend | M3 | opus/high | M | WEB-07, WEB-08, UI-10, UI-16, CON-03 |
| MOD-07 | Path II: savings vs risk, odds, tornado | M3 | opus/high | M | MOD-06, UI-15 |
| MOD-08 | Market module | M3 | sonnet/high | M | WEB-07, UI-16, UI-10 |
| MOD-09 | Excel module: export and import review | M3 | sonnet/high | M | WEB-07, UI-16, WEB-08, CON-03 |
| MOD-10 | Airlines module | M4 | sonnet/high | M | WEB-07, UI-10, WEB-08, API-11 |

## MOD-01 · Cockpit hero: Net savings gauge, Bridge, Your inputs

```yaml
id: MOD-01
title: "Cockpit hero: Net savings gauge, Bridge, Your inputs"
epic: MOD
milestone: M2
priority: must
status: done
stream: C
model: opus
effort: high
depends_on: [WEB-06, UI-12, UI-13, UI-10, UI-08]
tier: 1
package: "tier1-presentation/web/src/modules/cockpit"
contract: "Cockpit route"
inputs:
  - "docs/ux/03_screens.md#Cockpit · \"Path to the bar\""
  - "docs/ux/screens/cockpit-dark-1440.jpg"
  - "docs/ux/screens/cockpit-light-1440.jpg"
  - "docs/ux/screens/cockpit-dark-390.jpg"
  - "docs/ux/05_demo_storyline.md#Run of show"
acceptance:
  - "Net savings panel binds res.net, res.bar, res.target (editable), res.gap, res.risk, res.tot_rr, res.tot_ot_it; all values come from the session or API, never computed in tier 1 (test: values equal the mock-session fixture; tier-check + review)"
  - "Bridge binds base.total, base.headwinds, res.tot_iy, res.tot_ot_it, res.cy27_outlay and the tier-2 `bridge` view (target outlay, gap bracket) (test)"
  - "Your inputs: sliders g.target_net and g.ot_out_share, steppers hc.us, hc.gcc, hc.ctr (the registry's ui.hero inputs); 'All 194' opens ⌘K (test)"
  - "dragging the target sends previews and the bar notch, target line and gap update from deltas (test with mock session; e2e in QA-04)"
  - "layout matches the three cockpit renders (G11 reviewer); axe clean (G12)"
gates: [G1, G2, G11, G12, G13]
size: M
notes: "Near-critical for M2: QA-04 and INT-03 wait on it. Built against the mock session; real numbers checked in INT-03."
merged_at: "2026-11-23"
```

Can we reach the bar? — the first screen of the demo.

## MOD-02 · Cockpit tiles: VP rings, Shareholder, Odds, Fastest path

```yaml
id: MOD-02
title: "Cockpit tiles: VP rings, Shareholder, Odds, Fastest path"
epic: MOD
milestone: M2
priority: must
status: done
stream: C
model: opus
effort: high
depends_on: [MOD-01, UI-15, WEB-08]
tier: 1
package: "tier1-presentation/web/src/modules/cockpit"
contract: "Cockpit route (tiles)"
inputs:
  - "docs/ux/03_screens.md#Cockpit · \"Path to the bar\""
  - "docs/ux/screens/cockpit-dark-1440.jpg"
  - "contract/api-contract (solver-runs, Monte Carlo result)"
acceptance:
  - "VP rings bind vp.net, vp.bar, vp.gap, vp.outlay for each vp member from /members (test: 4 rings for AA fixture, 5 for a five-VP fixture)"
  - "Shareholder binds br.eps27, br.px27, pl.eps, val.px, br.fuel_equiv_cents (test)"
  - "Odds: empty state 'Run 2,000 trials' when the scenario has no Monte Carlo result; otherwise histogram with P10/P50/P90, bar and P(clear) from the solver_run result (test with fixture from monte_carlo_C)"
  - "Fastest path: min-risk result (net, moves count, risk, people-lever flag, top 3 moves) and 'Show me a path' → Path (test)"
  - "all values come from the session or API, never computed in tier 1 (test: values equal the mock-session fixture; tier-check + review)"
gates: [G1, G2, G11, G12, G13]
size: M
notes: "At M2 Odds/Fastest path show empty states; they fill when JOB-03/JOB-04 land."
merged_at: "2026-11-23"
```

The rest of the cockpit.

## MOD-03 · Baseline module

```yaml
id: MOD-03
title: "Baseline module"
epic: MOD
milestone: M3
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [WEB-07, UI-14, UI-10, API-12]
tier: 1
package: "tier1-presentation/web/src/modules/baseline"
contract: "Baseline route"
inputs:
  - "docs/ux/03_screens.md#Baseline · \"Where the money is\""
  - "docs/ux/screens/baseline-dark-1440.jpg"
  - "docs/ux/05_demo_storyline.md#Run of show (2:00)"
acceptance:
  - "header strip binds base.total, base.opex_total, base.capex_total, base.locked_share and line counts from the tier-2 `baseline.summary` view; group-by segmented Cost pool / Domain / VP (test)"
  - "treemap from the `baseline.groups` view (group → line, coloured by addressability); click selects a group and sets ?group&key (test)"
  - "group detail: name, total, pool.growth editable for pools, addressability split (base.pool_addressable, base.pool_outlay), top 7 lines with editable line.amount (test)"
  - "line table: line, vendor, domain, addressability, confidence, capex share, CY26 $M editable (line.* inputs); 'Edit in Excel' → Excel module (test)"
  - "all values come from the session or API, never computed in tier 1 (test: values equal the mock-session fixture; tier-check + review)"
gates: [G1, G2, G11, G12, G13]
size: M
notes: ""
merged_at: "2026-11-23"
```

Where the money is, and what can move.

## MOD-04 · Levers module

```yaml
id: MOD-04
title: "Levers module"
epic: MOD
milestone: M3
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [WEB-07, UI-17, UI-10, API-12]
tier: 1
package: "tier1-presentation/web/src/modules/levers"
contract: "Levers route"
inputs:
  - "docs/ux/03_screens.md#Levers · \"Lever studio\""
  - "docs/ux/screens/levers-dark-1440.jpg"
  - "docs/ux/screens/levers-light-1440.jpg"
  - "docs/spec/seed/aa/lever_library.json (hypothesis text)"
acceptance:
  - "lever list: three families with totals from the `levers.families` view; each row lev.on toggle, name, in-year bar scaled by the `levers.scale` view, lev.iy (test)"
  - "lever detail: chips id/category/confidence; lev.iy, lev.rr, lev.ot; one slider per lev.Lxx.* parameter with C and D ghosts, estimates locked by kind; timing strip lev.start select, lev.ramp, 12 monthly cells; lev.conf as a Dial; hypothesis line (test with L10)"
  - "All levers: res.tot_iy, res.tot_ot_it, res.net, res.bar; 2027 by month from the `levers.monthly` view with the selected lever as a line (test)"
  - "?lever=L10 deep link selects the lever (test)"
  - "all values come from the session or API, never computed in tier 1 (test: values equal the mock-session fixture; tier-check + review)"
gates: [G1, G2, G11, G12, G13]
size: M
notes: ""
merged_at: "2026-11-23"
```

Seventeen levers made tangible.

## MOD-05 · VPs module

```yaml
id: MOD-05
title: "VPs module"
epic: MOD
milestone: M3
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [WEB-07, UI-11, UI-12, UI-10, WEB-08, API-12]
tier: 1
package: "tier1-presentation/web/src/modules/vps"
contract: "VPs route"
inputs:
  - "docs/ux/03_screens.md#VPs · \"VP targets & ownership\""
  - "docs/ux/screens/vps-dark-1440.jpg"
  - "docs/ux/screens/vps-dark-390.jpg"
acceptance:
  - "controls: g.vp_target_method segmented (Proportional / Equal / Manual), g.chargeback_on toggle (test)"
  - "VP cards per vp member: vp.outlay, bullet vp.net vs vp.bar, vp.net, vp.bar, vp.target, vp.growth, vp.gap; 'Shared owner' chip from org.ss_flag (test)"
  - "who owns what: org.dom_share ownership bars per domain from members with per-domain outlay from the `vps.domain_outlay` view; drag previews, release commits; changed numbers glow (test)"
  - "chargeback: vp.usage key bar, org.usage_override*, pool.shared toggles; 'Every VP clears?' shows the VP-feasible solver result (net, binding constraint) or empty state + run (test)"
  - "VR01 warnings appear in tier 2's words; all values come from the session or API, never computed in tier 1 (test: values equal the mock-session fixture; tier-check + review)"
gates: [G1, G2, G11, G12, G13]
size: M
notes: ""
merged_at: "2026-11-23"
```

Every VP is short today.

## MOD-06 · Path I: goal, objective, constraints, result, blend

```yaml
id: MOD-06
title: "Path I: goal, objective, constraints, result, blend"
epic: MOD
milestone: M3
priority: must
status: in_progress
stream: C
model: opus
effort: high
depends_on: [WEB-07, WEB-08, UI-10, UI-16, CON-03]
tier: 1
package: "tier1-presentation/web/src/modules/path"
contract: "Path route (goal + result)"
inputs:
  - "docs/ux/03_screens.md#Path · \"Find a path\""
  - "docs/ux/screens/solver-dark-1440.jpg"
  - "docs/ux/screens/solver-light-1440.jpg"
  - "docs/spec/solvers.json (problems.min_risk_mix.objective_options, constraints)"
acceptance:
  - "goal (editable), objective radio cards (lowest risk, most risk-adjusted, least one-time, fewest people moves, smallest change) and constraint toggles (every VP clears, US headcount floor, one-time cap, stretch cap, estimates fixed) map to solver params from the contract (test)"
  - "'Find a path' starts min_risk_mix, shows job progress, then lands moves one by one with a 90 ms stagger in optimizer order (test with mock job)"
  - "'Blend C → D' runs quick scenario_blend and shows the result (test)"
  - "result: net, 'Bar cleared' chip, risk exposure (with C and D references from result metrics), one-time, US headcount, EPS; ranked MoveRows; save as scenario; compare with C (test)"
  - "all values come from the session or API, never computed in tier 1 (test: values equal the mock-session fixture; tier-check + review)"
gates: [G1, G2, G11, G12, G13]
size: M
notes: ""
```

'Show me a path' as an explainable answer.

## MOD-07 · Path II: savings vs risk, odds, tornado

```yaml
id: MOD-07
title: "Path II: savings vs risk, odds, tornado"
epic: MOD
milestone: M3
priority: must
status: todo
stream: C
model: opus
effort: high
depends_on: [MOD-06, UI-15]
tier: 1
package: "tier1-presentation/web/src/modules/path"
contract: "Path route (analysis panels)"
inputs:
  - "docs/ux/03_screens.md#Path · \"Find a path\""
  - "docs/ux/screens/solver-dark-1440.jpg"
  - "docs/architecture/09_delivery_plan.md#3. Demo cut (must) vs post-demo (should / could)"
acceptance:
  - "savings vs risk scatter: points C, Path, All VPs, D from tier-2 result metrics and the bar line; frontier curve only when a Pareto result exists (post-demo), otherwise hidden (test)"
  - "odds: P(clear) for C and D and the D histogram from Monte Carlo results; run action when missing (test)"
  - "what moves net most: tornado top 10 from quick sensitivity; policy and timing inputs amber by tier-2 category (test)"
  - "all values come from the session or API, never computed in tier 1 (test: values equal the mock-session fixture; tier-check + review)"
gates: [G1, G2, G11, G12, G13]
size: M
notes: ""
```

The reality check after the path.

## MOD-08 · Market module

```yaml
id: MOD-08
title: "Market module"
epic: MOD
milestone: M3
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [WEB-07, UI-16, UI-10]
tier: 1
package: "tier1-presentation/web/src/modules/market"
contract: "Market route"
inputs:
  - "docs/ux/03_screens.md#Market · \"Shareholder view\""
  - "docs/ux/screens/market-dark-1440.jpg"
  - "docs/spec/02_variable_registry.md#Corporate drivers (91)"
acceptance:
  - "trace: res.net → pnl.o27 → res.tot_ot_all → br.ebitda27 → br.eps27 (+ br.eps_pct27) → br.px27 → br.mcap27 as TraceNodes, each opening the trace drawer (test)"
  - "driver dials corp.brent, corp.crack, corp.gdp, corp.lab_wage_g, corp.ac_add, corp.sofr; valuation corp.ev_mult or corp.pe with corp.w_pe (test)"
  - "adjusted EPS pl.eps per year; share price val.px (fy27b, fy27it) and br.fuel_equiv_cents (test)"
  - "'More drivers' lists every corporate driver from the bundle grouped macro, fuel, demand, labor, fleet, airports, financing, tax, valuation (test: count equals the bundle's Corporate drivers group)"
  - "all values come from the session or API, never computed in tier 1 (test: values equal the mock-session fixture; tier-check + review)"
gates: [G1, G2, G11, G12, G13]
size: M
notes: ""
merged_at: "2026-11-23"
```

IT savings in the CFO's language.

## MOD-09 · Excel module: export and import review

```yaml
id: MOD-09
title: "Excel module: export and import review"
epic: MOD
milestone: M3
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [WEB-07, UI-16, WEB-08, CON-03]
tier: 1
package: "tier1-presentation/web/src/modules/excel"
contract: "Excel route"
inputs:
  - "docs/ux/03_screens.md#Excel · \"Excel round trip\""
  - "docs/ux/screens/data-dark-1440.jpg"
  - "contract/api-contract (exports, imports, delta report)"
acceptance:
  - "export: scenario choice C, D, C + D, all five; the 11 editable sheets as chips; file name preview from tier 2; 'Export workbook' → POST exports → download via files route (test)"
  - "import review: drop file → POST imports; file card (exported time, three-way or foreign), summary chips (changes, conflicts, errors), DiffRows (sheet, item, exported, in file, app now, take) conflicts first (test with delta report fixture)"
  - "File / App choice per conflict, 'new line' chip, DELETE removals, validation line from the report, 'Preview impact', 'Apply as changeset' (test)"
  - "no workbook parsing or diffing in tier 1 (tier-check: no exceljs in the bundle)"
gates: [G1, G2, G11, G12, G13]
size: M
notes: ""
merged_at: "2026-11-23"
```

Excel in, safely.

## MOD-10 · Airlines module

```yaml
id: MOD-10
title: "Airlines module"
epic: MOD
milestone: M4
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [WEB-07, UI-10, WEB-08, API-11]
tier: 1
package: "tier1-presentation/web/src/modules/airlines"
contract: "Airlines route"
inputs:
  - "docs/ux/03_screens.md#Airlines · \"Airlines\""
  - "docs/ux/screens/airlines-dark-1440.jpg"
  - "docs/spec/07_multitenancy_reconfiguration.md#2. Tenant onboarding checklist (what the AI must produce)"
acceptance:
  - "tenant tiles from /tenants + AI drafts: AA live (line, VP, scenario counts and parity status from tier 2), UA draft, AS not started ('Set up with AI'), Add an airline; IATA monograms only (test)"
  - "Reconfigure with AI: PromptBar → POST /api/ai/reconfig with cost estimate; four steps plan / validate / review / apply with job progress; review shows plan, sources, open questions, calibration, changeset summary (test with cached UA fixture)"
  - "onboarding: the nine checklist steps with done / in review / to do from tier 2 (test)"
  - "all values come from the session or API, never computed in tier 1 (test: values equal the mock-session fixture; tier-check + review)"
gates: [G1, G2, G11, G12, G13]
size: M
notes: ""
```

AA is the first airline, not the only one.
