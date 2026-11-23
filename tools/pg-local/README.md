# @glidepath/pg-local

Throwaway Postgres 16 for tests, no Docker needed (ADR-016).

- `pnpm pg:local start [--ssl] [--init <dir>] [--db <name>]` runs initdb + pg_ctl from `PG_BIN` (default `/usr/lib/postgresql/16/bin`) in a temp dir on a free port and prints `DATABASE_URL=...`. `pnpm pg:local stop` stops it and deletes the dir. State is kept in `<tmp>/glidepath-pg-local.json` (override with `PG_LOCAL_STATE`).
- `--init <dir>` runs `*.sql` files (sorted) as the bootstrap superuser `postgres`.
- `--ssl` generates a self-signed cert; the URL ends `?sslmode=require`. node-postgres treats that as verify-full, so use `clientConfig(url)` from this package.
- Running as root: initdb refuses root, so the data dir is chowned to the OS user `postgres` and initdb/pg_ctl run as that user (uid/gid drop). The user must exist.
- `getTestDatabaseUrl()`: `TEST_DATABASE_URL`, else Testcontainers if `TESTCONTAINERS=1` and `docker info` answers (needs `testcontainers` installed; not a dependency), else a pg-local cluster stopped at process exit.
