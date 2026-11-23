# INT · Integration

Milestone closers run by the orchestrator: wiring checks, gates, status notes, release and freeze.

6 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| INT-01 | M0 integration: stack up, gates green, seed path ready | M0 | opus/high | S | FND-03, FND-04, FND-06, OPS-05, DATA-11, UI-04, SPEC-03, CON-02 |
| INT-02 | M1 integration: parity, sessions, write path | M1 | opus/high | S | ENG-10, ENG-11, API-07, DATA-08, DATA-10, INT-01 |
| INT-03 | M2 integration: walking skeleton on Cockpit | M2 | opus/high | S | MOD-02, QA-04, API-08, API-12, WEB-07, INT-02 |
| INT-04 | M3 integration: all modules bound, solvers and Excel green | M3 | opus/high | S | MOD-03, MOD-04, MOD-05, MOD-07, MOD-08, MOD-09, QA-03, XL-07, SOL-11, API-09, API-10, JOB-03, INT-03 |
| INT-05 | M4 integration: Airlines, demo profile, storyline green | M4 | opus/high | S | OPS-06, OPS-07, MOD-10, QA-05, QA-06, QA-07, QA-08, INT-04 |
| INT-06 | M5 freeze: market refresh, backup, rehearsal, tag | M5 | opus/high | S | INT-05 |

## INT-01 · M0 integration: stack up, gates green, seed path ready

```yaml
id: INT-01
title: "M0 integration: stack up, gates green, seed path ready"
epic: INT
milestone: M0
priority: must
status: done
stream: D
model: opus
effort: high
depends_on: [FND-03, FND-04, FND-06, OPS-05, DATA-11, UI-04, SPEC-03, CON-02]
tier: ops
package: "repo (integration, no feature code)"
contract: "M0 exit criteria (09 §1)"
inputs:
  - "docs/architecture/09_delivery_plan.md#1. Milestones"
  - "docs/architecture/prompts/20_orchestrator.md#Loop (repeat until the milestone exit criteria in 09 §1 are met)"
  - "docs/architecture/08_quality_and_testing.md#1. Gates"
acceptance:
  - "G1, G2, G13 green on main; G14 compose-check green in CI (and on the Mac when the owner runs it) (test: CI run links in docs/status)"
  - "tokens → CSS present, spec types generated, DB schema + RLS + views applied by migrate (test: compose-check)"
  - "docs/status/2026-11-24.md written with the M0 status and the DATA-08 seed timing (test: file exists)"
gates: [G1, G2, G13, G14]
size: S
notes: "merged wiring 2026-11-23; G14 PASS with STRICT_ENTRYPOINTS=1: 6 services in 22s, M0 data and token checks ok"
merged_at: "2026-11-23"
```

Closes M0.

## INT-02 · M1 integration: parity, sessions, write path

```yaml
id: INT-02
title: "M1 integration: parity, sessions, write path"
epic: INT
milestone: M1
priority: must
status: in_progress
stream: D
model: opus
effort: high
depends_on: [ENG-10, ENG-11, API-07, DATA-08, DATA-10, INT-01]
tier: ops
package: "repo (integration, no feature code)"
contract: "M1 exit criteria (09 §1)"
inputs:
  - "docs/architecture/09_delivery_plan.md#1. Milestones"
  - "docs/architecture/prompts/20_orchestrator.md#Loop (repeat until the milestone exit criteria in 09 §1 are met)"
  - "docs/architecture/08_quality_and_testing.md#1. Gates"
  - "docs/spec/reference/golden_results.json (scenarios.C)"
acceptance:
  - "G3 760/760 and 245/245, G4 fuzz, G8 engine budgets green on main (test: CI)"
  - "on the seeded stack: WS preview of g.target_net on C returns a delta; POST /changesets persists, forks Custom (from C), recomputes; GET calc equals golden C headline values (test: tools/int/m1.spec.ts)"
  - "docs/status note records the numbers"
gates: [G3, G4, G7, G8]
size: S
notes: ""
```

Closes M1.

## INT-03 · M2 integration: walking skeleton on Cockpit

```yaml
id: INT-03
title: "M2 integration: walking skeleton on Cockpit"
epic: INT
milestone: M2
priority: must
status: todo
stream: D
model: opus
effort: high
depends_on: [MOD-02, QA-04, API-08, API-12, WEB-07, INT-02]
tier: ops
package: "repo (integration, no feature code)"
contract: "M2 exit criteria (09 §1)"
inputs:
  - "docs/architecture/09_delivery_plan.md#1. Milestones"
  - "docs/architecture/prompts/20_orchestrator.md#Loop (repeat until the milestone exit criteria in 09 §1 are met)"
  - "docs/architecture/08_quality_and_testing.md#1. Gates"
  - "docs/architecture/prompts/20_orchestrator.md#Loop (repeat until the milestone exit criteria in 09 §1 are met) (step 6)"
acceptance:
  - "Cockpit C on the compose stack shows net 119.3, gap −23.7, risk-adjusted 82.0, EPS +0.091 (test: e2e assertion)"
  - "edits persist across reload; global layer (rail, scenario bar, flight strip, edit popover, trace drawer, ⌘K) works; G9 green (test)"
  - "status note with screenshots in both themes"
gates: [G9, G13, G14]
size: S
notes: ""
```

