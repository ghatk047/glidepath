# ADR-005: Port reference/engine.py to a compiled TypeScript evaluator

## Context

The Python reference engine is proven math (245/245 parity cases) and golden results exist as acceptance data. Re-deriving formulas risks drift.

## Decision

Port `reference/engine.py` to a compiled TypeScript evaluator that compiles the formula graph (cached by `members_hash`). Golden results are the acceptance test. Rejected: re-deriving formulas from the spec prose.

## Consequences

The port must match golden results to 1e-6 relative. A parity gate protects downstream work (ADR-020). The Python engine remains as oracle and must be kept in sync with spec changes.

## Status

Accepted
