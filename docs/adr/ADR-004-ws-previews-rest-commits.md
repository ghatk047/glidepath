# ADR-004: Previews over WebSocket, commits over REST

## Context

Dragging a slider produces many intermediate values; writing each to the database or issuing a REST call per frame is wasteful and slow.

## Decision

Drag sends coalesced `preview` messages over WebSocket (latest value wins, at most 30 per second). Release or typed edit commits a changeset over REST (`POST /changesets`). Previews never write to the database. Rejected: REST per frame.

## Consequences

Smooth drag at 60 fps with cheap previews. Two transports to secure and test. Deltas are pushed only for cells the screen subscribes to.

## Status

Accepted
