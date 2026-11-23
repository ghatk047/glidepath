# ADR-009: Tier 1: React 19 + Vite SPA, TanStack Router/Query, Zustand

## Context

The information architecture (IA section 5) needs URL state, server state and local view state in a single-page app.

## Decision

React 19 and Vite SPA; TanStack Router for URL state; TanStack Query for server state (amended by ADR-026: a thin fetch + zustand layer, same hook surface); Zustand for view state. Rejected: Next.js, because server rendering would blur tiers 1 and 2.

## Consequences

A static bundle served by the web container. No server-side rendering. The three state kinds have clear homes.

## Status

Accepted (the server-state line is amended by ADR-026).
