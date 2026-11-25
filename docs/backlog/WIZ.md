# WIZ · Guided build: wizard, walkthrough, compute indicator

Product-owner request for the demo (Fri 4 Dec 2026): a four-step **wizard** that feels like a calculator and an optimizer, a WalkMe-style **guided walkthrough** over the real screens with a written narrative, and a fluid **"math running" indicator** on every solver, optimizer and Monte Carlo run. Design, layouts, tour steps, file ownership and test commands: [`docs/ux/07_wizard_tour_plan.md`](../ux/07_wizard_tour_plan.md) (builders read it first).

**Tier-2 change: none.** The wizard binds existing registry variables, formula nodes, the `levers.families` view, the commit queue (changesets) and the existing solver routes (`min_risk_mix`, `monte_carlo` look-up). The only contract change is one enum value (`AppModule` gains `wizard`, WIZ-01). The bare URL keeps opening the Cockpit.

13 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2. Waves (at most 4 builders in flight): **0** WIZ-01 → WIZ-02 · **1** WIZ-03, WIZ-04, WIZ-09 · **2** WIZ-05, WIZ-06, WIZ-07, WIZ-08 · **3** WIZ-10 → WIZ-11 · **4** WIZ-12 → WIZ-13.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| WIZ-01 | Contract: `wizard` in `AppModule` | M4 | sonnet/medium | S | CON-03 |
| WIZ-02 | Web registry: wizard route, rail entry, frozen store and step stubs | M4 | sonnet/high | S | WIZ-01, WEB-12 |
| WIZ-03 | ui: ComputeFlow "math running" indicator | M4 | sonnet/high | M | UI-04, UI-02 |
| WIZ-04 | ui: tour primitives (spotlight, coachmark, placement) | M4 | sonnet/high | M | UI-07, UI-02 |
| WIZ-05 | Wizard I: frame, stepper, running-total tape, steps 1–2 | M4 | sonnet/high | M | WIZ-02, WIZ-03, MOD-04 |
| WIZ-06 | Wizard II: steps 3–4 and the optimizer | M4 | sonnet/high | M | WIZ-02, WIZ-03, MOD-05, MOD-07 |
| WIZ-07 | Tour engine and the 14 walkthrough steps | M4 | sonnet/high | M | WIZ-02, WIZ-04 |
| WIZ-08 | ComputeFlow wired into job states (JobHeader, RunIndicator, Path) | M4 | sonnet/high | S | WIZ-03, WEB-08, MOD-07 |
| WIZ-09 | Walkthrough narrative script | M4 | sonnet/medium | S | QA-05 |
| WIZ-10 | Shell entry points: Tour button and tour host | M4 | sonnet/high | S | WIZ-07 |
| WIZ-11 | E2E: wizard, tour, indicator, storyline-wizard | M4 | sonnet/high | M | WIZ-05, WIZ-06, WIZ-08, WIZ-10 |
| WIZ-12 | A11y, perf monitors and visual baselines for the new screens | M4 | sonnet/high | M | WIZ-11 |
| WIZ-13 | Integration and full regression | M4 | opus/high | M | WIZ-09, WIZ-12 |

## WIZ-01 · Contract: `wizard` in `AppModule`

```yaml
id: WIZ-01
title: "Contract: wizard in AppModule"
epic: WIZ
milestone: M4
priority: must
status: todo
stream: C
model: sonnet
effort: medium
depends_on: [CON-03]
tier: contract
package: "contract/api-contract"
contract: "AppModule enum (core.ts)"
inputs:
  - "docs/ux/07_wizard_tour_plan.md#2. Decisions"
  - "docs/ux/07_wizard_tour_plan.md#8. Work packages (WP-01)"
  - "contract/api-contract/src/core.ts (AppModule)"
acceptance:
  - "AppModule.options equals ['cockpit','wizard','baseline','levers','vps','path','market','excel','airlines'] (test in contract schemas spec)"
  - "SearchResult with module 'wizard' parses; every old module still parses (test)"
  - "tier 2 still typechecks and its tests pass unchanged: pnpm turbo run typecheck test --filter=@glidepath/server (no tier-2 file edited)"
  - "the one consumer assertion that counts contract modules is updated: e2e/src/a11y.test.ts expects 9 (test)"
gates: [G1, G2, G13]
size: S
notes: "Merge together with WIZ-02 (same builder session, two branches): until WIZ-02 lands, tier 1 does not typecheck because MODULE_COPY and moduleLoaders are exhaustive records. Owns e2e/src/a11y.test.ts for this one line only."
```

