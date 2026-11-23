# OPS · Docker and operations

Compose stack with edge/data/egress networks, multi-arch images, Caddy, dev override, compose checks, demo profile, backup/restore.

7 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| OPS-01 | docker-compose.yml, networks and .env.example | M0 | opus/high | M | FND-05, FND-01 |
| OPS-02 | logic image Dockerfile (server, worker, migrate), multi-arch | M0 | sonnet/high | S | OPS-01 |
| OPS-03 | web image (Caddy + SPA) and Caddyfile | M0 | sonnet/high | S | OPS-01 |
| OPS-04 | docker-compose.dev.yml hot-reload override and mailpit | M3 | sonnet/medium | S | OPS-01 |
| OPS-05 | Compose checks: clean start < 3 min, web cannot reach db | M0 | sonnet/high | S | OPS-02, OPS-03, DATA-04, API-01 |
| OPS-06 | Demo profile with pinned digests and ops/demo-check.sh | M4 | sonnet/high | M | OPS-05, JOB-04, AI-07 |
| OPS-07 | ops/backup.sh and ops/restore.sh | M4 | sonnet/medium | S | OPS-05, DATA-07 |

## OPS-01 · docker-compose.yml, networks and .env.example

```yaml
id: OPS-01
title: "docker-compose.yml, networks and .env.example"
epic: OPS
milestone: M0
priority: must
status: in_progress
stream: B
model: opus
effort: high
depends_on: [FND-05, FND-01]
tier: ops
package: "repo-root (docker-compose.yml, .env.example, README 'Running locally')"
contract: "Services and networks of 11 §1–§2"
inputs:
  - "docs/architecture/11_docker_deployment.md#1. Containers"
  - "docs/architecture/11_docker_deployment.md#2. Compose sketch"
  - "docs/architecture/11_docker_deployment.md#4. Configuration (12-factor)"
  - "docs/architecture/02_repo_and_conventions.md#4. Environments"
  - "docs/adr/ADR-015-database-portability.md"
acceptance:
  - "services db (postgres:16 pinned minor), objects (minio pinned RELEASE tag), migrate, logic, worker, web, mail (dev profile) with networks edge, data (internal: true), egress (test: ops/test/compose-config.spec.ts parses `docker compose config` output or the YAML when no daemon)"
  - "web on edge only; db and objects on data only; worker on data + egress; logic on edge + data (same test)"
  - ".env.example lists DATABASE_URL (glidepath_app), DATABASE_URL_MIGRATE (glidepath_owner), POSTGRES_PASSWORD, APP_DB_PASSWORD, S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY, MINIO_ROOT_PASSWORD, AUTH_SECRET, PUBLIC_BASE_URL, SMTP_URL, ANTHROPIC_API_KEY, LOG_LEVEL, SESSION_IDLE_MIN, JOB_CONCURRENCY, AI_MAX_TOKENS_PER_JOB, AUTH_LINK_TTL_MIN, DEMO_USER_EMAIL, all empty or placeholder (test: env-example.spec.ts)"
  - "tier-2 services read only DATABASE_URL / DATABASE_URL_MIGRATE for the DB (no host/port/user split vars) so a Neon URL is a drop-in (test: grep compose for PGHOST etc. fails)"
  - "README 'Running locally': cp .env.example .env, docker compose up -d, open https://localhost (test: section exists)"
gates: [G14]
size: M
notes: "If the builder has no Docker daemon, validate the YAML by test; INT-01 runs it on a daemon (CI or the Mac)."
```

The one compose file that runs all tiers on the Mac and later on any VM.

## OPS-02 · logic image Dockerfile (server, worker, migrate), multi-arch

```yaml
id: OPS-02
title: "logic image Dockerfile (server, worker, migrate), multi-arch"
epic: OPS
milestone: M0
priority: must
status: todo
stream: B
model: sonnet
effort: high
depends_on: [OPS-01]
tier: ops
package: "ops/docker/logic"
contract: "Image glidepath/logic with entrypoints dist/server.js, dist/worker.js, dist/migrate.js"
inputs:
  - "docs/architecture/11_docker_deployment.md#1. Containers"
  - "docs/architecture/11_docker_deployment.md#5. Moving to a cloud server later"
  - "docs/architecture/02_repo_and_conventions.md#2. Toolchain"
acceptance:
  - "multi-stage build on a pinned node:22 slim image, pnpm deploy of server + worker, non-root user (test: hadolint + ops/test/dockerfile.spec.ts)"
  - "`docker buildx bake --print logic` lists linux/arm64 and linux/amd64 (test)"
  - ".dockerignore excludes .env, docs, tests; no secret build args (test: dockerignore check)"
  - "same image runs `node dist/server.js`, `node dist/worker.js`, `node dist/migrate.js --seed aa` (test: entrypoint files referenced exist in package build outputs; stubbed until API-01/JOB-01/DATA-08)"
gates: [G14]
size: S
notes: ""
```

One tier-2 image, three commands.

## OPS-03 · web image (Caddy + SPA) and Caddyfile

```yaml
id: OPS-03
title: "web image (Caddy + SPA) and Caddyfile"
epic: OPS
milestone: M0
priority: must
status: todo
stream: B
model: sonnet
effort: high
depends_on: [OPS-01]
tier: ops
package: "ops/docker/web"
contract: "Caddy proxies /api/* and /ws/* to logic:8080"
inputs:
  - "docs/architecture/11_docker_deployment.md#1. Containers"
  - "docs/architecture/07_frontend.md#7. Demo resilience (replaces v1.0's in-browser offline kit)"
  - "docs/architecture/01_architecture_overview.md#1. The three tiers"
acceptance:
  - "Caddyfile serves the SPA with history fallback and proxies /api/* and /ws/* (WebSocket upgrade) to logic:8080; local TLS via Caddy internal CA (test: `caddy validate` in a test + ops/test/caddy.spec.ts)"
  - "CSP without unsafe-eval and with no external origins (the demo needs no internet) (test: header assertions)"
  - "multi-arch bake target glidepath/web (test: bake --print)"
gates: [G13, G14]
size: S
notes: ""
```

