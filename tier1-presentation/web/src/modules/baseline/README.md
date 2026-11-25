# modules/baseline

Baseline, "Where the money is" (MOD-03; docs/ux/03_screens.md). Default export `Baseline` renders
inside `GlobalLayout` (BindProvider + CommitProvider); nothing is computed here.

- Header: `base.total`, `base.opex_total`, `base.capex_total`, `base.locked_share` (`Value`),
  line counts from the `baseline.summary` view, group-by segmented = the `by` of `baseline.groups`.
- Treemap: `baseline.groups {by}` view; click sets `?group=<by>&key=<member>` (no `?key` = first group).
- Group detail: group value from the view, `pool.growth` editable for pools, `base.pool_addressable`
  against `base.pool_outlay` (native `<meter>`), top 7 lines (tier 2's order) with editable `line.amount`.
- Line table: members attrs (vendor, domain, addr, confidence), `line.capex_share`, editable
  `line.amount` (`LineAmount`: `line.amount` has no max/step in the registry, so the popover range is a
  display affordance); "Edit in Excel" navigates to the Excel module.
- Mount `<Tooltip />` from `@glidepath/ui/overlays/drawer` once at the app root (treemap tips).
- Tests: `baseline.test.tsx` (msw, the contract's mock session and generated spec fixtures, axe).