One enum value; tier 2 never emits it, so no server change.

## WIZ-02 · Web registry: wizard route, rail entry, frozen store and step stubs

```yaml
id: WIZ-02
title: "Web registry: wizard route, rail entry, frozen store and step stubs"
epic: WIZ
milestone: M4
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [WIZ-01, WEB-12]
tier: 1
package: "tier1-presentation/web/src/app (+ global/shell/modules.tsx, modules/wizard skeleton)"
contract: "moduleLoaders.wizard; MODULE_COPY.wizard; TOOL_ICONS.tour; wizardStore; OptimizerProvider/useWizardOptimizer stub"
inputs:
  - "docs/ux/07_wizard_tour_plan.md#2. Decisions"
  - "docs/ux/07_wizard_tour_plan.md#3. Wizard (module wizard)"
  - "docs/ux/07_wizard_tour_plan.md#8. Work packages (WP-02)"
  - "tier1-presentation/web/src/app/modules.ts"
  - "tier1-presentation/web/src/global/shell/modules.tsx"
acceptance:
  - "/:tenant/:scenario/wizard parses and renders the wizard chunk; bare URL and /:tenant/:scenario still redirect to cockpit (routes.test.ts)"
  - "build manifest has 9 distinct module chunks; preloaded modules unchanged (build.test.ts)"
  - "rail shows Build second, after Cockpit; palette screen results include wizard (modules.test.ts)"
  - "modules/wizard/store.ts matches the plan verbatim and has its own test (store.test.ts)"
  - "stubs StepLevers, StepTune, StepPolicy, StepResult, optimizer.tsx export the plan's signatures; the placeholder screen renders main[data-module=wizard] with no aria-busy"
gates: [G1, G2, G13]
size: S
notes: "Creates the wizard skeleton so WIZ-05 and WIZ-06 can run in parallel on disjoint files. After merge, ownership of the stubs passes to WIZ-05/WIZ-06 as listed in the plan; store.ts is frozen."
```

Adds the ninth module everywhere tier 1 enumerates modules.

## WIZ-03 · ui: ComputeFlow "math running" indicator

```yaml
id: WIZ-03
title: "ui: ComputeFlow math-running indicator"
epic: WIZ
milestone: M4
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [UI-04, UI-02]
tier: 1
package: "tier1-presentation/ui/src/compute"
contract: "ComputeFlow({ active, variant, progress, still, className }); computeCss; wavePath(); COMPUTE_GLYPHS"
inputs:
  - "docs/ux/07_wizard_tour_plan.md#5. Compute indicator"
  - "docs/ux/01_moodboard.md#Motion"
  - "tier1-presentation/ui/src/motion/README.md"
  - "tier1-presentation/ui/src/glass/quality.ts"
  - "tier1-presentation/ui/src/tokens/README.md"
acceptance:
  - "inactive renders nothing; inline and field variants render the plan's wave and glyph counts, aria-hidden, data-compute (test)"
  - "every @keyframes in computeCss animates only transform and opacity; durations and delays are calc() of var(--motion-*) tokens (test parses the css)"
  - "no backdrop-filter, filter or box-shadow in computeCss; colours only var(--accent*), var(--ink*) tokens (test)"
  - "prefersReducedMotion() or still=true: data-motion=still, a static wave and three static glyphs, no will-change (test)"
  - "off-screen (IntersectionObserver) sets data-visible=false and pauses animations (test with a fake observer)"
  - "wavePath is deterministic and stays inside its viewBox (test); lint clean (no hex, no px literals); axe clean (test)"
gates: [G1, G2, G12, G13]
size: M
notes: "Presentation only; it never reads or derives a business value. Progress is passed through as tier 2 sent it."
```

The motion that tells the room the math is running.

## WIZ-04 · ui: tour primitives (spotlight, coachmark, placement)

