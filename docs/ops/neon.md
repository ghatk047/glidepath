# Moving Glidepath to Neon

ADR-015: the database is configuration only. Moving from the local Postgres 16 container to Neon changes two URLs and nothing else. `tier2-logic/data-access/test/neon/neon-readiness.spec.ts` proves the same on a TLS-only pg-local cluster with plain roles.

## Create roles in Neon

Neon gives no superuser. Create the two roles in the Neon console (or SQL editor), in the project's database, as the project owner. Migrations never create roles.

```sql
CREATE ROLE glidepath_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '<owner password>';
CREATE ROLE glidepath_app   LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '<app password>';
ALTER DATABASE <database> OWNER TO glidepath_owner;
```

- Use plain `CREATE ROLE`, not the console's default role, which is a member of `neon_superuser` (it can bypass row-level security). `glidepath_app` must not be a member of any privileged role.
- `glidepath_owner` owns the database and every object; it runs migrations and the seed. `glidepath_app` is the runtime role of server and worker; it gets only the grants of `0002_rls.sql`, and RLS always applies to it.
- Generate the passwords yourself; do not reuse the local `.env` values.

## DATABASE_URL (pooled) and DATABASE_URL_MIGRATE (direct)

| Variable | Role | Neon endpoint | Used by |
|---|---|---|---|
| `DATABASE_URL` | `glidepath_app` | pooled (host contains `-pooler`) | server, worker |
| `DATABASE_URL_MIGRATE` | `glidepath_owner` | direct (no `-pooler`) | migrate container |

```
DATABASE_URL=postgresql://glidepath_app:<pw>@ep-xxxx-pooler.<region>.aws.neon.tech/<database>?sslmode=require
DATABASE_URL_MIGRATE=postgresql://glidepath_owner:<pw>@ep-xxxx.<region>.aws.neon.tech/<database>?sslmode=require
```

Set both in `.env` (never committed), and remove the local `db` service from the compose run (`docker compose up -d` with the managed-Postgres lines of `.env.example` uncommented). TLS is chosen by `sslmode` in the URL: `require` = encrypted, certificate not verified by the app's own pools; `verify-full` = verified. Nothing else is configured.

What makes the pooled URL safe (transaction pooling):

- Tenant context is `set_config('app.tenant_id', ..., true)` (= `SET LOCAL`) inside the transaction `withTenant` opens. It is gone at COMMIT or ROLLBACK; no session `SET`, no startup `options`.
- No session advisory locks (only `pg_advisory_xact_lock`), no LISTEN/NOTIFY in request paths.
- Named prepared statements are off (the default). `DB_PREPARED_STATEMENTS=true` is for a direct URL only. `DB_POOL_MAX` sizes each app pool (default 10); keep the sum over server and worker below the pooler's client limit.

## Run the migrate container

The `migrate` compose service runs `node dist/migrate.js --seed aa` with `DATABASE_URL_MIGRATE`: migrations (`tier3-data/migrations`, then `manual/`), the global model definitions, the AA tenant seed through `applyChangeset`, then the pg-boss queue schema with the grants for `glidepath_app`. Idempotent: a rerun writes nothing.

```
docker compose run --rm migrate
```

Run it once after creating the roles and after every release that carries a migration. It needs the direct URL because it takes a transaction-scoped advisory lock and runs DDL. Check: `select count(*) from schema_migration;` as the owner role, and sign in as a seeded user.

## pg-boss connection note

pg-boss (job queue of the worker, schema `JOB_QUEUE_SCHEMA`, default `pgboss`) opens its own `pg` connections from the URL it is given and runs maintenance with advisory locks and its own transactions. Prefer the direct endpoint for it; the pooled endpoint works for the job functions in transaction mode but has not been proven for pg-boss maintenance.

- The queue schema is installed by the migrate container as the owner role (direct URL). The worker never installs it.
- pg-boss hands the URL to node-postgres as is, so `sslmode=require` there means certificate verification (`verify-full`). Neon's certificate is publicly trusted, so this works; a self-signed server (local `pg-local --ssl`) is refused. Use `sslmode=disable` locally or give the worker the CA.
- Do not point other consumers at the pg-boss tables; the app role has DML on that schema only.
