# AI reconfig and market refresh routes (API-11)

`registerAiRoutes(app, ctx)` mounts the AI half of 04 section 3 on `/api/ai/*`; `registerMarketRoutes(app, { specBundle })` mounts `POST /api/t/:tenant/market/refresh` on the tenant mount (tenant middleware and the owner/editor write guard apply). `createApp({ ai })` wires the first (absent = not mounted); the market route is always mounted. The API-02 guards (same origin, CSRF) run on all `/api/*`.

| Route | Answer (`@glidepath/api-contract`) |
|---|---|
| `POST /api/ai/reconfig` | 201 `ReconfigJob`: id and `costEstimate`; `dryRun` runs step 1 only and answers `estimated` with plan and estimate |
| `GET /api/ai/reconfig` | `ReconfigList` (API-14): `jobs` of every tenant the caller belongs to, newest first, and `parity` per tenant |
| `GET /api/ai/reconfig/:id` | `ReconfigJob`: plan, sources, facts, draft summaries, validation, calibration, open questions, usage, error |
| `POST /api/ai/reconfig/:id/apply` | `ReconfigApplyResult`; owner only; 403, 404, 409 (not in review), 422 (no such draft, new tenant without seed, blocking question) |
| `POST /api/t/:tenant/market/refresh` | 201 `MarketRefreshResult`; 501 for `source: "feed"`; 422 for a non-market variable or a repeated cell |

## Contract readings

- **Host tenant.** `/api/ai/*` has no tenant in the path, but a job row (`ai_reconfig_job`) belongs to one. It lives in the tenant named in `request.tenant` (caller must own it), else the first tenant the caller owns (by slug). `GET` and `apply` find the job over the caller's own tenants (RLS: a user sees only their memberships). Start and apply need the owner role; any member may read.
- **Job port.** The server does not import the worker. `AiJobs` (`jobs.ts`) is implemented by `compose/ai-jobs.ts` on pg-boss (`ai.reconfig` via `queue.enqueue`, the dry run and `ai.apply` via `queue.run`); tests wire the worker's `runReconfig` / `runApply` with the fake model client (`testing/worker-ai-jobs.ts`). The route creates the `queued` row (committed) before it sends the job.
- **Cost estimate.** The worker computes it before its first model call. `POST` (not dry) waits up to `estimateWaitMs` (5 s) for the row to carry it; if the worker has not started, the answer shows `model: "pending"`, zero tokens and `maxTokens: 1` (nothing is spent yet). Use `dryRun` to see the cost before starting.
- **Cached rehearsal (06 section 3).** Before queuing, the host tenant's `review` jobs that carry a `cache` marker (`migrate --ai-cache`) are checked: the same prompt (whitespace and case folded), or, for a new-tenant request, a prompt that names the rehearsed airline (name, case-insensitive, or its IATA code in capitals). A hit is answered as is (201): no row, no job, no model call.
- **Author and times.** `ai_reconfig_job` has neither: the route writes `ai/<job-id>/request.json` (author, time, requested tenant); `createdAt` is its time (cache: the rehearsal time), `updatedAt` the newest `ai/<job-id>/` object.
- **Mapping to the contract.** Plan: `mode`, `monogram` = IATA code, `slug` = the seed record's id (new tenant) or the host (tune), `currency` falls back to the tenant record's, then the host's. Sources: public http(s) pages only, ids `S1..`. Calibration: the last round's figures that have both values; a missing figure is a review flag. Impact: the tenant-defaults preview. Scalar cells get the empty member (`res.net[]`). Validation entries that name a rule (VR01-VR10) are `Violation`s; review flags and non-rule entries (`members`, `engine`) become non-blocking `OpenQuestion`s (`context` = the kind). `tenant` is the request's tenant, or the existing tenant of a tune plan, else `null`.
- **Status.** `budget_exceeded` (AI-06's cost guard) was added to `ReconfigStatus`; its stored error is the job's `error` Problem (422).
- **Apply.** Needs status `review` (a repeat of an applied job answers the stored result). Every changeset is written by the worker through `applyChangeset` (`ai_reconfig`; presets copied unchanged are `seed`).
- **Market origin.** The domain and contract origin is `market_refresh` (the item text says "origin=market"). The snapshot is one changeset on the tenant defaults; the registry bounds policy for this origin is warn (VR04 stays a warning). Values equal to the tenant default write no changeset (`changesetId: null`, the snapshot row is still stored). A `clientRequestId` already applied answers its snapshot. Allowed variables: `corp.price_now`, `corp.brent`, `corp.crack`, `corp.jet_direct`.
- The `market_snapshot` and `source` (kind `market`) rows are the record of the typed payload, not inputs, so they are written beside the changeset in the request transaction.

## Job list, tenant parity, onboarding states (API-14)

- **List.** `GET /api/ai/reconfig` walks the caller's memberships (RLS shows nothing else), reads each tenant's `ai_reconfig_job` rows and presents each as `GET :id` does (cached rehearsal included). Dry-run rows (`estimated`) are left out: they only priced a request. Order: `createdAt` descending (the rehearsal counts at its rehearsal time), then id. Any member may read; no sign-in is 401. The Airlines screen picks the job from here (a running one, else the newest in review) and keeps no id in the browser.
- **Parity.** The latest parity of a tenant is one object of its own store, bucket `ai`, key `parity/latest.json` (format `glidepath.parity/1`: `passed`/`total` of the parity replay, the golden tally beside it, `recordedAt`). `migrate --parity <report dir> [--parity-tenant <slug>]` (worker `seed/parity.ts`) writes it from the `golden-report.json` and `replay-report.json` of `pnpm parity:golden`, replacing the earlier one; nothing invents a count. Object store rows have RLS (`stored_object`), so no new table; the list reads it per tenant and answers `parity: [{tenant, passed, total, recordedAt}]`. A tenant without a readable record has no entry. `passed`/`total` are the replay's (the "parity 245/245" of docs/ux/03_screens.md).
- **Onboarding.** `ReconfigJob.onboarding` = `{steps: [{id, state}], done, total}`. The steps are the plan's `checklist` (the AI package's step ids, in order); state per step: `todo` (no fact or open question names it), `review` (an open question, or a fact with no source or confidence `L`), else `done`; an applied job settles every step that has something behind it. Empty while the plan is unknown and for a tuning-only plan.

## Tests

`ai.pg.test.ts` runs on pg-local with the AA seed (roles as compose) and the real AI-06 jobs in-process with the fake model client: one test per acceptance line plus the guards. `map.test.ts` covers the mapping and the queue port without a database.