Tier 1 container: static files and a reverse proxy, nothing else.

## OPS-04 · docker-compose.dev.yml hot-reload override and mailpit

```yaml
id: OPS-04
title: "docker-compose.dev.yml hot-reload override and mailpit"
epic: OPS
milestone: M3
priority: must
status: todo
stream: B
model: sonnet
effort: medium
depends_on: [OPS-01]
tier: ops
package: "repo-root (docker-compose.dev.yml)"
contract: "Dev override of 11 §3"
inputs:
  - "docs/architecture/11_docker_deployment.md#3. On the Mac"
  - "docs/architecture/02_repo_and_conventions.md#4. Environments"
acceptance:
  - "web runs the Vite dev server and logic/worker run `tsx watch` from bind mounts (test: compose-config.spec.ts on merged config)"
  - "db 5432, MinIO console and mailpit 8025 bound to 127.0.0.1 only (same test)"
  - "README documents the dev command (test)"
gates: [G14]
size: S
notes: ""
```

Daily dev loop on the Mac.

## OPS-05 · Compose checks: clean start < 3 min, web cannot reach db

```yaml
id: OPS-05
title: "Compose checks: clean start < 3 min, web cannot reach db"
epic: OPS
milestone: M0
priority: must
status: todo
stream: B
model: sonnet
effort: high
depends_on: [OPS-02, OPS-03, DATA-04, API-01]
tier: ops
package: "ops/compose-check.sh"
contract: "`ops/compose-check.sh` exit code contract"
inputs:
  - "docs/architecture/08_quality_and_testing.md#1. Gates (G13, G14)"
  - "docs/architecture/11_docker_deployment.md#1. Containers"
  - "docs/architecture/01_architecture_overview.md#6. Non-functional targets"
acceptance:
  - "from clean volumes all services healthy and migrate completed in < 3 min; script prints per-service timings (G14)"
  - "inside the web container `getent hosts db` and `getent hosts objects` fail (G13 network test)"
  - "CI job compose (FND-04) runs it on pushes to main and nightly; exits non-zero with a one-line reason (test: bats or shellcheck + dry-run mode)"
gates: [G13, G14]
size: S
notes: "Needs a Docker daemon: runs in CI and on the Mac; in a daemon-less builder only shellcheck + dry-run are checked."
```

Turns the physical tier separation and the 3-minute start into a repeatable check.

## OPS-06 · Demo profile with pinned digests and ops/demo-check.sh

```yaml
id: OPS-06
title: "Demo profile with pinned digests and ops/demo-check.sh"
epic: OPS
milestone: M4
priority: must
status: todo
stream: B
model: sonnet
effort: high
depends_on: [OPS-05, JOB-04, AI-07]
tier: ops
package: "ops/demo-check.sh (+ demo profile in docker-compose.yml)"
contract: "`docker compose --profile demo up -d`"
inputs:
  - "docs/architecture/02_repo_and_conventions.md#4. Environments"
  - "docs/architecture/07_frontend.md#7. Demo resilience (replaces v1.0's in-browser offline kit)"
  - "docs/architecture/prompts/20_orchestrator.md#Freeze (Thu 3 Dec, 18:00 US Central)"
  - "docs/spec/reference/golden_results.json (scenarios.C)"
acceptance:
  - "demo profile uses images tagged demo-2026-12-04 pinned by digest (test: compose-config.spec.ts)"
  - "`ops/demo-check.sh` verifies all containers healthy, AA seed loaded, /calc for C equals golden_results.json C headline values (res.net, res.gap, res.risk, br.eps27) within 1e-6 relative, cached Monte Carlo C/D and min-risk results present, cached UA reconfig draft present; exits non-zero with a one-line reason (test: script against the stack)"
  - "check resolves no external hostnames (runs with networking off) (test: run with --network none for the checker container)"
  - "demo profile includes the local mail sink so magic-link sign-in works offline (GAP-09); demo-check signs in through it (test: demo-check)"
gates: [G14]
size: M
notes: ""
```

The pre-demo checklist as a script.

## OPS-07 · ops/backup.sh and ops/restore.sh

```yaml
id: OPS-07
title: "ops/backup.sh and ops/restore.sh"
epic: OPS
milestone: M4
priority: must
status: todo
stream: B
model: sonnet
effort: medium
depends_on: [OPS-05, DATA-07]
tier: ops
package: "ops/backup.sh + ops/restore.sh"
contract: "Backup folder layout ./backups/<timestamp>/"
inputs:
  - "docs/architecture/11_docker_deployment.md#3. On the Mac"
  - "docs/architecture/04_data_and_api.md#5. Tier 3 · Object storage (MinIO)"
  - "docs/adr/ADR-015-database-portability.md"
acceptance:
  - "backup writes pg_dump (custom format, via DATABASE_URL_MIGRATE) and a mirror of every MinIO bucket to ./backups/<timestamp>/ (test: ops/test/backup.spec)"
  - "restore into clean volumes, then /calc for C and object counts equal the pre-backup values (round-trip test)"
  - "uses --no-owner --no-privileges so it works against a non-superuser URL including sslmode=require (test with pg-local --ssl)"
gates: [G14]
size: S
notes: ""
```

Run before the freeze; also the first step of moving to Neon later.
