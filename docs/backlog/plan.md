# Build plan

Generated from the item YAML (`items.json`). Today is Mon 23 Nov 2026 (US Central); demo Fri 4 Dec; freeze Thu 3 Dec 18:00 CT.
Durations assumed per item including review: S = 2.5 h, M = 4 h of builder wall time. Build window assumed 07:00–24:00 CT daily (Mon 23 from 13:00, Thu 3 Dec to 18:00; milestone deadlines read as 24:00 of their day), 4 parallel builders (09 §2), one builder per package scope (ADR-017). If the orchestrator also runs overnight, every date below moves earlier.

## Milestones

| milestone | deadline (09 §1) | items | must | simulated finish | slack |
|---|---|---|---|---|---|
| M0 | Tue 24 Nov 24:00 | 30 | 30 | Tue 24 Nov 22:00 | +2.0 h |
| M1 | Thu 26 Nov 24:00 | 25 | 25 | Thu 26 Nov 21:00 | +3.0 h |
| M2 | Fri 27 Nov 24:00 | 26 | 26 | Fri 27 Nov 20:00 | +4.0 h |
| M3 | Tue 01 Dec 24:00 | 38 | 38 | Sun 29 Nov 24:00 | +34.0 h |
| M4 | Wed 02 Dec 24:00 | 19 | 17 | Tue 01 Dec 15:30 | +25.5 h |
| M5 | Thu 03 Dec 18:00 | 1 | 1 | Tue 01 Dec 18:00 | +34.0 h |
| POST | after demo | 2 | 0 | not scheduled | — |

Notes:
- M0 exit 'AA seed loaded' in the database depends on `applyChangeset` (DOM-03) because seeding uses the write path (04 §1). In M0 the seed is proven from JSON (SPEC-03, ENG-06 inputs) and the schema/RLS/views are applied by `migrate`; DATA-08 loads the seed through `applyChangeset` early in M1. This is the only M0 exit criterion that moves.
- Slack before M2 is thin (a few hours). If an engine item fails review twice (escalation, 10 §2), M1/M2 slip unless the orchestrator runs overnight or adds a fifth builder for that stretch; stream C has the most parallel-ready work. M3–M5 carry 1–1.5 days of slack: that is the rework buffer, not spare scope (scope control after M3, prompts/20).
- INT-06 (freeze) is shown when its dependencies allow it; it actually runs on Thu 3 Dec because the market refresh uses the EIA December STEO and the rehearsal happens on the demo Mac.
- Thu 26 Nov is Thanksgiving: the plan assumes builders run; the owner is only needed for the Mac-only checks listed in coverage.md (gaps).

## Items per milestone and stream

| milestone | A Tier 2 engine + solvers + domain | B Tier 2/3 data + API + ops + Excel + AI | C Tier 1 UI | D Quality + foundations + integration | total |
|---|---|---|---|---|---|
| M0 | 6: SPEC-01, SPEC-02, SPEC-03, ENG-01, ENG-02, DOM-01 | 12: OPS-01, OPS-02, OPS-03, OPS-05, CON-01, CON-02, DATA-01, DATA-02, DATA-03, DATA-11, DATA-04, API-01 | 4: UI-01, UI-02, UI-03, UI-04 | 8: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, INT-01 | 30 |
| M1 | 13: ENG-03, ENG-04, ENG-05, ENG-06, ENG-07, ENG-08, ENG-09, ENG-10, ENG-11, DOM-02, DOM-03, DOM-04, DOM-05 | 9: CON-04, DATA-05, DATA-06, DATA-08, DATA-10, API-04, API-05, API-06, API-07 | 1: WEB-01 | 2: QA-01, INT-02 | 25 |
| M2 | 1: DOM-06 | 4: CON-03, API-02, API-08, API-12 | 19: UI-05, UI-06, UI-07, UI-08, UI-09, UI-10, UI-12, UI-13, UI-15, UI-18, WEB-02, WEB-03, WEB-04, WEB-05, WEB-06, WEB-07, WEB-08, MOD-01, MOD-02 | 2: QA-04, INT-03 | 26 |
| M3 | 12: SOL-01, SOL-02, SOL-03, SOL-04, SOL-05, SOL-06, SOL-07, SOL-08, SOL-11, JOB-01, JOB-02, JOB-03 | 12: OPS-04, DATA-07, API-09, API-10, XL-01, XL-02, XL-03, XL-04, XL-05, XL-06, XL-07, XL-08 | 11: UI-11, UI-14, UI-16, UI-17, MOD-03, MOD-04, MOD-05, MOD-06, MOD-07, MOD-08, MOD-09 | 3: QA-02, QA-03, INT-04 | 38 |
| M4 | 1: JOB-04 | 12: OPS-06, OPS-07, DATA-09, API-03, API-11, AI-01, AI-02, AI-03, AI-04, AI-05, AI-06, AI-07 | 1: MOD-10 | 5: QA-05, QA-06, QA-07, QA-08, INT-05 | 19 |
| M5 | — | — | — | 1: INT-06 | 1 |
| POST | 2: SOL-09, SOL-10 | — | — | — | 2 |