```yaml
id: WIZ-04
title: "ui: tour primitives (spotlight, coachmark, placement)"
epic: WIZ
milestone: M4
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [UI-07, UI-02]
tier: 1
package: "tier1-presentation/ui/src/overlays/tour"
contract: "TourOverlay, Spotlight, Coachmark, placeCard(), TourRect, TourPlacement, tourCss"
inputs:
  - "docs/ux/07_wizard_tour_plan.md#4. Walkthrough (tour)"
  - "tier1-presentation/ui/src/overlays/palette/dialog.ts (useDialog)"
  - "tier1-presentation/ui/src/overlays/palette/styles.ts (scrim)"
  - "docs/ux/04_component_inventory.md#Accessibility notes"
acceptance:
  - "placeCard keeps the card inside the viewport for each placement and flips when the preferred side does not fit; null rect centres the card (table test)"
  - "Spotlight draws one fixed hole around the rect with the scrim colour from tokens, pointer-events none, no backdrop-filter (test)"
  - "Coachmark is role=dialog aria-modal=false with labelled title and body, 'n / N' counter, Back, Next (Done on the last), Skip; Back disabled on step 1 (test)"
  - "keys: ArrowRight and Enter next, ArrowLeft back, Escape skip; Tab cycles inside the card; focus moves to the card on every step (test)"
  - "a polite live region announces 'Step n of N: title' once per step (test)"
  - "reduced motion: no transition on the spotlight or card (test); lint clean; axe clean (test)"
gates: [G1, G2, G12, G13]
size: M
notes: "No new runtime dependency (the tier-boundary test allows react, react-dom, router and zustand only)."
```

Generic, data-free tour parts.

## WIZ-05 · Wizard I: frame, stepper, running-total tape, steps 1–2

```yaml
id: WIZ-05
title: "Wizard I: frame, stepper, running-total tape, steps 1-2"
epic: WIZ
milestone: M4
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [WIZ-02, WIZ-03, MOD-04]
tier: 1
package: "tier1-presentation/web/src/modules/wizard (frame + steps 1-2 files)"
contract: "Wizard screen; binds res.tot_iy, res.tot_ot_it, res.net, res.bar, res.gap, lev.on, lev.iy, lev.conf, lev.rr, lev.ot, lev.Lxx.* sliders, levers.families"
inputs:
  - "docs/ux/07_wizard_tour_plan.md#3. Wizard (module wizard)"
  - "docs/ux/07_wizard_tour_plan.md#8. Work packages (WP-05)"
  - "tier1-presentation/web/src/modules/levers (LeverList.tsx, LeverDetail.tsx, levers.test.tsx)"
  - "docs/ux/02_information_architecture.md#7. Navigation and editing rules"
acceptance:
  - "stepper shows four steps with aria-current=step, Back and Next, and any step is reachable by click; the step survives a fork (URL scenario change) (test)"
  - "tape shows res.tot_iy − res.tot_ot_it = res.net vs res.bar and the res.gap chip, each as tier 2 pushes it, on every step (test: values equal the mock-session fixture)"
  - "tape 'Find a path' calls useWizardOptimizer().find(); while busy without a job id it shows ComputeFlow inline, with a job id it shows JobHeader (test)"
  - "step 1 lists the 17 levers by family from levers.families with a lev.on toggle each; toggling commits 1/0 through the commit queue (test)"
  - "step 2 shows only levers whose lev.on is 1; per lever lev.iy, lev.rr, lev.ot and one BoundSlider per lev.<Lxx>.* registry variable with ui.control slider (decisions first, estimates and lev.conf under Assumptions) with C and D ghosts (test)"
  - "variables in useWizardOptimizer().moved carry data-moved and an accent dot (test)"
  - "no arithmetic on received values; tokens only; axe clean on steps 1 and 2 (test)"
gates: [G1, G2, G11, G12, G13]
size: M
notes: "Read-only imports from modules/levers are not needed; copy patterns, do not import. Never edit files of another module."
```

The calculator half: every move shows on the tape at once.

## WIZ-06 · Wizard II: steps 3–4 and the optimizer

