# modules/path

Path · "Find a path" (03_screens; `docs/ux/screens/solver-*-1440`). MOD-06 builds Goal (4) and
Result (8); Savings vs risk (4), Odds (4) and the tornado (4) are MOD-07. Renders inside
`GlobalLayout`; every number is a session cell or a solver run tier 2 answered. Nothing is computed
here.

- **Savings vs risk** (`SavingsRiskPanel`): a scatter of net against risk exposure. Points are the
  (net, risk) pairs the Path (`min_risk_mix`) run reports — `res.net[]` / `risk_exposure` for Path,
  and `net[<key>]` / `risk_exposure[<key>]` references for C, the all-VP optimum and D (MOD-06
  already carries the risk references). The dashed bar line is `res.bar[]`. The frontier curve comes
  from a `pareto` run's `detail.points`, looked up side-effect-free (API-13) and hidden until one
  exists (post-demo). Tier 1 only scales the values to the svg.
- **Odds** (`OddsPanel`): the Monte Carlo runs of C and D (`useAnalysis` look-up, API-13).
  P(`res.net` ≥ `res.bar`) for each from `detail.probabilities`, and D's net histogram with
  P10/P50/P90 and the bar line. "Run N trials" (N is tier 2's look-up trial count) starts one when a
  scenario has none (`POST /solver-runs`, `save: false`).
- **What moves net most** (`TornadoPanel`): the quick `sensitivity` tornado on `res.net[]`. Tier 2
  returns `detail.rows` sorted by swing, each with its `category` (lever, policy, timing) and `swing`
  ($M); the top ten render as bars as sent, policy / timing amber by that category (SOL-13: tier 1
  classifies and takes the magnitude of nothing). The demo warmer pre-runs this tornado and the
  odds for D, so they show without a click. "Run sensitivity" starts one when missing (`POST /solver-runs/quick`, `save: false`).
- **Look-ups** (`useAnalysis`): each analysis panel reads what tier 2 holds with
  `GET /solver-runs/lookup` (no enqueue, run, save or row written) and shows it; an explicit "Run"
  sends `save: false`. Only "Save as scenario" on the Result panel sends `save: true` (MOD-06).

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
