# ADR-024: Job updates relayed by polling

## Context

Pushing job progress via LISTEN/NOTIFY needs a session-level connection, which a transaction pooler such as Neon's does not provide.

## Decision

Tier 2 relays job updates to clients by polling job state in Postgres (and pushing over WebSocket from there). No LISTEN/NOTIFY dependency.

## Consequences

Slight latency (poll interval) but pooler-safe and simple. Poll interval is a setting, not a business number.

## Status

Accepted
