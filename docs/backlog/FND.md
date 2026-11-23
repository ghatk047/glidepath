# FND · Foundations

Monorepo with tier folders, lint and tier boundaries, tier-check, CI, ADRs, planning notes (folded prompt 00) and a Docker-free test Postgres.

7 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| FND-01 | Monorepo scaffold with tier folders, pnpm and Turborepo | M0 | sonnet/medium | M | — |
| FND-02 | ESLint, Prettier and tier boundary rules | M0 | sonnet/medium | M | FND-01 |
| FND-03 | tools/tier-check: web bundle inspector | M0 | sonnet/high | S | FND-01 |
| FND-04 | GitHub Actions CI with gate jobs | M0 | sonnet/medium | S | FND-01, FND-02 |
| FND-05 | ADRs 001–024 in docs/adr | M0 | sonnet/medium | M | — |
| FND-06 | PLANNING_NOTES.md (folded prompt 00) | M0 | opus/high | S | FND-05 |
| FND-07 | tools/pg-local: throwaway Postgres 16 for tests without Docker | M0 | sonnet/medium | S | FND-05, FND-01 |

## FND-01 · Monorepo scaffold with tier folders, pnpm and Turborepo

```yaml
id: FND-01
title: "Monorepo scaffold with tier folders, pnpm and Turborepo"
epic: FND
milestone: M0
priority: must
status: done
stream: D
model: sonnet
effort: medium
depends_on: []
tier: ops
package: "repo-root (workspace config + empty package skeletons)"
contract: "Layout of 02 §1; workspace names @glidepath/<pkg>"
inputs:
  - "docs/architecture/02_repo_and_conventions.md#1. Layout"
  - "docs/architecture/02_repo_and_conventions.md#2. Toolchain"
  - "CLAUDE.md#Commands"
  - "docs/backlog/README.md#Package scope"
acceptance:
  - "`pnpm i && pnpm turbo run typecheck lint test` succeeds on the skeleton (test: scaffold smoke in CI and in the build container)"
  - "every package in 02 §1 (tier1-presentation/{web,ui}, tier2-logic/{server,worker,spec,engine,solvers,domain,excel,ai,data-access}, contract/api-contract, tools/*, e2e) has package.json, README.md, src/index.ts and one passing Vitest (test: tools/scaffold-check reports 0 missing)"
  - "tsconfig.base.json has strict: true; a fixture with an implicit any fails `pnpm turbo run typecheck` (test: typecheck-fixture)"
  - "Node 22 and pnpm 10 pinned via engines and packageManager; .nvmrc present (test: scaffold-check)"
  - "root scripts exist for every command in CLAUDE.md#Commands, each printing 'not implemented yet' until its item lands (test: scaffold-check)"
gates: [G1, G2]
size: M
notes: "No feature code. Root scripts are placeholders owned by later items."
merged_at: "2026-11-23"
```

Creates the empty three-tier monorepo so every later item has a package to land in. Turbo pipeline: typecheck, lint, test, build, bench.

## FND-02 · ESLint, Prettier and tier boundary rules

```yaml
id: FND-02
title: "ESLint, Prettier and tier boundary rules"
epic: FND
milestone: M0
priority: must
status: done
stream: D
model: sonnet
effort: medium
depends_on: [FND-01]
tier: ops
package: "tools/eslint-config"
contract: "Dependency rules of 02 §1 as eslint-plugin-boundaries config"
inputs:
  - "docs/architecture/02_repo_and_conventions.md#Dependency rules (eslint-plugin-boundaries + `tools/tier-check`)"
  - "docs/architecture/02_repo_and_conventions.md#3. Conventions"
  - "docs/architecture/06_multitenancy_and_ai.md#1. Tenancy model (recap and build rules)"
  - "docs/architecture/08_quality_and_testing.md#1. Gates (G1, G13)"
acceptance:
  - "each arrow in the 02 §1 dependency list has one passing and one failing fixture (test: lint-fixtures.spec.ts, e.g. 'tier1 cannot import tier2-logic/engine')"
  - "only tier2-logic/data-access may import pg/drizzle; a fixture importing pg from tier2-logic/domain fails (test)"
  - "magic-number rule (configurable allow-list, default 0, 1, -1) is on for tier2-logic/{engine,solvers,domain,excel} source, off for tests (fixture)"
  - "airline-strings rule: 'AA', 'American', 'Sabre', 'DXC', 'Hyderabad' fail outside seed folders, fixtures and docs (fixture)"
  - "tier-1 rule: no hex colours or raw px literals in tier1-presentation source outside ui/src/tokens (fixture)"
gates: [G1, G13]
size: M
notes: "Rubric: lint rules are haiku/low, raised to sonnet/medium because the boundary config is load-bearing for G13."
merged_at: "2026-11-23"
```

Turns the tier rules into lint errors so reviewers do not have to catch them by eye.

