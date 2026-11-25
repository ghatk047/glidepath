# Glidepath — repo guide for Claude

Multi-tenant what-if app for airline IT cost reduction. AA is the first tenant. Demo: Fri 4 Dec 2026. **Strict three-tier architecture**, running in Docker Compose on the product owner's Mac, portable to any cloud later.

## Tiers
- **Tier 1 · Presentation** `tier1-presentation/` (`web`, `ui`): the React SPA. Renders values from tier 2, sends intent. No business logic.
- **Tier 2 · Business logic** `tier2-logic/` (`server`, `worker`, `spec`, `engine`, `solvers`, `domain`, `excel`, `ai`, `data-access`): every formula, rule, solver, Excel and AI step.
- **Tier 3 · Data** `tier3-data/` (migrations, seed, Postgres config, backup): Postgres 16 + RLS (workbooks and audit files too, ADR-025).
- **Contract** `contract/api-contract`: the only code shared by tiers 1 and 2.

## Where things are
- Architecture: `docs/architecture/` (README first). ADRs: `docs/adr/`.
- Model spec (read-only): `docs/spec/`. UX pack (read-only): `docs/ux/`.
- Backlog: `docs/backlog/`. Status notes: `docs/status/`.

## Rules
1. Business logic only in tier 2. Tier 1 imports only `contract` and `ui`. Only `data-access` touches tier 3.
2. No business numbers in code. Numbers live in the registry (`variables.json`) and the database.
3. Spec ids (`g.target_net`, `res.net`, `'pilots,fy27'`) are used verbatim everywhere.
4. Every write goes through `applyChangeset()` in `tier2-logic/domain`.
5. `engine`, `solvers`, `domain`, `excel` are pure: no IO.
6. Engine output must match `docs/spec/reference/golden_results.json` (1e-6 relative).
7. Every tenant table has RLS; the app role never bypasses it.
8. UI uses tokens only and binds to ids with `useNode` / `useVariable`.
9. No airline logos, livery colours or typefaces. Tenants are IATA-code monograms.
10. Config only via environment variables (`.env`, never committed). No secrets in images or git.
11. One backlog item per branch `bl/<id>-<slug>`; conventional commits ending with the item id.

## Commands
- `cp .env.example .env` · `docker compose up -d` (all tiers, seeded) · `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` (hot reload)
- `pnpm i` · `pnpm turbo run typecheck lint test --filter=<pkg>...`
- `pnpm parity:golden` · `pnpm parity:fuzz` · `pnpm test:excel` · `pnpm test:leak` · `pnpm tier-check`
- `pnpm e2e -- --trace off` (smoke, against the compose stack) · `pnpm e2e:storyline -- --trace off`
- `pnpm bench --filter=./tier2-logic/engine` · `ops/backup.sh` · `ops/demo-check.sh`

## Testing etiquette
Run affected packages only; re-run only failing tests while fixing; never skip or weaken a test to get green.
