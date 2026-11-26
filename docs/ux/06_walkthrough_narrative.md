# 06 · Walkthrough narrative: what the presenter says, step by step

Script for the Friday 4 December 2026 demo (20 minutes), for the live app with the WalkMe-style tour (`docs/ux/07_wizard_tour_plan.md` §4) and the Build wizard (§3). It tightens the lines of `05_demo_storyline.md` and is keyed by the tour step ids of `07` §4.2.

**Audience:** AA's MD of Procurement, with a CIO and CFO lens in the room.
**Message:** the target is hard, and this app lets AA build its own path.
**Voice:** an airline procurement expert who knows what a renewal calendar does to a savings number, a senior partner who says the uncomfortable thing first, and a careful financial analyst who never states a figure the screen does not show. Short sentences. Name the number, then what it means. Never say "just".

## How to read this page

- **Live nodes** are the spec ids on screen for that beat, with the AA seed value in brackets (scenario C unless stated). The seed values are for rehearsal and cross-checking only. **In the room, read every number off the screen.** The app is the source and the script is not.
- Sources for the bracketed values: `docs/spec/reference/golden_results.json` (scenarios `rates`, `C`, `D`), `docs/spec/reference/solver_demo_results.json` (optimizer and Monte Carlo), `docs/spec/README.md` (headline numbers), `docs/spec/seed/aa/` (inputs). All amounts are $M unless marked.
- Words used the same way everywhere: **bar, net, gap, run-rate, locked, path.**
- Tour step ids (`bar`, `baseline`, …) are the `TOUR_STEPS` ids. The tour card carries the short on-screen line. The **Say** column here is what you add.
- The tour never auto-starts, never writes and never switches scenario. Step 3 does not click R for you.

## Run of show at a glance

| # | Time | Screen | Tour step id | Core line |
|---|---|---|---|---|
| 1 | 0:00 | Cockpit | `bar` | The bar is about $143M, not $100M. |
| 2 | 2:00 | Baseline | `baseline` | A fifth of the money is locked. |
| 3 | 4:00 | Cockpit (R) | `rates` | Squeezing vendor rates is not a plan. |
| 4 | 5:00 | Levers | `levers` | Seventeen levers, each with its own timing and confidence. |
| 5 | 8:00 | VPs | `vps` | Every VP is short today. |
| 6 | 10:00 | Path | `path` | The least risky path leaves people levers alone. |
| 7 | 12:30 | Path · odds | `odds` | At their own confidence, even full stretch rarely clears. |
| 7b | after 7 | Path · frontier | `frontier` | The curve is the most net for each level of risk. |
| S | optional | Sourcing | `spend`, `renewals`, `benchmarks`, `consolidation` | Spend, renewal dates, price gaps, fewer vendors. |
| P | optional | Plan | `breakeven`, `stress`, `case`, `waves` | How much slack, which shocks, what it costs, in what order. |
| 8 | 14:00 | Market | `market` | About nine cents of EPS, a dollar a share. |
| 9 | 16:00 | Cockpit | `handover` | Every number is yours to change. |
| 10 | 18:00 | Excel | `excel` | Work in Excel; the app shows what changed. |
| 11 | 19:30 | Airlines | `airlines` | AA is the first airline on it, not the only one. |
| 9b | after 9 | Cockpit | `solve` | Click a number, choose Solve for this. |
| W | (replaces 4–6) | Build | `wizard`, `optimize` | Pick, tune, set policy, find a path. |
| – | close | any | `restart` | Restart the tour from the top bar. |

---

## Beat 1 · The bar (0:00, 2 min)

