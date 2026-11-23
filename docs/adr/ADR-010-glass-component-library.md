# ADR-010: Own glass component library on Radix, Motion, D3 + SVG charts

## Context

The approved UX is bespoke and cannot be met by an off-the-shelf kit.

## Decision

Build our own component library (`ui`) on Radix primitives, with Motion for animation and D3 plus SVG for charts. Tokens only. Rejected: UI kits.

## Consequences

Full control of look and accessibility; more components to build and test. Binding to data is split from presentation (ADR-018).

## Status

Accepted
