# 11 · Docker deployment (Mac now, any cloud later)

The first environment is Docker on the user's Mac. Everything is defined in one `docker-compose.yml` so the same stack moves to a Linux VM or a managed container service later without code changes.

## 1. Containers

| Service | Tier | Image | Networks | Ports (host) | Notes |
|---|---|---|---|---|---|
| `web` | 1 | `glidepath/web` (Caddy + built SPA) | edge | `80`, `443` | Serves SPA; proxies `/api/*` and `/ws/*` to `logic:8080`; local TLS via Caddy internal CA |
| `logic` | 2 | `glidepath/logic` | edge, data | none | REST + WS API, what-if sessions, auth; healthcheck `/healthz` |
| `worker` | 2 | `glidepath/logic` (command `worker`) | data (+ outbound internet for AI) | none | pg-boss jobs: solvers, Excel, AI |
| `migrate` | 2 | `glidepath/logic` (command `migrate && seed`) | data | none | One-shot; runs before `logic` and `worker` start |
| `db` | 3 | `postgres:16` | data | none (dev profile exposes `5432` on 127.0.0.1 for debugging) | Volume `pgdata`; roles `glidepath_owner`, `glidepath_app` |
| `objects` | 3 | `minio/minio` | data | none (dev profile exposes console on 127.0.0.1) | Volume `objdata`; buckets created by `migrate` |
| `mail` | dev only | `axllent/mailpit` | edge | `8025` on 127.0.0.1 | Catches magic-link emails locally |

Networks: `edge` (web ↔ logic) and `data` (`internal: true`; logic, worker, migrate ↔ db, objects). `web` is not attached to `data`, so tier 1 cannot reach tier 3.

Pin every image by version (and digest in the demo profile). Pin exact versions when the repo is scaffolded.

## 2. Compose sketch

```yaml
name: glidepath
networks:
  edge: {}
  data: { internal: true }
  egress: {}   # outbound only, used by worker for the Claude API and by logic for the Cloudflare Access keys (OPS-09)
volumes: { pgdata: {}, objdata: {} }
services:
  db:
    image: postgres:16
    env_file: .env
    volumes: [pgdata:/var/lib/postgresql/data, ./tier3-data/postgres/init:/docker-entrypoint-initdb.d:ro]
    networks: [data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"], interval: 5s }
  objects:
    image: minio/minio
    command: server /data
    env_file: .env
    volumes: [objdata:/data]
    networks: [data]
  migrate:
    image: glidepath/logic:${TAG:-dev}
    command: ["node", "dist/migrate.js", "--seed", "aa"]
    env_file: .env
    networks: [data]
    depends_on: { db: { condition: service_healthy } }
  logic:
    image: glidepath/logic:${TAG:-dev}
    command: ["node", "dist/server.js"]
    env_file: .env
    networks: [edge, data]
    depends_on: { migrate: { condition: service_completed_successfully } }
    healthcheck: { test: ["CMD", "wget", "-qO-", "http://localhost:8080/healthz"], interval: 10s }
  worker:
    image: glidepath/logic:${TAG:-dev}
    command: ["node", "dist/worker.js"]
    env_file: .env
    networks: [data, egress]
    depends_on: { migrate: { condition: service_completed_successfully } }
  web:
    image: glidepath/web:${TAG:-dev}
    ports: ["80:80", "443:443"]
    networks: [edge]
    depends_on: { logic: { condition: service_healthy } }
```
(The scaffold item adds the dev override with bind mounts and hot reload, and the `demo` profile with digests.)

## 3. On the Mac

- Requires Docker Desktop (Apple Silicon or Intel), 4 CPUs and 8 GB RAM assigned to Docker.
- First run: `cp .env.example .env` → fill secrets → `docker compose up -d` → open `https://localhost`. Seeded AA tenant and a demo user are ready in under 3 minutes.
- Daily dev: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` (web on Vite dev server, logic with `tsx watch`).
- Backups: `ops/backup.sh` runs `pg_dump` and mirrors MinIO buckets to `./backups/<timestamp>`; `ops/restore.sh` restores. Run before the demo freeze.
- Showing it to others before a cloud host exists (optional): a tunnel such as Tailscale or Cloudflare Tunnel in front of `web` only. Tiers 2 and 3 stay private.

## 4. Configuration (12-factor)

All settings are environment variables listed in `.env.example`: database URLs (owner and app roles), S3 endpoint and keys, auth secret, public base URL, Anthropic API key, log level, session idle minutes, job concurrency. No setting is baked into an image. Business numbers are not configuration; they live in tier 3.

## 5. Moving to a cloud server later

| Target | What changes |
|---|---|
| Any Linux VM (AWS EC2, Azure VM, GCP, Hetzner…) | Install Docker, copy compose + `.env`, `docker compose --profile demo up -d`; point a DNS name at it; Caddy gets a public certificate automatically |
| Managed containers (ECS/Fargate, Azure Container Apps, Cloud Run + VM for WS) | Same images; `db` → managed Postgres (RDS, Azure Database, Cloud SQL), `objects` → S3/Blob/GCS; only env vars change |
| Kubernetes | Same images; a Helm chart mirrors the compose services and networks (NetworkPolicies replace Docker networks) |

Images are built multi-arch (`docker buildx bake`, `linux/arm64` + `linux/amd64`) and pushed to GitHub Container Registry from CI, so the Mac and an x86 cloud host run the same tags.
