# ADR-021: Tier-2 view-models for derived display series

## Context

Some displayed series have no formula node: bridge target outlay, baseline grouping, lever families, the monthly curve and the lever bar scale. Tier 1 may not calculate them.

## Decision

Tier 2 (`domain`, DOM-06) computes these as view-models and exposes them through session view subscriptions (API-12) and the contract. They are derived from engine nodes and registry data, not new business numbers.

## Consequences

Tier 1 stays logic-free. View-models need contract types and tests of their own.

## Status

Accepted
