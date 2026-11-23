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