## FND-03 · tools/tier-check: web bundle inspector

```yaml
id: FND-03
title: "tools/tier-check: web bundle inspector"
epic: FND
milestone: M0
priority: must
status: done
stream: D
model: sonnet
effort: high
depends_on: [FND-01]
tier: ops
package: "tools/tier-check"
contract: "`pnpm tier-check` exit code contract (0 clean, 1 leak found)"
inputs:
  - "docs/architecture/02_repo_and_conventions.md#Dependency rules (eslint-plugin-boundaries + `tools/tier-check`)"
  - "docs/architecture/01_architecture_overview.md#1. The three tiers"
  - "docs/architecture/08_quality_and_testing.md#1. Gates (G13)"
acceptance:
  - "`pnpm tier-check` exits 1 on a fixture bundle containing an exported tier-2 symbol or an SQL statement pattern (test: tier-check.spec.ts)"
  - "exits 0 on the clean production build of tier1-presentation/web (test: runs after `pnpm --filter web build`; skipped with a message until WEB-01 lands)"
  - "denylist is derived from the exported names of tier2-logic packages at run time, not hand-maintained (test: adding an export to a fixture package updates the denylist)"
gates: [G1, G2, G13]
size: S
notes: ""
merged_at: "2026-11-23"
```

The bundle-level half of G13: catches tier-2 code that slipped into the SPA through any route lint cannot see.

## FND-04 · GitHub Actions CI with gate jobs

```yaml
id: FND-04
title: "GitHub Actions CI with gate jobs"
epic: FND
milestone: M0
priority: must
status: in_progress
stream: D
model: sonnet
effort: medium
depends_on: [FND-01, FND-02]
tier: ops
package: ".github/workflows"
contract: "Gate job names G1–G14 as in 08 §1"
inputs:
  - "docs/architecture/08_quality_and_testing.md#1. Gates"
  - "docs/architecture/02_repo_and_conventions.md#2. Toolchain"
  - "docs/architecture/02_repo_and_conventions.md#4. Environments"
acceptance:
  - "ci.yml runs G1, G2 (affected packages via turbo --filter=...[origin/main]) and G13 on every PR (test: actionlint + dry run with act or a workflow-syntax test)"
  - "Postgres 16 service container exposed to tests as DATABASE_URL and DATABASE_URL_MIGRATE; no object store container (ADR-025) (test: a job step runs `SELECT 1`)"
  - "jobs parity-golden (G3), parity-fuzz (G4, nightly), solvers (G5), excel (G6), leak (G7), perf (G8), e2e (G9), compose (G14) exist and skip with a clear message while their pnpm script is a placeholder (test: script-presence step)"
  - "no secrets referenced except via ${{ secrets.* }} (test: grep step)"
gates: [G1]
size: S
notes: "Rubric: CI YAML tweaks are haiku/low; first full CI is sonnet/medium. CI runs on GitHub; builders cannot see it, so the orchestrator checks the first run."
```

Wires the gates from 08 so later items only flip their job from skipped to required.

## FND-05 · ADRs 001–024 in docs/adr

```yaml
id: FND-05
title: "ADRs 001–024 in docs/adr"
epic: FND
milestone: M0
priority: must
status: done
stream: D
model: sonnet
effort: medium
depends_on: []
tier: ops
package: "docs/adr"
contract: "ADR file format: Context, Decision, Consequences, Status"
inputs:
  - "docs/architecture/01_architecture_overview.md#4. Key decisions (ADR summary)"
  - "docs/architecture/README.md#Assumptions taken (all reversible, each becomes an ADR)"
  - "docs/architecture/11_docker_deployment.md#4. Configuration (12-factor)"
  - "docs/architecture/11_docker_deployment.md#5. Moving to a cloud server later"
  - "docs/backlog/README.md#Product-owner decisions"
acceptance:
  - "docs/adr/ADR-001 … ADR-014 exist, one per row of 01 §4, each with headings Context, Decision, Consequences, Status (test: tools/adr-check script in this folder counts files and headings)"
  - "ADR-015 database portability: single DATABASE_URL (app role) + DATABASE_URL_MIGRATE (owner role), TLS via URL (sslmode=require), no superuser at runtime, SET LOCAL only (pooler-safe), local Postgres 16 now, Neon later"
  - "ADR-016 test database strategy: TEST_DATABASE_URL, else tools/pg-local (initdb/pg_ctl), Testcontainers optional"
  - "ADR-017 package scope: `package` may be a sub-folder (web/src/modules/x, server/src/routes/x) so builders can run in parallel; prefix overlap serialises"
  - "ADR-018 tier-1 binding split: ui is presentational (props only), web owns useNode/useVariable and bound wrappers"
  - "ADR-019 domain ports: applyChangeset runs over a ChangesetStore port implemented in data-access so domain stays pure"
  - "ADR-020 engine parity gate: golden 760/760 + parity replay 245/245 must be green before numbers-dependent DOM/SOL/API work"
  - "ADR-021 tier-2 view-models for derived display series that have no formula node (bridge target outlay, baseline grouping, lever families, monthly curve, lever bar scale)"
  - "ADR-022 SESSION_IDLE_MIN and AI_MAX_TOKENS_PER_JOB are env settings (the spec has no sys.session_idle_min or ai.max_tokens_per_job input)"
  - "ADR-023 manual migrations beyond schema.json: solver_run progress/cancel columns and auth tables (auth_token, auth_session, passkey)"
  - "ADR-024 job updates relayed by polling (no LISTEN/NOTIFY dependency, pooler-safe)"
  - "file names ADR-0NN-<slug>.md; slugs for 015–024 exactly database-portability, test-database, package-scope, binding-split, domain-ports, engine-parity-gate, view-models, env-settings, manual-migrations, job-relay-polling, because other items' inputs link to them (test: adr-check)"
gates: [G1]
size: M
notes: "Docs only; can run in parallel with FND-01. ADRs 015–024 record the product-owner decisions and gaps found while writing the backlog."
merged_at: "2026-11-23"
```

