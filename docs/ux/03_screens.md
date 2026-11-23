# 03 · Screens

Eight modules. Layout is a 12-column grid with 18px gaps inside a main area beside an 84px rail; below 1180px panels go to 6 or 12 columns, below 760px everything stacks. Node ids refer to `model-spec/formula_graph.json`; input ids to `model-spec/variables.json`. Values quoted are AA, scenario C (Balanced), unified defaults. Renders: `screens/`.

---

## Cockpit · "Path to the bar"

**Job:** answer "can we reach the bar?" in one glance, and hand the MD the five inputs that matter most.

| Panel (cols) | Content | Bound to |
|---|---|---|
| Net savings (5) | 270° gauge, hero net $119.3M, "of $143.0M bar" (editable), gap chip −$23.7M; stat row risk-adjusted $82.0M · 2028 run-rate $193.8M · one-time in IT $19.6M | `res.net`, `res.bar`, `res.target`, `res.gap`, `res.risk`, `res.tot_rr`, `res.tot_ot_it` |
| CY26 → CY27 outlay (7) | Bridge: base $1,007.6M → growth +$43.0M → savings −$138.8M → one-time +$19.6M → CY27 $931.3M; dashed target outlay $907.6M; red bracket = gap; axis break at $840M | `base.total`, `base.headwinds`, `res.tot_iy`, `res.tot_ot_it`, `res.cy27_outlay` |
| Your inputs (7) | Net target slider, one-time funded outside IT slider, US / GCC / contractor steppers; "All 194" opens ⌘K | `g.target_net`, `g.ot_out_share`, `hc.us`, `hc.gcc`, `hc.ctr` (the registry's `ui.hero` inputs) |
| VP rings (4 × 3) | Ring net/bar, net, bar, gap chip, outlay | `vp.net`, `vp.bar`, `vp.gap`, `vp.outlay` |
| Shareholder view (4) | EPS +$0.091 ($0.465 → $0.556), price +$1.02 ($11.90 → $12.92), "1.7¢ per gallon of jet fuel" | `br.eps27`, `br.px27`, `pl.eps`, `val.px`, `br.fuel_equiv_cents` |
| Odds (4) | P(clear bar) 0%, histogram with P10/P50/P90 49.5 / 74.5 / 97.4 and the bar; empty state "Run 2,000 trials" for unsimulated scenarios | Monte Carlo job result |
| Fastest path (4) | $143.0M, 15 moves, risk $42.0M, no people levers, top 3 moves, "Show me a path" | Min-risk solver result |

**Interactions:** scenario switch rolls every number; dragging the target moves the bar notch, the target line and the gap; outside funding changes net and one-time in IT only (P&L and EPS do not change, since the P&L bears one-time cost whoever funds it).

---

## Baseline · "Where the money is"

**Job:** show the $1,007.6M and what can move in 2027.

| Panel | Content | Bound to |
|---|---|---|
| Header strip | CY26 normalized $1,008M · opex $883.7M · capex $123.9M · locked 20.8% · 415 lines (394 in scope); group-by segmented Cost pool / Domain / VP | `base.total`, `base.opex_total`, `base.capex_total`, `base.locked_share` |
| Treemap (8) | Two levels (group → line), coloured by addressability, labels on a ground chip; click selects a group | `line.amount`, `line` members, `org.dom_share` for VP grouping |
| Group detail (4) | Name, total, growth (editable for pools), addressability split bar, top 7 lines with editable amounts | `base.pool_outlay`, `pool.growth`, `base.pool_addressable` |
| Line table (12) | Line, vendor, domain, addressability, confidence, capex share, CY26 $M (editable); "Edit in Excel" | `line.*` inputs |

Group-by VP splits each line by its domain's ownership shares, so it always agrees with the VP module.

---

## Levers · "Lever studio"

**Job:** make each of the 17 levers tangible: what it gives, when, how sure we are.

| Panel | Content | Bound to |
|---|---|---|
| Lever list (4) | Three families (Labour 8, Technology 6, Platforms & avoidance 3) with family totals; each row: on/off, name, in-year bar (scaled to D max), in-year $ | `lev.on`, `lev.iy` |
| Lever detail (5) | Chips (id, category, confidence); in-year / run-rate / one-time; one slider per parameter with C and D ghost ticks, estimates locked; timing strip (start month select, ramp, 12 monthly cells); hypothesis line | `lev.Lxx.*`, `lev.start`, `lev.ramp`, `lev.conf`, `lev.rr`, `lev.ot` |
| All levers (3) | In-year $138.8M, minus one-time in IT, net vs bar | `res.tot_iy`, `res.tot_ot_it`, `res.net`, `res.bar` |
| 2027 by month (3) | Stacked area by family with the selected lever as a line | derived from `lev.start`, `lev.ramp`, `lev.iy` |

Confidence becomes a dial in the build (the prototype shows it as a chip). Breakeven per lever ("this lever alone would need X") is a later panel fed by the batch goal seek.

---

## VPs · "VP targets & ownership"

**Job:** show that every VP is short today and let the room change who owns what.

| Panel | Content | Bound to |
|---|---|---|
| Controls | Target method (Proportional / Equal / Manual), chargeback toggle | `g.vp_target_method`, `g.chargeback_on` |
| VP cards (4 × 3) | Outlay, bullet (net vs bar tick), net, bar, target + growth, gap chip; "Shared owner" chip | `vp.outlay`, `vp.net`, `vp.bar`, `vp.target`, `vp.growth`, `vp.gap`, `org.ss_flag` |
| Who owns what (7) | 14 domains × 4 VPs as draggable segmented bars (5% steps, row sums to 100%); outlay per domain | `org.dom_share` |
| Chargeback (5) | Usage key bar 27 / 27 / 14 / 32%, shared pools with toggles | `org.usage_override*`, `pool.shared` |
| Every VP clears? (5) | All-VP optimizer result $148.1M, Operations binding | Min-risk with VP constraints |

Dragging ownership recalculates VP outlay live (glow on the changed numbers) and, in the build, targets, bars and gaps.

---

## Path · "Find a path"

**Job:** "show me a path": the solver as an explainable answer, then the reality check.

| Panel | Content | Bound to |
|---|---|---|
| Goal (4) | Goal $143.0M (editable); objective radio cards (lowest risk, most risk-adjusted, least one-time, fewest people moves, smallest change); constraints (every VP clears, US headcount floor, one-time cap, stretch cap, estimates fixed); "Find a path", "Blend C → D" | `solvers.json` problem catalogue |
| Result (8) | $143.0M, "Bar cleared", risk exposure $42.0M (C 37.3, D 54.8), one-time $20.0M, US headcount 2,692 unchanged, EPS +$0.113; 15 ranked moves with from-tick → to-thumb; save as scenario, compare with C | `solver_run` result |
| Savings vs risk (4) | Scatter: C, Path, All VPs, D, frontier sketch, bar line | Pareto sweep |
| Odds (4) | P(clear) C 0%, D 4.5%; D histogram | Monte Carlo |
| What moves net most (4) | Tornado top 10; policy and timing inputs in amber | Sensitivity job |

"Find a path" lands moves one by one (90 ms stagger). Moves are listed in the order the optimizer valued them.

---

## Market · "Shareholder view"

**Job:** connect IT savings to the numbers the CFO and the street use.

| Panel | Content | Bound to |
|---|---|---|
| Trace (12) | IT net $119.3M → P&L opex saved $123.0M → one-time −$39.1M → EBITDA +$79.6M → EPS +$0.091 (+19.6%) → share price +$1.02 → market cap +$680M; each node opens the trace drawer | `res.net`, `pnl.o27`, `res.tot_ot_all`, `br.ebitda27`, `br.eps27`, `br.eps_pct27`, `br.px27`, `br.mcap27` |
| Drivers (5) | Dials: Brent $86, jet crack $59, US GDP 2.0%, labor pay 3.6%, aircraft added 25, SOFR 3.4%; valuation EV/EBITDAR 7.39× or P/E | `corp.brent`, `corp.crack`, `corp.gdp`, `corp.lab_wage_g`, `corp.ac_add`, `corp.sofr`, `corp.ev_mult`, `corp.pe`, `corp.w_pe` |
| Adjusted EPS (4) | FY25A $0.36 · FY26E −$0.75 · FY27E base $0.47 · FY27E with IT $0.56 | `pl.eps` |
| Share price (3) | Without IT $11.90, with IT $12.92; fuel equivalent | `val.px`, `br.fuel_equiv_cents` |

All 91 corporate drivers sit behind "More drivers" (grouped: macro, fuel, demand, labor, fleet, airports, financing, tax, valuation) in the build.

---

## Excel · "Excel round trip"

**Job:** let people work in Excel and bring it back safely.

| Panel | Content |
|---|---|
| Export (4) | Scenario choice (C, D, C + D, all five), the 11 editable sheets as chips, file name pattern `{tenant}_it_savings_{scenarios}_{yyyymmdd-hhmm}.xlsx`, "Export workbook" (saves a server snapshot) |
| Import review (8) | File card (exported time, three-way compare), summary chips (changes, conflicts, errors), diff table (sheet, item, exported, in file, app now, take), validation line (VR01–VR10, Org_Map rows sum to 100%), "Preview impact", "Apply as changeset" |

Conflicts (the app changed since export) get a File / App choice. New lines show a "new line" chip. Rows the user deleted with `DELETE` show as removals.

---

## Airlines · "Airlines"

**Job:** prove the app is a platform: AA is the first tenant.

| Panel | Content |
|---|---|
| Tenant tiles (4 × 3) | AA live (415 lines, 4 VPs, 5 scenarios, parity 245/245); UA draft (example 4 of 9); AS not started ("Set up with AI"); Add an airline |
| Reconfigure with AI (7) | Prompt ("Set up Alaska Airlines for CY27, target 10% of base"), four steps (plan, validate, review one changeset, apply), global vs per-airline vs upgrades |
| Onboarding (5) | The nine checklist steps from model-spec 07 §2 with done / in review / to do |