Streams are labels for status reporting; builders take any ready item, so a stream's items are not tied to one builder.

## Critical path

To M2 (walking skeleton, INT-03): 54.0 builder-hours of sequential work.

FND-01 → SPEC-01 → SPEC-02 → ENG-01 → ENG-02 → ENG-03 → ENG-04 → ENG-05 → ENG-06 → ENG-07 → DOM-05 → API-05 → API-07 → QA-04 → INT-03

To M1 (INT-02): 50.0 h: FND-01 → SPEC-01 → SPEC-02 → ENG-01 → ENG-02 → ENG-03 → ENG-04 → ENG-05 → ENG-06 → ENG-07 → DOM-05 → API-05 → API-07 → INT-02

Whole build to the freeze (INT-06): 68.5 h: FND-01 → SPEC-01 → SPEC-02 → ENG-01 → ENG-02 → ENG-03 → ENG-04 → ENG-05 → ENG-06 → ENG-07 → DOM-05 → AI-04 → AI-05 → AI-06 → API-11 → MOD-10 → QA-05 → INT-05 → INT-06

The intended spine FND → SPEC → ENG → DOM/API + CON → WEB → MOD Cockpit holds: the engine parity gate (ENG-06) sits on it, and everything numeric after it waits for that gate.

### Simulated start/finish of the M2 critical path

| item | title | start | finish |
|---|---|---|---|
| FND-01 | Monorepo scaffold with tier folders, pnpm and Turborepo | Mon 23 Nov 13:00 | Mon 23 Nov 17:00 |
| SPEC-01 | Generate zod types and id unions from spec JSON | Mon 23 Nov 17:00 | Mon 23 Nov 19:30 |
| SPEC-02 | Spec loader, ModelBundle and members hash | Mon 23 Nov 21:00 | Tue 24 Nov 08:00 |
| ENG-01 | Engine port map (PORTING.md) and package skeleton | Tue 24 Nov 10:30 | Tue 24 Nov 13:00 |
| ENG-02 | Tokenizer and Pratt parser | Tue 24 Nov 18:00 | Tue 24 Nov 20:30 |
| ENG-03 | Expander: cells, cases, implicit indexing, where-filters, deps | Tue 24 Nov 20:30 | Wed 25 Nov 07:30 |
| ENG-04 | Topological sort, lowering to a flat program, CSR adjacency | Wed 25 Nov 07:30 | Wed 25 Nov 11:30 |
| ENG-05 | Full evaluation with overrides and inputHash | Wed 25 Nov 11:30 | Wed 25 Nov 15:30 |
| ENG-06 | PARITY GATE: golden 760/760 and parity replay 245/245 | Wed 25 Nov 15:30 | Wed 25 Nov 19:30 |
| ENG-07 | Incremental rerun with dirty propagation | Wed 25 Nov 19:30 | Wed 25 Nov 23:30 |
| DOM-05 | Post-commit recompute, calc_run, VR05 and VR08 | Wed 25 Nov 23:30 | Thu 26 Nov 10:30 |
| API-05 | Write routes: changesets, revert, scenarios, calc | Thu 26 Nov 10:30 | Thu 26 Nov 14:30 |
| API-07 | Session lifecycle: commit broadcast, warnings, idle close, reconnect | Thu 26 Nov 14:30 | Thu 26 Nov 18:30 |
| QA-04 | E2E smoke (G9) | Fri 27 Nov 13:00 | Fri 27 Nov 17:00 |
| INT-03 | M2 integration: walking skeleton on Cockpit | Fri 27 Nov 17:30 | Fri 27 Nov 20:00 |

