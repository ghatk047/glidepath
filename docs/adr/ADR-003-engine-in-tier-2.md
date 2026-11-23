# ADR-003: Engine runs only in tier 2; per-user what-if sessions stay warm

## Context

The live slider needs recalculation on every drag frame without putting logic in the UI. On local Docker the round trip is about 2-5 ms plus evaluation time.

## Decision

The calculation engine runs only in tier 2. Each user's what-if session keeps a compiled engine instance warm in memory. Rejected: running the engine in a browser worker.

## Consequences

Tier 1 stays free of formulas. Sessions hold memory per open scenario and need an idle timeout (see ADR-022). Latency depends on the network path between browser and tier 2.

## Status

Accepted
