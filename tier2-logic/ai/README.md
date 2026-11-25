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

## Pipeline steps 1–3 (AI-03)

`src/steps/`: each step takes the `ModelClient` port and its input, and returns `StepResult<O>` =
`{ output, review: ReviewFlag[], calls: StepCall[] }` (`calls` keep sources, model, fallback, usage and audit keys).
No other IO: `eslint.config.js` bans Node builtins, IO packages and globals, dynamic import, value imports of the
SDK and this package's client/audit/config/retry/testing modules in `src/steps` (lint test).

- `scope(client, ScopePromptInput)` → `ReconfigPlan`, effort `medium`, no tools. Flags an onboarding plan that
  leaves out checklist steps.
- `research(client, ResearchPromptInput, { maxSearches?, maxFetches?, maxContentTokens? })` → `FactBase`, effort
  `high`, `web_search_20260209` + `web_fetch_20260209`. Document citations on web fetch are off (the API rejects them
  with `output_config.format`); citations come from web search. `checkFactSources` then sets confidence `L` and a
  review flag on every fact with no source (`unsourced`) or citing a page the model never searched, fetched or cited
  (`source_not_seen`).
- `draftSeed(client, { promptBar, plan, facts, bundle, presets, workedExample? })` → `TenantSeedDraft`, effort
  `high`, one `SeedSectionDraft` call per checklist step with `seed.from = "facts"` (checklist order, sequential so
  the shared prefix cache is reused). Steps with `seed.from = "presets"` are copied from `presets`
  (`presetsFromSeed(referenceSeedJson, registry)` builds them; scenarios get the new tenant id). Each section is
  checked: a wrong section, tenant record or foreign dimension/variable rejects the reply (`ModelOutputError`);
  unsourced values become `L` + flag, unknown fact ids are dropped + flagged, left-out variables are flagged.

## Pipeline steps 4–5 (AI-04)

No model call unless calibration misses. Data in `src/calibration/calibration.json` (`CALIBRATION`): the eleven
metrics with the node each ties to (`pl.rev`, `pl.fuel`, `pl.swb`, `pl.opex`, `pl.ebit`, `pl.int_exp`, `pl.ni`, `pl.ocf`,
`pl.fcf`, `pl.cash_close`, `pl.net_debt`) and the fact labels that name them, the tolerance (1%), one repair round, the
repairable registry layers (`corporate`), units, the invariants of 06 §4 and the member references checked.

- `validateDraft(draft, bundle)` → `ValidationReport { ok, entries }` (step 4). Member integrity first (dimensions known
  and non-empty, every value and pin of the defaults and each scenario on a registry id with a valid member key,
  member references such as `year.prev`, `line.addr`, `lever.alloc_key`), then the domain's input rules VR01–VR10 on the
  tenant defaults and on each scenario, and VR05/VR08 on an engine evaluation of each. VR04 (registry bounds) follows
  `BOUNDS_POLICY`: an error for a drafted value (`ai_reconfig` rejects), a warning for one copied from the global
  presets (`seed`). Identical entries of several states are merged with their `scopes` (null = tenant defaults).
- `targetsFromFacts(factBase, lastReportedYear)` → `CalibrationTarget[]`: per metric, a numeric fact of that year whose
  normalised label is one of the metric's aliases (first alias wins, then confidence), converted to $M.
- `calibrate(client, { draft, bundle, targets, facts?, promptBar? })` → `StepResult<{ draft, report, validation,
  openQuestions }>` (step 5). The engine rebuilds the last reported year (the `year` member with an empty `prev`) on the
  tenant defaults and compares each metric. On a miss: one `calibration-repair` call (effort `high`, structured output
  `CalibrationRepair`) with the residuals and the repairable inputs; changes to other variables or member keys are
  dropped (`repair_dropped` flag); the repaired copy is validated again and rebuilt. `report.tied` needs every metric
  tied and every invariant holding; misses and broken invariants become review flags.
- `checkInvariants(draft, bundle)`: `lev.rr_check` = 0, `vp.check` = 0, and `pl.rev` equal across year columns of the
  same input year (FY27 base vs FY27 + IT), on the defaults and every scenario.

## Pipeline steps 6–8 (AI-05)

Data in `src/pipeline/pipeline.json` (`REVIEW_CONFIG`): the registry layers lever tuning may change (`levers`) and the
checklist step its flags belong to, the impact nodes (`base.total`, `res.net`, `res.gap`, `br.eps27`), the draft titles.

- `tuneLevers(client, { promptBar, plan, facts, seed, bundle })` → `StepResult<LeverTuningDraft>` (step 6, effort `high`,
  structured output, no tools). The prompt lists every lever input the seed sets with its value as the library default.
  `checkLeverTuning` drops (flag `tuning_dropped`) changes to non-lever variables, unknown member keys or scenarios, and
  values outside the registry bounds; unknown fact ids are removed (`unknown_fact`), a change on no fact gets `L`.
- Changesets: `seedChangeset(seed, bundle)` gives, in apply order, the tenant defaults drafted by the AI (members, lines
  and values, origin `ai_reconfig`, values noted with their source), the tenant defaults step 3 copied from the global
  presets (the lever library, origin `seed`), then one per preset scenario (origin `seed`). `leverTuningChangeset(tuning)`
  is the separate tuning changeset: one part per scope, origin `ai_reconfig`, each change noted with its reason.
- `reviewPayload(input)` → `ReconfigReview` (step 7, pure, JSON): plan, sources (every page a call saw plus fact URLs),
  facts, open questions (plan, research gaps, calibration, tuning; never blocking), review flags, validation, the
  calibration report, the tenant plan (record, presets, line-lever links) and both drafts with change counts per
  checklist step, their validation entries and an impact preview per state (seed against nothing, tuning against the seed).
- `applyDraft(port, review, { accept, actor, bundle, ... })` (step 8): the only write. Checks the accept first (nothing
  accepted, a draft the job lacks, tuning a new tenant without its seed, a seed that fails validation:
  `ReconfigApplyError`, the port is not called). Then, in one `port.inTenant` transaction: create the tenant (seed), the
  presets unlocked, every seed changeset through `applyChangeset`, the line-lever links, the tuning changesets only when
  accepted, then lock the presets. On an existing tenant a tuned locked preset forks, as any edit does. A rejected
  changeset rolls the whole apply back.
- Why two origins: `BOUNDS_POLICY.ai_reconfig` rejects values past a registry bound and only `seed` writes a locked
  preset in place; the global presets hold values past a bound (as step 4 reports them, warnings), so the parts copied
  unchanged from them are written as the seed loader writes them for every tenant. Everything the AI drafted is `ai_reconfig`.

## Configuration

`loadAiConfig(env)`: `ANTHROPIC_API_KEY` (required, secret: never logged or persisted), optional
`ANTHROPIC_BASE_URL`, and the `AI_*` settings above. Errors name variables, never values.

## Tests

No network: `src/testing/fake-transport.ts` replays recorded SSE exchanges from `fixtures/` through the
SDK's `fetch` option and records request bodies; global `fetch` is stubbed to throw.
