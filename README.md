# Glidepath

Multi-tenant what-if app for airline IT cost reduction (AA first tenant). Strict three-tier: React SPA (tier 1), TypeScript logic service + worker (tier 2), Postgres 16 (tier 3).

- Repo guide: `CLAUDE.md`
- Architecture: `docs/architecture/README.md`
- Backlog: `docs/backlog/`
- Run: see "Running locally" below.

## Running locally

Needs Docker Desktop (Apple Silicon or Intel) with 4 CPUs and 8 GB RAM for Docker. Everything runs from `docker-compose.yml`; settings come only from `.env`.

1. Copy the settings and fill the empty secrets:

   ```sh
   cp .env.example .env
   # generate every empty secret (letters and digits only: they go into the DB URLs)
   perl -pi -e 's{^(POSTGRES_PASSWORD|OWNER_DB_PASSWORD|APP_DB_PASSWORD|AUTH_SECRET)=$}{my $r = qx(openssl rand -hex 24); chomp $r; "$1=$r"}e' .env
   ```

   Add `ANTHROPIC_API_KEY` if you want AI reconfiguration. Every other setting has a working default.

2. Start the stack:

   ```sh
   docker compose up -d
   ```

   `migrate` creates the schema and loads the AA seed, then `logic`, `worker` and `web` start. `docker compose ps` shows progress, and `docker compose logs -f logic` shows the API log.

3. Open https://localhost. Caddy serves it with its own local certificate authority, so the browser warns until you trust that CA once:

   ```sh
   docker compose cp web:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ./caddy-root.crt
   ```

   Magic-link emails land in mailpit at http://localhost:8025. Mailpit is in the `dev` profile, which `COMPOSE_PROFILES=dev` in `.env` turns on.

Stop with `docker compose down`. Your data stays in the `pgdata` volume. `docker compose down -v` also deletes the data, so the next `up` seeds from scratch.

What runs where: `web` (tier 1) is only on the `edge` network. `db` (tier 3) is only on the internal `data` network. `logic` joins both, and `worker` joins `data` and `egress` (for the Claude API). Only `web` (80/443) and mailpit (8025) publish ports. Both bind to 127.0.0.1, and `WEB_BIND_ADDRESS` changes this for web.

### Using Neon (or another managed Postgres) instead of the local db

Tier 2 reads the database only from `DATABASE_URL` and `DATABASE_URL_MIGRATE`, and TLS comes from the URL. To switch:

1. Create the roles `glidepath_owner` and `glidepath_app` in Neon.
2. In `.env`, set `DATABASE_URL=postgresql://glidepath_app:<password>@<pooled-host>/glidepath?sslmode=require` and `DATABASE_URL_MIGRATE=postgresql://glidepath_owner:<password>@<direct-host>/glidepath?sslmode=require`.
3. Start with the Neon override. It leaves out the `db` container and lets `migrate` reach the internet:

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.neon.yml up -d
   ```

   Or uncomment `COMPOSE_FILE=docker-compose.yml:docker-compose.neon.yml` in `.env` and keep using plain `docker compose up -d`. `POSTGRES_PASSWORD`, `OWNER_DB_PASSWORD` and `APP_DB_PASSWORD` are then unused.
