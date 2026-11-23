# 02 · Information architecture

One airline, one scenario, eight places to work. Every screen reads the same scenario, and a change anywhere moves the flight strip at the bottom. The live version is the **Map** tab in the prototype.

## 1. Site map

```
Airline (tenant switcher: AA live · UA · AS · + Add)
└── Scenario context (Rates · A · B · C · D · Custom copies · solver Paths)
    ├── Cockpit    Net vs bar gauge · CY26→CY27 bridge · hero inputs · 4 VP rings · shareholder tile · odds · fastest path
    ├── Baseline   Treemap by pool / domain / VP · group detail · line table · line editor
    ├── Levers     17 levers by family · lever detail (parameters, timing, confidence) · totals · monthly curve
    ├── VPs        Target method · chargeback · 4 VP cards · "who owns what" ownership editor · shared pools
    ├── Path       Goal · objective · constraints · result + ranked moves · savings-vs-risk · odds · tornado
    ├── Market     Trace from IT net to market cap · driver dials · EPS bars · share price
    ├── Excel      Export (scenarios, sheets) · import review (3-way diff, conflicts, validation) · apply
    └── Airlines   Tenant tiles · AI reconfiguration prompt · onboarding checklist
Design pack (prototype only): Mood · Map · Parts · Demo
```

Routes (hash in the prototype; real paths in the build): `/:tenant/:scenario/{cockpit|baseline|levers|vps|path|market|excel|airlines}`, with optional `?lever=L10`, `?group=pool&key=software`, `?node=br.eps27`.

## 2. Global layer (on every module)

| Element | Where | Behaviour |
|---|---|---|
| Rail | Left, 84px; bottom bar under 760px | Module icons + 10px labels. Tenant monogram on top opens Airlines. |
| Scenario bar | Top bar | Segmented R / A / B / C / D (+ Custom and Paths in a menu in the build). Switching animates every number to its new value. |
| Edits counter | Top bar | Count of changes in the current Custom scenario. Opens the changeset tray: list, undo/redo, save as scenario, discard. |
| Find any number (⌘K) | Top bar | Search across 194 inputs, 17 levers, 98 output nodes, lines and screens. Enter jumps and focuses the control. |
| Theme | Top bar | Cruise (dark) ⇄ Daylight (light). Remembered per viewer. |
| Flight strip (HUD) | Fixed bottom centre | Net (with progress to bar), bar, gap chip, risk-adjusted net, EPS 2027. Hidden on Cockpit, where the same numbers are the hero. |
| Edit popover | Anchored to any number | Value field, slider within registry min/max, source, confidence, default, reset; for outputs, "pin with reason" (writes to Overrides). |
| Trace drawer | Right | For any output node: value, node id, formula in words, upstream chain, top drivers. |
| Toast | Top centre | Confirms cause and effect in one line, 2.4 s. |

## 3. Objects

`Tenant ▸ Model version ▸ Scenario ▸ Changeset ▸ Input value → Formula node`, plus `Solver run` (lands as a scenario).

- Presets (Rates, A–D) are read-only. The first edit forks **Custom (from C)**; the edits counter starts at 1.
- A solver run always lands as a new scenario of kind `solver` with its ranked moves, binding constraints and shadow prices.
- An Excel import always lands as one changeset on the current scenario, after review.
- Outputs can be pinned (an override with a reason). Pinned numbers show a pin glyph and the trace shows "pinned".

## 4. Module table

| Module | Question | You change | You see | Solver hook |
|---|---|---|---|---|
| Cockpit | Can we reach the bar? | Target, outside funding, headcount | Net, gap, risk-adj., VP gaps, EPS, odds | Blend C→D |
| Baseline | Where is the money, and what can move? | Line amounts, capex share, tags, growth | Totals by pool / domain / VP, locked % | — |
| Levers | What does each lever give, and when? | 61 lever inputs, start, ramp, confidence, on/off | In-year, run-rate, one-time, monthly curve | Breakeven per lever |
| VPs | Is each VP on the hook fairly? | Ownership matrix, target method, chargeback, shared pools | VP outlay, target, bar, net, gap | All-VP feasible plan |
| Path | What is the least risky way there? | Goal, objective, constraints | Moves, risk, one-time, P(clear), frontier, tornado | Min-risk mix, Pareto, Monte Carlo, sensitivity |
| Market | What is it worth to shareholders? | 91 corporate drivers, valuation multiple | EBITDA, EPS, price, market cap, fuel equivalent | Stress presets |
| Excel | Can my team work offline? | Workbook | Delta list, conflicts, validation | — |
| Airlines | Can this run for UA or AS? | Prompt, tenant seed | Changeset, calibration check | AI reconfiguration job |

## 5. State model (for architecture)

| State | Scope | Persistence |
|---|---|---|
| Tenant, scenario, module, selection (lever, group, node) | URL | Shareable link |
| Input values, overrides, changesets, scenarios, solver runs | Tenant | Database (spec `schema.json`) |
| Evaluated node values | Session | Recomputed by the engine on every change (full < 50 ms, slider < 10 ms) |
| Theme, collapsed panels, last module | Viewer | Local storage |
| Monte Carlo / optimizer jobs | Tenant | `solver_run` with progress and cancel; results cached per scenario hash |

Slider drags call the incremental evaluator on every frame and commit one changeset entry on release. The HUD and every bound number subscribe to node ids, not to screens.

## 6. Screen states

| State | Treatment |
|---|---|
| Loading | Glass panels render at rest with skeleton bars at 40% opacity; numbers fade in once evaluated. No spinners in panels. |
| Empty | Designed panel with one line and one action (e.g. Odds: "This scenario has not been simulated." + "Run 2,000 trials"). |
| Job running | Inline progress in the panel header ("Searching 1,634 combinations…") and a cancel link; the rest of the screen stays usable. |
| Error | Panel header chip in neg with a one-line cause and fix ("Org_Map row 'Data & analytics' sums to 95%. Make it 100%."). |
| Conflict | Warn chip and a File / App choice per row (Excel import). |
| Stale | After a model upgrade or tenant change, outputs show a faint "recalculate" chip until the engine reruns. |

## 7. Navigation and editing rules

1. Every number is editable or traceable. Inputs open the edit popover; outputs open the trace drawer (and can be pinned).
2. Decisions have a white thumb; estimates have a grey thumb and a lock, because solvers hold them fixed.
3. Ghost ticks on every lever slider show where scenarios C and D sit.
4. Clicking a VP tile, the shareholder tile or "Show me a path" on Cockpit deep-links to that module with context.
5. The same six words (bar, net, gap, run-rate, locked, path) mean the same thing on every screen and in Excel.
6. Phone: rail becomes a bottom bar, panels stack to one column, the scenario bar shows letters only, the flight strip keeps net, bar and gap.

## 8. Multi-tenant hooks in the UI

- Nothing AA-specific is hard-coded in components: VP names and count, pools' tenant labels, domains, lever availability and corporate labor groups all come from the tenant's dimension members.
- VP colours are assigned by slot order, so a tenant with 3 or 5 VPs works (slot 5 = magenta, re-validated).
- The Airlines module is where the AI reconfiguration job runs: prompt → plan → validate (calibration ties to the 10-K within 1%) → one reviewable changeset → apply. Nothing is written until the user accepts.
