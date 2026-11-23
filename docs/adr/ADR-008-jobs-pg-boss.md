# ADR-008: Jobs on Postgres (pg-boss) in the worker container

## Context

Long solvers, Excel work and AI jobs need a queue. The deployment should add no extra infrastructure.

## Decision

Use pg-boss on the existing Postgres, with consumers in the `worker` container. Rejected: Redis.

## Consequences

No extra service. Job state lives in Postgres, so it must work through a transaction pooler; progress is relayed to clients by polling (ADR-024).

## Status

Accepted
