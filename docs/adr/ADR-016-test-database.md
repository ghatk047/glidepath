# ADR-016: Test database strategy

## Context

Builders run in a container that may have no Docker daemon but has PostgreSQL 16 binaries in `/usr/lib/postgresql/16/bin`.

## Decision

Every DB test uses `TEST_DATABASE_URL` if set; otherwise a throwaway cluster from `tools/pg-local` (initdb/pg_ctl, `pnpm pg:local start [--ssl]`); otherwise Testcontainers, only when `TESTCONTAINERS=1` and a daemon answers (optional).

## Consequences

Tests run without Docker. `pnpm pg:local start --ssl` gives an `sslmode=require` URL for portability checks. CI can point `TEST_DATABASE_URL` at a service container.

## Status

Accepted