Closes M2 (Fri 27 Nov).

## INT-04 · M3 integration: all modules bound, solvers and Excel green

```yaml
id: INT-04
title: "M3 integration: all modules bound, solvers and Excel green"
epic: INT
milestone: M3
priority: must
status: todo
stream: D
model: opus
effort: high
depends_on: [MOD-03, MOD-04, MOD-05, MOD-07, MOD-08, MOD-09, QA-03, XL-07, SOL-11, API-09, API-10, JOB-03, INT-03]
tier: ops
package: "repo (integration, no feature code)"
contract: "M3 exit criteria (09 §1)"
inputs:
  - "docs/architecture/09_delivery_plan.md#1. Milestones"
  - "docs/architecture/prompts/20_orchestrator.md#Loop (repeat until the milestone exit criteria in 09 §1 are met)"
  - "docs/architecture/08_quality_and_testing.md#1. Gates"
acceptance:
  - "G5, G6, G7 green on main (test: CI)"
  - "storyline beats 0:00–18:00 run against the stack (Airlines pending) (test: storyline e2e subset)"
  - "`python3 tools/backlog/extract.py --check` passes and coverage.md 'Uncovered must-scope' says none (test + review)"
gates: [G5, G6, G7, G9]
size: S
notes: "After M3 the orchestrator accepts only must items and bug fixes."
```

Closes M3 (Tue 1 Dec).

## INT-05 · M4 integration: Airlines, demo profile, storyline green

```yaml
id: INT-05
title: "M4 integration: Airlines, demo profile, storyline green"
epic: INT
milestone: M4
priority: must
status: todo
stream: D
model: opus
effort: high
depends_on: [OPS-06, OPS-07, MOD-10, QA-05, QA-06, QA-07, QA-08, INT-04]
tier: ops
package: "repo (integration, no feature code)"
contract: "M4 exit criteria (09 §1)"
inputs:
  - "docs/architecture/09_delivery_plan.md#1. Milestones"
  - "docs/architecture/prompts/20_orchestrator.md#Loop (repeat until the milestone exit criteria in 09 §1 are met)"
  - "docs/architecture/08_quality_and_testing.md#1. Gates"
  - "docs/ux/05_demo_storyline.md#Before the day"
acceptance:
  - "G10 storyline green on the demo profile; ops/demo-check.sh green (test)"
  - "visual pass vs docs/ux/screens signed off by the reviewer; glass perf measured on the demo Mac by the owner (QA-08 script output in status)"
  - "leak test re-run with AI routes present (QA-03) (test)"
gates: [G10, G11, G12, G14]
size: S
notes: ""
```

Closes M4 (Wed 2 Dec).

## INT-06 · M5 freeze: market refresh, backup, rehearsal, tag

```yaml
id: INT-06
title: "M5 freeze: market refresh, backup, rehearsal, tag"
epic: INT
milestone: M5
priority: must
status: todo
stream: D
model: opus
effort: high
depends_on: [INT-05]
tier: ops
package: "repo (release, no feature code)"
contract: "Freeze steps of prompts/20"
inputs:
  - "docs/architecture/09_delivery_plan.md#1. Milestones"
  - "docs/architecture/prompts/20_orchestrator.md#Loop (repeat until the milestone exit criteria in 09 §1 are met)"
  - "docs/architecture/08_quality_and_testing.md#1. Gates"
  - "docs/architecture/prompts/20_orchestrator.md#Freeze (Thu 3 Dec, 18:00 US Central)"
  - "docs/ux/05_demo_storyline.md#Before the day"
acceptance:
  - "market refresh (share price, Brent/jet from the EIA December STEO) applied via POST market/refresh with the as-of date recorded; values supplied by the owner (test: changeset origin=market exists)"
  - "ops/backup.sh run; storyline e2e passes on the demo Mac with Wi-Fi off (owner-run, output in status)"
  - "tag demo-2026-12-04 and pinned multi-arch images; docs/status/demo-runbook.md (start/stop, URL, accounts, fallbacks, market data date); no merges after 18:00 CT Thu 3 Dec"
gates: [G10, G14]
size: S
notes: ""
```

Ready for Friday.
