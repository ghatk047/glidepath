# Glidepath UX pack v1.0 (step 2: UX and moodboard)

This pack sets the look, the structure and the demo flow for the airline IT savings app. Glidepath is a working name. AA is the first tenant; UA and AS come later. It builds on `/mnt/project-files/model-spec/` (step 1). It does not cover architecture or the backlog. Those are steps 3 and 4.

## Open it

- **`prototype/glidepath.html`**: one self-contained file. Open it in any browser. It runs on the real AA numbers from the engine's golden results. All eight modules and the four design pages are linked from the rail on the left.
- **`screens/`**: PNG renders of every screen: dark desktop, light desktop and phone width.
- The same prototype is also published as a private Artifact (link in the thread).

## Files

| File | What it holds | Read it when |
|---|---|---|
| `01_moodboard.md` | Direction "Cruise": palette, type, glass recipe, motion, chart rules, icons, words | You style anything |
| `02_information_architecture.md` | Site map, objects, global layer, navigation and state rules, responsive rules | You plan routes, state or data flow |
| `03_screens.md` | Each of the 8 modules: job, layout, components, bound nodes and inputs, interactions | You build a screen |
| `04_component_inventory.md` | 27 components with props, states and the data they bind | You build the component library |
| `05_demo_storyline.md` | Run of show for Fri 4 Dec 2026, Q&A moves, pre-flight checklist | You rehearse |
| `tokens.json` | Design tokens for both themes (colour, type, radius, motion, glass) | You set up the theme |
| `prototype/src/` | Prototype source: `styles.css`, `core.js`, `views.js`, `docs.js`, `app.js`, `shell.html`, `extract_data.py`, `build.py` | You want a reference implementation |

Rebuild the prototype: `python3 prototype/src/extract_data.py /mnt/project-files/model-spec prototype/src/data.json && python3 prototype/src/build.py prototype/src prototype`.

## What is real in the prototype and what is not

- **Exact:** every number shown for the five preset scenarios (from `reference/golden_results.json` and `solver_demo_results.json`). Changing the target or the share of one-time cost funded outside IT is also exact, because the spec gives closed forms: net = in-year − one-time × (1 − share), gap = net − bar. Dragging VP ownership recalculates VP outlay exactly (Σ line × domain share; it reproduces $211.8M / $203.5M / $125.8M / $466.5M).
- **Estimated:** lever sliders, lever on/off and start month scale that lever proportionally. Corporate dials use linear sensitivities taken from the corporate model's equivalences (Brent, yield, pilot pay); SOFR and fleet are rough. Headcount steppers change the value only. The real app replaces all of this with the engine.
- **Examples, clearly labelled on screen:** the Excel import file and its rows, United's onboarding progress, the Pareto curve between solved points.

## Decisions taken (assumptions, all reversible)

1. **Dark-first.** Cruise (dark glass over a night sky) is the default, because it reads as high-end on a big screen and makes glass look like glass. Daylight (light) ships too, for bright rooms and print. A toggle sits in the top bar.
2. **One persistent flight strip.** Net, bar, gap, risk-adjusted net and EPS sit at the bottom of every module except Cockpit (which is that strip, enlarged). It is the cause-and-effect device for the demo.
3. **Every number editable** via one popover pattern, with source, confidence, default and reset. Decisions and estimates look different (white thumb vs grey thumb with lock), matching the spec's `kind` tag that the solvers respect.
4. **Presets are read-only.** The first edit forks a Custom scenario. Solver results and Excel imports always land as a new scenario or one changeset.
5. **No airline marks.** Tenants show as IATA codes in neutral monograms. The product never uses AA's (or anyone's) logo, livery colours or typeface.
6. **Typeface:** Geist and Geist Mono (Google Fonts, open licence) for UI and data, tabular figures everywhere.

## Next step (3): architecture

Start with `02_information_architecture.md` §5 (state model) and `03_screens.md` (node bindings), then the model spec's engine contract (03 §5) and performance targets (04 §6). Each module in `03_screens.md` maps to a UI epic; each component in `04_component_inventory.md` maps to a library story.