- **Screen:** Cockpit, scenario C Balanced.
- **Tour step:** `bar` (cockpit, anchor `cockpit-net`).
- **Do:** Open on Balanced. Point at the gauge and the notch on the bar. Press Next on the tour card.
- **Say:** "Ten percent of the IT bill sounds like a hundred million. But AA also has to absorb cost growth, so the real bar is a hundred and forty-three. Today's balanced plan nets one nineteen. We are twenty-four short."
- **Live nodes:** `res.net` [119.29], `res.bar` [142.98], `res.target` [100], `base.headwinds` [42.98], `res.gap` [−23.69], `res.coverage` [83.4%].
- **Check:** target 100.0 + growth 43.0 = bar 143.0 (`README.md` headline).
- **Fallback:** If the gauge is slow to draw, say the sum aloud from the tour card ("target plus growth equals the bar") and move on.

## Beat 2 · Where the money is (2:00, 2 min)

- **Screen:** Baseline.
- **Tour step:** `baseline` (anchor `.gp-treemap`).
- **Do:** Group by pool. Click Airline platforms, then US labour.
- **Say:** "About a fifth of the spend is locked for 2027. Take Airline platforms. The contracts were renewed in December 2024, so there is almost nothing to negotiate this year. Most of what we can move sits elsewhere."
- **Live nodes:** `base.total` [1,007.64], `base.capex_total` [123.93], `base.locked_share` [20.8%], `base.addressable_total` [367.19].
- **Check:** base $1,007.6M, capex $123.9M, 20.8% locked (`README.md`). The Sabre renewal date (December 2024) is from the storyline and is a talking point, not a node: confirm it before the day.
- **Fallback:** If the treemap does not group, read the locked share from the headline chip. Say: "Twenty-one percent is locked; the rest is the fight."

## Beat 3 · The instinctive move (4:00, 1 min)

- **Screen:** Cockpit with the scenario bar on R (Rates only).
- **Tour step:** `rates` (anchor `.gp-seg`).
- **Do:** Click R in the scenario bar yourself (the tour does not). Let the gauge fall.
- **Say:** "The instinctive move is to squeeze vendor rates. It gets about eight million. It is not a plan."
- **Live nodes:** `res.net` [8.11], `res.gap` [−134.87], `res.risk` [5.83], `res.coverage` [5.7%].
- **Fallback:** If the switch lags, say the number from the strip: "Eight million against a bar of one forty-three." Switch back to C before beat 4.

## Beat 4 · Levers (5:00, 3 min)

- **Screen:** Levers.
- **Tour step:** `levers` (anchor `[data-lever-detail]`).
- **Do:** Back to C. Open Software. Drag shelfware. Toggle Cloud FinOps off and on.
- **Say:** "Seventeen levers. Each has its own start month, its own ramp, and a confidence we can defend. Watch the strip at the bottom as I move shelfware, then drop Cloud FinOps and bring it back. Cloud is small but reliable. Software is bigger and softer."
- **Live nodes:** `lev.on` [L10 = 1, L11 = 1], `lev.L10.shelf` [0.10], `lev.iy[L10]` [26.52], `lev.conf[L10]` [0.75], `lev.L11.pct` [0.30], `lev.iy[L11]` [8.96], `lev.conf[L11]` [0.85], `res.tot_iy` [138.84], `res.tot_ot_it` [19.55], `res.net` [119.29].
- **Check:** "Medium-high (0.75)" and "High (0.85)" are the lever library labels (`seed/aa/lever_library.json`).
- **Fallback:** If a drag does not register, type the value into the slider's number field. If the strip does not move, toggle the lever again and say what the strip shows. Restore shelfware to 10% and Cloud FinOps to on before beat 5.

## Beat 5 · Who owns what (8:00, 2 min)

- **Screen:** VPs.
- **Tour step:** `vps` (anchor `.gp-vps-rows`).
- **Do:** Show the four bars. Drag Data & analytics ownership toward Commercial.
- **Say:** "Every VP is short today. Ownership and chargeback decide who carries what, and you can change both right here. Watch the four bars follow."
- **Live nodes:** `vp.net` / `vp.bar` / `vp.gap` by `vp`: Commercial [31.68 / 36.57 / −4.89], Operations [27.28 / 34.13 / −6.85], Corporate [19.43 / 22.41 / −2.98], Infrastructure [40.90 / 49.87 / −8.97]. `org.dom_share['data_analytics,vp_commercial']` [0.35], `['data_analytics,vp_operations']` [0.35], `['data_analytics,vp_corporate']` [0.30].
- **Fallback:** If the drag stalls, use the matrix cell instead. Say: "Same input, typed." Restore the share afterwards (35 / 35 / 30).

