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

## Schemas, prompts and the onboarding checklist (AI-02)

- **Checklist as data:** `src/onboarding/checklist.json` holds the nine steps of spec 07 §2 (title, what to
  produce, research topics, and which seed files, dimensions, registry groups and variables each step fills).
  `ONBOARDING_CHECKLIST`, `ChecklistStepId` (enum from the data), `checklistStepForDim/ForVariable` and
  `renderChecklist()` read it; no step is spelled out in code (test).
- **zod schemas** (`src/schemas/`): `ReconfigPlan` (step 1), `FactBase` (step 2: value, unit, source URL, date,
  confidence H/M/L as in the registry), `TenantSeedDraft` (step 3, assembled: the five `seed/<tenant>/` files in the
  seed's own shape, validated with `parseTenantSeed` from `@glidepath/spec`, plus `provenance` per value),
  `LeverTuningDraft` (step 6, a separate changeset with reasons).
- **Wire format of step 3:** structured outputs accept no maps and no recursion (the SDK silently sends a zod
  record as an empty object), so the model writes one `SeedSectionDraft` per checklist step with lists of
  entries; `assembleSeedDraft(sections, presets)` rebuilds the seed and `splitSeedDraft(seed, registry)` is its
  inverse (worked example, coverage test). Every model-facing schema is checked for closed objects, no maps and
  no recursion.
- **Prompts** (`src/prompts/`): `systemBlocks(step, { workedExample? })` gives the stable, cached prefix (shared
  system prompt with the trust rules, step instructions, rendered checklist, optional worked example).
  `render*Prompt()` builds the per-job prompt: prompt-bar text is quoted as user input in `<prompt_bar>` with
  `& < >` escaped, web-derived JSON is emitted with `<` escaped. Snapshots are plain text in `fixtures/prompts/`.
  Prompts and fixtures use neutral examples only ("Example Air", `ZZ`).

## Configuration

`loadAiConfig(env)`: `ANTHROPIC_API_KEY` (required, secret: never logged or persisted), optional
`ANTHROPIC_BASE_URL`, and the `AI_*` settings above. Errors name variables, never values.

## Tests

No network: `src/testing/fake-transport.ts` replays recorded SSE exchanges from `fixtures/` through the
SDK's `fetch` option and records request bodies; global `fetch` is stubbed to throw.
