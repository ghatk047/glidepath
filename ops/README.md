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