## Beat 6 · Find a path (10:00, 2.5 min)

- **Screen:** Path.
- **Tour step:** `path` (anchor `.gp-path-actions`).
- **Do:** Press Find a path. Let the moves land one by one. Do not talk over the first landing.
- **Say:** "This is the least risky way to a hundred and forty-three. It leaves the people levers alone. It refuses vendor COLA and contains growth first. Every move is a number AA can argue with."
- **Live nodes:** result metrics (read live): net [143.02], risk exposure [42.01], one-time on IT [20.0], US headcount `res.fte_us` [unchanged from C, 2,692.5]. Bar `res.bar` [142.98]. With every VP bar added: net [148.13], risk exposure [43.63].
- **Check:** `solver_demo_results.json`, `min_risk_total_bar` and `min_risk_total_and_vp_bars`. The moves that raise lever inputs (for example `lev.L01.cut` 0.25 to 0.35, `lev.L17.cola` 0.7 to 1.0, shelfware 0.10 to 0.11) are listed there.
- **Fallback:** If the job runs long, see "When a job is slow" below. If it fails, open the saved Min-risk scenario from the scenario bar and walk its moves.

## Beat 7 · The odds (12:30, 1.5 min)

- **Screen:** Path, odds panel.
- **Tour step:** `odds` (anchor `path-odds`).
- **Do:** Point at 0% and 4.5%.
- **Say:** "Now the honest part. If each lever delivers only what its confidence says, balanced clears the bar zero times in two thousand trials. Full stretch clears it four and a half percent of the time. That is why AA has to own the path: nobody else's plan survives contact with the calendar."
- **Live values (read live):** P(clear) C [0%], D [4.5%]. Net P10 / P50 / P90: C [49.5 / 74.5 / 97.4], D [62.8 / 102.0 / 135.6]. Trials [2,000].
- **Check:** `solver_demo_results.json`, `monte_carlo_C` and `monte_carlo_D`.
- **Fallback:** If odds are not pre-run, say "I ran this before the meeting" and open the pre-run result. Never wait on screen for 2,000 trials in front of the room.

## Beat 7b · Savings vs risk (after beat 7, 1 min)

- **Screen:** Path, Savings vs risk panel.
- **Tour step:** `frontier` (anchor `path-scatter`).
- **Do:** Point at the curve, then at where the current plan sits against it.
- **Say:** "Every point on this curve is the most net AA can get for that much risk. A plan below the curve is leaving savings on the table. A plan above it does not exist."
- **Live values:** read off the panel; the curve is a solver run.
- **Fallback:** If the curve is still drawing, talk to the points already shown.

## Sourcing chapter (VP Procurement, optional, 4 min, between beat 7b and beat 8)

Open from the rail, or `tourStore.getState().startAt('sourcing')`. The numbers are the tenant's contract data: read them off the screen, none is an engine node.

| Step | Tour step id | Anchor | Do | Say |
|---|---|---|---|---|
| Spend by vendor | `spend` | `sourcing-vendors` | Sort by spend. Open the top vendor. | "Start where the money is. Who we pay, by category and by contract." |
| Renewal calendar | `renewals` | `sourcing-renewals` | Point at the next renewals and the notice dates. | "A saving only counts if we act before the notice date. This is the calendar a negotiator works to." |
| Should-cost | `benchmarks` | `sourcing-benchmarks` | Point at the largest gap to benchmark. | "What we pay against what the market says it should cost. The gap is the negotiating room." |
| Consolidation | `consolidation` | `sourcing-consolidation` | Run the optimizer. | "Fewer vendors can buy better prices. It also concentrates risk. The optimizer shows the trade." |

