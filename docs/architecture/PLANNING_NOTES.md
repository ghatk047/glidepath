# Planning notes (folded prompt 00)

Output of `prompts/00_architecture_planning.md`, folded into backlog item FND-06. Written Mon 23 Nov 2026; demo Fri 4 Dec 2026; freeze Thu 3 Dec 18:00 CT.
Sources: `01` §4, `09` §4, `backlog/plan.md` (critical path), `backlog/coverage.md` (gaps), ADR-001…024. Checked by `python3 docs/adr/adr-check.py --planning`.

| Prompt 00 task | Where |
|---|---|
| 1 Challenge the architecture | [ADR review](#adr-review) |
| 2 Write the ADRs | `docs/adr/ADR-001…024` (FND-05, merged) |
| 3 Scaffold plan | [Scaffold command summary](#scaffold-command-summary) |
| 4 Engine port plan | [Engine port plan](#engine-port-plan-pointer) → `tier2-logic/engine/PORTING.md` (ENG-01) |
| 5 Risk register | [Risk register](#risk-register) |
| 6 Gaps | [Gaps](#gaps) |
| Epic changes vs 10 §3 | [Epic changes](#epic-changes-vs-10-3) |

## ADR review

Rule applied: change only if it lowers risk to the demo or to multi-tenancy; never weaken tier separation. Result: 12 confirmed, 2 changed (text only, no new items). Net impact on Dec 4: none.

| ADR | decision | verdict | reason | impact on Dec 4 |
|---|---|---|---|---|
| ADR-001 | Strict three tiers | Confirm | Product-owner requirement; enforced by G13 (FND-02 lint, FND-03 bundle, OPS-05 network test) | None; contract package (CON) is on the M0/M1 path |
| ADR-002 | TypeScript monorepo (pnpm + Turborepo) | Confirm | One toolchain for 4 parallel builders; Python stays as parity oracle and for docs/backlog tools | None |
| ADR-003 | Engine only in tier 2, warm per-user sessions | Confirm (idle limit: ADR-022) | Live slider without UI math; local round trip is small | None; memory per session bounded by `SESSION_IDLE_MIN` |
| ADR-004 | WS previews, REST commits | Confirm | Coalesced previews never touch the DB; one audited commit path | None; WS protocol (CON-02) lands in M0 |
| ADR-005 | Port `engine.py` to compiled TS | Confirm (gate: ADR-020) | Proven math; re-deriving would drift | Puts ENG-01…07 on the critical path (50 h to M1); accepted |
| ADR-006 | Postgres 16 + RLS, Drizzle, generated migrations | Confirm (amended by ADR-015, ADR-023) | `schema.json` lacks auth tables and `solver_run` progress/cancel; Neon has no superuser | +1 S item (DATA-11) in M0; lowers risk |
| ADR-007 | Every write via `applyChangeset()` | Confirm (port: ADR-019) | One validation path for UI, Excel, solver, AI, seed | M0 exit "seed loaded" moves to early M1 (DATA-08); no demo impact |
| ADR-008 | Jobs on pg-boss in `worker` | Confirm (relay: ADR-024) | No extra infrastructure; polling relay is pooler-safe | None |
| ADR-009 | React 19 + Vite SPA, TanStack, Zustand | Confirm | No SSR keeps tiers 1 and 2 apart | None |
| ADR-010 | Own glass library on Radix, Motion, D3 + SVG | Confirm (split: ADR-018) | UX is bespoke; `ui` props-only lets stream C run ahead of tier 2 | None; one bound wrapper per component in `web` |
| ADR-011 | ExcelJS in tier 2, pure `excel` | Confirm | Round trip testable in Node | Excel-for-Mac fixture needs the owner (GAP-08) |
| ADR-012 | AI = fixed pipeline on Claude API, draft changeset | Confirm | Engine calibrates; model never writes data | None; UA run cached (AI-07, JOB-04) |
| ADR-013 | Compose on the Mac, multi-arch, 12-factor | Change: drop "Neon rejected"; Neon is the next DB host via URL-only config (ADR-015) | Matches product-owner decision; lowers portability risk | None; DATA-09 (should) proves it, not on the demo path |
| ADR-014 | Magic link + passkey, roles from `tenant_membership` | Change: demo sign-in is magic link to a local mail sink; passkey (API-03) is should | WebAuthn ceremony on the demo stack is avoidable risk; mail sink is only in the dev profile today (GAP-09) | None if OPS-06 adds the mail sink to the demo profile; passkey may slip post-demo |

ADR text edits for 013/014 belong to `docs/adr` (FND-05 package); not applied here.

## Scaffold command summary

No features. Toolchain pinned by spec: Node 22, pnpm 10, Postgres 16. Other versions are chosen by the item.

| # | step | command(s) | files | item |
|---|---|---|---|---|
| 1 | Workspace | `corepack enable && corepack use pnpm@10` · `pnpm add -Dw turbo typescript vitest` | `package.json` (engines, packageManager), `pnpm-workspace.yaml`, `turbo.json` (typecheck, lint, test, build, bench), `tsconfig.base.json` (`strict: true`), `.nvmrc` | FND-01 |
| 2 | Package skeletons | one `@glidepath/<pkg>` per folder in 02 §1; `pnpm i && pnpm turbo run typecheck lint test` | per package: `package.json`, `README.md`, `src/index.ts`, one Vitest; `tools/scaffold-check` | FND-01 |
| 3 | Lint + boundaries | `pnpm add -Dw eslint typescript-eslint eslint-plugin-boundaries prettier` | `tools/eslint-config` (02 §1 arrows, magic-number, airline-string, tokens-only rules) | FND-02 |
| 4 | Bundle tier check | `pnpm tier-check` | `tools/tier-check` (denylist from tier-2 exports) | FND-03 |
| 5 | Unit tests | `pnpm turbo run test --filter=<pkg>...` | `vitest.config.ts` per package | FND-01 |
| 6 | E2E | `pnpm --filter e2e add -D @playwright/test` · `pnpm e2e -- --trace off` | `e2e/playwright.config.ts` | FND-01 (skeleton), QA-04 |
| 7 | Test database | `pnpm pg:local start [--ssl]` · `pnpm pg:local stop` | `tools/pg-local` (ADR-016) | FND-07 |
| 8 | Compose stack | `cp .env.example .env && docker compose up -d` · `docker compose config` | `docker-compose.yml` (networks `edge`, `data` internal, `egress`), `.env.example` | OPS-01 |
| 9 | Images (multi-arch) | `docker buildx bake` (`linux/arm64`, `linux/amd64`) | `tier2-logic/Dockerfile` (logic, worker, migrate), web image + `Caddyfile` | OPS-02, OPS-03 |
| 10 | Migrate container | `node dist/migrate.js --seed aa` (one-shot before logic/worker) | `tier3-data/migrations`, `tier3-data/postgres` (roles outside migrations) | DATA-01, DATA-04, DATA-08 |
| 11 | Dev override | `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` | `docker-compose.dev.yml`, mailpit | OPS-04 |
| 12 | CI gates | GitHub Actions on PR: G1, G2, G13; G3 on spec/engine/seed; G14 on infra + nightly | `.github/workflows/ci.yml` | FND-04 (jobs), OPS-05 (G13 network, G14) |
| 13 | M0 check | stack up, gates green, seed path ready | — | INT-01 |

## Engine port plan pointer

The full plan lives in `tier2-logic/engine/PORTING.md`, written by **ENG-01** (opus/xhigh). This section only points to it.

| part | content | where | item |
|---|---|---|---|
| Port map | every def/class in `docs/spec/reference/engine.py` → TS module + function | `tier2-logic/engine/PORTING.md` | ENG-01 |
| Easy-to-get-wrong semantics | implicit indexing, lazy IF, aggregate where-filters, member order of sums, cases, member subsets (+ the rest listed in ENG-01) | `PORTING.md`, one named test each | ENG-01 → ENG-03, ENG-05 |
| Parity harness | golden 760/760, parity replay 245/245, 200-vector fuzz, 1e-6 rel / 1e-9 abs | `tools/parity`, `pnpm parity:golden`, `pnpm parity:fuzz` | ENG-06 (gate, ADR-020), ENG-10 |

## Risk register

Every 09 §4 risk (R-01…R-08) plus new ones (R-09…R-13). Owner = stream A–D (09 §2). Dates from `plan.md` simulation; earliest retire = first day the named evidence can be green.

| id | risk | source | likelihood | owner | response | retired by | earliest retire |
|---|---|---|---|---|---|---|---|
| R-01 | Engine port subtle mismatches | 09 §4 | Medium | A | Port line by line; ENG at opus/xhigh; parity gate blocks numeric work (ADR-020) | ENG-06 G3 green, ENG-10 G4 green | 2026-11-26 |
| R-02 | Glass performance on the demo laptop/projector | 09 §4 | Medium | C | Blur budget, low-blur fallback (UI-02); measure on the demo Mac | QA-08 on the demo Mac (owner) | 2026-11-30 |
| R-03 | Slider feel with logic in tier 2 | 09 §4 | Low | A | Coalesced WS previews; engine bench budget | ENG-11 bench, API-06 round trip, INT-03 drag on Cockpit | 2026-11-27 |
| R-04 | Docker resources on the Mac | 09 §4 | Low | B | 4 CPU / 8 GB to Docker; clean start < 3 min | OPS-05 G14 on the Mac at INT-01; re-checked at INT-06 | 2026-11-24 |
| R-05 | Min-risk solver quality or speed | 09 §4 | Medium | A | Seeded runs; cache per input hash; reference result as fallback | SOL-04 + SOL-11 G5, JOB-04 cache warmed | 2026-11-29 |
| R-06 | Venue network | 09 §4 | Low | B | Whole stack local; UA AI result cached | OPS-06 offline demo-check, INT-06 Wi-Fi-off rehearsal | 2026-12-03 |
| R-07 | AI research gives wrong UA facts | 09 §4 | Medium | B | Draft only, sources shown, calibration; cached rehearsed run | AI-04 calibration, AI-07 cached run | 2026-11-30 |
| R-08 | Scope creep before freeze | 09 §4 | High | D | Demo-cut table; orchestrator rejects non-must after M3 | INT-06 freeze tag | 2026-12-03 |
| R-09 | Thanksgiving (Thu 26 Nov) owner availability for Mac-only steps | plan.md, coverage.md | Medium | D | Builders keep running; no owner step scheduled on 26 Nov; batch owner asks (G14 on Mac, XL-07 fixture, AI-07 key, QA-08) into one message by Wed 25 Nov | Fri 27 Nov passes with no owner step blocked | 2026-11-27 |
| R-10 | Docker daemon absent in builder container (or Docker Hub 429 on pulls) | backlog README, ADR-016 | Medium | D | DB tests on `tools/pg-local`; compose YAML checked by test; retry a 429 once then fall back; real G13/G14 on CI or the Mac | FND-07 merged, INT-01 G14 on a daemon | 2026-11-24 |
| R-11 | Neon move breaks runtime (pooler, TLS, no superuser) | ADR-015 | Low | B | URL-only config, `SET LOCAL`, no superuser, roles outside migrations, polling relay (ADR-024); `pg:local --ssl` tests | DATA-09 Neon readiness (should) | 2026-11-30 |
| R-12 | Thin slack before M2 (critical path 54 h, a few hours slack) | plan.md | Medium | D | Orchestrator runs overnight or adds a fifth builder on the ENG stretch; stream C absorbs idle builders | INT-03 walking skeleton green | 2026-11-27 |
| R-13 | No sign-in path on the demo profile (mail sink is dev-only, passkey is should) | this review (GAP-09) | Medium | B | Add `mail` to the demo profile on 127.0.0.1; demo user signs in offline | OPS-06 demo-check signs in | 2026-11-30 |

## Gaps

GAP-01…08 are the rows of `coverage.md` (same order). GAP-09 is new from this review.

| gap id | gap | smallest fix | fixed by | ADR |
|---|---|---|---|---|
| GAP-01 | Derived display series with no formula node (target outlay, Baseline grouping, lever families/bar scale, monthly curve, outlay per domain) | Tier-2 view-models via session | DOM-06, CON-02, API-12 | ADR-021 |
| GAP-02 | `sys.session_idle_min`, `ai.max_tokens_per_job` cited but not in `variables.json` | Env settings `SESSION_IDLE_MIN`, `AI_MAX_TOKENS_PER_JOB` | OPS-01, API-07, AI-06 | ADR-022 |
| GAP-03 | `solver_run` has no progress/cancel columns | Manual migration | DATA-11, JOB-01 | ADR-023 |
| GAP-04 | No tables for magic-link tokens, sessions, passkeys | Manual migration | DATA-11, API-02 | ADR-023 |
| GAP-05 | 245/245 parity needs source workbooks not in the repo | Replay `parity_report.json` engine values with `parity_overrides` | ENG-06 | ADR-020 |
| GAP-06 | Seed uses `applyChangeset` (M1) but M0 exit says seed loaded | Prove seed from JSON in M0; load via write path early M1 | DATA-08 | ADR-007 |
| GAP-07 | UA rehearsal needs `ANTHROPIC_API_KEY` builders may lack | Owner runs one command on the Mac | AI-07 | ADR-012 |
| GAP-08 | Excel-for-Mac re-save fixture needs a Mac | Owner saves one exported file; test pending until then | XL-07 | ADR-011 |
| GAP-09 | Demo profile has no mail sink (`mail` is dev profile in OPS-01/OPS-04) and passkey is should, so the demo stack has no offline sign-in | Put `mail` in the demo profile too (127.0.0.1 only); demo-check signs in `DEMO_USER_EMAIL` | OPS-06 (proposed acceptance line) | ADR-014 |

## Epic changes vs 10 §3

10 §3 sketched 17 epics / ~113 items; the backlog has the same 17 epics / 141 items. No epic added, removed or renamed.

| epic | 10 §3 | backlog | change | why |
|---|---|---|---|---|
| FND | 6 | 7 | +FND-06 planning notes, +FND-07 pg-local | Prompt 00 folded in; daemon-less DB tests (ADR-016) |
| OPS | 6 | 7 | Compose checks split out (OPS-05) | G13 network test and G14 in one owner item |
| CON | 3 | 4 | Typed client + mock session split (CON-04) | Tier 1 can build before tier 2 is live |
| SPEC | 3 | 3 | — | — |
| ENG | 10 | 11 | ENG-01 port map split from parser | PORTING.md before code (prompt 00 task 4) |
| SOL | 10 | 11 | SOL-11 G5 acceptance runner | One gate item for solver numbers |
| DATA | 6 | 11 | +DATA-07 object store, +DATA-08 seed via write path, +DATA-09 Neon readiness, +DATA-10 RLS catalog/leak, +DATA-11 manual migrations | ADR-015, ADR-023, GAP-03/04/06 |
| DOM | 5 | 6 | +DOM-06 view-models | ADR-021, GAP-01 |
| API | 8 | 12 | Auth split (API-02, API-03 should), sessions split (API-06, API-07), +API-12 view subscriptions | Size S/M; ADR-021 |
| JOB | 3 | 4 | +JOB-04 demo cache warmer | R-05, R-06 |
| XL | 7 | 8 | +XL-08 Excel jobs | Worker side separate from pure `excel` |
| AI | 7 | 7 | — | — |
| UI | 14 | 18 | 27 components regrouped into S/M items | Size limit; parallel builders |
| WEB | 7 | 8 | +WEB-08 job progress / empty states | Plumbing used by several modules |
| MOD | 9 | 10 | Cockpit split (MOD-01 hero, MOD-02 tiles) | M2 walking skeleton needs the hero first |
| QA | 5 | 8 | +QA-02 tenant zz, +QA-03 route leak test, +QA-08 perf monitors | Multi-tenancy proof; R-02, R-03 |
| INT | 4 | 6 | +INT-01 M0 check, +INT-06 freeze | Every milestone has a wiring check |

Proposed by this review (for the orchestrator; not applied here):

| proposal | target | reason |
|---|---|---|
| Add acceptance line "mail sink in demo profile; demo-check signs in the demo user offline" | OPS-06 | GAP-09, R-13 |
| Amend ADR-013 (Neon is the next host, not rejected) and ADR-014 (demo sign-in via magic link; passkey should) | `docs/adr` | ADR review |