```yaml
id: WIZ-06
title: "Wizard II: steps 3-4 and the optimizer"
epic: WIZ
milestone: M4
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [WIZ-02, WIZ-03, MOD-05, MOD-07]
tier: 1
package: "tier1-presentation/web/src/modules/wizard (steps 3-4 + optimizer files)"
contract: "StepPolicy, StepResult, OptimizerProvider, useWizardOptimizer; POST /solver-runs min_risk_mix (pathSpec), GET /solver-runs/lookup monte_carlo (oddsSpec)"
inputs:
  - "docs/ux/07_wizard_tour_plan.md#3. Wizard (module wizard)"
  - "docs/ux/07_wizard_tour_plan.md#8. Work packages (WP-06)"
  - "tier1-presentation/web/src/modules/path (useSolverRun.ts, useAnalysis.ts, params.ts, copy.ts, useLanding.ts, path.test.tsx)"
  - "tier1-presentation/web/src/modules/vps (Controls.tsx, OwnershipPanel.tsx, styles.ts)"
  - "tier1-presentation/web/src/modules/cockpit (NetSavingsPanel.tsx, VpRings.tsx, scale.ts)"
acceptance:
  - "step 3 binds g.target_net (g.target_pct when g.target_mode is 2), g.absorb_growth, g.ot_out_share, g.head_start, lev.start and lev.ramp for each chosen lever, g.vp_target_method, g.chargeback_on and org.dom_share (vps OwnershipPanel), with res.target, base.headwinds, res.bar, res.tot_ot_it, res.tot_ot_out, vp.outlay shown (test)"
  - "step 4 shows the gauge of res.net against res.bar with res.target and base.headwinds as the bar's parts, res.gap, res.coverage, res.risk, res.gap_risk, br.eps27 and per VP vp.net, vp.bar, vp.gap (test)"
  - "odds: the monte_carlo look-up's P(res.net[] >= res.bar[]) from detail.probabilities; without a run, 'Run N trials' with tier 2's trial count (test)"
  - "find() posts min_risk_mix with pathSpec(objective, perVp) on the current scenario and moves the wizard to step 4; ComputeFlow field shows until the run ends; ranked moves land with the motion.stagger token (test with mock job)"
  - "apply() re-asks the same spec with save true and, on done, navigates to resultScenarioId; moves and moved var ids survive the scenario change (test)"
  - "cancel via JobHeader works; a failed run shows tier 2's detail (test); no arithmetic on received values; axe clean on steps 3 and 4 (test)"
gates: [G1, G2, G11, G12, G13]
size: M
notes: "Read-only imports allowed from modules/path, modules/vps and modules/cockpit/scale.ts as listed in the plan; never edit those files. Escalate to opus/high on a second failed review (demo-critical solver landing)."
```

The optimizer half: the existing Path solver, landed into the wizard.

## WIZ-07 · Tour engine and the 14 walkthrough steps

```yaml
id: WIZ-07
title: "Tour engine and the 14 walkthrough steps"
epic: WIZ
milestone: M4
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [WIZ-02, WIZ-04]
tier: 1
package: "tier1-presentation/web/src/global/tour"
contract: "TOUR_STEPS, TOUR_VERSION, tourStore, TourHost({ module }), TourButton(), readSeen/writeSeen"
inputs:
  - "docs/ux/07_wizard_tour_plan.md#4. Walkthrough (tour)"
  - "docs/ux/07_wizard_tour_plan.md#8. Work packages (WP-07)"
  - "docs/ux/05_demo_storyline.md#Run of show"
  - "tier1-presentation/web/src/global/shell/navigation.ts"
  - "tier1-presentation/web/src/bind/Value.tsx"
acceptance:
  - "TOUR_STEPS equals the plan's table (ids, modules, anchors, placements, copy); every {placeholder} names a spec id or {tenant}; no digits and no airline words in copy (test)"
  - "start opens step 1; next on a step of another module navigates there with toModule and waits for the anchor; back and skip work; Done on the last step closes (test with a fake router)"
  - "a missing anchor after the wait centres the card and sets data-tour-missing on the overlay (test)"
  - "live placeholders render as bound <Value> cells (node ids verbatim) and {tenant} as the tenant name from tier 2 (test)"
  - "seen is stored in localStorage key glidepath.tour.seen as TOUR_VERSION inside try/catch; blocked storage still runs the tour; the tour never auto-starts (test)"
  - "the tour never sends a changeset, preview or scenario switch (test: commit and session spies untouched)"
gates: [G1, G2, G12, G13]
size: M
notes: "Copy is presentation copy; numbers only through bound placeholders."
```

The walkthrough over the real screens.

## WIZ-08 · ComputeFlow wired into job states (JobHeader, RunIndicator, Path)

