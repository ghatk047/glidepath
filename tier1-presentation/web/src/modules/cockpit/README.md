# modules/cockpit

Cockpit · "Path to the bar" (03_screens; `docs/ux/screens/cockpit-*`). MOD-01 builds the hero row;
MOD-02 the VP rings, Shareholder, Odds and Fastest path tiles. Renders inside `GlobalLayout`
(the app router wires it), so every number is a session cell or view pushed by tier 2.

- **Net savings** (5 cols, `NetSavingsPanel`): `Gauge` with `res.net` (fill), `res.bar` (solid
  notch), `res.target` (dotted notch); hero `res.net`; "of `res.bar` bar", which opens the
  `g.target_net` popover (prototype `data-ed="target"`); gap chip `res.gap`; stats `res.risk`,
  `res.tot_rr`, `res.tot_ot_it`. Header: target year from the tenant row, preset chip.
- **CY26 → CY27 outlay** (7 cols, `OutlayBridgePanel`): the tier 2 `bridge` view (`useView`), whose
  steps carry `base.total`, `base.headwinds`, `res.tot_iy`, `res.tot_ot_it`, `res.cy27_outlay`,
  the target outlay line and the gap bracket. Axis from `bridgeDomain` (ui); bars open the trace
  drawer when the shell passes `onTrace`.
- **Your inputs** (7 cols, `YourInputsPanel`): the bundle's `ui.hero` variables in registry order;
  `FTE` units as steppers, others as decision sliders; drag previews, release commits (WEB-05
  queue). "All N" (N = bundle variable count) opens the command palette.
- **VP rings** (3 cols each, `VpRings`): one tile per active `vp` member of `/members`, in the
  order sent (slot colour = `vpColour(slot)`): `vp.outlay`, the ui `RingTile` of `vp.net` against
  `vp.bar`, "of `vp.bar` bar", gap chip `vp.gap`. Short names in `copy.ts` (`VP_LABELS`), else
  the member label. The name opens the VPs module.
- **Shareholder view** (4, `ShareholderPanel`): `br.eps27`, `br.px27`; `pl.eps` and `val.px`
  `fy27b` → `fy27it`; `br.fuel_equiv_cents`. The chevron opens Market.
- **Odds** (4, `OddsPanel`) and **Fastest path** (4, `FastestPathPanel`): the scenario's latest
  `monte_carlo` and `min_risk_mix` (lowest risk exposure) `solver_run` (`runs.ts`). Odds draws
  `detail` as sent: P(`res.net[]` ≥ `res.bar[]`), run count, the `res.net[]` histogram with
  P10 / P50 / P90 and the bar line at `res.bar[]` P50; without a result, the WEB-08 empty state
  "Run 2,000 trials" (`POST /solver-runs` monte_carlo, no params: tier 2's defaults), with
  `JobHeader` progress and cancel while it runs. Fastest path shows `metrics['res.net[]']`,
  the move count, `metrics.risk_exposure`, the people clause from `metrics.people_moves` (left out
  when absent) and the first three ranked moves "from → to" in the registry unit; "Show me a
  path" opens Path.
- `runs.ts`: which run each tile shows. The contract has no "latest run of a scenario" lookup
  and no cache-only request, so on mount each tile asks `POST /solver-runs` with its problem and
  `params: {}` (`TILE_SPECS`, tier 2's defaults: the JOB-04 warm-cache key). A hit answers `done`
  at once; a miss queued a fresh run, which the tile cancels straight away (`DELETE`), so viewing
  the Cockpit never runs a simulation or saves a min-risk scenario by itself. A tile also shows
  the run the user starts and any solver job that ends on the session (`job` message, then one
  `GET /solver-runs/:id`; cancelled look-ups are ignored). A result from an older scenario
  version is shown dimmed (`data-stale`).
- `scale.ts`: the gauge axis end (display only; the contract carries no gauge scale).
- Tests: `cockpit.test.tsx` mounts the app router with msw REST doubles and the contract's mock
  session (values from the generated golden fixtures; solver runs shaped from
  `docs/spec/reference/solver_demo_results.json`), one test per acceptance line plus axe.
