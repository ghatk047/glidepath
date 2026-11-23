# ADR-019: Domain ports

## Context

`domain` must be pure (no IO) but `applyChangeset()` has to read and write state.

## Decision

`applyChangeset` runs over a `ChangesetStore` port defined in `domain` and implemented in `data-access`. Domain depends only on the interface.

## Consequences

Domain is unit-tested with an in-memory store. `data-access` owns transactions and `SET LOCAL` tenant context (ADR-015).

## Status

Accepted
