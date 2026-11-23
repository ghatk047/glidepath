# @glidepath/ops

Tests and helpers for the repo-root operations files: `docker-compose.yml`,
`docker-compose.neon.yml`, `.env.example` and the README "Running locally" section.

- `src/index.ts`: loads the Compose model from `docker compose config --format json` when
  the Compose CLI is installed (no daemon needed), else from the YAML with a small
  Compose-style interpolator; parses `.env.example`.
- `test/compose-config.spec.ts`: services, images, profiles and networks of
  `docs/architecture/11_docker_deployment.md` §1–§2; DB only via `DATABASE_URL(_MIGRATE)`;
  the Neon override.
- `test/env-example.spec.ts`: every setting listed, no secret filled.
- `test/readme.spec.ts`: the "Running locally" section.
- `test/dockerfile.spec.ts` (OPS-02): the `glidepath/logic` image in `ops/docker/logic`: Dockerfile, hadolint (when installed), bake platforms, `.dockerignore`, entry files, build helpers.

Set `OPS_COMPOSE_SOURCE=yaml` to force the YAML path. Run with
`pnpm turbo run typecheck lint test --filter=@glidepath/ops`.
- `backup.sh`, `restore.sh`, `pg-common.sh` (OPS-07): `pg_dump -Fc --no-owner --no-privileges` into `./backups/<timestamp>/` (dump, grants.sql, manifest.txt) and the matching restore; DB from `DATABASE_URL_BACKUP`/`DATABASE_URL_MIGRATE` or the compose `db` service; the role must bypass RLS. Tested in `test/backup.spec.ts` against pg-local with TLS.
- `compose-check.sh` (OPS-05, INT-01): clean start < 3 min (G14), web cannot resolve `db`/`objects` (G13), and the M0 checks: every migration recorded in `schema_migration`, RLS enabled and forced on every tenant table, the migrations' views present, the `--seed` tenant loaded (once `migrate` completes), and every `tokens.css` custom property in the CSS `web` serves. Exit 0 PASS, 1 FAIL, 2 USAGE, 3 BUDGET, 4 PENDING (stub entries). Tested with a fake `docker` in `test/compose-check.spec.ts`; `test/m0-status.spec.ts` covers the M0 status note.
- `demo-pin.sh`, `demo-check.sh`, `demo-check-relay.mjs`, `src/demo-check*.ts` (OPS-06): the demo profile, see below. Tested in `test/demo-pin.spec.ts`, `test/demo-check.spec.ts` (fixture stack, and the checker container on `--network none` when Docker and a `glidepath/logic` image are there) and the demo sections of `test/compose-config.spec.ts`.

## Demo profile (OPS-06)

`docker compose --profile demo up -d` runs the images tagged `demo-2026-12-04`, each pinned by digest, with the mail sink (`mail`, mailpit) so magic-link sign-in works with Wi-Fi off (GAP-09). The compose file has one set of services; the profile and the pins come from `.env`:

- `image: glidepath/logic:${TAG:-dev}${LOGIC_IMAGE_PIN:-}` (same for `WEB_`, `DB_`, `MAIL_IMAGE_PIN`). A pin is `@sha256:<64 hex>` or empty (dev). `compose-config.spec.ts` checks that a demo env gives `name:tag@sha256:...` for all six services and that dev stays unpinned.
- **`ops/demo-pin.sh`** (run on the Mac that builds the images, at the freeze): `--build` builds `glidepath/logic` and `glidepath/web` as `demo-2026-12-04` (`--extra-ca` behind a TLS-inspecting proxy), or `--from-tag TAG` retags images you built already; it reads the manifest digest of those two and of the pinned postgres and mailpit images, and writes `TAG`, `COMPOSE_PROFILES=demo` and the four pins into `.env`, plus the same five lines into `ops/demo-pins.env`. Commit that record at the freeze; on another Mac `ops/demo-pin.sh --apply` copies it into `.env` (no Docker). A pin that does not resolve locally is refused. For a multi-arch image pushed with `docker buildx bake --push`, pass the index digest: `--digest logic=sha256:...`. Needs the containerd image store (Docker Desktop's default) so a local image keeps its manifest digest. Rebuild the images and you must pin again (`up` otherwise looks for the old digest and fails with "build tag cannot contain a digest"); `ops/compose-check.sh` rebuilds, so point it at an env file without pins.
- **migrate** now starts through a small shell: it adds `--parity tier3-data/seed/parity` when `golden-report.json` and `replay-report.json` are in the image (`pnpm parity:golden --out tier3-data/seed/parity` before the build, git-ignored; the Airlines tile then shows parity 245/245, API-14) and `--ai-cache tier3-data/seed/ai-cache/ua` when the bundle is (`pnpm ai:rehearse --tenant ua`, AI-07). With neither directory it seeds as before.
- **`ops/demo-check.sh`** (after `up -d`): every service running and healthy (migrate completed), every image pinned by digest, sign-in through the mail sink, AA seed with C and D, `/calc` for C equal to `golden_results.json` (res.net, res.gap, res.risk, br.eps27, 1e-6 relative), cached Monte Carlo C and D, cached min-risk C within the G5 tolerances (`@glidepath/parity`) of `solver_demo_results.json` `min_risk_total_bar` (a cache warmed before SOL-12 shows risk 42.5, not 42.0, and fails; the fix is `docker compose down -v`, rebuild, `up`), parity recorded, and the cached UA reconfiguration draft. Exit 0 PASS; 1 FAIL with the last stderr line `demo-check: FAIL: <first reason>`; 2 usage. **Until AI-07 lands the UA check fails** with `UA reconfig draft not cached (run pnpm ai:rehearse --tenant ua)`; every other line is PASS.
- It resolves no external host: it only connects to `localhost` (as 127.0.0.1, no lookup) and refuses any other name. `--isolated` goes further and runs the HTTP checks in a container on `--network none` (the web and mail ports reach it as unix sockets through `demo-check-relay.mjs`); it needs Linux or Docker Engine, because Docker Desktop for Mac cannot bind-mount host sockets. The script bundles `src/demo-check-cli.ts` with esbuild (`pnpm i` first) and runs it with node.
