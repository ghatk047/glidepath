# QA · Quality

Testkit, second tenant, route-level leak test, e2e smoke, storyline, visual, accessibility and performance checks.

8 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| QA-01 | testkit: AA seed, golden accessors, DB harness, Excel fixtures | M1 | sonnet/high | M | FND-07, SPEC-03, DATA-04 |
| QA-02 | Synthetic second tenant zz | M3 | sonnet/high | M | QA-01, DOM-02 |
| QA-03 | Route-level cross-tenant leak test (3 tenants) | M3 | opus/xhigh | M | API-09, API-10, QA-02, DATA-10 |
| QA-04 | E2E smoke (G9) | M2 | sonnet/high | M | MOD-01, OPS-05, API-07, WEB-07 |
| QA-05 | Demo storyline e2e (G10) | M4 | sonnet/high | M | QA-04, MOD-02, MOD-03, MOD-04, MOD-05, MOD-07, MOD-08, MOD-09, MOD-10, JOB-04 |
| QA-06 | Visual baselines (G11) | M4 | sonnet/high | M | MOD-02, MOD-03, MOD-04, MOD-05, MOD-07, MOD-08, MOD-09, MOD-10 |
| QA-07 | Accessibility checks (G12) and Lighthouse | M4 | sonnet/high | M | MOD-02, MOD-03, MOD-04, MOD-05, MOD-07, MOD-08, MOD-09, MOD-10 |
| QA-08 | Performance monitors: drag fps, preview round trip, glass budget | M4 | sonnet/high | S | QA-04, MOD-04 |

## QA-01 · testkit: AA seed, golden accessors, DB harness, Excel fixtures

```yaml
id: QA-01
title: "testkit: AA seed, golden accessors, DB harness, Excel fixtures"
epic: QA
milestone: M1
priority: must
status: done
stream: D
model: sonnet
effort: high
depends_on: [FND-07, SPEC-03, DATA-04]
tier: ops
package: "tools/testkit"
contract: "withTestDatabase(), golden(), fixtures"
inputs:
  - "docs/architecture/08_quality_and_testing.md#2. Test data"
  - "docs/adr/ADR-016-test-database.md"
  - "docs/spec/reference/golden_results.json"
acceptance:
  - "withTestDatabase() uses TEST_DATABASE_URL, else pg-local, else Testcontainers when TESTCONTAINERS=1; applies migrations and optional seed; isolates by schema or database per test file (test)"
  - "golden(scenario, key) accessor over golden_results.json; AA seed accessors (test)"
  - "Excel fixture folder with README on how fixtures were produced (test: index lists files)"
  - "no real personal data; fictitious users only (lint)"
gates: [G1, G2]
size: M
notes: ""
merged_at: "2026-11-23"
```

Shared test infrastructure.

## QA-02 · Synthetic second tenant zz

```yaml
id: QA-02
title: "Synthetic second tenant zz"
epic: QA
milestone: M3
priority: must
status: in_progress
stream: D
model: sonnet
effort: high
depends_on: [QA-01, DOM-02]
tier: ops
package: "tools/testkit/seed/zz"
contract: "Tenant seed folder in seed/aa shape"
inputs:
  - "docs/architecture/08_quality_and_testing.md#2. Test data"
  - "docs/spec/01_data_model.md#7. What the AA seed contains"
  - "docs/spec/07_multitenancy_reconfiguration.md#2. Tenant onboarding checklist (what the AI must produce)"
acceptance:
  - "five VPs, different labor groups, lines across all 11 pools, every input present (test: readTenantSeed validates)"
  - "passes VR01–VR04, VR06, VR07, VR09, VR10 and evaluates with the engine without error once ENG-05 exists (test, skipped with reason before)"
  - "no airline names or marks (lint)"
gates: [G1, G2]
size: M
notes: ""
```

Multi-tenant tests need a tenant that is not AA.

## QA-03 · Route-level cross-tenant leak test (3 tenants)

```yaml
id: QA-03
title: "Route-level cross-tenant leak test (3 tenants)"
epic: QA
milestone: M3
priority: must
status: todo
stream: D
model: opus
effort: xhigh
depends_on: [API-09, API-10, QA-02, DATA-10]
tier: ops
package: "tier2-logic/server (test/leak)"
contract: "`pnpm test:leak` (G7)"
inputs:
  - "docs/architecture/04_data_and_api.md#Tenancy and row-level security"
  - "docs/architecture/08_quality_and_testing.md#1. Gates (G7)"
  - "docs/architecture/06_multitenancy_and_ai.md#4. Second-tenant acceptance"
acceptance:
  - "three tenants (AA, zz, a copy); every REST route and the WS session as tenant A never return or write rows of other tenants (G7)"
  - "route list is read from the server router so a new route without a case fails the test (test)"
  - "CI job leak required for data-access and server PRs (test: job enabled)"
gates: [G1, G2, G7]
size: M
notes: "Re-run by INT-05 after API-11 lands."
```

Second half of G7.

## QA-04 · E2E smoke (G9)

