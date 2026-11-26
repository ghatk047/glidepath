# SRC · Sourcing and planning: ten features for the VP IT and VP Procurement

Product-owner request for the demo (Fri 4 Dec 2026): ten accretive features seen from a **VP IT** and a **VP Procurement** chair, with more data, optimizers and solvers. Built on `bl/UIX-01-desktop-density` (PR 3) on branch `bl/SRC-00-procurement-features`.

## The ten features

| # | Feature | Who asks | Where | What is new |
|---|---|---|---|---|
| F1 | **Breakeven table**: what each lever would have to deliver alone to close the gap | VP IT | Plan | UI over the existing `breakeven` solver |
| F2 | **Solve for this**: goal seek any input on the gap from the edit popover, then apply | VP IT | global edit popover | UI over the existing `goal_seek` solver |
| F3 | **Stress tests**: named shocks (GCC can't hire, vendors win COLA, late start) with editable sizes | VP IT, CFO | Plan | UI over the existing `stress_presets` solver |
| F4 | **Savings vs risk frontier**: the Pareto curve of min-risk mixes over a range of bars | VP IT | Path (existing panel) | `pareto` solver (was pending) |
| F5 | **Vendor spend cube**: spend by vendor, share, concentration (HHI, top-5), preferred vs tail, levers touching each | VP Procurement | Sourcing | tier-2 view over the 415 seeded lines |
| F6 | **Renewal calendar**: contract renewals, notice deadlines, escalator exposure and in-year capture of each negotiation | VP Procurement | Sourcing | new data: contracts (editable) |
| F7 | **Should-cost benchmarks**: unit cost vs P25/median/P75 benchmarks, gap and headroom beyond the modelled levers | VP Procurement | Sourcing | new data: benchmarks (editable) |
| F8 | **Vendor consolidation optimizer**: move tail spend to preferred vendors under a concentration cap | VP Procurement | Sourcing | new optimizer |
| F9 | **Lever business case**: NPV, payback, IRR and ROI per lever at an editable discount rate | VP IT, CFO | Plan | tier-2 view over engine outputs |
| F10 | **Wave planner**: choose lever start months under a quarterly one-time budget and launch capacity | VP IT | Plan | new `wave_plan` solver |

Deferred (not built for the demo): SRC-23 AI negotiation brief (designed for OpenRouter, key supplied at runtime, stubbed in build and tests) and SRC-24 Sobol indices panel (after SOL-10).

## Data decisions

- **The AA seed and the spec are untouched.** `docs/spec/` stays read-only; no variable, node, line or preset value changes; golden 760/760 and replay 245/245 must stay green.
- New numbers live in **new tenant dimensions** (`contract`, `benchmark`, `sourcing_param`) seeded from `tier3-data/seed/aa/sourcing.json`. Their members carry the numbers as attributes, so every one is editable through `applyChangeset()` as a structural change, audited and reversible. The engine expands over none of these dimensions, so no formula result moves.
- Parameters such as the discount rate, consolidation discount, transition cost and concentration cap are `sourcing_param` members with value, unit, min, max and step, the same shape as a registry entry. No business number is written in code.

## Modules

Two new modules (contract `AppModule` goes from 9 to 11): **Sourcing** (F5–F8, the procurement chair) and **Plan** (F1, F3, F9, F10, the VP IT chair). F2 lives in the global edit popover and F4 in Path's existing Savings vs risk panel. Every panel must pass the 1280×720 and 1920×1080 fit audit.

24 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2. Waves (at most 4 builders): **0** SRC-01, SRC-02, SRC-03, SRC-04 · **1** SRC-06/08/09/10/07, SRC-12, SRC-14/15, SRC-16/17 · **2** SRC-11, SRC-13, SRC-18, SRC-19 · **3** SRC-20, SRC-21 → SRC-22.

| id | title | model/effort | size | depends on |
|---|---|---|---|---|
| SRC-01 | AA sourcing seed: contracts, benchmarks, sourcing parameters | opus/high | M | — |
| SRC-02 | Load the sourcing dimensions; structural edits on them pass applyChangeset | opus/xhigh | M | SRC-01 |
| SRC-03 | Contract: sourcing and plan modules, sourcing and plan schemas, wave_plan problem | opus/high | M | — |
| SRC-04 | Web registry: Sourcing and Plan routes, rail entries and stubs | sonnet/high | S | SRC-03 |
| SRC-05 | Server: sourcing and plan routers registered (stubs) | sonnet/medium | S | SRC-03 |
| SRC-06 | Vendor spend cube view | sonnet/high | S | SRC-02 |
| SRC-07 | Server: sourcing routes (vendors, renewals, benchmarks, consolidation) | sonnet/high | M | SRC-05, SRC-06, SRC-08, SRC-09, SRC-10 |
| SRC-08 | Renewal calendar computation | sonnet/high | S | SRC-02 |
| SRC-09 | Should-cost benchmark gap computation | sonnet/high | S | SRC-02 |
| SRC-10 | Vendor consolidation optimizer | opus/xhigh | M | SRC-06 |
| SRC-11 | Sourcing module: spend cube, renewals, benchmarks, consolidation | opus/high | M | SRC-04, SRC-07 |
| SRC-12 | Pareto frontier solver | opus/xhigh | M | SRC-03 |
| SRC-13 | Frontier curve in Path's Savings vs risk panel | sonnet/medium | S | SRC-12 |
| SRC-14 | Wave planner solver | opus/xhigh | M | SRC-03 |
| SRC-15 | Server and worker: wave_plan runs as a solver job | sonnet/high | S | SRC-14 |
| SRC-16 | Lever business case view (NPV, payback, IRR, ROI) | opus/high | S | SRC-02 |
| SRC-17 | Server: plan routes (business case) | sonnet/high | S | SRC-05, SRC-16 |
| SRC-18 | Plan module: breakeven, stress tests, business case, wave planner | opus/high | M | SRC-04, SRC-15, SRC-17 |
| SRC-19 | Solve for this: goal seek from the edit popover | sonnet/high | S | SRC-04 |
| SRC-20 | Tour v3: steps for the ten features | sonnet/medium | S | SRC-11, SRC-13, SRC-18, SRC-19 |
| SRC-21 | E2E, a11y and desktop fit for Sourcing and Plan | sonnet/high | M | SRC-20 |
| SRC-22 | Integration and full regression | opus/high | M | SRC-21 |
| SRC-23 | AI negotiation brief (OpenRouter, stubbed) | sonnet/high | M | SRC-11 |
| SRC-24 | Sobol indices panel | sonnet/high | S | SRC-13 |

## SRC-01 · AA sourcing seed: contracts, benchmarks, sourcing parameters

```yaml
id: SRC-01
title: "AA sourcing seed: contracts, benchmarks, sourcing parameters"
epic: SRC
milestone: M4
priority: must
status: todo
stream: B
model: opus
effort: high
depends_on: []
tier: 3
package: "tier3-data/seed/aa (sourcing.json, new file)"
contract: "dimension members contract, benchmark, sourcing_param"
inputs:
  - "docs/backlog/SRC.md#Data decisions"
  - "docs/spec/seed/aa/dimension_members.json (vendor, line)"
  - "docs/spec/01_data_model.md"
acceptance:
  - "sourcing.json holds contract members for every third-party vendor with in-scope spend, each linked to a vendor and its lines (test)"
  - "benchmark members cover the line units with the most spend; each has p25 <= median <= p75 (test)"
  - "sourcing_param members each carry value, unit, min, max, step and a label; value inside [min, max] (test)"
  - "no existing seed file changes (git diff --stat of docs/spec and the existing seed files is empty)"
gates: [G1, G2]
size: M
notes: "Numbers are illustrative estimates marked source 'SRC estimate' and confidence L/M; all are editable in the app."
```

New data only; nothing in the AA seed changes.

## SRC-02 · Load the sourcing dimensions; structural edits on them pass applyChangeset

```yaml
id: SRC-02
title: "Load the sourcing dimensions; structural edits on them pass applyChangeset"
epic: SRC
milestone: M4
priority: must
status: todo
stream: B
model: opus
effort: xhigh
depends_on: [SRC-01]
tier: 2
package: "tier2-logic/worker (seed) + tier2-logic/domain (validation)"
contract: "seed loader; applyChangeset structural target on contract, benchmark, sourcing_param"
inputs:
  - "tier2-logic/worker/src/seed/tenant.ts"
  - "tier2-logic/domain/src/apply.ts"
  - "tier2-logic/domain/src/validation"
acceptance:
  - "seed loads the three dimensions through applyChangeset with origin seed, idempotently (seed.pg.test)"
  - "a structural change on a sourcing_param member commits, is audited and reverts (domain test)"
  - "a value outside [min, max] on a sourcing_param is rejected with a violation (domain test)"
  - "pnpm parity:golden stays 760/760 and 245/245; pnpm test:leak stays green; spec and seed tests unchanged"
gates: [G1, G2, G3, G7]
size: M
notes: "The engine expands over none of the new dims; check the members hash does not stale the preset calc_runs."
```

## SRC-03 · Contract: sourcing and plan modules, schemas, wave_plan problem

```yaml
id: SRC-03
title: "Contract: sourcing and plan modules, sourcing and plan schemas, wave_plan problem"
epic: SRC
milestone: M4
priority: must
status: todo
stream: C
model: opus
effort: high
depends_on: []
tier: contract
package: "contract/api-contract"
contract: "AppModule; sourcing.ts; plan.ts; ProblemId wave_plan; routes"
inputs:
  - "docs/backlog/SRC.md#The ten features"
  - "contract/api-contract/src/core.ts"
  - "contract/api-contract/src/solvers.ts"
acceptance:
  - "AppModule has 11 options with sourcing and plan (schemas spec)"
  - "VendorSpend, RenewalCalendar, BenchmarkGap, ConsolidationRequest/Result and BusinessCase parse their fixtures (spec)"
  - "ProblemId includes wave_plan with params and detail schemas (spec)"
  - "every consumer that counts modules or problems is updated in the same change"
gates: [G1, G2, G13]
size: M
notes: "Owns the shared contract files for the whole epic; later items consume only."
```

## SRC-04 · Web registry: Sourcing and Plan routes, rail entries and stubs

```yaml
id: SRC-04
title: "Web registry: Sourcing and Plan routes, rail entries and stubs"
epic: SRC
milestone: M4
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [SRC-03]
tier: 1
package: "tier1-presentation/web/src/app (+ global/shell/modules.tsx, modules/sourcing and modules/plan skeletons)"
contract: "moduleLoaders.sourcing, moduleLoaders.plan; MODULE_COPY"
inputs:
  - "tier1-presentation/web/src/app/modules.ts"
  - "tier1-presentation/web/src/global/shell/modules.tsx"
acceptance:
  - "/:tenant/:scenario/sourcing and /plan render their chunks (routes test)"
  - "the rail shows 11 modules with icons and copy (shell test)"
gates: [G1, G2, G13]
size: S
notes: ""
```

## SRC-05 · Server: sourcing and plan routers registered (stubs)

```yaml
id: SRC-05
title: "Server: sourcing and plan routers registered (stubs)"
epic: SRC
milestone: M4
priority: must
status: todo
stream: B
model: sonnet
effort: medium
depends_on: [SRC-03]
tier: 2
package: "tier2-logic/server/src/routes (sourcing, plan)"
contract: "GET /api/t/:tenant/sourcing/*, /api/t/:tenant/plan/*"
inputs:
  - "tier2-logic/server/src/routes/read/routes.ts"
acceptance:
  - "the routers mount behind auth and tenant middleware; unauthenticated calls get 401 (test)"
gates: [G1, G2]
size: S
notes: "Pre-wired in wave 0 so wave-1 builders never edit the shared route registry."
```

## SRC-06 · Vendor spend cube view

```yaml
id: SRC-06
title: "Vendor spend cube view"
epic: SRC
milestone: M4
priority: must
status: todo
stream: A
model: sonnet
effort: high
depends_on: [SRC-02]
tier: 2
package: "tier2-logic/domain/src/sourcing"
contract: "vendorSpend(lines, members) -> VendorSpend"
inputs:
  - "docs/backlog/SRC.md#The ten features (F5)"
  - "docs/spec/seed/aa/dimension_members.json (line, vendor)"
acceptance:
  - "spend by vendor sums qty x unit cost over in-scope, non-memo lines and reconciles to the third-party baseline (test)"
  - "share, cumulative share, HHI and top-5 share are right on a hand-built fixture (test)"
  - "each vendor lists the levers that touch its lines (test)"
gates: [G1, G2]
size: S
notes: "Pure; no IO."
```

## SRC-07 · Server: sourcing routes

```yaml
id: SRC-07
title: "Server: sourcing routes (vendors, renewals, benchmarks, consolidation)"
epic: SRC
milestone: M4
priority: must
status: todo
stream: B
model: sonnet
effort: high
depends_on: [SRC-05, SRC-06, SRC-08, SRC-09, SRC-10]
tier: 2
package: "tier2-logic/server/src/routes/sourcing"
contract: "GET vendors, renewals, benchmarks; POST consolidation"
inputs:
  - "contract/api-contract/src/sourcing.ts"
acceptance:
  - "each route answers its contract schema for scenario C on the seeded stack (pg test)"
  - "an edit to a contract member changes the renewals answer on the next call (pg test)"
  - "RLS: another tenant's members never appear (leak test entry)"
gates: [G1, G2, G7]
size: M
notes: ""
```

## SRC-08 · Renewal calendar computation

```yaml
id: SRC-08
title: "Renewal calendar computation"
epic: SRC
milestone: M4
priority: must
status: todo
stream: A
model: sonnet
effort: high
depends_on: [SRC-02]
tier: 2
package: "tier2-logic/domain/src/sourcing"
contract: "renewalCalendar(contracts, params, asOf) -> RenewalCalendar"
inputs:
  - "docs/backlog/SRC.md#The ten features (F6)"
acceptance:
  - "renewals in the plan window are listed with notice deadline, months to deadline and status (overdue, act now, plan, later) (test)"
  - "escalator exposure and in-year capture of a negotiated cut are right on a fixture (test)"
gates: [G1, G2]
size: S
notes: ""
```

## SRC-09 · Should-cost benchmark gap computation

```yaml
id: SRC-09
title: "Should-cost benchmark gap computation"
epic: SRC
milestone: M4
priority: must
status: todo
stream: A
model: sonnet
effort: high
depends_on: [SRC-02]
tier: 2
package: "tier2-logic/domain/src/sourcing"
contract: "benchmarkGap(lines, benchmarks, params) -> BenchmarkGap"
inputs:
  - "docs/backlog/SRC.md#The ten features (F7)"
acceptance:
  - "each benchmarked line shows unit cost vs the chosen percentile, gap per unit and opportunity in $M (test)"
  - "lines already at or below the benchmark contribute zero (test)"
  - "headroom = capturable opportunity minus the scenario's lever savings allocated to the benchmarked lines (each pool's lev.eff spread over its lines pro-rata by outlay) (test)"
gates: [G1, G2]
size: S
notes: ""
```

## SRC-10 · Vendor consolidation optimizer

```yaml
id: SRC-10
title: "Vendor consolidation optimizer"
epic: SRC
milestone: M4
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [SRC-06]
tier: 2
package: "tier2-logic/solvers/src/sourcing"
contract: "consolidate(spend, params) -> ConsolidationResult"
inputs:
  - "docs/backlog/SRC.md#The ten features (F8)"
acceptance:
  - "never breaches the concentration cap or the minimum vendor count (property test, 500 random cases)"
  - "matches brute force on small instances (test)"
  - "every move reports spend moved, annual saving, one-time transition cost and payback (test)"
gates: [G1, G2]
size: M
notes: "Greedy by net benefit with a repair step; deterministic."
```

## SRC-11 · Sourcing module

```yaml
id: SRC-11
title: "Sourcing module: spend cube, renewals, benchmarks, consolidation"
epic: SRC
milestone: M4
priority: must
status: todo
stream: C
model: opus
effort: high
depends_on: [SRC-04, SRC-07]
tier: 1
package: "tier1-presentation/web/src/modules/sourcing"
contract: "sourcing routes"
inputs:
  - "docs/ux (tokens, glass panels, density rules)"
  - "tier1-presentation/web/src/modules/vps (panel patterns)"
acceptance:
  - "four panels render tier 2 values only; no arithmetic in tier 1 (tier-check, test)"
  - "every number is editable through the edit popover or a parameter stepper and commits a changeset (test)"
  - "fits 1280x720 and 1920x1080 without page scroll (desktop audit)"
gates: [G1, G2, G9, G13]
size: M
notes: ""
```

## SRC-12 · Pareto frontier solver

```yaml
id: SRC-12
title: "Pareto frontier solver"
epic: SRC
milestone: M4
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [SRC-03]
tier: 2
package: "tier2-logic/solvers/src/problems/pareto.ts"
contract: "PROBLEMS.pareto"
inputs:
  - "docs/spec/04_solvers_simulation.md#2. Problem catalogue (Pareto frontier)"
  - "tier2-logic/solvers/src/problems/min-risk.ts"
acceptance:
  - "epsilon-constraint sweep returns a monotone frontier: higher bar never has lower risk (test)"
  - "the point at the default bar equals min_risk_mix's answer (test)"
  - "progress and cancel work (test)"
gates: [G1, G2, G5]
size: M
notes: ""
```

## SRC-13 · Frontier curve in Path's Savings vs risk panel

```yaml
id: SRC-13
title: "Frontier curve in Path's Savings vs risk panel"
epic: SRC
milestone: M4
priority: must
status: todo
stream: C
model: sonnet
effort: medium
depends_on: [SRC-12]
tier: 1
package: "tier1-presentation/web/src/modules/path"
contract: "SolverDetail pareto"
inputs:
  - "tier1-presentation/web/src/modules/path/SavingsRiskPanel.tsx"
acceptance:
  - "the panel draws the frontier from tier 2's points with the current plan marked (test)"
gates: [G1, G2, G9]
size: S
notes: ""
```

## SRC-14 · Wave planner solver

```yaml
id: SRC-14
title: "Wave planner solver"
epic: SRC
milestone: M4
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [SRC-03]
tier: 2
package: "tier2-logic/solvers/src/problems/wave-plan.ts"
contract: "PROBLEMS.wave_plan"
inputs:
  - "docs/backlog/SRC.md#The ten features (F10)"
  - "tier2-logic/solvers/src/decision-sets.ts"
acceptance:
  - "never breaches the quarterly one-time budget or the launches-per-quarter cap (property test)"
  - "CY27 net of the plan is >= the start point's when the start point is feasible (test)"
  - "returns ranked moves (lever, start month from -> to) and binding constraints (test)"
gates: [G1, G2, G5]
size: M
notes: "Start months are decision inputs; nothing outside the decision set moves."
```

## SRC-15 · Server and worker: wave_plan runs as a solver job

```yaml
id: SRC-15
title: "Server and worker: wave_plan runs as a solver job"
epic: SRC
milestone: M4
priority: must
status: todo
stream: B
model: sonnet
effort: high
depends_on: [SRC-14]
tier: 2
package: "tier2-logic/server/src/routes/solver + tier2-logic/worker/src/jobs/solver"
contract: "POST solver wave_plan"
inputs:
  - "tier2-logic/server/src/routes/solver/kinds.ts"
acceptance:
  - "a wave_plan run is queued, reports progress and saves a solver scenario (pg test)"
gates: [G1, G2]
size: S
notes: ""
```

## SRC-16 · Lever business case view

```yaml
id: SRC-16
title: "Lever business case view (NPV, payback, IRR, ROI)"
epic: SRC
milestone: M4
priority: must
status: todo
stream: A
model: opus
effort: high
depends_on: [SRC-02]
tier: 2
package: "tier2-logic/domain/src/plan"
contract: "businessCase(cells, params) -> BusinessCase"
inputs:
  - "docs/spec/03b_node_catalogue.md (lev.* nodes)"
acceptance:
  - "per lever: savings by year, one-time, NPV at the discount rate, payback month, IRR and ROI, right on a fixture (test)"
  - "a lever with no one-time cost reports payback 0 and IRR as not applicable (test)"
  - "portfolio totals reconcile to res.net's components for scenario C (test against golden C)"
gates: [G1, G2]
size: S
notes: ""
```

## SRC-17 · Server: plan routes

```yaml
id: SRC-17
title: "Server: plan routes (business case)"
epic: SRC
milestone: M4
priority: must
status: todo
stream: B
model: sonnet
effort: high
depends_on: [SRC-05, SRC-16]
tier: 2
package: "tier2-logic/server/src/routes/plan"
contract: "GET /api/t/:tenant/plan/business-case?scenario="
inputs:
  - "contract/api-contract/src/plan.ts"
acceptance:
  - "answers the contract schema for scenario C; a discount-rate edit changes NPV (pg test)"
gates: [G1, G2]
size: S
notes: ""
```

## SRC-18 · Plan module

```yaml
id: SRC-18
title: "Plan module: breakeven, stress tests, business case, wave planner"
epic: SRC
milestone: M4
priority: must
status: todo
stream: C
model: opus
effort: high
depends_on: [SRC-04, SRC-15, SRC-17]
tier: 1
package: "tier1-presentation/web/src/modules/plan"
contract: "solver routes (breakeven, stress_presets, wave_plan); plan routes"
inputs:
  - "tier1-presentation/web/src/modules/path (solver run hooks, ComputeFlow)"
acceptance:
  - "breakeven, stress, business case and wave planner panels render tier 2 values only (test)"
  - "stress sizes and wave-plan caps are editable and rerun the solver (test)"
  - "a wave plan opens as a scenario (test)"
  - "fits 1280x720 and 1920x1080 (desktop audit)"
gates: [G1, G2, G9, G13]
size: M
notes: ""
```

## SRC-19 · Solve for this: goal seek from the edit popover

```yaml
id: SRC-19
title: "Solve for this: goal seek from the edit popover"
epic: SRC
milestone: M4
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [SRC-04]
tier: 1
package: "tier1-presentation/web/src/global/overlays (edit popover)"
contract: "solver goal_seek"
inputs:
  - "tier1-presentation/web/src/global/overlays"
acceptance:
  - "Solve for this runs goal_seek on res.gap = 0 for the open input and shows the value or 'not reachable in range' with the best value (test)"
  - "Apply commits the value through the commit queue (test)"
gates: [G1, G2, G9]
size: S
notes: ""
```

## SRC-20 · Tour v3

```yaml
id: SRC-20
title: "Tour v3: steps for the ten features"
epic: SRC
milestone: M4
priority: must
status: todo
stream: C
model: sonnet
effort: medium
depends_on: [SRC-11, SRC-13, SRC-18, SRC-19]
tier: 1
package: "tier1-presentation/web/src/global/tour + docs/ux/06_walkthrough_narrative.md"
contract: "TOUR_STEPS"
inputs:
  - "tier1-presentation/web/src/global/tour/steps.ts"
acceptance:
  - "TOUR_VERSION 3; new chapters Sourcing and Plan with a step per feature; placeholders only; about <= 22 words (tour.test)"
gates: [G1, G2, G9]
size: S
notes: ""
```

## SRC-21 · E2E, a11y and desktop fit

```yaml
id: SRC-21
title: "E2E, a11y and desktop fit for Sourcing and Plan"
epic: SRC
milestone: M4
priority: must
status: todo
stream: D
model: sonnet
effort: high
depends_on: [SRC-20]
tier: ops
package: "e2e"
contract: "e2e specs"
inputs:
  - "e2e/tests"
acceptance:
  - "smoke covers both modules; the desktop audit covers every new panel and tour step (e2e)"
gates: [G9, G10, G11]
size: M
notes: "Runs against a separate compose project, never the demo stack."
```

## SRC-22 · Integration and full regression

```yaml
id: SRC-22
title: "Integration and full regression"
epic: SRC
milestone: M4
priority: must
status: todo
stream: D
model: opus
effort: high
depends_on: [SRC-21]
tier: ops
package: "docs/status"
contract: "gates"
inputs:
  - "docs/architecture/08_quality_and_testing.md"
acceptance:
  - "turbo typecheck lint test green; parity golden and replay green; tier-check, leak and e2e green; status note written"
gates: [G1, G2, G3, G7, G9, G13]
size: M
notes: ""
```

## SRC-23 · AI negotiation brief (deferred)

```yaml
id: SRC-23
title: "AI negotiation brief (OpenRouter, stubbed)"
epic: SRC
milestone: POST
priority: could
status: todo
stream: B
model: sonnet
effort: high
depends_on: [SRC-11]
tier: 2
package: "tier2-logic/ai"
contract: "POST /sourcing/brief"
inputs:
  - "tier2-logic/ai/src/client.ts"
acceptance:
  - "uses OpenRouter with OPENROUTER_API_KEY read at runtime; without it, returns a deterministic template brief (test)"
gates: [G1, G2]
size: M
notes: "Not built for the demo: needs a live LLM key. Build and tests never need the key."
```

## SRC-24 · Sobol indices panel (deferred)

```yaml
id: SRC-24
title: "Sobol indices panel"
epic: SRC
milestone: POST
priority: could
status: todo
stream: C
model: sonnet
effort: high
depends_on: [SRC-13]
tier: 1
package: "tier1-presentation/web/src/modules/path"
contract: "SolverDetail sensitivity sobol"
inputs:
  - "docs/spec/04_solvers_simulation.md#5. Sensitivity specification"
acceptance:
  - "first-order and total-effect bars for the top 20 inputs (test)"
gates: [G1, G2]
size: S
notes: "Waits for SOL-10 (Sobol in tier 2)."
```