```yaml
id: WIZ-08
title: "ComputeFlow wired into job states (JobHeader, RunIndicator, Path)"
epic: WIZ
milestone: M4
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [WIZ-03, WEB-08, MOD-07]
tier: 1
package: "tier1-presentation/web/src/jobs (+ modules/path/ResultPanel.tsx call site)"
contract: "JobHeader (unchanged props), RunIndicator({ busy, jobId, note })"
inputs:
  - "docs/ux/07_wizard_tour_plan.md#5. Compute indicator"
  - "docs/ux/07_wizard_tour_plan.md#8. Work packages (WP-08)"
  - "tier1-presentation/web/src/jobs (JobHeader.tsx, jobs.test.tsx, README.md)"
  - "docs/ux/02_information_architecture.md#6. Screen states"
acceptance:
  - "JobHeader shows ComputeFlow inline while the job is queued or running (incl. cancelling) and none when done, failed or cancelled; the progressbar, note and cancel link are unchanged (test)"
  - "RunIndicator shows JobHeader with a job id, ComputeFlow plus 'Starting…' while busy without one, nothing otherwise (test)"
  - "Path Result panel: RunIndicator in the header while busy; ComputeFlow field above the empty state while finding (path.test.tsx new test; existing path tests unchanged and green)"
  - "Cockpit Odds and Fastest path, Path Odds and Tornado, VPs Feasible show the indicator through JobHeader without edits to those files (test in jobs.test.tsx with each status)"
gates: [G1, G2, G11, G12, G13]
size: S
notes: "Owns ResultPanel.tsx and path.test.tsx for this change only; no other module file."
```

Every long run shows the same motion.

## WIZ-09 · Walkthrough narrative script

```yaml
id: WIZ-09
title: "Walkthrough narrative script"
epic: WIZ
milestone: M4
priority: must
status: todo
stream: D
model: sonnet
effort: medium
depends_on: [QA-05]
tier: ops
package: "docs/ux/06_walkthrough_narrative.md"
contract: "Narrative keyed by the tour step ids of the plan"
inputs:
  - "docs/ux/05_demo_storyline.md"
  - "docs/ux/07_wizard_tour_plan.md#4. Walkthrough (tour)"
  - "docs/ux/07_wizard_tour_plan.md#3. Wizard (module wizard)"
  - "docs/spec/README.md (Headline numbers)"
  - "docs/spec/reference/solver_demo_results.json"
acceptance:
  - "one section per storyline beat (11) with time, screen, tour step id, Do, Say, the live node ids on screen and a fallback line (review)"
  - "a 3-minute wizard segment that can replace beats 4 to 6, step by step, ending on Find a path and Use this path (review)"
  - "every number quoted is in the spec bundle and marked as read live in the app (review against golden_results.json and solver_demo_results.json)"
  - "presenter notes: start, move, leave and restart the tour by keyboard; what to do when a job is slow (review)"
gates: [G10]
size: S
notes: "Docs only. Adds a new file to the read-only UX pack at the owner's request; edits no existing UX file."
```

What the presenter says, step by step.

## WIZ-10 · Shell entry points: Tour button and tour host

```yaml
id: WIZ-10
title: "Shell entry points: Tour button and tour host"
epic: WIZ
milestone: M4
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [WIZ-07]
tier: 1
package: "tier1-presentation/web/src/global/shell (GlobalLayout.tsx, styles.ts, shell.test.tsx, README.md)"
contract: "GlobalLayout mounts TourButton (top bar) and TourHost"
inputs:
  - "docs/ux/07_wizard_tour_plan.md#6. Shell entry points"
  - "docs/ux/07_wizard_tour_plan.md#8. Work packages (WP-10)"
  - "tier1-presentation/web/src/global/shell/GlobalLayout.tsx"
acceptance:
  - "top bar shows the Tour button before 'Find any number' on every module; icon only at phone width; data-tour-button and data-tour-seen as the tour reports (test)"
  - "TourHost is mounted once inside BindProvider and survives module changes (test)"
  - "rail test lists the 9 modules in contract order with Build second (test title and assertions updated)"
  - "existing shell tests stay green; axe clean (test)"
gates: [G1, G2, G11, G12, G13]
size: S
notes: "The wizard's own entry point (rail, ⌘K screen result) is WIZ-02."
```

Start the tour from anywhere; open the wizard from the rail.

## WIZ-11 · E2E: wizard, tour, indicator, storyline-wizard

