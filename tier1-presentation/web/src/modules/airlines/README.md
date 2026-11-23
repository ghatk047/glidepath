# modules/airlines

Airlines (MOD-10; docs/ux/03_screens.md, airlines-dark-1440.jpg). Default export `Airlines`
renders inside `GlobalLayout`; nothing is computed here.

- Tiles (`Tiles.tsx`): one per tenant from `GET /api/tenants` (`active` = Live with line / VP /
  scenario counts read from `members` and `scenarios`; `setup` = Draft "n of 9" when tier 2 holds
  an AI job for it, else Not started with "Set up with AI"), a draft tile for an AI plan whose
  airline is not a tenant yet, and "Add an airline". Monograms are the IATA code, never a logo.
- Reconfigure with AI (`ReconfigPanel.tsx`, `useReconfig.ts`): the ui `PromptBar` calls
  `POST /api/ai/reconfig` with `dryRun: true` (plan and cost estimate), "Start job" repeats it
  without, then `GET /api/ai/reconfig/:id` is polled while queued / running. The four steps
  (plan / validate / review / apply) are groups of tier 2's `step` (`model.ts`). `Review.tsx`
  shows plan, sources and facts, open questions, calibration and changeset summaries; Apply calls
  `POST /api/ai/reconfig/:id/apply` with the drafts tier 2 listed, disabled while a blocking
  question is open. The last job id is remembered in localStorage (a convenience only).
- Onboarding (`Onboarding.tsx`): the nine steps of model-spec 07 §2. State per step comes from the
  facts and open questions tier 2 attached (`item` = the step id in `copy.ts`): any open question
  or unsourced / low-confidence fact = in review, facts all sourced = done, none = to do.
- Gaps in the contract (see the item report): no parity status, no onboarding-state field, no
  job list route.
