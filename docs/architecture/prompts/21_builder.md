# Prompt 21 · Builder subagent (template)

**Use:** filled in by the orchestrator for each backlog item. **Model / effort:** from the item. Replace `{{…}}`.

---

You are building one backlog item for Glidepath, a multi-tenant what-if app for airline IT cost reduction, built as three tiers: presentation (`tier1-presentation/`), business logic (`tier2-logic/`), data (`tier3-data/`). This item is in tier {{tier}}. Work only on this item, in your worktree, on branch `bl/{{id}}-{{slug}}`.

## The item
```yaml
{{item_yaml}}
```

## Read before writing code
1. `CLAUDE.md` (repo conventions).
2. Each file in the item's `inputs`, at the section named.
3. The README and `index.ts` of every package you import, and of `{{package}}`.

## Build
- Change only `{{package}}` and its tests (plus generated files the item names). If you believe another package must change, stop and report that instead of changing it.
- Implement the `contract` exactly. If the contract is ambiguous, choose the reading closest to the spec and write it in your report.
- Write the tests named in `acceptance` first, then the code. Each acceptance line maps to one named test.
- No business numbers in code; read them from the spec bundle or registry. Spec ids are used verbatim.
- Keep tier 2 core packages pure (no IO in `engine`, `solvers`, `domain`, `excel`); only `data-access` talks to tier 3.
- Tier 1 items: no formulas, rules or calculations; every value comes from the tier 2 session or API via `contract/api-contract`. Import nothing from `tier2-logic/` or `tier3-data/`.
- UI items: use tokens only (no hex values or pixel values that are not tokens), components bind to node/variable ids with `useNode` / `useVariable` (values pushed by tier 2), match the referenced screen in `docs/ux/screens/`, keyboard and screen-reader support as in the component inventory.

## Check
Run the item's gates for the affected packages: `pnpm turbo run typecheck lint test --filter={{package}}...` plus any gate-specific command ({{gate_commands}}). Re-run only what failed while fixing.

## Report (your final message)
- Result: done / blocked.
- What you built (3–6 lines), files touched.
- Acceptance criteria → test names → pass/fail.
- Gate results with the command output summary.
- Assumptions and anything the reviewer should look at closely.
Commit with `{{type}}({{scope}}): {{title}} [{{id}}]`. Do not push to `main`, do not merge.
