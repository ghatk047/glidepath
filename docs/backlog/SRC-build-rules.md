# SRC build rules (for every builder on this epic)

Read `CLAUDE.md`, `docs/backlog/SRC.md` (your items' yaml blocks and the "Data decisions" section) and `docs/architecture/10_backlog_conventions.md` first.

- **Shared checkout.** Several builders work in `~/Projects/glidepath` at the same time on branch `bl/SRC-00-procurement-features`. Do **not** commit, stash, reset, checkout, switch branches or create worktrees. Edit only the files your brief lists (plus new files inside the folders it names and their tests). If you must touch a file outside that list, stop and say so in your report instead.
- **Never change** `docs/spec/**`, the existing files in `tier3-data/seed/aa/`, golden results, or any existing test expectation to make something pass. Add data, don't change it. Never skip or weaken a test.
- **Tiers.** Business logic only in tier 2. Tier 1 imports only `@glidepath/api-contract` and `@glidepath/ui`, renders tier-2 values, does no arithmetic on business numbers. Only `data-access` touches the database. `engine`, `solvers`, `domain`, `excel` stay pure (no IO).
- **No business numbers in code.** Defaults live in seed data (`tier3-data/seed/aa/sourcing.json`, `sourcing_param` members) or the registry.
- **Every write** goes through `applyChangeset()`.
- **Tests.** Run only your affected packages: `pnpm turbo run typecheck lint test --filter=<pkg>` (use `--concurrency=1`). Other builders share the CPU, so don't run the whole repo suite. If you change anything the engine or seed reads, also run `pnpm parity:golden` (must stay golden 760/760, replay 245/245).
- **Never** run e2e, `docker compose down/up`, `ops/compose-check.sh` or migrations against the running `glidepath` compose project (the demo stack). If you need a database, use the pg test helpers the package already uses, or a separate compose project name.
- **No LLM / API keys.** Nothing may need an Anthropic or other key to build or test.
- **UI.** Tokens only (no raw colours/px), glass panels from `@glidepath/ui`, dense desktop layout with little text, must fit 1280×720 and 1920×1080 without page scroll. Bind numbers with the existing hooks.
- **Report** at the end: files changed, tests run with pass counts, anything left undone or any file outside your list you needed. Keep it short.
