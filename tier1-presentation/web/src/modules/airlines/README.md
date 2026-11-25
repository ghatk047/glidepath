# modules/airlines

Airlines (MOD-10; docs/ux/03_screens.md, airlines-dark-1440.jpg). Default export `Airlines`
renders inside `GlobalLayout`; nothing is computed here.

- Tiles (`Tiles.tsx`): one per tenant from `GET /api/tenants` (`active` = Live with line / VP /
  scenario counts read from `members` and `scenarios`, and "parity n/m" as tier 2 recorded it; `setup` =
  Draft "done of total" (tier 2's `job.onboarding`) when tier 2 holds an AI job for it, else Not
  started with "Set up with AI"), a draft tile for an AI plan whose
  airline is not a tenant yet, and "Add an airline". Monograms are the IATA code, never a logo.
- Reconfigure with AI (`ReconfigPanel.tsx`, `useReconfig.ts`): the ui `PromptBar` calls
  `POST /api/ai/reconfig` with `dryRun: true` (plan and cost estimate), "Start job" repeats it
  without, then `GET /api/ai/reconfig/:id` is polled while queued / running. The four steps
  (plan / validate / review / apply) are groups of tier 2's `step` (`model.ts`). `Review.tsx`
  shows plan, sources and facts, open questions, calibration and changeset summaries; Apply calls
  `POST /api/ai/reconfig/:id/apply` with the drafts tier 2 listed, disabled while a blocking
  question is open. On mount `GET /api/ai/reconfig` (API-14) lists the caller's jobs and tenant
  parity: the screen picks a running job, else the newest in review (the cached UA example); no id
  is kept in the browser.
- Onboarding (`Onboarding.tsx`): the steps tier 2 sends on the job (`job.onboarding`: step ids of
  model-spec 07 section 2, each done / review / todo, plus `done` and `total`). Tier 1 only maps an
  id to its words (`copy.ts`, an unknown id is shown by its own words) and prints what it was sent;
  it derives no state and counts nothing. No job or no steps yet = the empty line.
