# Prompt 00 · Architecture planning session

**Use:** first session in the new `glidepath` repository. **Model:** Claude Opus 5.5, effort `high`. **Output:** repo scaffold plan, ADRs, risk list, confirmed or challenged decisions. Paste everything below the line.

---

You are the lead architect for **Glidepath**, a multi-tenant what-if app for airline IT cost reduction. American Airlines (AA) is the first tenant; United (UA) and Alaska (AS) follow. A live demo to AA's MD of Procurement is on **Friday 4 December 2026**.

## Read first, in this order
1. `docs/architecture/README.md`, then `01_architecture_overview.md` (decisions ADR-001…014).
2. `docs/spec/README.md` (model spec v1.0: 194 inputs, 307-node formula graph, schema, solvers, Excel template, AA seed, Python reference engine with 245/245 parity).
3. `docs/ux/README.md`, `02_information_architecture.md` §5, `03_screens.md`, `04_component_inventory.md`, `tokens.json`.
4. `docs/architecture/02`–`11` (11 = Docker deployment).

## Non-negotiable requirements (from the product owner)
- **Strict three-tier architecture:** presentation (tier 1), business logic (tier 2), data (tier 3) in separate containers and networks. No business logic in the UI. Keep the UX exactly as designed.
- **Runs in Docker Compose on the product owner's Mac** for now, portable to any cloud server later. No Fly.io or other cloud accounts yet.
- Every number is an input editable in the UI; no business numbers in code.
- Database-backed (Postgres); every write is a changeset (audit, diff, undo).
- Excel export/import with an app-defined template; re-import detects deltas with a three-way diff.
- Multi-tenant from day one; AI can reconfigure the app for another airline by producing a reviewable changeset.
- Solvers, optimizers and simulators on top of one engine; engine output must match `golden_results.json`.
- Super polished, minimalist glass UX (Cruise and Daylight themes), little text.
- Make reasonable assumptions instead of asking; record each as an ADR.

## Your tasks
1. **Challenge the architecture.** For each ADR in 01 §4, confirm it or propose a change with the reason and the impact on the Dec 4 date. Only change a decision if it lowers risk to the demo or to multi-tenancy, and never weaken the tier separation.
2. **Write the ADRs** to `docs/adr/ADR-0NN-*.md` (context, decision, consequences, status).
3. **Scaffold plan:** exact commands and files for the monorepo in `02_repo_and_conventions.md` §1 (tier folders, pnpm, Turborepo, TS config, ESLint boundaries + `tools/tier-check`, Vitest, Playwright), the compose stack in `11_docker_deployment.md` (networks `edge` / `data` / `egress`, Dockerfiles multi-arch, Caddy, migrate container, dev override), and GitHub Actions with gates G1–G3, G13, G14. Do not build features.
4. **Engine port plan (tier 2):** map each function/class in `docs/spec/reference/engine.py` to a TS module in `tier2-logic/engine`, list the semantics that are easy to get wrong (implicit indexing, lazy IF, aggregate where-filters, member order of sums, cases, member subsets), and define the parity harness.
5. **Risk register update** for 09 §4, with owners (streams A–D) and the earliest date each risk can be retired.
6. **Gaps:** list anything in spec or UX that the architecture does not cover yet, and the smallest fix.

## Output
A single `docs/architecture/PLANNING_NOTES.md` plus the ADR files and the scaffold PR. Keep prose short: tables over paragraphs. End with the list of backlog epics you would change versus `10_backlog_conventions.md` §3, if any.

## Rules
- Do not invent numbers; every number comes from the spec or is a registry input.
- No airline logos, livery colours or typefaces anywhere.
- Do not commit secrets. Ask for credentials only through the environment's secret store.
