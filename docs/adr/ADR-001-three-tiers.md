# ADR-001: Strict three tiers

## Context

The product owner requires presentation, business logic and data to be separate tiers (architecture overview section 1). Business logic must stay testable, swappable and reusable, for example by a future Excel add-in or other API clients that use the same tier 2. Alternatives considered: logic in the browser (v1.0 of the plan) and a two-tier UI plus database.

## Decision

Three tiers: tier 1 presentation (`tier1-presentation/`), tier 2 business logic (`tier2-logic/`), tier 3 data (`tier3-data/`). Tier 1 imports only `contract` and `ui`; only `data-access` touches tier 3. The separation is enforced by Docker networks and by build rules (`pnpm tier-check`). Rejected: logic in the browser; two-tier UI + DB.

## Consequences

Every number shown in tier 1 comes from tier 2. Tier 2 can be reused by other clients and re-implemented behind the same contract. Cost: an extra network hop and a contract package to maintain. Import-boundary violations fail CI.

## Status

Accepted
