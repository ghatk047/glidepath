# ADR-002: TypeScript in all tiers (pnpm + Turborepo monorepo)

## Context

Builders are subagents working in parallel; one language and one toolchain reduces friction, and tiers 1 and 2 need shared contract types. The reference engine (`reference/engine.py`) is Python.

## Decision

TypeScript everywhere in a pnpm + Turborepo monorepo. The contract package carries the shared types. Tier 2 may later be re-implemented in another language behind the same contract. Rejected: Python tier 2 (a second toolchain); the Python reference engine stays as the parity oracle.

## Consequences

One toolchain, one lint/typecheck pipeline, shared types with compile-time safety across the API boundary. Python is still needed for the oracle and some tooling scripts.

## Status

Accepted
