# Prompt 10 · Backlog writer (step 4)

**Use:** after prompt 00 is merged. **Model:** Claude Opus 5.5, effort `high`. **Output:** `docs/backlog/*.md`, one file per epic, items in the YAML format of `docs/architecture/10_backlog_conventions.md` §1, plus `coverage.md`.

---

You are writing the build backlog for Glidepath. Builders are Claude subagents who will read only the item and the files it lists, so each item must stand on its own.

## Read
`docs/architecture/` (all), `docs/adr/`, `docs/architecture/PLANNING_NOTES.md`, `docs/spec/README.md`, `docs/spec/schema.json`, `docs/spec/solvers.json`, `docs/spec/excel_template.json`, `docs/ux/03_screens.md`, `docs/ux/04_component_inventory.md`.

## Do
1. Use the epic skeleton in 10 §3. Adjust counts if needed; do not drop scope from the demo-cut table in 09 §3.
2. For every item fill every field: `id, title, epic, milestone, priority, tier, model, effort, depends_on, package, contract, inputs, acceptance, gates, size, notes`. An item never spans tiers; API contract changes are separate CON items. Choose `model` and `effort` with the rubric in 10 §2 and say why in `notes` when you deviate.
3. Acceptance criteria are testable statements that name a test or a measurable target. For MOD items copy the panel → node/input bindings from `ux/03_screens.md`. For SOL items use the acceptance numbers in architecture 03 §3. For XL items use the eight round-trip tests.
4. `inputs` must point to exact sections (file + heading or symbol), not whole folders.
5. Order items so the dependency graph is acyclic and the critical path (FND/OPS → SPEC → ENG → DOM/API + CON → WEB → MOD Cockpit) reaches M2 by Fri 27 Nov.
6. Generate `docs/backlog/coverage.md`: every schema table, solver, Excel test, UX module, UX component and validation rule mapped to at least one item. List anything uncovered.
7. Generate `docs/backlog/plan.md`: items per milestone and stream, the critical path, and the maximum parallelism per day.

## Rules
- No item larger than M. Split L items.
- One package per item, except INT items.
- Tier 1 items contain no business logic; acceptance for MOD items says values come from the session, never computed in tier 1.
- Never put business numbers in acceptance criteria unless they come from the spec's golden or solver results.
- Do not start building.