- **Fallback:** If a panel is empty, the tenant has no contract data loaded: say so and skip the chapter.

## Plan chapter (VP IT, optional, 4 min, after the Sourcing chapter)

Open from the rail, or `startAt('plan')`. All values come from tier 2; read them off the screen.

| Step | Tour step id | Anchor | Do | Say |
|---|---|---|---|---|
| Breakeven | `breakeven` | `plan-breakeven` | Point at the levers with the least slack. | "How far can each lever fall short before we miss the bar? These have the least room." |
| Stress tests | `stress` | `plan-stress` | Change a shock size. | "Slower delivery, higher prices. Change the size of the shock and watch net absorb it." |
| Business case | `case` | `plan-business-case` | Read across cost, savings and payback. | "The same plan, the way finance reads it: one-time cost, savings by year, payback." |
| Wave planner | `waves` | `plan-wave` | Run the planner. | "The order the levers go live in, within capacity. The best order lands savings soonest." |

- **Fallback:** If a solve is slow, see "When a job is slow" below.

## Beat 8 · Shareholders (14:00, 2 min)

- **Screen:** Market.
- **Tour step:** `market` (anchor `market-trace`).
- **Do:** Walk the trace from net savings to share price. Turn Brent up ten dollars.
- **Say:** "Balanced is worth about nine cents of EPS and about a dollar a share. In fuel terms that is one point seven cents off every gallon. Now Brent, ten dollars higher. Watch the bridge move, and notice that IT savings do not."
- **Live nodes:** `br.eps27` [0.0912], `br.px27` [1.018], `br.fuel_equiv_cents` [1.74], `corp.brent['fy27']` [85.78, so +$10 is 95.78], `res.net` [119.29].
- **Check:** EPS +$0.091, price +$1.02, 1.74¢/gal (`README.md`, `golden_results.json`). The effect of +$10 Brent is not in the spec: read it live and quote what the screen shows.
- **Fallback:** If the Brent slider is slow, hover the trace nodes instead and describe the chain. Restore Brent to 85.78 afterwards.

## Beat 9 · Hand over the controls (16:00, 2 min)

- **Screen:** Cockpit.
- **Tour step:** `handover` (anchor `cockpit-inputs`).
- **Do:** Step back. Let the MD move one-time funding and the target.
- **Say:** "Every number on this screen is yours. Move the target. Move who pays the one-time cost. I will not touch the keyboard."
- **Live nodes:** `g.target_net` [100], `g.ot_out_share` [0.5], `res.tot_ot_it` [19.55], `res.net` [119.29], `br.eps27` [0.0912].
- **Check:** Outside funding at 0% and at 100% swings net by about ±$19.6M (`res.tot_ot_it` 19.55); EPS does not move (05, "Who pays the one-time?").
- **Fallback:** If the MD hesitates, offer: "Try outside funding at one hundred percent." Reset to C afterwards.

## Beat 9b · Solve for this (after beat 9, 1 min)

- **Screen:** Cockpit.
- **Tour step:** `solve` (anchor `.gp-cockpit-bar`, the "of bar" number). The tour cannot open the edit popover, so the step points at the control that does, and the card says to click it.
- **Do:** Click the bar number. In the popover choose Solve for this. Read the value found, then Apply or Escape.
- **Say:** "Any number you can edit, you can solve backwards. Tell the app the goal, and it finds the value. If it cannot get there, it says so and shows the closest it can."
- **Fallback:** If the solve does not return, close the popover with Escape: nothing was changed.

## Beat 10 · Excel (18:00, 1.5 min)

