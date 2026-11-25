# ADR-022: SESSION_IDLE_MIN and AI_MAX_TOKENS_PER_JOB are env settings

## Context

The spec has no `sys.session_idle_min` input and no `ai.max_tokens_per_job` input, yet both values are needed.

## Decision

Both are environment variables (`SESSION_IDLE_MIN`, `AI_MAX_TOKENS_PER_JOB`) documented in `.env.example`, with defaults in the config loader. They are operational limits, not business numbers.

## Consequences

No spec change. Changing them needs a restart. Consistent with 12-factor configuration (ADR-013).

## Status

Accepted
