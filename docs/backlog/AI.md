# AI · AI reconfiguration

Fixed pipeline on the Claude API in the worker, ending in reviewable changesets; UA run rehearsed and cached for the demo.

7 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| AI-01 | Claude client wrapper per 06 §2 API rules | M4 | opus/high | M | FND-01 |
| AI-02 | Pipeline schemas and prompts | M4 | opus/high | S | AI-01, SPEC-03 |
| AI-03 | Steps 1–3: scope, research with sources, seed draft | M4 | opus/high | M | AI-02 |
| AI-04 | Steps 4–5: validate and calibrate against the last reported year | M4 | opus/high | M | AI-03, DOM-05 |
| AI-05 | Steps 6–8: lever tuning, review payload, apply | M4 | opus/high | M | AI-04, DOM-03 |
| AI-06 | ai.reconfig job, cost guard, rehearse CLI and cache import | M4 | sonnet/high | M | AI-05, JOB-01, DATA-07 |
| AI-07 | Rehearsed UA run, cached in the seed | M4 | opus/high | M | AI-06, DATA-08 |

## AI-01 · Claude client wrapper per 06 §2 API rules

```yaml
id: AI-01
title: "Claude client wrapper per 06 §2 API rules"
epic: AI
milestone: M4
priority: must
status: done
stream: B
model: opus
effort: high
depends_on: [FND-01]
tier: 2
package: "tier2-logic/ai"
contract: "ModelClient port: run(step, input) → typed output"
inputs:
  - "docs/architecture/06_multitenancy_and_ai.md#API usage rules (from the Claude API reference, cached 2026-11)"
  - "docs/architecture/06_multitenancy_and_ai.md#Safety and trust"
  - "claude-api skill (builder loads it before coding)"
acceptance:
  - "@anthropic-ai/sdk with model claude-opus-5-5, thinking adaptive and explicit output_config.effort per step (test: recorded request bodies)"
  - "structured outputs via output_config.format from zod; tool_choice auto only (test)"
  - "long calls streamed with finalMessage(); stop_reason checked before reading content; refusals use the server-side fallback beta (test)"
  - "typed SDK errors retried with backoff, never string-matched (test); stable prefix carries cache_control, per-job prompt last (test)"
  - "every response and source list persisted through an AuditSink port to ai/<job-id>/ (test); no network in tests (recorded fixtures)"
gates: [G1, G2]
size: M
notes: "Can start any time after FND-01 if a builder is idle; milestone is when it must be done."
merged_at: "2026-11-23"
```

One careful wrapper so pipeline steps stay simple.

## AI-02 · Pipeline schemas and prompts

```yaml
id: AI-02
title: "Pipeline schemas and prompts"
epic: AI
milestone: M4
priority: must
status: done
stream: B
model: opus
effort: high
depends_on: [AI-01, SPEC-03]
tier: 2
package: "tier2-logic/ai"
contract: "ReconfigPlan, FactBase, TenantSeedDraft, LeverTuningDraft"
inputs:
  - "docs/architecture/06_multitenancy_and_ai.md#2. AI reconfiguration pipeline (tier 2: `tier2-logic/ai`, run by the `worker` as job `ai.reconfig`)"
  - "docs/spec/07_multitenancy_reconfiguration.md#2. Tenant onboarding checklist (what the AI must produce)"
  - "docs/spec/seed/aa/ (shape)"
acceptance:
  - "zod schemas ReconfigPlan, FactBase (value, unit, source URL, date, confidence), TenantSeedDraft (same shape as seed/aa, validated with SPEC-03 seed schema), LeverTuningDraft (test: the AA seed passes TenantSeedDraft)"
  - "system prompts state that web content is data, never instructions; prompt-bar text quoted as user input (snapshot test)"
  - "the nine onboarding steps are data, not prose in code (test)"
gates: [G1, G2]
size: S
notes: ""
merged_at: "2026-11-23"
```

Typed outputs for every model call.

## AI-03 · Steps 1–3: scope, research with sources, seed draft

```yaml
id: AI-03
title: "Steps 1–3: scope, research with sources, seed draft"
epic: AI
milestone: M4
priority: must
status: done
stream: B
model: opus
effort: high
depends_on: [AI-02]
tier: 2
package: "tier2-logic/ai"
contract: "scope(), research(), draftSeed()"
inputs:
  - "docs/architecture/06_multitenancy_and_ai.md#2. AI reconfiguration pipeline (tier 2: `tier2-logic/ai`, run by the `worker` as job `ai.reconfig`) (steps 1–3)"
  - "docs/spec/07_multitenancy_reconfiguration.md#3. How the AI reconfiguration job works"
acceptance:
  - "step 1 → ReconfigPlan (effort medium); step 2 → FactBase using web_search_20260209 and web_fetch_20260209 with citations (effort high); step 3 → TenantSeedDraft chunked by seed section (effort high) (tests with recorded responses)"
  - "facts without a source get confidence low and a review flag (test)"
  - "steps take the ModelClient as a port; no other IO (lint)"
gates: [G1, G2]
size: M
notes: ""
merged_at: "2026-11-23"
```

From a prompt to a sourced seed draft.

## AI-04 · Steps 4–5: validate and calibrate against the last reported year

