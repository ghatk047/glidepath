# modules/path

Path · "Find a path" (03_screens; `docs/ux/screens/solver-*-1440`). MOD-06 builds Goal (4) and
Result (8); Savings vs risk, Odds and the tornado are MOD-07. Renders inside `GlobalLayout`; every
number is a session cell or a solver run tier 2 answered. Nothing is computed here.

- **Goal** (`GoalPanel`): goal = `res.bar`, pressing it edits `g.target_net` (popover, commit
  queue). Objective radio cards = `min_risk_mix.objective_options` (`OBJECTIVES` in `copy.ts`).
  "Hold to" toggles map to contract constraints (`params.ts` `pathSpec`): `total` always,
  every VP → `per_vp`, US headcount floor → `us_floor` (value: the session's `res.fte_us`, or what
  the user types), one-time cap → `one_time_cap` (value: the session's `res.tot_ot_it`, or typed).
  Stretch cap and estimates fixed are shown on and locked: the contract has no parameter for them
  (tier 2 always bounds decisions at full stretch and never moves `estimate` variables).
  The one-time cap starts **off** (the render shows it on with $20M): there is no tier-2 default
  for the cap, and holding it at the plan's own one-time cost would change the demo's reference
  path.
- **Find a path**: `POST /solver-runs` `{problem: min_risk_mix, params: {objective, method:
explainable, constraints}}`; progress from the session's `job` messages (`JobHeader`); on done,
  `GET /solver-runs/:id`. Moves (`result.ranked`, tier 2's order) land one by one, one per
  `motion.stagger` token (90 ms, `useLanding`); reduced motion shows them at once.
- **Blend C → D**: `POST /solver-runs/quick` `{problem: scenario_blend, params: {from, to}}` with
  the ids of presets `C` and `D` from `GET /scenarios`; λ from `detail.lambda`.
- **Result** (`ResultPanel`): net `res.net[]`, "Bar cleared" when the run's status is
  `optimal` / `feasible`, else the `res.gap[]` chip; risk exposure `risk_exposure` with the
  references tier 2 reports as `risk_exposure[<scenario key>]`; one-time `res.tot_ot_it[]`;
  US headcount `res.fte_us[]` ("unchanged" when equal to the session's cell); EPS `br.eps27[]`;
  "N evaluations · M steps" from `evaluations` / `steps`. MoveRows from the bundle's variable
  definitions (label, min/max, unit, step).
- **Save as scenario**: the same spec again with `save: true` (tier 2 answers from its run cache
  and writes the `solver` scenario), then the URL moves to `resultScenarioId`.
  **Compare with C**: a table of the start scenario's session cells beside the run's metrics.
- Tests: `path.test.tsx` (app router, msw for REST incl. the solver routes, the contract's mock
  session for WS and jobs, golden fixtures and `docs/spec/reference/solver_demo_results.json`),
  one test per acceptance line plus axe.
