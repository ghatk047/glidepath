# modules/market

Market, "Shareholder view" (MOD-08; docs/ux/03_screens.md, market-dark-1440.jpg). Default export
`Market` renders inside `GlobalLayout` (BindProvider + CommitProvider); nothing is computed here.

- Trace (12 cols): the ui `TraceChain` over `res.net`, `pnl.o27`, `res.tot_ot_all`, `br.ebitda27`,
  `br.eps27` (note `br.eps_pct27`), `br.px27` (note: `corp.ev_mult` or `corp.pe`), `br.mcap27` (note
  `corp.shares[fy27]`). A node opens the trace drawer through `overlayController.openTrace(cell)` and
  is `aria-current` while its drawer is open. "Show formulas" opens it on the selected node (`res.net`
  first). The one-time node reads as a cost (display sign only, `asCost`).
- Drivers (5 cols): six ui `Dial`s on `corp.brent`, `corp.crack`, `corp.gdp`, `corp.ac_add`,
  `corp.sofr` at `fy27` and `corp.lab_wage_g` at `<group>,fy27` (a group picker from the `lgroup`
  members: the registry has no all-group pay node). Drag previews, release commits (queue). Reset
  writes `null` to these cells. Valuation: segmented EV / EBITDAR | P/E writes `corp.w_pe` (registry
  min or max); any weight above the min reads as P/E. Multiple: `corp.ev_mult` or `corp.pe`.
- Adjusted EPS: `pl.eps` for each active `year` member in tier 2's order; the member with
  `attrs.it = 1` is the highlighted bar. The axis (`scale.ts`) is layout only.
- Share price: `val.px` for `fy27b` and `fy27it`, `br.fuel_equiv_cents`.
- More drivers: every variable with group "Corporate drivers" in the bundle (91 for AA), in sections
  macro, fuel, demand, labor, fleet, airports, financing, tax, valuation (`DRIVER_GROUP_OF` in
  `copy.ts` is the id to section map; an id not in it lands in "Other", none is dropped). One
  `Stepper` per cell (members from the dimensions); cells mount while the list is open.
- Corporate `%` values are percentage points (2 = 2.0%) while `fmt.pct` takes decimals: `format.ts`
  scales for display (`pctPoints`, `driverFormat`).
- Tests: `market.test.tsx` (msw, the contract's mock session, generated spec fixtures, axe).
