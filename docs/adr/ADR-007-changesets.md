# ADR-007: Every write is a changeset via applyChangeset()

## Context

UI edits, Excel import, solver results, AI drafts and seed data all change inputs. Separate write paths would validate differently.

## Decision

Every write goes through `applyChangeset()` in `tier2-logic/domain`: validation (VR01-VR10, bounds), one transaction, version bump, stored `calc_run`. Rejected: per-feature writes.

## Consequences

One audited path with one set of validations. Domain must stay pure, so storage is accessed through a port (ADR-019).

## Status

Accepted