```yaml
id: WIZ-11
title: "E2E: wizard, tour, indicator, storyline-wizard"
epic: WIZ
milestone: M4
priority: must
status: todo
stream: D
model: sonnet
effort: high
depends_on: [WIZ-05, WIZ-06, WIZ-08, WIZ-10]
tier: ops
package: "e2e (tests/wizard.spec.ts, tests/tour.spec.ts, tests/storyline-wizard.spec.ts, src/wizard.ts, configs, scripts)"
contract: "pnpm e2e:wizard; storyline config runs storyline-wizard.spec.ts"
inputs:
  - "docs/ux/07_wizard_tour_plan.md#7. Tests"
  - "docs/ux/07_wizard_tour_plan.md#8. Work packages (WP-11)"
  - "e2e/tests/storyline.spec.ts, e2e/tests/smoke.spec.ts, e2e/tests/fixtures.ts, e2e/src/storyline.ts"
acceptance:
  - "wizard.spec: tape equals golden C on open; lev.on L11 off then on returns net to golden C; a step-2 drag moves the tape before release; step 3 outside funding 0 and 1 swing net not EPS; step 4 bar equals spec prose bar, growth and target"
  - "wizard.spec: Find a path from C shows [data-compute], lands moves, net equals min_risk_total_bar.net, no move on L03-L05; Use this path switches the URL to the solver scenario with that net on the tape"
  - "wizard.spec: with L06 off, Find a path proposes no lev.L06.* move (a failure is a tier-2 finding, reported, never skipped)"
  - "tour.spec: 14 steps walked by keyboard, each step's module in the URL and anchor visible, no data-tour-missing; step 1 shows res.bar equal to the spec prose; seen persists; edits count and scenario unchanged after the tour"
  - "indicator: Path Find a path and a Cockpit 'Run N trials' on a fresh fork show [data-compute] until the job ends; with reducedMotion reduce it has no running animations"
  - "storyline-wizard.spec runs in the storyline config; wizard and tour specs run in playwright.wizard.config.ts and are ignored by the G9 smoke config (smoke stays under 180 s)"
gates: [G9, G10]
size: M
notes: "Numbers come from the spec bundle through the existing helpers (spec-headline.ts, storyline.ts, golden); none written in tests."
```

Proves the new flows on the compose stack.

## WIZ-12 · A11y, perf monitors and visual baselines for the new screens

```yaml
id: WIZ-12
title: "A11y, perf monitors and visual baselines for the new screens"
epic: WIZ
milestone: M4
priority: must
status: todo
stream: D
model: sonnet
effort: high
depends_on: [WIZ-11]
tier: ops
package: "e2e (a11y/a11y.spec.ts, perf/perf.spec.ts, src/visual.ts, src/visual.test.ts, visual/baselines)"
contract: "G11 shots 9 modules x 2 themes x 2 widths; G12 incl. wizard steps and tour; QA-08 compute indicator frame p95"
inputs:
  - "docs/ux/07_wizard_tour_plan.md#7. Tests"
  - "docs/ux/07_wizard_tour_plan.md#8. Work packages (WP-12)"
  - "e2e/visual/visual.spec.ts, e2e/src/visual.ts, e2e/a11y/a11y.spec.ts, e2e/perf/perf.spec.ts"
acceptance:
  - "a11y: axe zero serious on wizard steps 1 to 4 in both themes and with the tour open on Cockpit and Wizard"
  - "perf: compute_indicator_frame_p95_within_60fps (frame p95 <= 16.7 ms while a real solver job runs with the indicator on screen); glass layers <= 3 with the tour open"
  - "visual: MODULES has wizard (36 shots); the 32 old diffs are confined to the rail and the top bar (reviewer checks the diff images before --update); 4 new wizard baselines approved; report written"
  - "e2e unit tests (vitest) green with the new counts"
gates: [G8, G11, G12]
size: M
notes: "Baselines are regenerated only after WIZ-05..WIZ-10 are merged; never raise the pixel threshold."
```

The gates that guard the look, the access and the frame budget.

## WIZ-13 · Integration and full regression

```yaml
id: WIZ-13
title: "Integration and full regression"
epic: WIZ
milestone: M4
priority: must
status: todo
stream: D
model: opus
effort: high
depends_on: [WIZ-09, WIZ-12]
tier: ops
package: "repo (no feature code; docs/status note)"
contract: "Regression checklist of the plan section 9"
inputs:
  - "docs/ux/07_wizard_tour_plan.md#9. Final regression checklist"
  - "docs/architecture/08_quality_and_testing.md#1. Gates"
  - "docs/ux/06_walkthrough_narrative.md"
acceptance:
  - "every command of the checklist green on one commit of develop: typecheck, lint, unit, parity golden incl. 245/245 replay, fuzz, solvers, excel, leak, tier-check, smoke, wizard, storyline (11 beats + questions + wizard), int m2 and m3, a11y, perf, visual"
  - "a dry run of the narrative with the tour on the compose stack in Cruise and Daylight, timed (status note)"
  - "docs/status note lists each command, its result and any finding routed to its owner"
gates: [G1, G2, G3, G4, G5, G6, G7, G8, G9, G10, G11, G12, G13, G14]
size: M
notes: "A failing gate is fixed by the owning item's builder, never by weakening a test. INT-06 (freeze) should wait for this item."
```

One green run before the freeze.
