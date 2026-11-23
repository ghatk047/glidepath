# Glidepath architecture pack v1.1 (step 3: architecture md + prompts)

This pack tells Claude how to build Glidepath: the system shape, the stack, the boundaries that let subagents build in parallel, the gates that keep numbers right, the plan to the Fri 4 Dec 2026 demo, and the prompts for planning (step 3), backlog writing (step 4) and the build. It builds on `/mnt/project-files/model-spec/` (step 1) and `/mnt/project-files/ux/` (step 2, unchanged).

**v1.1 (22 Nov 2026):** redesigned as a strict three-tier architecture with business logic in its own tier, and Docker Compose on the Mac instead of Fly.io/Neon. The browser no longer runs the engine.

## The architecture in one paragraph

Three tiers in separate containers and networks. **Tier 1, presentation:** a React + Vite SPA served by Caddy that implements the approved glass UX and holds no business logic; it renders values that tier 2 pushes and sends user intent back. **Tier 2, business logic:** a TypeScript service (`logic` for REST + WebSocket, `worker` for jobs) holding the engine (a compiled TS port of the proven Python reference, checked against `golden_results.json`), the solvers, the changeset and validation rules, the Excel three-way diff and the AI reconfiguration pipeline (`claude-opus-5-5`, ending in a reviewable changeset). Per-user what-if sessions keep the engine warm in memory, so slider previews come back over WebSocket in milliseconds without putting math in the browser. **Tier 3, data:** Postgres 16 with row-level security per airline (schema generated from the spec) and MinIO for workbooks. Docker networks make the separation physical: the web container cannot reach the database. Everything starts with `docker compose up` on the Mac, needs no internet for the demo, and moves to any cloud server later by changing environment variables.

## Files

| File | What it decides | Read it when |
|---|---|---|
| `01_architecture_overview.md` | The three tiers and their rules, requirements map, diagram, ADR-001…014, flows, targets | Always first |
| `02_repo_and_conventions.md` | Monorepo by tier, dependency rules, toolchain, conventions, environments | Scaffolding, any PR |
| `03_engine_and_solvers.md` | Tier 2 engine, what-if sessions, solvers, jobs, perf budget | Engine and solver work |
| `04_data_and_api.md` | Tier 3 schema and RLS, the single write path, tier 2 REST + WS contract, storage | Backend work |
| `05_excel_roundtrip.md` | Excel package (tier 2), export/import flow, the 8 tests | Excel work |
| `06_multitenancy_and_ai.md` | Tenancy rules, AI reconfiguration pipeline, Claude API usage, demo scope | Tenancy and AI work |
| `07_frontend.md` | Tier 1: structure, id binding, editing feel without local math, charts, a11y, demo resilience | UI work |
| `08_quality_and_testing.md` | Gates G1–G14 incl. tier separation and container gates | Every merge |
| `09_delivery_plan.md` | Milestones M0–M5 to Dec 4, workstreams, demo cut, risks, what the person provides | Planning and status |
| `10_backlog_conventions.md` | Item YAML (with tier), model/effort rubric, epic skeleton (~113 items) | Step 4 |
| `11_docker_deployment.md` | Containers, networks, compose sketch, Mac setup, config, backup, moving to cloud | Ops and scaffolding |
| `prompts/00_architecture_planning.md` | First session in the repo: challenge ADRs, scaffold plan, engine port plan | Start of build |
| `prompts/10_backlog_writer.md` | Step 4: detailed backlog with model and effort per item | After 00 |
| `prompts/20_orchestrator.md` | Opus master orchestrator: dispatch, gate, review, merge, status | Build |
| `prompts/21_builder.md` | Builder subagent template | Build |
| `prompts/30_reviewer.md` | Reviewer subagent | Build |
| `prompts/CLAUDE.md.template` | Repo guide to copy to `CLAUDE.md` | Scaffolding |

## How to run steps 3 → 4 → build

1. Create the GitHub repo (`glidepath`); copy `model-spec/` → `docs/spec/`, `ux/` → `docs/ux/`, this folder → `docs/architecture/`, `prompts/CLAUDE.md.template` → `CLAUDE.md`.
2. Run **prompt 00** (Opus, high): ADRs, scaffold PR with the compose stack, planning notes.
3. Run **prompt 10** (Opus, high): the backlog with model and effort per item (step 4).
4. Start the **orchestrator** (prompt 20, Opus): builders (21) and reviewers (30) as subagents until the Dec 3 freeze.

## Assumptions taken (all reversible, each becomes an ADR)

1. TypeScript in all tiers; React 19 + Vite SPA; Hono REST + WebSocket on Node 22; Drizzle; pg-boss jobs.
2. Docker Compose on the user's Mac (4 CPU / 8 GB for Docker); multi-arch images so an x86 cloud host runs the same tags later.
3. Short solvers run in the tier 2 session, long ones as worker jobs; every result is saved as a scenario.
4. Auth by email magic link (local mail catcher) + passkey for the demo; SSO later.
5. The AI reconfiguration for UA is shown as a reviewed draft at the demo, not applied live.
6. No airline marks anywhere, as in the UX pack.

## What the person needs to provide before the build starts

A GitHub repository attached to the build session, Docker Desktop on the Mac, and an Anthropic API key for the AI job kept in the local `.env` (09 §5).