## Parallelism per day

Ready width = most items whose dependencies were met at the same moment (running + waiting); builders = most builders busy at once (capped at 4).

| day | ready width (max) | builders busy (max) | items finished |
|---|---|---|---|
| Mon 23 Nov | 11 | 4 | 7 |
| Tue 24 Nov | 26 | 4 | 23 |
| Wed 25 Nov | 28 | 4 | 19 |
| Thu 26 Nov | 28 | 4 | 18 |
| Fri 27 Nov | 19 | 4 | 20 |
| Sat 28 Nov | 21 | 4 | 20 |
| Sun 29 Nov | 15 | 4 | 19 |
| Mon 30 Nov | 4 | 4 | 9 |
| Tue 01 Dec | 1 | 1 | 4 |
| Wed 02 Dec | 0 | 0 | 0 |
| Thu 03 Dec | 0 | 0 | 0 |

Scheduled work: 490 builder-hours over 139 items; capacity in the window with 4 builders: 700 h (70% load). POST items (2) are not scheduled.

## Model and effort totals

| model | low | medium | high | xhigh | max | total | builder-hours |
|---|---|---|---|---|---|---|---|
| opus | 0 | 0 | 34 | 33 | 0 | 67 | 246 |
| sonnet | 0 | 15 | 58 | 0 | 0 | 73 | 250 |
| haiku | 1 | 0 | 0 | 0 | 0 | 1 | 2 |
| total | 1 | 15 | 92 | 33 | 0 | 141 | 498 |

### By epic

| epic | items | S | M | opus | sonnet | haiku | must | should |
|---|---|---|---|---|---|---|---|---|
| FND | 7 | 4 | 3 | 1 | 6 | 0 | 7 | 0 |
| OPS | 7 | 5 | 2 | 1 | 6 | 0 | 7 | 0 |
| CON | 4 | 1 | 3 | 4 | 0 | 0 | 4 | 0 |
| SPEC | 3 | 2 | 1 | 0 | 2 | 1 | 3 | 0 |
| ENG | 11 | 3 | 8 | 11 | 0 | 0 | 11 | 0 |
| DATA | 11 | 4 | 7 | 3 | 8 | 0 | 10 | 1 |
| DOM | 6 | 0 | 6 | 6 | 0 | 0 | 6 | 0 |
| API | 12 | 1 | 11 | 4 | 8 | 0 | 11 | 1 |
| JOB | 4 | 2 | 2 | 0 | 4 | 0 | 4 | 0 |
| SOL | 11 | 4 | 7 | 9 | 2 | 0 | 9 | 2 |
| XL | 8 | 2 | 6 | 1 | 7 | 0 | 8 | 0 |
| AI | 7 | 1 | 6 | 6 | 1 | 0 | 7 | 0 |
| UI | 18 | 6 | 12 | 5 | 13 | 0 | 18 | 0 |
| WEB | 8 | 2 | 6 | 5 | 3 | 0 | 8 | 0 |
| MOD | 10 | 0 | 10 | 4 | 6 | 0 | 10 | 0 |
| QA | 8 | 1 | 7 | 1 | 7 | 0 | 8 | 0 |
| INT | 6 | 6 | 0 | 6 | 0 | 0 | 6 | 0 |
| total | 141 | 44 | 97 | 67 | 73 | 1 | 137 | 4 |

## Simulated schedule (all scheduled items)