- **Screen:** Excel.
- **Tour step:** `excel` (anchor `.gp-xl-chips`).
- **Do:** Export C + D. Open the rehearsal file already edited. Show the import review with one conflict.
- **Say:** "Your team can work in Excel. When it comes back the app shows exactly what changed, line by line, and flags the one place someone else got there first."
- **Live nodes:** none quoted. The review lists changed keys (read live).
- **Fallback:** If the upload fails, open the pre-imported review from the rehearsal run, or show the exported workbook only. Say: "The round trip is tested; here is the review it produces."

## Beat 11 · Airlines (19:30, 30 s)

- **Screen:** Airlines.
- **Tour step:** `airlines` (anchor `airlines-grid`).
- **Do:** Show the UA and AS tiles. Close.
- **Say:** "American is the first airline on it, not the only one. Same model, a different airline's numbers."
- **Live nodes:** none. The tenant names come from the tenant list.
- **Fallback:** If a tile is empty, say "Onboarding is a checklist, not a project" and stop.

---

## Wizard segment (3 min, replaces beats 4 to 6)

Use this instead of beats 4, 5 and 6 when the MD wants to build rather than watch (5:00 to 8:00, then straight to beat 7). It runs on the Build screen (`/:tenant/:scenario/wizard`). Tour steps `wizard` and `optimize` introduce it. **Start from a clean scenario C** so the quoted path numbers hold.

| Step | Time | Tour | Do | Say | Live nodes |
|---|---|---|---|---|---|
| 1 Levers | 0:00 to 0:40 | `wizard` | Open Build from the rail. Toggle Cloud FinOps (L11) off, watch the tape, toggle it back on. | "Four steps. First, which levers are even in play. Switch Cloud FinOps off and the tape drops. Switch it on and it comes back." | `lev.on[L11]` [1], `lev.iy[L11]` [8.96], `res.tot_iy` [138.84], `res.net` [119.29], `res.gap` [−23.69] |
| 2 Tune | 0:40 to 1:20 | `wizard` | Next. Pick Software (L10). Drag shelfware, then put it back to 10%. | "Second, tune the chosen ones. Shelfware at ten percent. Move it and the tape follows before I let go." | `lev.L10.shelf` [0.10], `lev.iy[L10]` [26.52], `lev.conf[L10]` [0.75] |
| 3 Policy | 1:20 to 2:00 | `wizard` | Next. Move outside funding, then restore it. Glance at Ownership. | "Third, the policy that is not about IT at all. Who pays the one-time cost. This is the CFO's lever, not ours." | `g.ot_out_share` [0.5], `res.tot_ot_it` [19.55], `res.tot_ot_out` [19.55], `g.target_net` [100], `res.bar` [142.98] |
| 4 Result | 2:00 to 3:00 | `optimize` | Next, or press Find a path in the tape from any step. When the moves land, press Use this path. | "Fourth, the answer. Find a path. The least risky way to the bar, as ranked moves. If AA likes it, Use this path, and it becomes its own scenario." | `res.net` [143.02], `res.bar` [142.98], risk exposure [42.01], one-time on IT [20.0], `br.eps27` [0.113] |

- **Check:** C `res.tot_ot_out` equals `res.tot_ot_it` at the default 50% outside share (`res.tot_ot_all` 39.10, `res.tot_ot_it` 19.55). Path numbers: `solver_demo_results.json`, `min_risk_total_bar` (net 143.02, risk exposure 42.01, one-time 20.0, EPS 0.113).
- **End state:** the wizard stays on step 4, the app is on the new `solver` scenario and the moved sliders show accent dots in steps 2 and 3. Say: "Everything I changed is now visible: the dots are the moves." Then continue with beat 7 (odds) on the new scenario.
- **Warning:** the optimizer starts from the current scenario. Any edit left over from steps 1 to 3 (Cloud FinOps off, shelfware, outside funding) changes the answer, and the quoted numbers will not match. Restore the three inputs, or say "about" and read the screen.
- **Fallbacks:** step 1 toggle does not move the tape: reload the page, the wizard step is not in the URL and resets to step 1. The solver is slow or fails: use "When a job is slow" below. The apply fails: open the saved path from the scenario bar and carry on.

