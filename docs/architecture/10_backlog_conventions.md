# 10 · Backlog conventions (input to step 4)

Step 4 turns this architecture into detailed specs as a backlog, each item with a model name and effort, built by subagents with Claude Opus as master orchestrator. This page fixes the item format, the model/effort rubric and the epic skeleton, so step 4 is filling in rather than designing.

## 1. Item format

One Markdown file per epic in `docs/backlog/`, items as fenced YAML blocks (machine-readable for the orchestrator) followed by prose detail.

```yaml
id: ENG-03                       # EPIC-NN
title: Incremental rerun with dirty propagation
epic: ENG
milestone: M1                    # M0..M5 or POST
priority: must                   # must | should | could
model: opus                      # opus | sonnet | haiku  (Claude Code subagent model)
effort: xhigh                    # low | medium | high | xhigh | max
depends_on: [ENG-02]
tier: 2                          # 1 presentation | 2 logic | 3 data | contract | ops
package: tier2-logic/engine      # the one package it changes (plus tests)
contract: CompiledModel.rerun     # interface it implements or consumes
inputs:                          # files the builder must read first
  - docs/spec/03_formula_graph.md#2
  - docs/spec/reference/engine.py (Model.rerun)
acceptance:                      # each maps to a named test
  - "rerun matches evaluate on 500 random single-input changes (bitwise)"
  - "one lever slider rerun < 10 ms on AA (bench engine.rerun.lever)"
gates: [G1, G2, G3, G8]
size: M                          # S (<2h agent time) | M (2–5h) | L (split it)
notes: "Early stop when value unchanged."
```

Rules: every item names its tier and never mixes tiers (contract changes are their own items); no `L` items (split them); every acceptance line is testable; `inputs` lists the exact spec/UX sections, so the builder does not need the whole folder; one package per item except integration items in `INT`.

## 2. Model and effort rubric

Models are Claude Code subagent aliases (Opus 5.5, Sonnet 5.5, Haiku 5.5 as of Nov 2026). Choose by the cost of a subtle mistake, not by size.

| Work type | Model | Effort | Examples |
|---|---|---|---|
| Correctness-critical math, concurrency, security | opus | xhigh | Engine compiler and incremental path, batch mode, min-risk solver, Monte Carlo, `applyChangeset`, what-if session manager, RLS + leak test, 3-way diff |
| Architecture-shaping or high-polish UI | opus | high | API contract, compose stack and networks, global layer, Gauge/Bridge/Treemap, Cockpit and Path modules, WS session client, AI pipeline |
| Standard feature work against a clear contract | sonnet | high | Module screens other than Cockpit/Path, API routes, Excel build/parse, WS plumbing, jobs plumbing |
| Routine, well-specified, low risk | sonnet | medium | Simple components (chip, toggle, stepper), formatters, seed loader, CRUD, README/ADR writing |
| Mechanical generation and fixtures | haiku | low | Type generation from spec JSON, test fixtures, lint rules, CI YAML tweaks |
| Review | opus (reviewer) | high | Every merge; xhigh for engine, solver, tenancy, diff |

The orchestrator is always Opus 5.5 (high effort for routing, xhigh when resolving a failed gate on a critical item). An item that fails review twice is escalated one step (model or effort) before a third attempt.

## 3. Epic skeleton (approximate item counts; step 4 details each)

| Epic | Scope | Items | Milestones | Typical model/effort |
|---|---|---|---|---|
| FND Foundations | Monorepo with tier folders, CI, Turborepo, boundary lint + tier-check, CLAUDE.md, ADRs | 6 | M0 | sonnet/medium, haiku/low |
| OPS Docker | Compose stack (edge/data/egress networks), Dockerfiles multi-arch, Caddy, migrate container, dev override, demo profile, backup/restore, demo-check | 6 | M0, M4 | opus/high, sonnet/medium |
| CON Contract | REST schemas, WS message protocol, typed client, contract tests | 3 | M0–M1 | opus/high |
| SPEC Spec package | Load + validate spec JSON, zod types, generators | 3 | M0 | haiku/low, sonnet/high |
| ENG Engine | Parser, expander, toposort, lowering, full eval, incremental, batch, explain/deps, hashing, benches, golden + fuzz parity | 10 | M0–M1 | opus/xhigh |
| SOL Solvers | Goal seek, breakeven, blend, min-risk, Monte Carlo, tornado, VP-feasible, Pareto, Sobol, stress, job adapters, caching | 10 | M3 (Pareto/Sobol POST) | opus/xhigh, sonnet/high |
| DATA Tier 3 + data-access | Schema generator, RLS, views, roles, seed loader, repositories, MinIO buckets, leak test | 6 | M0–M1 | opus/xhigh (RLS), sonnet/high |
| DOM Domain | Changeset model, VR01–VR10, scenario resolution/fork, undo, rebase | 5 | M1 | opus/xhigh |
| API Tier 2 server | Auth, tenant middleware, routes (04 §3), what-if session manager over WS, explain/search, problem JSON | 8 | M1–M3 | sonnet/high, opus/xhigh (sessions) |
| JOB Jobs | pg-boss worker, progress, cancel, result caching | 3 | M3 | sonnet/high |
| XL Excel | Template, build, parse, validate, diff, report, toChangeset, routes, 8 tests | 7 | M3 | opus/xhigh (diff), sonnet/high |
| AI Reconfig | Pipeline steps 1–8, prompts, schemas, calibration, review API, cost guard, cached UA run | 7 | M4 | opus/high |
| UI Library | Tokens, glass primitives, 27 components, charts, motion, format | 14 | M0–M2 | opus/high (charts, hero), sonnet/medium |
| WEB Tier 1 shell | Router, view store, WS session client, subscriptions, global layer | 7 | M1–M2 | opus/high |
| MOD Modules | Cockpit, Baseline, Levers, VPs, Path, Market, Excel, Airlines (one item per module, two for Path) | 9 | M2–M4 | opus/high (Cockpit, Path), sonnet/high |
| QA Quality | Testkit, storyline e2e, visual baselines, a11y, perf monitors | 5 | M1–M4 | sonnet/high |
| INT Integration | Cross-package wiring checks at each milestone, release, demo freeze | 4 | M1–M5 | opus/high |

Roughly 113 items. At ~4 parallel builders that fits M0–M5 if items stay S/M.

## 4. Traceability

- Each UX module's panel table (`ux/03_screens.md`) is copied into its MOD item's acceptance criteria: every listed node/input id must be bound and visible.
- Each component in `ux/04_component_inventory.md` is one UI item or part of one.
- Each table in `schema.json` belongs to exactly one DB item; each solver in `solvers.json` to one SOL item; each Excel test to the XL test item.
- A generated `docs/backlog/coverage.md` lists spec ids not covered by any item; it must be empty before M3.
