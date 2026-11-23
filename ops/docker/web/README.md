# glidepath/web (OPS-03)

Tier 1 container: Caddy serving the built SPA and proxying tier 2. Nothing else.

| File | Purpose |
|---|---|
| `Dockerfile` | `spa` stage (node, pnpm) builds the static files; runtime is `caddy:<pinned>-alpine`, non-root, with a HEALTHCHECK |
| `build-spa.sh` | Builds `@glidepath/web` when its package.json has a `build` script (Vite, `dist/`); until then serves `placeholder/index.html` |
| `Caddyfile` | `/api/*` and `/ws/*` to `logic:8080`, SPA history fallback, `tls internal`, CSP (no `unsafe-eval`, no external origin) |
| `Dockerfile.dockerignore` | Build context for this image: no tier 2/3 code, docs or secrets |
| `docker-bake.hcl` | Multi-arch (`linux/arm64`, `linux/amd64`) target `web`, tag `glidepath/web:${TAG}` |

```
docker build -f ops/docker/web/Dockerfile -t glidepath/web:dev .          # from the repo root
docker buildx bake -f ops/docker/web/docker-bake.hcl web --print          # multi-arch plan
```

Site address is `PUBLIC_BASE_URL` (default `https://localhost`). Caddy's internal CA lives in the
`caddydata` volume; trust it on the Mac with
`docker compose cp web:/data/caddy/pki/authorities/local/root.crt .` and add it to the keychain.
Public port 80 only redirects to https; the health probe uses a loopback-only listener on
`127.0.0.1:2020` inside the container.

Tests: `ops/test/caddy.spec.ts` (needs `caddy` on PATH, or Docker with the pinned image) and
`ops/test/web-image.spec.ts` (needs `docker buildx`).
