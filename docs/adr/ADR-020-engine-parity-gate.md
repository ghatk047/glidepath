# ADR-020: Engine parity gate

## Context

Everything that displays or stores numbers depends on the engine being right.

## Decision

Golden 760/760 and parity replay 245/245 must be green (ENG-06) before any DOM, SOL or API item that consumes engine numbers starts. All ENG items are opus/xhigh.

## Consequences

Numbers-dependent work is blocked until the gate merges green, which can delay downstream streams; that is accepted to avoid rework.

## Status

Accepted
