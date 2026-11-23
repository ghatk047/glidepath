# 02 · Repository layout and conventions (v1.1, three-tier)

One monorepo, suggested name `glidepath`. Folders mirror the three tiers so a subagent always knows which tier it is in. A backlog item touches one package (plus its tests).

## 1. Layout

```
glidepath/
├── CLAUDE.md
├── docker-compose.yml            # all tiers (11)
├── docker-compose.dev.yml        # hot reload overrides
├── .env.example                  # every setting, no secrets
├── docs/  adr/  spec/  ux/  architecture/  backlog/  status/
│
├── tier1-presentation/
│   ├── web/                      # Vite React SPA: routes, view store, WS client, 8 modules, global layer
│   └── ui/                       # tokens → CSS vars, glass primitives, 27 components, charts, formatters
│
├── tier2-logic/
│   ├── server/                   # `logic` container: Hono REST + WebSocket, auth, tenancy, sessions
│   ├── worker/                   # `worker` container: pg-boss consumers (solvers, Excel, AI, golden runs)
│   ├── spec/                     # loads + validates spec JSON, generated zod types
│   ├── engine/                   # parser, compiler, evaluator (full, incremental, batch), explain
│   ├── solvers/                  # goal seek … Monte Carlo, Sobol
│   ├── domain/                   # changesets, VR01–VR10, scenario resolution/fork/undo, hashing
│   ├── excel/                    # template, build, parse, diff, delta report (pure)
│   ├── ai/                       # reconfiguration pipeline, prompts, schemas
│   └── data-access/              # repositories over tier 3: Drizzle schema (generated), queries, RLS session, object store client
│
├── tier3-data/
│   ├── migrations/               # generated SQL from schema.json + RLS policies + views
│   ├── seed/                     # tenant seeds (aa/ copied from model-spec/seed/aa)
│   ├── postgres/                 # init scripts, roles (glidepath_owner, glidepath_app), conf
│   └── backup/                   # pg_dump / restore scripts, MinIO bucket policy
│
├── contract/
│   └── api-contract/             # the ONLY code shared by tier 1 and tier 2: zod schemas, WS message types, typed client
│
├── tools/  gen-schema/  gen-types/  parity/  tier-check/
└── e2e/                          # Playwright against the running compose stack
```

### Dependency rules (eslint-plugin-boundaries + `tools/tier-check`)

```
tier1-presentation/*  →  contract/api-contract, tier1-presentation/ui        (nothing from tier2 or tier3)
tier2-logic/server    →  contract, domain, engine, solvers, excel, ai, data-access, spec
tier2-logic/worker    →  same as server
engine                →  spec
solvers               →  engine, spec
domain                →  spec, engine
excel, ai             →  domain, engine, spec
data-access           →  spec, domain types   (the only tier 2 package that talks to tier 3)
```
`tools/tier-check` also inspects the production web bundle and fails if it finds engine, solver, domain, excel or SQL symbols.

## 2. Toolchain

| Concern | Choice |
|---|---|
| Runtime | Node 22 LTS in tier 2 containers; TypeScript 5.x `strict` everywhere |
| Packages | pnpm workspaces, Turborepo |
| Containers | Docker Desktop on macOS (Apple Silicon or Intel); images built multi-arch (`linux/arm64`, `linux/amd64`) with `docker buildx` |
| Lint / format | ESLint (typescript-eslint, boundaries), Prettier |
| Tests | Vitest (unit), Playwright (e2e against compose, `--trace off`) |
| CI | GitHub Actions; Postgres and MinIO as service containers; same images as local |

## 3. Conventions

- **Business logic lives only in `tier2-logic/`.** If code decides a number, validates a rule or knows a formula, it is tier 2. Tier 1 code that does any of these fails review.
- **No numeric literals with business meaning in code.** They belong in `variables.json` and the database.
- **Spec ids are used verbatim** (`g.target_net`, `res.net`, `'pilots,fy27'`); labels come from the spec via tier 2.
- **Money is $M float64; percentages are decimals.** Formatting only in `tier1-presentation/ui/format`.
- **Pure core in tier 2** (`engine`, `solvers`, `domain`, `excel` have no IO). IO lives in `server`, `worker` and `data-access`.
- **Contract first.** Any change to `contract/api-contract` needs both tiers' items in the same milestone and an ADR note.
- **One backlog item per branch** `bl/<id>-<slug>`; conventional commits ending with the item id.
- **No airline marks** anywhere, including fixtures and screenshots.

## 4. Environments

| Env | Where | Purpose |
|---|---|---|
| dev | `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` on the Mac (hot reload for web and logic) | Daily build work |
| demo | `docker compose --profile demo up -d` on the Mac from tagged images `demo-2026-12-04` | Dec 4 demo, frozen Dec 3 |
| ci | GitHub Actions service containers | Gates |
| cloud (later) | Same compose file on a Linux VM (or ECS / Azure Container Apps / Kubernetes via the same images) | Post-demo; see 11 §5 |

Secrets (`POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `MINIO_ROOT_PASSWORD`, `AUTH_SECRET`, `ANTHROPIC_API_KEY`) live in a local `.env` (git-ignored) or Docker secrets; in CI, GitHub Actions secrets.