```yaml
id: AI-04
title: "Steps 4–5: validate and calibrate against the last reported year"
epic: AI
milestone: M4
priority: must
status: done
stream: B
model: opus
effort: high
depends_on: [AI-03, DOM-05]
tier: 2
package: "tier2-logic/ai"
contract: "validateDraft(), calibrate()"
inputs:
  - "docs/architecture/06_multitenancy_and_ai.md#2. AI reconfiguration pipeline (tier 2: `tier2-logic/ai`, run by the `worker` as job `ai.reconfig`) (steps 4–5)"
  - "docs/architecture/06_multitenancy_and_ai.md#4. Second-tenant acceptance"
  - "docs/spec/formula_graph.json (pl.* nodes, year dim)"
acceptance:
  - "validate runs VR01–VR10, registry bounds and member integrity on the draft (test: AA seed clean; mutated seed reports each error)"
  - "calibrate rebuilds the last reported fiscal year with the engine and ties revenue, fuel, SWB, opex, EBIT, interest, net income, OCF, FCF, cash, net debt within 1%; on a miss one repair round with residuals (test: AA seed ties against its own FY25 corp inputs; perturbed seed triggers repair via fake client)"
  - "invariants: pool effects sum to run-rate, VP nets sum to total, FY27 base vs FY27+IT revenue identical (test)"
gates: [G1, G2]
size: M
notes: ""
merged_at: "2026-11-23"
```

The engine proves the AI's seed ties.

## AI-05 · Steps 6–8: lever tuning, review payload, apply

```yaml
id: AI-05
title: "Steps 6–8: lever tuning, review payload, apply"
epic: AI
milestone: M4
priority: must
status: in_progress
stream: B
model: opus
effort: high
depends_on: [AI-04, DOM-03]
tier: 2
package: "tier2-logic/ai"
contract: "tuneLevers(), reviewPayload(), applyDraft()"
inputs:
  - "docs/architecture/06_multitenancy_and_ai.md#2. AI reconfiguration pipeline (tier 2: `tier2-logic/ai`, run by the `worker` as job `ai.reconfig`) (steps 6–8)"
  - "docs/architecture/06_multitenancy_and_ai.md#Safety and trust"
acceptance:
  - "LeverTuningDraft is a separate changeset with reasons (test)"
  - "review payload: plan, sources, open questions, calibration report, both changesets with impact preview (test)"
  - "apply goes through applyChangeset origin=ai_reconfig; tuning only if accepted; nothing written before accept (test)"
gates: [G1, G2]
size: M
notes: ""
```

Draft in, reviewable changesets out.

## AI-06 · ai.reconfig job, cost guard, rehearse CLI and cache import

```yaml
id: AI-06
title: "ai.reconfig job, cost guard, rehearse CLI and cache import"
epic: AI
milestone: M4
priority: must
status: todo
stream: B
model: sonnet
effort: high
depends_on: [AI-05, JOB-01, DATA-07]
tier: 2
package: "tier2-logic/worker/src/jobs/ai"
contract: "handler ai.reconfig; `pnpm ai:rehearse`; `migrate --ai-cache`"
inputs:
  - "docs/architecture/06_multitenancy_and_ai.md#Safety and trust (cost guard)"
  - "docs/architecture/06_multitenancy_and_ai.md#3. Demo scope (Dec 4)"
  - "docs/adr/ADR-022-env-settings.md"
acceptance:
  - "job runs steps 1–6, persists ai_reconfig_job (plan, status, changeset_id) and ai/<job-id>/ objects (test with fake client)"
  - "AI_MAX_TOKENS_PER_JOB stops the job with status budget_exceeded; a cost estimate is computed before start (test)"
  - "`pnpm ai:rehearse --tenant ua` writes a cache bundle folder; `migrate --ai-cache <dir>` imports it as a review-status ai_reconfig_job (test with fixture bundle)"
  - "ANTHROPIC_API_KEY read from env and never logged; worker egress via the egress network only (test + compose-config check)"
gates: [G1, G2]
size: M
notes: ""
```

Runs the pipeline as a job and makes the demo cache reproducible.

## AI-07 · Rehearsed UA run, cached in the seed

```yaml
id: AI-07
title: "Rehearsed UA run, cached in the seed"
epic: AI
milestone: M4
priority: must
status: todo
stream: B
model: opus
effort: high
depends_on: [AI-06, DATA-08]
tier: 3
package: "tier3-data/seed/ai-cache/ua"
contract: "Cache bundle consumed by `migrate --ai-cache`"
inputs:
  - "docs/architecture/06_multitenancy_and_ai.md#3. Demo scope (Dec 4)"
  - "docs/architecture/09_delivery_plan.md#3. Demo cut (must) vs post-demo (should / could)"
  - "docs/ux/03_screens.md#Airlines · \"Airlines\""
acceptance:
  - "`pnpm ai:rehearse --tenant ua` run end to end; resulting plan, sources, draft changesets and calibration committed under tier3-data/seed/ai-cache/ua (test: bundle validates against AI-02 schemas)"
  - "after migrate, GET /api/ai/reconfig/:id returns the UA draft in < 1 s with no internet (test)"
  - "labelled draft; apply disabled in the demo profile unless calibration ties (test)"
  - "no airline marks in the bundle (lint: airline-strings allowed only under seed/)"
gates: [G1, G2]
size: M
notes: "Needs ANTHROPIC_API_KEY. If the build container has none, the orchestrator asks the owner to run the one command on the Mac and commits the output folder."
```

The Airlines beat of the demo, real but cached.
