# ADR-018: Tier-1 binding split

## Context

UI components must be reusable and testable, while rule 8 requires binding to node and variable ids.

## Decision

`ui` is presentational: props only, no data hooks. `web` owns `useNode` / `useVariable` and the bound wrappers that feed values pushed by tier 2 into `ui` components.

## Consequences

`ui` can be tested and shown in isolation. Each component needs a thin bound wrapper in `web`.

## Status

Accepted
