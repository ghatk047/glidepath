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

## Public demo (Cloudflare)

OPS-09: the demo runs on the owner's Mac mini and is reached at `PUBLIC_BASE_URL` (e.g. `https://glidepath.wafflebot.us`) through a **Cloudflare Tunnel**; **Cloudflare Access** is the sign-in (one-time PIN to an address its policy allows, here `@gmail.com` and `@infosys.com`). Magic links still go to the local mail sink, so outside visitors sign in through Access only. Nothing is published to the internet from the Mac: cloudflared dials out. Compose keeps the tiers apart as before: the tunnel connector is on `edge` only (it reaches `web`, never `db`, G13), and `logic` is now also on `egress`, only to fetch the Access signing keys.

### Cloudflare dashboard (once)

1. **Tunnel** (Zero Trust > Networks > Tunnels): create a tunnel, or use the existing one. Public hostname: the `PUBLIC_BASE_URL` host, service **`https://web:443`**. Under Additional application settings > TLS: **Origin Server Name = the `PUBLIC_BASE_URL` host** (Caddy's site address is `PUBLIC_BASE_URL` with `tls internal`, so it only answers that name) and **No TLS Verify = on** (the certificate comes from Caddy's local CA). Leave HTTP Host Header empty (the public host is passed through).
2. **Access application** (Zero Trust > Access > Applications > Add > Self-hosted) on the same hostname. Policy: Allow, include *Emails ending in* `@gmail.com` and `@infosys.com`; login method: One-time PIN. Copy the application's **AUD tag** (Overview).
3. The **team domain** is shown in Zero Trust > Settings: `icy-recipe-ffdf.cloudflareaccess.com`.

### `.env` on the Mac (never committed)

| Key | Value |
|---|---|
| `PUBLIC_BASE_URL` | `https://glidepath.wafflebot.us` (the public hostname; also Caddy's site address and the cookies' origin) |
| `CF_ACCESS_TEAM_DOMAIN` | `icy-recipe-ffdf.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | the Access application's AUD tag |
| `TUNNEL_TOKEN` | only for the compose `tunnel` profile: the token of the tunnel's install command |
| `ACCESS_AUTO_TENANTS` | optional, default `aa`: tenants a first-time Access user joins (`none`: none) |
| `ACCESS_AUTO_ROLE` | optional, default `editor` (`owner`, `editor`, `viewer`, `advisor`) |
| `ACCESS_ALLOWED_DOMAINS` | optional re-check after Access, e.g. `gmail.com,infosys.com` |
| `AI_ENABLED` | `0` (the AI feature is not used; `ops/demo-check.sh` prints `SKIP cached UA reconfig draft: skipped (AI off)`) |

With `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` set, `logic` verifies the `Cf-Access-Jwt-Assertion` header that Cloudflare adds to every request (RS256 against `https://<team>/cdn-cgi/access/certs`, cached for 10 minutes, refetched at most every 30 s for an unknown key; `iss` = the team domain, `aud` contains the AUD tag, `exp`/`nbf`) and opens the normal cookie session for its `email` on the SPA's first `GET /api/*`. The plain `Cf-Access-Authenticated-User-Email` header is never trusted. A new address gets an `app_user` (manual migration 0006, a SECURITY DEFINER function: the app role still has no INSERT on `app_user`) and, when it has no membership, joins `ACCESS_AUTO_TENANTS` as `ACCESS_AUTO_ROLE` through `withTenant` (RLS applies). A missing or invalid JWT falls back to the existing sign-in; with the two keys empty nothing changes. Code: `tier2-logic/server/src/auth/access.ts`; tests: `access.pg.test.ts` (locally signed JWTs, a fake certs endpoint).

### Start and stop

Either way, start the app stack first: `docker compose --profile demo up -d`.

- **Token-based connector in compose** (`tunnel` profile, `cloudflare/cloudflared:2026.11.2`, `tunnel --no-autoupdate run`, `TUNNEL_TOKEN` from `.env`): `docker compose --profile demo --profile tunnel up -d`; stop it alone with `docker compose --profile tunnel stop tunnel`, or everything with `docker compose --profile demo --profile tunnel down` (keeps the volumes). Logs: `docker compose logs -f tunnel`. To pin it by digest as well, set `TUNNEL_IMAGE_PIN` by hand (`ops/demo-pin.sh` pins the four app images only).
- **Locally managed tunnel, as on the owner's Mac today**: a standalone container `glidepath-tunnel` (cloudflared 2026.11.2) with its config and credentials in `~/.cloudflared/glidepath`, joined to the stack's edge network (`<project>_edge`, e.g. `glidepath_edge`) and with an ingress rule `service: https://web:443`, `originRequest: { originServerName: <PUBLIC_BASE_URL host>, noTLSVerify: true }`. Leave `TUNNEL_TOKEN` empty and the `tunnel` profile off; after `docker compose ... down` and `up`, reconnect it if the network was recreated: `docker network connect glidepath_edge glidepath-tunnel` (or `docker restart glidepath-tunnel`). Stop: `docker stop glidepath-tunnel`. Never put it on the data network.

On that Mac `localhost:443` resets connections (Cloudflare WARP), so check the app through the public hostname (Access sign-in) or from inside the Docker network, e.g. `docker compose exec logic node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>console.log(r.status))"`. `ops/demo-check.sh` talks to `https://localhost` only and expects the localhost site address, so it is not the check for this setup: its HTTP checks need a stack with `PUBLIC_BASE_URL=https://localhost` on a machine where localhost works.
