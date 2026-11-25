# global/tour

The walkthrough engine (WIZ-07). Generic parts (placement, spotlight, card) are `@glidepath/ui/overlays/tour`; this folder owns the steps, the store and the anchors. Steps and copy: `docs/ux/07_wizard_tour_plan.md` §4.2, narrative keyed by step id: `docs/ux/06_walkthrough_narrative.md`.

- `steps.ts`: `TOUR_STEPS` (14), `TOUR_VERSION`, `TOUR_CHAPTERS`. Copy has numbers only as placeholders. Each step has `about` (UIX-02): one plain line on what the screen is for, shown above the body so a first-time viewer can follow the tour alone.
- `body.tsx`: `{res.net}` is a bound `<Value>`, `{base.locked_share|pct}` an explicit format, `{vp.net[vp_x]}` a member, `{tenant}` the tenant name from `useTenants()`.
- `store.ts`: `tourStore { open, index, seen, start, startAt, jumpTo, next, back, close }`. `start()` is always step 1.
- `seen.ts`: `localStorage['glidepath.tour.seen']`, try/catch; only sets the Tour button's dot.
- `useAnchor.ts`: rect tracking and a wait of `ANCHOR_WAIT_MS`; `missing` after that.
- `TourHost({ module })`: mount inside `BindProvider` (WIZ-10). Calls `toModule` only; never commit, preview or scenario switch. Missing anchor: centred card, `data-tour-missing`.
- `TourButton()`: top-bar entry, `data-tour-button`, dot until seen.

## Jump API (presenter)

`tourStore.getState().startAt('wizard')` opens at a step id or a chapter (`main`, `levers`, `wizard`, `close`); `jumpTo(id)` moves an open tour. Nothing in the UI calls them: the Tour button always starts at step 1. Use from the console during a rehearsal or wire a control later.
