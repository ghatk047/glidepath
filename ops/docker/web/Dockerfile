# syntax=docker/dockerfile:1
# glidepath/web: Caddy serving the built React SPA and proxying /api and /ws to tier 2.
# Build context is the repo root (docker-compose.yml, docker-bake.hcl in this folder).
# Multi-arch: both stages are multi-platform official images; nothing here is arch specific.

# ------------------------------------------------------------------ spa: build the static files
FROM node:22.23.5-bookworm-slim AS spa
ENV PNPM_HOME=/pnpm CI=true
ENV PATH=$PNPM_HOME:$PATH
# Same pnpm as the repo pin (package.json "packageManager").
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

# Tier 1 only: the web package, the ui package, the contract and the workspace manifests.
# (Dockerfile.dockerignore keeps tier 2 and tier 3 code out of the context altogether.)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY tier1-presentation ./tier1-presentation
COPY contract ./contract
COPY ops/docker/web/build-spa.sh ./ops/docker/web/build-spa.sh
COPY ops/docker/web/placeholder ./ops/docker/web/placeholder
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@glidepath/web..."
RUN sh ops/docker/web/build-spa.sh /out

# ------------------------------------------------------------------ runtime: Caddy
FROM caddy:2.11.9-alpine
# Non-root. caddy keeps cap_net_bind_service on the binary, so it can still bind 80/443.
# /data (certificates, internal CA) is the caddydata volume; /config is Caddy's autosave.
RUN addgroup -S glidepath && adduser -S -G glidepath -H -s /sbin/nologin glidepath \
    && mkdir -p /srv && chown -R glidepath:glidepath /data /config
COPY --from=spa --chown=glidepath:glidepath /out /srv
COPY --chown=glidepath:glidepath ops/docker/web/Caddyfile /etc/caddy/Caddyfile

# The site address comes from the environment (compose passes PUBLIC_BASE_URL).
ENV PUBLIC_BASE_URL=https://localhost
EXPOSE 80 443
USER glidepath

# Loopback listener defined at the bottom of the Caddyfile (public :80 only redirects).
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
    CMD wget -q -O /dev/null http://127.0.0.1:2020/healthz || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
