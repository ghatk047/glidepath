# ADR-023: Manual migrations beyond schema.json

## Context

The spec schema lacks solver progress/cancel state and authentication tables.

## Decision

Add manual migrations for `solver_run` progress and cancel columns and for auth tables `auth_token`, `auth_session` and `passkey`. Each manual migration file names ADR-023 in a header comment. Roles are still created outside migrations (ADR-015).

## Consequences

Generated and manual migrations coexist; regeneration from `schema.json` must not drop them. New tenant tables still need RLS.

## Status

Accepted
