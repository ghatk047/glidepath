# ADR-017: Package scope may be a sub-folder

## Context

Several builders run in parallel; whole-package scopes would serialise work that touches different areas of the same package.

## Decision

The `package` field of a backlog item may be a sub-folder, for example `web/src/modules/x` or `server/src/routes/x`. Items whose package paths overlap by prefix are serialised; disjoint paths run in parallel.

## Consequences

More parallelism. Planning must check prefix overlap. Shared files at a package root need their own item.

## Status

Accepted