Writes the ADRs that prompt 00 would have produced (prompt 00 was folded into this backlog).

## FND-06 · PLANNING_NOTES.md (folded prompt 00)

```yaml
id: FND-06
title: "PLANNING_NOTES.md (folded prompt 00)"
epic: FND
milestone: M0
priority: must
status: done
stream: D
model: opus
effort: high
depends_on: [FND-05]
tier: ops
package: "docs/architecture/PLANNING_NOTES.md"
contract: "Sections required by prompts/00 §Output"
inputs:
  - "docs/architecture/prompts/00_architecture_planning.md#Your tasks"
  - "docs/architecture/09_delivery_plan.md#4. Risks and responses"
  - "docs/backlog/plan.md#Critical path"
  - "docs/backlog/coverage.md#Gaps found while writing the backlog"
acceptance:
  - "file has sections: ADR review (confirm/change per ADR-001…014 with impact on Dec 4), scaffold command summary, engine port plan pointer (tier2-logic/engine/PORTING.md, ENG-01), risk register, gaps, epic changes vs 10 §3 (test: tools/adr-check --planning verifies headings)"
  - "risk register covers every 09 §4 risk plus Thanksgiving (Thu 26 Nov) owner availability, Docker daemon absent in builder container, Neon move; each row has owner stream A–D and earliest retire date between 2026-11-24 and 2026-12-03 (test: heading + table column check)"
  - "gaps table lists each gap in coverage.md with the item that fixes it (test: every gap id appears)"
gates: [G1]
size: S
notes: "Deviation: rubric puts docs at sonnet/medium; opus/high because the ADR challenge and risk register are architecture judgement (prompt 00 ran at opus/high)."
merged_at: "2026-11-23"
```

Short, table-first planning notes so the orchestrator has one page of risks and decisions.

## FND-07 · tools/pg-local: throwaway Postgres 16 for tests without Docker

```yaml
id: FND-07
title: "tools/pg-local: throwaway Postgres 16 for tests without Docker"
epic: FND
milestone: M0
priority: must
status: done
stream: D
model: sonnet
effort: medium
depends_on: [FND-05, FND-01]
tier: ops
package: "tools/pg-local"
contract: "`pnpm pg:local start|stop` and `getTestDatabaseUrl()`"
inputs:
  - "docs/architecture/02_repo_and_conventions.md#2. Toolchain"
  - "docs/adr/ADR-016-test-database.md (or FND-05 acceptance text)"
  - "docs/backlog/README.md#Build environment"
acceptance:
  - "`pnpm pg:local start` runs initdb + pg_ctl from PG_BIN (default /usr/lib/postgresql/16/bin) on a free port in a temp dir and prints DATABASE_URL; `stop` removes it (test: pg-local.spec.ts connects and runs SELECT 1)"
  - "`getTestDatabaseUrl()` returns TEST_DATABASE_URL when set, else starts pg-local; Testcontainers only when TESTCONTAINERS=1 and a Docker daemon answers (test: env matrix)"
  - "`--init <dir>` runs the SQL files in a folder as the bootstrap superuser (used for tier3-data/postgres/init role creation) (test)"
  - "`--ssl` starts the cluster with a generated self-signed certificate so `sslmode=require` URLs work (test: connects with sslmode=require)"
  - "works as a non-root user and when run as root drops to a postgres-owned data dir (test: runs in the build container)"
gates: [G1, G2]
size: S
notes: "Builders cannot reach the owner's Mac and may have no Docker daemon; every DB test must run on this."
merged_at: "2026-11-23"
```

Lets every DB-touching item run its tests in the build container.