```yaml
id: QA-04
title: "E2E smoke (G9)"
epic: QA
milestone: M2
priority: must
status: todo
stream: D
model: sonnet
effort: high
depends_on: [MOD-01, OPS-05, API-07, WEB-07]
tier: ops
package: "e2e"
contract: "`pnpm e2e -- --trace off`"
inputs:
  - "docs/architecture/08_quality_and_testing.md#1. Gates (G9)"
  - "docs/spec/reference/golden_results.json (scenarios.C, scenarios.rates)"
  - "docs/backlog/README.md#Build environment"
acceptance:
  - "Playwright against the compose stack, or against logic + web started from source on any DATABASE_URL when no Docker daemon: load Cockpit C, drag target, switch scenario, edit a lever via the popover, undo (G9)"
  - "asserts headline numbers on Cockpit C equal golden C formatted (res.net, res.gap, res.risk, br.eps27) (test)"
  - "runs with --trace off in < 3 min (test)"
gates: [G9]
size: M
notes: ""
```

The walking-skeleton check.

## QA-05 · Demo storyline e2e (G10)

```yaml
id: QA-05
title: "Demo storyline e2e (G10)"
epic: QA
milestone: M4
priority: must
status: todo
stream: D
model: sonnet
effort: high
depends_on: [QA-04, MOD-02, MOD-03, MOD-04, MOD-05, MOD-07, MOD-08, MOD-09, MOD-10, JOB-04]
tier: ops
package: "e2e (storyline)"
contract: "`pnpm e2e:storyline -- --trace off`"
inputs:
  - "docs/ux/05_demo_storyline.md#Run of show"
  - "docs/ux/05_demo_storyline.md#Ready for questions"
  - "docs/architecture/08_quality_and_testing.md#1. Gates (G10)"
acceptance:
  - "runs the 11 beats of the run of show and asserts the quoted numbers: bar 143.0, C net 119.3, gap −23.7, Rates only 8.1, D 166.9, min-risk 143.0 with risk 42.0 and US headcount unchanged, P(clear) C 0% and D 4.5%, C EPS +0.091, price +1.02, fuel 1.74¢ (G10)"
  - "covers the 'Ready for questions' moves that exist in the build (GCC constraint, COLA, outside funding 0/100%, line edit, start month) (test)"
  - "runs nightly and before the freeze (CI job)"
gates: [G10]
size: M
notes: ""
```

The demo, rehearsed by a robot every night.

## QA-06 · Visual baselines (G11)

```yaml
id: QA-06
title: "Visual baselines (G11)"
epic: QA
milestone: M4
priority: must
status: todo
stream: D
model: sonnet
effort: high
depends_on: [MOD-02, MOD-03, MOD-04, MOD-05, MOD-07, MOD-08, MOD-09, MOD-10]
tier: ops
package: "e2e (visual)"
contract: "`pnpm e2e:visual`"
inputs:
  - "docs/architecture/08_quality_and_testing.md#1. Gates (G11)"
  - "docs/ux/screens/"
acceptance:
  - "screenshots of 8 modules × 2 themes × 2 widths (1440, 390) with a pixel threshold (G11)"
  - "first approval compared side by side with docs/ux/screens/ in a generated HTML report for the reviewer (test: report generated)"
gates: [G11]
size: M
notes: ""
```

Keeps the glass looking like the approved UX.

## QA-07 · Accessibility checks (G12) and Lighthouse

```yaml
id: QA-07
title: "Accessibility checks (G12) and Lighthouse"
epic: QA
milestone: M4
priority: must
status: todo
stream: D
model: sonnet
effort: high
depends_on: [MOD-02, MOD-03, MOD-04, MOD-05, MOD-07, MOD-08, MOD-09, MOD-10]
tier: ops
package: "e2e (a11y)"
contract: "`pnpm e2e:a11y`"
inputs:
  - "docs/architecture/08_quality_and_testing.md#1. Gates (G12)"
  - "docs/architecture/07_frontend.md#6. Accessibility and responsiveness"
  - "docs/ux/04_component_inventory.md#Accessibility notes"
acceptance:
  - "axe-core on each module in both themes: zero serious violations (G12)"
  - "Lighthouse accessibility ≥ 95 on Cockpit, Levers, Path (test)"
  - "keyboard paths: slider, dial, ownership dividers, palette, drawer (test)"
gates: [G12]
size: M
notes: ""
```

Usable by keyboard and screen reader.

## QA-08 · Performance monitors: drag fps, preview round trip, glass budget

```yaml
id: QA-08
title: "Performance monitors: drag fps, preview round trip, glass budget"
epic: QA
milestone: M4
priority: must
status: todo
stream: D
model: sonnet
effort: high
depends_on: [QA-04, MOD-04]
tier: ops
package: "e2e (perf)"
contract: "`pnpm e2e:perf`"
inputs:
  - "docs/architecture/01_architecture_overview.md#6. Non-functional targets"
  - "docs/architecture/07_frontend.md#5. Performance rules"
  - "docs/architecture/09_delivery_plan.md#4. Risks and responses (glass row)"
acceptance:
  - "frame-time sampling during a lever drag: p95 frame ≤ 16.7 ms (60 fps) on the CI runner profile (test)"
  - "preview round trip through Caddy p95 < 25 ms (test)"
  - "`pnpm e2e:perf -- --device` prints the same metrics for the owner to run on the demo Mac by Wed 2 Dec (script)"
gates: [G8]
size: S
notes: ""
```

Measured feel, not guessed.
