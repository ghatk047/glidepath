# ADR-014: Auth: email magic link + passkey, roles from tenant_membership

## Context

The demo needs simple sign-in that works locally; SSO can follow later.

## Decision

Email magic link (dev mailbox container locally) plus passkey. Roles come from `tenant_membership`. Tier 2 issues session cookies. Rejected: hand-rolled auth.

## Consequences

Auth tables are not in `schema.json` and are added by manual migration (ADR-023). Needs a mail catcher locally and an auth secret in env.

## Status

Accepted
