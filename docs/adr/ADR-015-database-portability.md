# ADR-015: Database portability

## Context

The owner runs local PostgreSQL 16 in Docker Compose now and will move to Neon later. Neon uses a transaction pooler and TLS and does not give superuser rights.

## Decision

The database connection is configuration only. `DATABASE_URL` uses the app role `glidepath_app`; `DATABASE_URL_MIGRATE` uses the owner role `glidepath_owner`. TLS is chosen from the URL (`sslmode=require` must work). No superuser-only features at runtime or in migrations; roles are created outside migrations. Tenant context is set with `SET LOCAL` inside transactions only (never session-level `SET`), so a transaction pooler works. Local Postgres 16 now, Neon later.

## Consequences

Moving to Neon changes URLs only. Code must not use session state, advisory locks across transactions, or LISTEN/NOTIFY (ADR-024). Verified by DATA-09 (Neon readiness). Affects DATA-01, DATA-02, DATA-04, OPS-01, OPS-07.

## Status

Accepted
