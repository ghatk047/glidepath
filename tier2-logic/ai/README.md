# @glidepath/ai

Reconfiguration pipeline, prompts, schemas (06 §2). Runs in the worker as job `ai.reconfig`.

## ModelClient (AI-01)

The port every pipeline step uses: `run(step, input) → StepRun<O>` (`output` is the zod-typed result).
`createClaudeModelClient({ jobId, config, audit })` implements it on `@anthropic-ai/sdk`, following the
06 §2 API usage rules:

- model from config (`AI_MODEL`, default `claude-opus-5-5`; `AI_MODEL_LIGHT`, default `claude-sonnet-5-5`);
  `thinking: {type: "adaptive"}`; `output_config.effort` set by every step.
- `output_config.format` built from the step's zod schema; replies validated with the same schema.
  Only server tools (web search / fetch), so `tool_choice` is `auto` or absent.
- every call streamed and collected with `finalMessage()`; `stop_reason` checked before any content is
  read (`refusal`, `max_tokens`, `pause_turn` resumed up to `AI_MAX_PAUSE_TURNS`).
- refusals: beta `server-side-fallback-2026-07-01` with `fallbacks: "default"`.
- retries on typed SDK errors only (429, 408, 409, 5xx except 501, connection errors) with exponential
  backoff and `retry-after` (`AI_RETRY_ATTEMPTS`, `AI_RETRY_BASE_MS`, `AI_RETRY_MAX_MS`); the SDK's own
  retries are off.
- stable prefix (`step.system`) first with `cache_control` on its last block; per-job prompt last.
- every response and the step's source list go to the `AuditSink` port as `ai/<job-id>/<seq>-<step>-*.json`.
  `AuditSink.put` matches `ObjectStore.put` (ADR-025), so the worker passes its object store in.

## Configuration

`loadAiConfig(env)`: `ANTHROPIC_API_KEY` (required, secret: never logged or persisted), optional
`ANTHROPIC_BASE_URL`, and the `AI_*` settings above. Errors name variables, never values.

## Tests

No network: `src/testing/fake-transport.ts` replays recorded SSE exchanges from `fixtures/` through the
SDK's `fetch` option and records request bodies; global `fetch` is stubbed to throw.