---

## Closing (any time)

- **Tour step:** `restart` (anchor `[data-tour-button]`).
- **Say:** "If you want to run this yourself, the Tour button is in the top bar. And Command-K finds any number in the model."

## Presenter notes

**Tour keys.**

| Action | How |
|---|---|
| Start | Click Tour in the top bar. It always starts at step 1 and does not auto-start. |
| Next | Right arrow, Enter, or the Next button (Done on the last step). |
| Back | Left arrow, or Back. |
| Leave | Esc or Skip. The page is exactly as you left it. |
| Restart | Click Tour again. Starts at step 1. |
| Move around inside a card | Tab cycles inside the card. Focus lands on Next at each step. |
| Find any number | Command-K. |

- The tour moves between screens by itself, but it never edits a value and never changes the scenario. Everything you click is yours.
- Jump straight to a chapter with a deep link: add `?tour=wizard` (or `main`, `levers`, `close`, or any step id) to the URL. For the wizard variant, open `…/wizard?tour=wizard` after beat 3, or press Esc and drive the wizard by hand.
- The Tour button shows a dot until the tour has been seen in this browser. Clear it by finishing or skipping once. It is only a convenience.
- Do not start the tour with a dialog or palette open. Esc closes those first.

**While the compute indicator runs.** The glyphs and waves mean the math is running. Say what it is doing, not that you are waiting. For the optimizer: "It is trying more than sixteen hundred combinations of the levers, and keeping the cheapest risk." (1,634 evaluations in the reference run: `solver_demo_results.json`.) For odds: "Two thousand futures, each lever delivering a different share of its promise." Then stop talking and let the moves land. Do not describe the indicator.

**When a job is slow.**

1. Say the line for the work, not an apology. Offer the cancel button once.
2. The warmer pre-runs C and D so odds and the path appear from the run cache. Check this before the day. If a job is slow, it means the cache was cold or the scenario was edited. An edited scenario is a new problem and needs a fresh run.
3. Reference timings are long: the Python reference needed about 30 seconds for 2,000 Monte Carlo trials and about 21 seconds for a risk comparison. The app's target is under 10 seconds for 2,000 trials, but have the pre-run ready anyway.
4. If it is still running after about 20 seconds, cancel, switch to the saved Min-risk scenario or the pre-run odds, and go on. Never retry live.
5. If the stack is down: open the prototype file offline (see the checklist) and run beats 1 to 11 from it.

**Numbers.** Say amounts as "a hundred and forty-three", not "one forty-three point zero". Round to the figure the screen shows. If the screen and this script disagree, the screen is right: say what it shows and carry on.

## Pre-flight checklist: delta from `05_demo_storyline.md`

Everything in 05 "Before the day" still applies. Add:

- [ ] Open the tour once in the demo browser profile and finish it, so the Tour button's dot is gone, then check it still starts at step 1.
- [ ] Walk the tour end to end on the room's screen, in the theme you chose. Confirm each card sits clear of the content it points to.
- [ ] Rehearse the wizard segment from a clean scenario C. Confirm Find a path returns net 143.0, risk exposure 42.0 and one-time 20.0 on IT, then Use this path.
- [ ] After the wizard rehearsal, reset to C: Cloud FinOps on, shelfware 10%, outside funding 50%, ownership of Data & analytics 35 / 35 / 30, Brent for 2027 85.78.
- [ ] Pre-run C and D (Monte Carlo and the path) for the demo copy, as in 05. Confirm the odds panel shows 0% and 4.5%.
- [ ] Confirm the three keyboard routes work on the demo machine: Right arrow, Left arrow, Esc.
- [ ] Confirm the market data refresh (05) has not changed the beat 8 numbers: if it has, re-read EPS, price and 1.74 cents live and update the Say line.
- [ ] Confirm the Sabre renewal date (December 2024) with the owner before using it in beat 2.
- [ ] Keep this page open on the presenter's second screen, not on the room's.
