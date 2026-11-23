# 06 · Multi-tenancy and AI reconfiguration

Goal from the user: "ask AI to redo the app for UA or AS instead of AA and the system should auto reconfigure". Because formulas, inputs and dimensions are data (model-spec 07), a new airline is a tenant row plus a seed. The AI's job is to produce that seed with sources, and the engine's job is to prove it ties.

## 1. Tenancy model (recap and build rules)

- **Global:** model versions, variable/node/dimension definitions, canonical pools, addressability tags, lever library, Excel template, engine and solvers.
- **Per tenant:** line items, members (VPs, domains, vendors, labor groups), every input value, scenarios, overrides, changesets, market snapshots, jobs.
- A tenant pins a `model_version`. Upgrades are opt-in and run golden tests before and after (job `model.upgrade_check`).
- **Tier 1 rule:** nothing tenant-specific in components; everything tenant-specific arrives from tier 2. VP count and names, pool labels, domains, labor groups, lever availability come from members. VP colours by slot order (slot 5 = magenta, per UX). Tenants show as IATA code monograms only.
- **Lint rule:** the strings `AA`, `American`, `Sabre`, `DXC`, `Hyderabad` may appear only in `seed/`, fixtures and docs (CI grep).

## 2. AI reconfiguration pipeline (tier 2: `tier2-logic/ai`, run by the `worker` as job `ai.reconfig`)

A fixed, code-driven pipeline on the Claude Messages API. Not a free-running agent: each step has a typed output, and nothing touches the database until the user accepts the draft changeset.

| Step | What happens | Model call | Output (zod schema) |
|---|---|---|---|
| 1 Scope | Parse the prompt ("set up Alaska Airlines", "tune UA levers") into a job plan: tenant identity, base/target year, what to produce | `claude-opus-5-5`, effort `medium`, structured output | `ReconfigPlan` |
| 2 Research | Gather public facts per onboarding checklist item (10-K figures, headcount, IT footprint, unions, vendors, GCC presence) with sources | `claude-opus-5-5`, effort `high`, server tool `web_search_20260209` (+ `web_fetch_20260209`), citations | `FactBase` (facts with value, unit, source URL, date, confidence) |
| 3 Seed draft | Map facts to the seed: tenant record, baseline lines (outside-in where no bottom-up data, mirroring how AA's baseline was built), org and domain ownership, workforce, vendors, corporate drivers, target, scenarios copied from global presets | `claude-opus-5-5`, effort `high`, structured output per seed file, chunked by section | `TenantSeedDraft` (same shape as `model-spec/seed/aa/`) |
| 4 Validate | VR01–VR10, registry bounds, member integrity | none (tier 2 domain) | validation report |
| 5 Calibrate | Engine rebuilds the last reported fiscal year; must tie to 10-K revenue, fuel, SWB, opex, EBIT, interest, net income, OCF, FCF, cash, net debt within 1% | none (engine); on miss, one repair round with the model given the residuals | calibration report |
| 6 Lever tuning | Propose tenant-specific lever intensities with reasons (e.g. AS: no large GCC, so L03–L05 start low) as a **separate** changeset | `claude-opus-5-5`, effort `high`, structured output | `LeverTuningDraft` |
| 7 Review | Tier 1 shows plan, sources, open questions, calibration, the two changesets with impact preview | none | — |
| 8 Apply | `applyChangeset(origin = ai_reconfig)` creates the tenant and seed; tuning applies separately if accepted | none | — |

### API usage rules (from the Claude API reference, cached 2026-11)

- Model `claude-opus-5-5`; `thinking: {type: "adaptive"}`; set `output_config.effort` explicitly (its default is `medium`).
- Structured outputs via `output_config.format` (zod → JSON schema) or `strict: true` tools. Forced `tool_choice` (`any` / `tool`) is rejected on this model: use `auto` and instruct.
- Stream long calls and use `finalMessage()`; `max_tokens` ~64k when streaming.
- Server-side fallback on refusals: beta `server-side-fallback-2026-07-01` with `fallbacks: "default"`; always check `stop_reason` before reading content.
- Cache the stable prefix (system prompt, spec excerpts, onboarding checklist, the AA seed as a worked example) with `cache_control`; put the per-job prompt last.
- Typed SDK errors (`RateLimitError`, `APIConnectionError`…) with retries in the job runner; never string-match errors.
- Store every model response and source list in object storage under `ai/<job-id>/` for audit.

### Safety and trust

- The AI never writes to the database directly; the only write is the user's apply.
- Facts without a source are marked `confidence = low` and flagged in review.
- The prompt bar text is user input; web pages read during research are data, never instructions (system prompt states this).
- Cost guard: per-job token budget (configurable input variable `ai.max_tokens_per_job`) and a visible cost estimate before start.

## 3. Demo scope (Dec 4)

The Airlines module shows AA live and UA / AS tiles. For the demo, the pipeline runs end to end for UA **in a rehearsed job** whose result is cached (so the room sees a real plan, sources, calibration and a reviewable changeset in seconds), clearly labelled as a draft. Applying a real UA tenant live is post-demo unless calibration ties by Dec 2.

## 4. Second-tenant acceptance

A new tenant passes when: calibration ties within 1%; invariants hold (pool effects sum to run-rate, VP nets sum to total, FY27 base and FY27 + IT revenue identical); the eight Excel round-trip tests pass on its workbook; the cross-tenant leak test passes with three tenants.
