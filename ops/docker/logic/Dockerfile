# syntax=docker/dockerfile:1.7
#
# glidepath/logic: the one tier-2 image. server, worker and migrate all run from it:
#
#   node dist/server.js            REST + WS API on :8080      (compose service `logic`)
#   node dist/worker.js            pg-boss consumers           (compose service `worker`)
#   node dist/migrate.js --seed aa migrations + AA seed        (compose service `migrate`)
#
# Build context is the REPO ROOT (see docker-compose.yml and ops/docker/logic/README.md):
#
#   docker build -f ops/docker/logic/Dockerfile -t glidepath/logic:dev .
#   docker buildx bake -f ops/docker/logic/docker-bake.hcl logic        # linux/arm64 + linux/amd64
#
# Runtime approach: the workspace packages are source-only TypeScript, so each entry package
# owns a `build` script that bundles its entry with esbuild into <package>/dist/*.js. This
# file runs those scripts, collects the three entry files into /app/dist (paths are build
# args below) and installs the production dependencies of server + worker with `pnpm deploy`.
# Configuration is environment only; no setting and no secret is baked into the image.

ARG NODE_IMAGE=node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

# --------------------------------------------------------------------------- build
# NODE_IMAGE is pinned by tag and digest in the ARG above; hadolint cannot see through it.
# hadolint ignore=DL3006
FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION=10.28.0
# Built-file paths relative to the repo root. Override when an entry moves.
ARG SERVER_ENTRY=tier2-logic/server/dist/server.js
ARG WORKER_ENTRY=tier2-logic/worker/dist/worker.js
ARG MIGRATE_ENTRY=tier2-logic/worker/dist/migrate.js
# 0: an entry whose build output is missing becomes a stub that exits 78 (skeleton phase).
# 1: a missing entry fails the build (default since API-01, JOB-01 and DATA-08 landed).
ARG STRICT_ENTRYPOINTS=1
ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
# Optional BuildKit secret `extra-ca` (a PEM file): extra CA certificates for the build's
# network access behind a TLS-inspecting proxy. Not needed on an open network.
#   docker build --secret id=extra-ca,src=/path/ca.pem ...
RUN --mount=type=secret,id=extra-ca,required=false \
    if [ -f /run/secrets/extra-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra-ca; fi \
 && npm install --global --no-fund --no-audit "pnpm@${PNPM_VERSION}"
WORKDIR /repo
COPY . .
# The cache mount keeps the pnpm store between builds; it is not part of any layer.
RUN --mount=type=cache,id=glidepath-pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=extra-ca,required=false \
    if [ -f /run/secrets/extra-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra-ca; fi \
 && pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile \
      --filter "@glidepath/server..." --filter "@glidepath/worker..." \
 && pnpm --filter "@glidepath/server" --filter "@glidepath/worker" run --if-present build \
 && pnpm --filter "@glidepath/server" --prod --config.inject-workspace-packages=true --config.node-linker=hoisted deploy /deploy/server \
 && pnpm --filter "@glidepath/worker" --prod --config.inject-workspace-packages=true --config.node-linker=hoisted deploy /deploy/worker
RUN SERVER_ENTRY="${SERVER_ENTRY}" WORKER_ENTRY="${WORKER_ENTRY}" MIGRATE_ENTRY="${MIGRATE_ENTRY}" \
    STRICT_ENTRYPOINTS="${STRICT_ENTRYPOINTS}" \
    sh ops/docker/logic/collect-dist.sh /repo /out/dist \
 && sh ops/docker/logic/merge-node-modules.sh /out/node_modules /deploy/server/node_modules /deploy/worker/node_modules \
 && rm -rf /out/node_modules/@glidepath \
 && mkdir -p /out/tier3-data \
 && cp -R tier3-data/. /out/tier3-data/ \
 && mkdir -p /out/spec \
 && cp docs/spec/variables.json docs/spec/formula_graph.json docs/spec/excel_template.json docs/spec/solvers.json /out/spec/ \
 && chmod 0444 /out/spec/*.json

# ------------------------------------------------------------------------- runtime
# hadolint ignore=DL3006
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/tier3-data ./tier3-data
# The read routes load the spec bundle (variables.json, formula_graph.json: all loadModelBundleFromDir
# reads; the worker Excel jobs also read excel_template.json; the stress routes read solvers.json)
# from SPEC_DIR; the image has no docs/ tree, so a read-only copy lives at this fixed path.
COPY --from=build /out/spec /app/spec
ENV SPEC_DIR=/app/spec
# data-access resolves its default migrations directory three levels above the module,
# which for /app/dist/migrate.js is /tier3-data. Keep that default working.
RUN ln -s /app/tier3-data /tier3-data
LABEL org.opencontainers.image.title="glidepath/logic" \
      org.opencontainers.image.description="Glidepath tier 2: server, worker and migrate" \
      org.opencontainers.image.source="https://github.com/glidepath/glidepath"
# Non-root: the node image's `node` user (uid 1000). Nothing in /app needs to be writable.
USER node
EXPOSE 8080
# docker-compose.yml overrides the command per service.
CMD ["node", "dist/server.js"]
