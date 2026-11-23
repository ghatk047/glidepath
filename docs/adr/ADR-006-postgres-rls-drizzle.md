# ADR-006: Postgres 16 + RLS, Drizzle, migrations generated from schema.json

## Context

The spec defines tables, views and row-level security for a multi-tenant product.

## Decision

PostgreSQL 16 with RLS on every tenant table, Drizzle as the query layer, and migrations generated from `schema.json`. The app role never bypasses RLS. Rejected: hand-written schema.

## Consequences

The schema stays in step with the spec. Items that need objects beyond `schema.json` use manual migrations (ADR-023). Tenant isolation is tested by leak tests.

## Status

Accepted
