# modules/levers

Levers · "Lever studio" (MOD-04; UX `03_screens.md`, `screens/levers-*-1440.jpg`). Default export `Levers`
renders inside `GlobalLayout` (needs `BindProvider`, `DataProvider`, the router). Nothing is computed here.

- Lever list: `useView('levers.families')` (families, totals, lever order), `levers.scale` (bar scale),
  per row `lev.on` toggle (`useVariable`, commits 1/0), name button (`data-lever`, ⌘K focus target),
  `lev.iy` (`<Value>`). Bars are drawn by CSS from `--value / --max`.
- Lever detail: chips (id, family label from the view, `lev.conf`), `lev.iy` / `lev.rr` / `lev.ot`,
  one `BoundSlider` (C and D ghosts) per registry variable `lev.<Lxx>.*` with `ui.control = slider`,
  `lev.conf` as a Dial, timing strip (`lev.start` select, `lev.ramp`, 12 cells from `levers.monthly`),
  hypothesis = the lever member's `hypothesis` attribute (`GET /members`).
- All levers: `res.tot_iy`, `res.tot_ot_it`, `res.net`, `res.bar`; "2027 by month": `MonthlyCurve`
  on `levers.monthly` with the selected lever as the line.
- Selection: `?lever=` (view store, synced from the URL); a click replaces the URL's `lever`.
  Unknown or absent: the first lever of the view.
- Tests: `levers.test.tsx` (msw, the contract's mock session, generated spec fixtures, axe).