| item | ms | model/effort | size | start | finish |
|---|---|---|---|---|---|
| FND-01 | M0 | sonnet/medium | M | Mon 23 Nov 13:00 | Mon 23 Nov 17:00 |
| FND-05 | M0 | sonnet/medium | M | Mon 23 Nov 13:00 | Mon 23 Nov 17:00 |
| CON-01 | M0 | opus/high | M | Mon 23 Nov 17:00 | Mon 23 Nov 21:00 |
| DATA-01 | M0 | sonnet/high | M | Mon 23 Nov 17:00 | Mon 23 Nov 21:00 |
| FND-02 | M0 | sonnet/medium | M | Mon 23 Nov 17:00 | Mon 23 Nov 21:00 |
| SPEC-01 | M0 | haiku/low | S | Mon 23 Nov 17:00 | Mon 23 Nov 19:30 |
| FND-07 | M0 | sonnet/medium | S | Mon 23 Nov 19:30 | Mon 23 Nov 22:00 |
| DATA-02 | M0 | opus/xhigh | M | Mon 23 Nov 21:00 | Tue 24 Nov 08:00 |
| OPS-01 | M0 | opus/high | M | Mon 23 Nov 21:00 | Tue 24 Nov 08:00 |
| SPEC-02 | M0 | sonnet/high | M | Mon 23 Nov 21:00 | Tue 24 Nov 08:00 |
| DATA-04 | M0 | sonnet/high | M | Mon 23 Nov 22:00 | Tue 24 Nov 09:00 |
| OPS-02 | M0 | sonnet/high | S | Tue 24 Nov 08:00 | Tue 24 Nov 10:30 |
| OPS-03 | M0 | sonnet/high | S | Tue 24 Nov 08:00 | Tue 24 Nov 10:30 |
| UI-01 | M0 | sonnet/medium | S | Tue 24 Nov 08:00 | Tue 24 Nov 10:30 |
| API-01 | M0 | sonnet/high | M | Tue 24 Nov 09:00 | Tue 24 Nov 13:00 |
| CON-02 | M0 | opus/high | S | Tue 24 Nov 10:30 | Tue 24 Nov 13:00 |
| ENG-01 | M0 | opus/xhigh | S | Tue 24 Nov 10:30 | Tue 24 Nov 13:00 |
| SPEC-03 | M0 | sonnet/high | S | Tue 24 Nov 10:30 | Tue 24 Nov 13:00 |
| DATA-11 | M0 | sonnet/medium | S | Tue 24 Nov 13:00 | Tue 24 Nov 15:30 |
| FND-03 | M0 | sonnet/high | S | Tue 24 Nov 13:00 | Tue 24 Nov 15:30 |
| FND-04 | M0 | sonnet/medium | S | Tue 24 Nov 13:00 | Tue 24 Nov 15:30 |
| UI-04 | M0 | sonnet/high | S | Tue 24 Nov 13:00 | Tue 24 Nov 15:30 |
| DOM-01 | M0 | opus/xhigh | M | Tue 24 Nov 15:30 | Tue 24 Nov 19:30 |
| FND-06 | M0 | opus/high | S | Tue 24 Nov 15:30 | Tue 24 Nov 18:00 |
| OPS-05 | M0 | sonnet/high | S | Tue 24 Nov 15:30 | Tue 24 Nov 18:00 |
| UI-02 | M0 | opus/high | M | Tue 24 Nov 15:30 | Tue 24 Nov 19:30 |
| ENG-02 | M0 | opus/xhigh | S | Tue 24 Nov 18:00 | Tue 24 Nov 20:30 |
| UI-03 | M0 | sonnet/medium | S | Tue 24 Nov 18:00 | Tue 24 Nov 20:30 |
| DATA-03 | M0 | sonnet/high | S | Tue 24 Nov 19:30 | Tue 24 Nov 22:00 |
| INT-01 | M0 | opus/high | S | Tue 24 Nov 19:30 | Tue 24 Nov 22:00 |
| DOM-02 | M1 | opus/xhigh | M | Tue 24 Nov 20:30 | Wed 25 Nov 07:30 |
| ENG-03 | M1 | opus/xhigh | M | Tue 24 Nov 20:30 | Wed 25 Nov 07:30 |
| CON-04 | M1 | opus/high | M | Tue 24 Nov 22:00 | Wed 25 Nov 09:00 |
| DATA-05 | M1 | opus/xhigh | M | Tue 24 Nov 22:00 | Wed 25 Nov 09:00 |
| DOM-03 | M1 | opus/xhigh | M | Wed 25 Nov 07:30 | Wed 25 Nov 11:30 |
| ENG-04 | M1 | opus/xhigh | M | Wed 25 Nov 07:30 | Wed 25 Nov 11:30 |
| API-04 | M1 | sonnet/high | M | Wed 25 Nov 09:00 | Wed 25 Nov 13:00 |
| WEB-01 | M1 | sonnet/high | M | Wed 25 Nov 09:00 | Wed 25 Nov 13:00 |
| DATA-06 | M1 | sonnet/high | M | Wed 25 Nov 11:30 | Wed 25 Nov 15:30 |
| ENG-05 | M1 | opus/xhigh | M | Wed 25 Nov 11:30 | Wed 25 Nov 15:30 |
| DOM-04 | M1 | opus/xhigh | M | Wed 25 Nov 13:00 | Wed 25 Nov 17:00 |
| UI-08 | M2 | opus/high | M | Wed 25 Nov 13:00 | Wed 25 Nov 17:00 |
| ENG-06 | M1 | opus/xhigh | M | Wed 25 Nov 15:30 | Wed 25 Nov 19:30 |
| UI-09 | M2 | sonnet/high | M | Wed 25 Nov 15:30 | Wed 25 Nov 19:30 |
| WEB-02 | M2 | sonnet/high | S | Wed 25 Nov 17:00 | Wed 25 Nov 19:30 |
| WEB-03 | M2 | opus/high | M | Wed 25 Nov 17:00 | Wed 25 Nov 21:00 |
| DATA-08 | M1 | sonnet/medium | M | Wed 25 Nov 19:30 | Wed 25 Nov 23:30 |
| DATA-10 | M1 | opus/xhigh | S | Wed 25 Nov 19:30 | Wed 25 Nov 22:00 |
| ENG-07 | M1 | opus/xhigh | M | Wed 25 Nov 19:30 | Wed 25 Nov 23:30 |
| WEB-04 | M2 | opus/high | M | Wed 25 Nov 21:00 | Thu 26 Nov 08:00 |
| QA-01 | M1 | sonnet/high | M | Wed 25 Nov 22:00 | Thu 26 Nov 09:00 |
| DOM-05 | M1 | opus/xhigh | M | Wed 25 Nov 23:30 | Thu 26 Nov 10:30 |
| UI-05 | M2 | sonnet/high | M | Wed 25 Nov 23:30 | Thu 26 Nov 10:30 |
| API-06 | M1 | opus/xhigh | M | Thu 26 Nov 08:00 | Thu 26 Nov 12:00 |
| ENG-08 | M1 | opus/xhigh | M | Thu 26 Nov 09:00 | Thu 26 Nov 13:00 |
| API-05 | M1 | sonnet/high | M | Thu 26 Nov 10:30 | Thu 26 Nov 14:30 |
| ENG-10 | M1 | opus/xhigh | M | Thu 26 Nov 10:30 | Thu 26 Nov 14:30 |
| UI-06 | M2 | sonnet/high | M | Thu 26 Nov 12:00 | Thu 26 Nov 16:00 |
| ENG-11 | M1 | opus/xhigh | S | Thu 26 Nov 13:00 | Thu 26 Nov 15:30 |
| API-07 | M1 | opus/xhigh | M | Thu 26 Nov 14:30 | Thu 26 Nov 18:30 |
| UI-07 | M2 | sonnet/high | M | Thu 26 Nov 14:30 | Thu 26 Nov 18:30 |
| ENG-09 | M1 | opus/xhigh | M | Thu 26 Nov 15:30 | Thu 26 Nov 19:30 |
| WEB-05 | M2 | opus/high | M | Thu 26 Nov 16:00 | Thu 26 Nov 20:00 |
| INT-02 | M1 | opus/high | S | Thu 26 Nov 18:30 | Thu 26 Nov 21:00 |
| UI-10 | M2 | sonnet/medium | M | Thu 26 Nov 18:30 | Thu 26 Nov 22:30 |
| UI-12 | M2 | opus/high | M | Thu 26 Nov 19:30 | Thu 26 Nov 23:30 |
| WEB-06 | M2 | opus/high | M | Thu 26 Nov 20:00 | Thu 26 Nov 24:00 |
| UI-13 | M2 | opus/high | M | Thu 26 Nov 21:00 | Fri 27 Nov 08:00 |
| CON-03 | M2 | opus/high | M | Thu 26 Nov 22:30 | Fri 27 Nov 09:30 |
| UI-18 | M2 | sonnet/high | S | Thu 26 Nov 23:30 | Fri 27 Nov 09:00 |
| UI-15 | M2 | sonnet/high | M | Thu 26 Nov 24:00 | Fri 27 Nov 11:00 |
| MOD-01 | M2 | opus/high | M | Fri 27 Nov 08:00 | Fri 27 Nov 12:00 |
| WEB-07 | M2 | opus/high | M | Fri 27 Nov 09:00 | Fri 27 Nov 13:00 |
| DOM-06 | M2 | opus/high | M | Fri 27 Nov 09:30 | Fri 27 Nov 13:30 |
| WEB-08 | M2 | sonnet/high | S | Fri 27 Nov 11:00 | Fri 27 Nov 13:30 |
| API-08 | M2 | sonnet/high | M | Fri 27 Nov 12:00 | Fri 27 Nov 16:00 |
| QA-04 | M2 | sonnet/high | M | Fri 27 Nov 13:00 | Fri 27 Nov 17:00 |
| API-12 | M2 | sonnet/high | S | Fri 27 Nov 13:30 | Fri 27 Nov 16:00 |
| MOD-02 | M2 | opus/high | M | Fri 27 Nov 13:30 | Fri 27 Nov 17:30 |
| API-02 | M2 | opus/xhigh | M | Fri 27 Nov 16:00 | Fri 27 Nov 20:00 |
| XL-01 | M3 | sonnet/high | M | Fri 27 Nov 16:00 | Fri 27 Nov 20:00 |
| SOL-01 | M3 | opus/xhigh | M | Fri 27 Nov 17:00 | Fri 27 Nov 21:00 |
| INT-03 | M2 | opus/high | S | Fri 27 Nov 17:30 | Fri 27 Nov 20:00 |
| AI-01 | M4 | opus/high | M | Fri 27 Nov 20:00 | Fri 27 Nov 24:00 |
| JOB-01 | M3 | sonnet/high | M | Fri 27 Nov 20:00 | Fri 27 Nov 24:00 |
| XL-03 | M3 | sonnet/high | M | Fri 27 Nov 20:00 | Fri 27 Nov 24:00 |
| DATA-07 | M3 | sonnet/medium | S | Fri 27 Nov 21:00 | Fri 27 Nov 23:30 |
| SOL-02 | M3 | opus/xhigh | M | Fri 27 Nov 23:30 | Sat 28 Nov 10:30 |
| AI-02 | M4 | opus/high | S | Fri 27 Nov 24:00 | Sat 28 Nov 09:30 |
| UI-16 | M3 | sonnet/high | M | Fri 27 Nov 24:00 | Sat 28 Nov 11:00 |
| XL-05 | M3 | opus/xhigh | M | Fri 27 Nov 24:00 | Sat 28 Nov 11:00 |
| AI-03 | M4 | opus/high | M | Sat 28 Nov 09:30 | Sat 28 Nov 13:30 |
| SOL-04 | M3 | opus/xhigh | M | Sat 28 Nov 10:30 | Sat 28 Nov 14:30 |
| JOB-02 | M3 | sonnet/high | S | Sat 28 Nov 11:00 | Sat 28 Nov 13:30 |
| XL-04 | M3 | sonnet/high | S | Sat 28 Nov 11:00 | Sat 28 Nov 13:30 |
| MOD-06 | M3 | opus/high | M | Sat 28 Nov 13:30 | Sat 28 Nov 17:30 |
| UI-14 | M3 | opus/high | M | Sat 28 Nov 13:30 | Sat 28 Nov 17:30 |
| XL-02 | M3 | sonnet/high | M | Sat 28 Nov 13:30 | Sat 28 Nov 17:30 |
| SOL-03 | M3 | opus/xhigh | S | Sat 28 Nov 14:30 | Sat 28 Nov 17:00 |
| SOL-07 | M3 | opus/xhigh | S | Sat 28 Nov 17:00 | Sat 28 Nov 19:30 |
| AI-04 | M4 | opus/high | M | Sat 28 Nov 17:30 | Sat 28 Nov 21:30 |
| QA-02 | M3 | sonnet/high | M | Sat 28 Nov 17:30 | Sat 28 Nov 21:30 |
| XL-06 | M3 | sonnet/high | S | Sat 28 Nov 17:30 | Sat 28 Nov 20:00 |
| SOL-08 | M3 | sonnet/high | S | Sat 28 Nov 19:30 | Sat 28 Nov 22:00 |
| XL-08 | M3 | sonnet/high | M | Sat 28 Nov 20:00 | Sat 28 Nov 24:00 |
| UI-11 | M3 | sonnet/high | S | Sat 28 Nov 21:30 | Sat 28 Nov 24:00 |
| UI-17 | M3 | sonnet/high | S | Sat 28 Nov 21:30 | Sat 28 Nov 24:00 |
| SOL-05 | M3 | opus/xhigh | M | Sat 28 Nov 22:00 | Sun 29 Nov 09:00 |
| API-09 | M3 | sonnet/high | M | Sat 28 Nov 24:00 | Sun 29 Nov 11:00 |
| API-10 | M3 | sonnet/high | M | Sat 28 Nov 24:00 | Sun 29 Nov 11:00 |
| MOD-03 | M3 | sonnet/high | M | Sat 28 Nov 24:00 | Sun 29 Nov 11:00 |
| SOL-06 | M3 | opus/xhigh | M | Sun 29 Nov 09:00 | Sun 29 Nov 13:00 |
| MOD-04 | M3 | sonnet/high | M | Sun 29 Nov 11:00 | Sun 29 Nov 15:00 |
| MOD-05 | M3 | sonnet/high | M | Sun 29 Nov 11:00 | Sun 29 Nov 15:00 |
| MOD-07 | M3 | opus/high | M | Sun 29 Nov 11:00 | Sun 29 Nov 15:00 |
| JOB-03 | M3 | sonnet/high | M | Sun 29 Nov 13:00 | Sun 29 Nov 17:00 |
| MOD-08 | M3 | sonnet/high | M | Sun 29 Nov 15:00 | Sun 29 Nov 19:00 |
| MOD-09 | M3 | sonnet/high | M | Sun 29 Nov 15:00 | Sun 29 Nov 19:00 |
| QA-03 | M3 | opus/xhigh | M | Sun 29 Nov 15:00 | Sun 29 Nov 19:00 |
| XL-07 | M3 | sonnet/high | M | Sun 29 Nov 17:00 | Sun 29 Nov 21:00 |
| AI-05 | M4 | opus/high | M | Sun 29 Nov 19:00 | Sun 29 Nov 23:00 |
| OPS-04 | M3 | sonnet/medium | S | Sun 29 Nov 19:00 | Sun 29 Nov 21:30 |
| SOL-11 | M3 | sonnet/medium | S | Sun 29 Nov 19:00 | Sun 29 Nov 21:30 |
| JOB-04 | M4 | sonnet/medium | S | Sun 29 Nov 21:00 | Sun 29 Nov 23:30 |
| INT-04 | M3 | opus/high | S | Sun 29 Nov 21:30 | Sun 29 Nov 24:00 |
| OPS-07 | M4 | sonnet/medium | S | Sun 29 Nov 21:30 | Sun 29 Nov 24:00 |
| AI-06 | M4 | sonnet/high | M | Sun 29 Nov 23:00 | Mon 30 Nov 10:00 |
| QA-08 | M4 | sonnet/high | S | Sun 29 Nov 23:30 | Mon 30 Nov 09:00 |
| API-03 | M4 | opus/high | M | Sun 29 Nov 24:00 | Mon 30 Nov 11:00 |
| DATA-09 | M4 | sonnet/high | M | Sun 29 Nov 24:00 | Mon 30 Nov 11:00 |
| AI-07 | M4 | opus/high | M | Mon 30 Nov 10:00 | Mon 30 Nov 14:00 |
| API-11 | M4 | sonnet/high | M | Mon 30 Nov 10:00 | Mon 30 Nov 14:00 |
| MOD-10 | M4 | sonnet/high | M | Mon 30 Nov 14:00 | Mon 30 Nov 18:00 |
| OPS-06 | M4 | sonnet/high | M | Mon 30 Nov 14:00 | Mon 30 Nov 18:00 |
| QA-05 | M4 | sonnet/high | M | Mon 30 Nov 18:00 | Mon 30 Nov 22:00 |
| QA-06 | M4 | sonnet/high | M | Mon 30 Nov 22:00 | Tue 01 Dec 09:00 |
| QA-07 | M4 | sonnet/high | M | Tue 01 Dec 09:00 | Tue 01 Dec 13:00 |
| INT-05 | M4 | opus/high | S | Tue 01 Dec 13:00 | Tue 01 Dec 15:30 |
| INT-06 | M5 | opus/high | S | Tue 01 Dec 15:30 | Tue 01 Dec 18:00 |

A simulation, not a commitment: the orchestrator re-plans from `items.json` statuses as items merge.
