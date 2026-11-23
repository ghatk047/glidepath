# glidepath/logic image

One image for all of tier 2 (`docs/architecture/11_docker_deployment.md` §1). Compose runs it three ways:

| Service | Command | From |
|---|---|---|
| `logic` | `node dist/server.js` | `tier2-logic/server` (API-01) |
| `worker` | `node dist/worker.js` | `tier2-logic/worker` (JOB-01) |
| `migrate` | `node dist/migrate.js --seed aa` | `tier2-logic/worker/src/seed` (DATA-08) |

## Build

The build context is the repository root (docker-compose.yml already says so).

```sh
# local, single architecture (what compose does)
docker build -f ops/docker/logic/Dockerfile -t glidepath/logic:dev .

# multi-arch plan: lists linux/arm64 and linux/amd64
docker buildx bake -f ops/docker/logic/docker-bake.hcl --print logic

# multi-arch build and push (CI; needs a docker-container builder: `docker buildx create --use`)
REGISTRY=ghcr.io/<owner>/ TAG=$(git rev-parse --short HEAD) \
  docker buildx bake -f ops/docker/logic/docker-bake.hcl logic --push
```

Behind a TLS-inspecting proxy, hand the build its CA certificates as an optional BuildKit secret (a CA file is not a secret, but this keeps it out of the image): `docker build --secret id=extra-ca,src=/path/ca.pem ...`.

## Runtime approach

The workspace packages are source-only TypeScript (`main` is `src/index.ts`), so the image does not run them directly.

1. `pnpm install --frozen-lockfile` for server and worker and everything they depend on.
2. Each entry package owns a `build` script that bundles its entry with esbuild into `<package>/dist/*.js` (self-contained ESM, workspace packages included). The image runs `pnpm run --if-present build` for `@glidepath/server` and `@glidepath/worker`.
3. `collect-dist.sh` copies the three entry files to `/app/dist/{server,worker,migrate}.js`.
4. `pnpm deploy --prod` (lockfile-resolved, hoisted layout) of server and worker gives the production dependencies; `merge-node-modules.sh` merges them into one `/app/node_modules` and fails the build if the two disagree on a package version. The workspace packages themselves are dropped (they are in the bundles). This tree is what a bundle's `--external` imports (for example `pg-native`) resolve against.
5. Runtime stage: pinned `node:22-bookworm-slim` (tag and digest), `WORKDIR /app`, user `node` (uid 1000, not root), `tier3-data/` copied in (migrations, later the seed). `/tier3-data` is a symlink to `/app/tier3-data` because `data-access` resolves its default migrations directory three levels above the module, which for `/app/dist/migrate.js` is `/tier3-data`.

No setting and no secret is baked in; every setting is an environment variable read at start (compose passes them). The image has no `HEALTHCHECK`; compose defines the one for `logic`.

## Entry paths are configurable

Build args (also variables in `docker-bake.hcl`), relative to the repo root:

| Arg | Default |
|---|---|
| `SERVER_ENTRY` | `tier2-logic/server/dist/server.js` |
| `WORKER_ENTRY` | `tier2-logic/worker/dist/worker.js` |
| `MIGRATE_ENTRY` | `tier2-logic/worker/dist/migrate.js` |
| `STRICT_ENTRYPOINTS` | `0` |

The whole directory of each entry is copied, so chunks and source maps travel with it. With `STRICT_ENTRYPOINTS=0` an entry that was not built becomes a stub that prints which file is missing and exits 78, so the image builds while a package is still a skeleton. The default is now `STRICT_ENTRYPOINTS=1` (in the Dockerfile and `docker-bake.hcl`), since API-01, JOB-01 and DATA-08 have landed: the build fails on a missing entry.

## Spec bundle (`SPEC_DIR`)

The read routes (`GET bundle`) load the spec bundle from `SPEC_DIR`. The image has no `docs/` tree, so the build copies the two files `loadModelBundleFromDir` reads (`docs/spec/variables.json`, `docs/spec/formula_graph.json`) read-only (mode 0444) to `/app/spec`, and the runtime stage sets `SPEC_DIR=/app/spec`. Compose may override `SPEC_DIR`; the default needs no setting. `ops/test/dockerfile.spec.ts` checks the copy, the path and the dockerignore exception.

## Files

- `Dockerfile`, `docker-bake.hcl`: the image and its multi-arch plan.
- `Dockerfile.dockerignore`: BuildKit reads it before the repo-root `.dockerignore`. Excludes `.env*`, `docs` (except `docs/spec/variables.json` and `formula_graph.json`), tests, `.git`, `node_modules`, `dist`, tier 1.
- `collect-dist.sh`, `merge-node-modules.sh`: build-stage helpers (tested in `ops/test/dockerfile.spec.ts`).
- `.hadolint.yaml`: `hadolint --config ops/docker/logic/.hadolint.yaml ops/docker/logic/Dockerfile`.
