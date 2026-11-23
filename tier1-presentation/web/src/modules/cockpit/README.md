# modules/cockpit

Cockpit · "Path to the bar" (03_screens; `docs/ux/screens/cockpit-*`). MOD-01 builds the hero row;
the VP rings, Shareholder, Odds and Fastest path tiles are MOD-02. Renders inside `GlobalLayout`
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
- `scale.ts`: the gauge axis end (display only; the contract carries no gauge scale).
- Tests: `cockpit.test.tsx` mounts the app router with msw REST doubles and the contract's mock
  session (values from the generated golden fixtures), one test per acceptance line plus axe.
