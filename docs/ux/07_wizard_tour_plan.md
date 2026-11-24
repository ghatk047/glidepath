# 07 · Wizard, walkthrough and compute indicator: design and build plan

Owner request for the demo on Fri 4 Dec 2026, planned as backlog epic **WIZ** ([`docs/backlog/WIZ.md`](../backlog/WIZ.md)). Builders read this page, their WIZ item and the files their work package lists. Nothing else is needed.

Three things are added:

1. **Wizard** (new module `wizard`, rail label "Build"): 1 Levers → 2 Tune → 3 Policy → 4 Result. A running-total tape sits at the top of every step, and "Find a path" can be pressed from any step.
2. **Walkthrough**: a WalkMe-style tour over the real screens, 14 steps that follow the 11 storyline beats. It can be restarted from the top bar. A narrative script goes with it (`06_walkthrough_narrative.md`).
3. **Compute indicator** (`ComputeFlow`): glyphs and waves that flow while a solver, optimizer or Monte Carlo job runs. It is drawn in the Cruise glass style, uses tokens only, respects reduced motion and is cheap to draw.

Keep copy short (01 moodboard, "Words"). Use the same six words as everywhere else: bar, net, gap, run-rate, locked, path.

---

## 1. Ground rules (from CLAUDE.md, restated for builders)

- Tier 1 only. Import only `@glidepath/api-contract`, `@glidepath/ui`, relative files, and react / react-dom / @tanstack/react-router / zustand. `src/app/imports.test.ts` fails on anything else. **No new npm dependency**, so there is no tour or animation library.
- Every number comes from tier 2: `useNode` / `<Value>` for nodes, `useVariable` / `<BoundSlider>` / `<BoundEditable>` for inputs, `useView` for views, and solver runs over the contract client. Do no arithmetic on received values. Layout scaling such as CSS `--value / --max` bar widths is allowed, as the Levers bars already do.
- Every write goes through the commit queue (`useVariable().commit`, `BoundSlider`, `ctx.commit`). Tier 2 applies it with `applyChangeset()`. A solver result lands with `save: true`, which makes tier 2 write a `solver` scenario.
- Spec ids are used verbatim. Tokens only: no hex and no `px` literals (lint), and `var(--…)` or `cssVar[...]` for every colour, radius and duration.
- No airline words in tier-1 literals ("AA", "American", "Sabre", "DXC", "Hyderabad"; lint). Use the tenant name from `useTenants()` instead.
- Run only the affected packages. While fixing, re-run only the failing test. Never skip or weaken a test.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **No tier-2 change.** | Every binding the wizard needs already exists. On/off is `lev.on[lever]`, the controls are `lev.Lxx.*`, policy is `g.*` / `org.dom_share`, outputs are the `res.*`, `vp.*`, `br.*` nodes (all `output: true`), lever grouping is the `levers.families` view, and the optimizer is the existing `min_risk_mix` job (`pathSpec`) and `monte_carlo` look-up (`oddsSpec`). |
| D2 | **One contract change: `AppModule` gains `'wizard'`, second after `'cockpit'`.** | The router, rail, ⌘K screens, a11y and perf loops all enumerate `AppModule.options`. The enum value goes second so the rail reads Cockpit → Build → … Tier 2 only uses the type (`search.ts`), so its code and tests are unchanged. Its own screen list stays at 8, and tier 1 builds ⌘K screen results from `MODULE_IDS`. |
| D3 | **New module, not a mode of an existing one.** | Existing routes, module tests, the storyline e2e and their baselines stay valid. The wizard gets its own chunk (`/:tenant/:scenario/wizard`). |
| D4 | **The bare URL still lands on the Cockpit.** | Storyline beat 1 opens on the Cockpit. Smoke, storyline, visual and a11y specs all open explicit module URLs. If the owner later wants the wizard as the landing page, change the two `module: 'cockpit'` redirects in `web/src/app/router.tsx` (index loader and `scenarioIndexRoute`) and update `web/src/app/routes.test.ts` tests "sends /:tenant/:scenario to the cockpit" (line ~71) and the two `/` redirect tests (lines ~110 and ~119, `/zz/s-c/cockpit`, `/zz/s-b/cockpit`), plus `web/src/app/README.md`. No e2e test or visual baseline depends on the bare URL. |
| D5 | **Wizard step state lives in a module-scope zustand store, not the URL.** | The first edit on a preset forks `Custom (from C)` and the URL's scenario changes. The step must survive that. URL search stays `lever/group/key/node` (strict), so `app/search.ts` and the view store are untouched. |
| D6 | **The wizard may import some files of `path`, `vps` and `cockpit` read-only** (list in WP-06). It must never edit them. | Reusing `useSolverRun`, `useAnalysis`, `pathSpec`, `oddsSpec`, `OwnershipPanel` and `gaugeMax` avoids duplicating demo-critical code. Vite splits the shared code into a common chunk. `build.test.ts` counts only module entry chunks (9 after WIZ-02). |
| D7 | **The tour never auto-starts, never writes and never switches scenario.** | Fresh browser contexts (e2e, visual) would otherwise be covered by it. A tour must not change the demo data. "Seen" only sets the Tour button's dot and is stored per viewer in `localStorage` as a convenience. |
| D8 | **No new design tokens.** `docs/ux/tokens.json` is read-only. | Durations are `calc()` multiples of `--motion-*`, and colours are the accent, ink and ground tokens. |
| D9 | **All 32 existing visual baselines are regenerated once, at the end (WIZ-12).** | The rail gains an item and the top bar gains the Tour button on every screen. The reviewer confirms the diffs touch only those two regions. |

## 3. Wizard (module `wizard`)

### 3.1 Frame (every step)

```
┌ top bar (shell) ─────────────────────────────────────────────────────────────┐
│ main.gp-module.gp-wizard[data-module=wizard]                                  │
│ ┌ Stepper [data-wizard-stepper] ────────────────────────────────────────────┐ │
│ │ (1) Levers   (2) Tune   (3) Policy   (4) Result         Back   Next       │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Tape [data-wizard-tape] (sticky, GlassPanel level 2) ────────────────────────┐ │
│ │ IN-YEAR $x − ONE-TIME $y = NET $z   vs  BAR $b   [▼ $g short]  ▓▓▓▓░░  [Find a path] │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│ section[data-wizard-step=n] … step content (12-col Grid) …                    │
└ flight strip (shell, unchanged) ─────────────────────────────────────────────┘
```

- **Stepper**: `<nav aria-label="Steps"><ol>` holding four buttons (`aria-current="step"` on the current one) and Back / Next buttons (`data-wizard-back`, `data-wizard-next`). Next on step 4 is hidden. Any step can be clicked, so the order is a guide and not a gate.
- **Tape** ("calculator tape"): the running total, on every step. Each value is a `<span data-node="…"><Value node="…" format="money"/></span>`. `Value` already rolls the number (`motion.roll`) and flashes the recalculated value (`motion.flash`), which gives the calculator feel. The glyphs `−`, `=` and `vs` are text. **No arithmetic is done in tier 1: tier 2 sends all three terms.**
  - `res.tot_iy` "In-year" · `res.tot_ot_it` "One-time" · `res.net` "Net" · `res.bar` "Bar" · `res.gap` as a `StatusChip` (as on Cockpit: "▼ $23.7M short" / "▲ … clear"). A meter `--value: res.net; --max: res.bar` (CSS width only).
  - **Find a path** button `[data-wizard-optimize]` calls `useWizardOptimizer().find()`. While `busy && !jobId` it shows `<ComputeFlow active variant="inline"/>`. With a `jobId` it shows `<JobHeader id={jobId}/>`, which carries the ComputeFlow after WIZ-08.
  - Phone (< 760 px): two rows. Row 1 is Net vs Bar plus the gap chip. Row 2 holds In-year, One-time and a full-width Find a path button.
- Previews from sliders reach tier 2 at ≤ 1 per 33 ms (existing bind layer). The tape updates while dragging, before release. That is the "live recalculation as you go".

### 3.2 Step 1 · Levers (on/off)

- Grid: **Levers** panel (span 8) and **Families** panel (span 4).
- Levers panel: the families of `useView('levers.families', {})` in tier 2's order. Each family is a heading row with its label and `family.value` (as sent). Each lever (member keys in `family.levers`, labels from `useMembers(tenant).data.dimensions.lever`) is a row: `Toggle` bound to `lev.on[Lxx]` (commit `1`/`0`), name button `data-lever="Lxx"` (click = focus lever and go to step 2), an in-year bar (`--value: lev.iy[Lxx]`, `--max: levers.scale.max` from `useView('levers.scale', {})`), `<Value node="lev.iy" member="Lxx"/>`, and a confidence chip `<Value node="lev.conf" member="Lxx" format="pct"/>`. An off lever is shown dimmed (`data-off`).
- Families panel: one compact bar per family (`family.value`, scaled to `levers.families.total`), plus `<Value node="res.tot_iy"/>` as the total.
- Do not count levers in tier 1 (no "7 of 17").

### 3.3 Step 2 · Tune (controls of the chosen levers)

- Grid: **Chosen** list (span 4) and **Lever** detail (span 8). On phone the list becomes horizontal chips above the detail.
- Chosen list: every lever in `levers.families` order. A row renders only when `lev.on[Lxx]` is `1`, so each row component reads its own `useVariable('lev.on', Lxx)` and returns `null` when off. Each row shows the name and `lev.iy`. Clicking a row sets `focusLever`.
- Detail for `focusLever ?? first lever in family order`:
  - If that lever is off, show "Switched off" plus its `lev.on` toggle.
  - KPIs: `lev.iy` (hero), `lev.rr`, `lev.ot` (`<Value member=Lxx>`).
  - **Decisions**: one `<BoundSlider variable="lev.Lxx.*" ghosts={['C','D']}/>` per bundle variable whose id starts with `lev.Lxx.`, with `ui.control === 'slider'` and `kind === 'decision'`, in bundle order.
  - **Assumptions** (`<details>`, collapsed): the same filter with `kind !== 'decision'` (grey thumbs, which the solver never moves), and `lev.conf[Lxx]` as a `Dial`. Copy the Levers module's `ConfidenceDial` pattern; do not import it.
  - Moved by the optimizer: any slider whose variable id is in `useWizardOptimizer().moved` gets `data-moved` and an accent dot (`var(--accent)`).

### 3.4 Step 3 · Policy (funding, target, timing, ownership)

- Grid row 1, three panels of span 4 each:
  - **Target**: `<BoundSlider variable="g.target_net"/>`. When `useVariable('g.target_mode').value === 2`, show `g.target_pct` instead. Also a `Toggle` bound to `g.absorb_growth` (commit 1/0). Read-outs: `res.target` "Target", `base.headwinds` "Growth", `res.bar` "Bar".
  - **Funding**: `<BoundSlider variable="g.ot_out_share"/>`. Read-outs: `res.tot_ot_it` "On IT", `res.tot_ot_out` "Outside IT".
  - **Timing**: `<BoundSlider variable="g.head_start"/>`, then one row per chosen lever (rows return `null` when `lev.on` is 0). Each row has a `<select data-variable-id="lev.start">` over `MONTH_NAMES` (from `@glidepath/ui/charts/monthly`; the value is the month number 1–12 as the Levers module does) and `<BoundEditable variable="lev.ramp" member=Lxx/>`.
- Grid row 2, **Ownership** (span 12): the VPs module's `Controls` (`g.vp_target_method`, `g.chargeback_on`) above its `OwnershipPanel` (`org.dom_share` by `domain,vp`). Both are imported read-only from `../vps`, with the `vpsCss` style tag. Feed them `vps` and `domains` exactly as `modules/vps/index.tsx` builds them from `useMembers`, and `step` from the bundle's `org.dom_share` definition. Under it is one row of `vp.outlay[vp]` per VP.

### 3.5 Step 4 · Result

- Grid row 1:
  - **Net vs bar** (span 5): `Gauge` (`@glidepath/ui/charts/gauge`) with `net=res.net`, `bar=res.bar`, `target=res.target`, `max=gaugeMax(bar, net)` (read-only import from `../cockpit/scale`). Centre: `res.net` hero, the `res.gap` chip, `res.coverage` (pct). Under it: "Bar = target + growth" as `res.target` + `base.headwinds`. The growth part is dimmed with "not absorbed" when `g.absorb_growth` is 0 (label only; the bar value is tier 2's).
  - **VP split** (span 7): one `RingTile` per VP. Copy `modules/cockpit/VpRings.tsx`; do not import it, because it links to VPs. Each tile shows `vp.net` against `vp.bar` and the `vp.gap` chip, with VP labels from `useMembers` (`member.label`).
- Grid row 2, three panels of span 4 each:
  - **Risk**: `res.risk` "Risk-adjusted net", `res.gap_risk` "Gap, risk-adjusted", `br.eps27` "EPS".
  - **Odds**: `useAnalysis(tenant, scenarioId, { problem: 'monte_carlo', ask: { quick: false, spec: oddsSpec } })`. P(clear) is `detail.probabilities.find(r => r.cell === NET_CELL && r.against === BAR_CELL).p`, shown with `fmt.pct`. With no run there is an `EmptyState` with "Run N trials" (N from `analysis.trials`, `fmt.fte`). Show `<JobHeader id={analysis.jobId}/>` in the header.
  - **Optimizer** `[data-wizard-optimizer]`: `RadioCard` of `OBJECTIVES` (read-only from `../path/copy`), a "Every VP clears" `Toggle` (`perVp`) and a **Find a path** button. While busy, `<ComputeFlow active variant="field"/>` and the job note. When done, see 3.6.

### 3.6 Optimizer: how moves land in the wizard

1. **Find a path** (tape or Step 4) calls `find()`. It sets `step = 4` and runs `runner.start({ quick: false, spec: pathSpec({ objective, perVp, usFloor: null, oneTimeCap: null, gccHiring: null }) })` (`useSolverRun` from `../path/useSolverRun`) on the current scenario. Switched-off levers stay off: the default decision sets do not include `lever_switch`.
2. While running: the tape and Step 4 show the indicator (3.1, 3.5), and `JobHeader` offers Cancel.
3. When done: the ranked moves (`result.ranked`, tier 2's order) land one by one with `useLanding(run.id, ranked.length)` (read-only from `../path/useLanding`, stagger = `motion.stagger`) as `MoveRow`s. Labels, min, max, step and unit come from the bundle variable whose id is the cell key without `[]`. The metrics shown are `METRIC.net`, `METRIC.oneTime`, `risk_exposure`, and a "Bar cleared" chip when `result.status` is `optimal` or `feasible`. Buttons: **Use this path** and **Discard**.
4. **Use this path** calls `apply()`. It asks the same question again with `save: true` (a second `useSolverRun`, the same as Path's "Save as scenario"). Tier 2 answers from its run cache and writes the `solver` scenario. On done, it invalidates `dataKeys.scenarios(tenant)`, shows the toast "Path applied", and calls `nav.toScenario(resultScenarioId)`. The wizard stays on step 4. Every bound number now shows the new scenario. The moves list and `moved` (variable ids) are kept in provider state across the scenario change, so steps 2 and 3 show accent dots on what moved. The next `find()` or **Discard** clears them.
5. An edit after landing forks a Custom scenario (tier 2) and works like any other edit.

### 3.7 Files and frozen interfaces (created by WIZ-02)

`modules/wizard/store.ts` is **frozen**. Write it exactly like this:

```ts
import { createStore, useStore } from 'zustand';

/** The four steps of the wizard, in order. */
export const WIZARD_STEPS = [1, 2, 3, 4] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

const FIRST = WIZARD_STEPS[0];
const LAST = WIZARD_STEPS[WIZARD_STEPS.length - 1]!;

export interface WizardState {
  /** The step on screen. Module scope (not the URL), so it survives forks and scenario switches. */
  step: WizardStep;
  /** Lever shown in step 2; `null` = the first lever in `levers.families` order. */
  focusLever: string | null;
  setStep(step: WizardStep): void;
  next(): void;
  back(): void;
  setFocusLever(lever: string | null): void;
  reset(): void;
}

const initial = { step: FIRST as WizardStep, focusLever: null };

export const wizardStore = createStore<WizardState>()((set) => ({
  ...initial,
  setStep: (step) => set({ step }),
  next: () => set((s) => ({ step: (s.step < LAST ? s.step + 1 : LAST) as WizardStep })),
  back: () => set((s) => ({ step: (s.step > FIRST ? s.step - 1 : FIRST) as WizardStep })),
  setFocusLever: (focusLever) => set({ focusLever }),
  reset: () => set(initial),
}));

export const useWizard = <T,>(select: (s: WizardState) => T): T => useStore(wizardStore, select);
```

`modules/wizard/optimizer.tsx` is a stub from WIZ-02 and is replaced by WIZ-06. The **exported interface must not change**:

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { RankedMove, SolverObjective, SolverResult, SolverRun } from '@glidepath/api-contract';

export interface WizardOptimizer {
  objective: SolverObjective;
  setObjective(objective: SolverObjective): void;
  perVp: boolean;
  setPerVp(on: boolean): void;
  /** A run is starting or running. */
  busy: boolean;
  /** Active job id (for JobHeader); null before the first job message and after the end. */
  jobId: string | null;
  /** The run on the current scenario as tier 2 last reported it. */
  run: SolverRun | null;
  /** Result of the last finished run; kept across `apply()`'s scenario switch. */
  result: SolverResult | null;
  /** `result.ranked`, tier 2's order; kept across `apply()`. */
  moves: readonly RankedMove[];
  /** Variable ids (cell key without `[member]`) of `moves`, for accent dots. */
  moved: ReadonlySet<string>;
  error: string | null;
  find(): void;
  applying: boolean;
  apply(): void;
  discard(): void;
}

const INERT: WizardOptimizer = {
  objective: 'min_risk_exposure',
  setObjective: () => undefined,
  perVp: false,
  setPerVp: () => undefined,
  busy: false,
  jobId: null,
  run: null,
  result: null,
  moves: [],
  moved: new Set(),
  error: null,
  find: () => undefined,
  applying: false,
  apply: () => undefined,
  discard: () => undefined,
};

const OptimizerContext = createContext<WizardOptimizer>(INERT);

/** Stub (WIZ-02). WIZ-06 replaces the body with the real provider; the signature stays. */
export function OptimizerProvider({ children }: { children: ReactNode }) {
  return <OptimizerContext value={INERT}>{children}</OptimizerContext>;
}

export const useWizardOptimizer = (): WizardOptimizer => useContext(OptimizerContext);
```

Step stubs from WIZ-02 (each a named export with no props, rendering `<section data-wizard-step="n" aria-label="…"/>`): `StepLevers.tsx` (1), `StepTune.tsx` (2), `StepPolicy.tsx` (3), `StepResult.tsx` (4). The placeholder `index.tsx` default-exports a screen that renders `<main className="gp-module gp-wizard" data-module="wizard" aria-label="Build a plan"/>`.

Final `index.tsx` (WIZ-05) composition:

```tsx
export default function Wizard() {
  const { tenant, session } = useBindContext();
  const api = useApiClient();
  const cancel = useMemo(() => solverRunCanceller(api, tenant), [api, tenant]);
  return (
    <JobsProvider session={session} cancel={cancel}>
      <OptimizerProvider>
        <WizardScreen />   {/* Stepper, Tape, the current Step*, StepNav */}
      </OptimizerProvider>
    </JobsProvider>
  );
}
```

### 3.8 Copy (all of it)

| Where | Text |
|---|---|
| Rail / title (WIZ-02, `MODULE_COPY.wizard`) | label `Build`, title `Build a plan` |
| Stepper (WIZ-05 `copy.ts`) | `Levers`, `Tune`, `Policy`, `Result`, `Back`, `Next` |
| Tape | `In-year`, `One-time`, `Net`, `Bar`, `Find a path`, `Starting…` |
| Step 1 | panels `Levers`, `Families` |
| Step 2 | panels `Chosen`, lever label as title; `Decisions`, `Assumptions`, `Switched off` |
| Step 3 (WIZ-06 `copyResult.ts`) | panels `Target`, `Funding`, `Timing`, `Ownership`; `Absorb growth`, `Target`, `Growth`, `Bar`, `On IT`, `Outside IT`, `Head start`, `Start`, `Ramp` |
| Step 4 | panels `Net vs bar`, `VP split`, `Risk`, `Odds`, `Optimizer`; `Bar = target + growth`, `not absorbed`, `Risk-adjusted net`, `Gap, risk-adjusted`, `EPS`, `P(clear)`, `Every VP clears`, `Bar cleared`, `Use this path`, `Discard`, `Path applied`, `Run N trials` (path `COPY.runTrials` form) |

### 3.9 Data attributes (stable hooks for e2e and the tour)

`[data-module="wizard"]`, `[data-wizard-stepper]`, `[data-wizard-tape]`, `[data-wizard-optimize]` (tape button), `[data-wizard-optimizer]` (step-4 panel), `[data-wizard-step="1..4"]`, `[data-wizard-next]`, `[data-wizard-back]`, `[data-lever="Lxx"]`, `[data-variable-id]` (existing on bound controls), `[data-node]` / `[data-member]` on read-outs, `[data-moved]`, `[data-compute]` (indicator).

## 4. Walkthrough (tour)

### 4.1 Architecture

- **`@glidepath/ui/overlays/tour` (WIZ-04)** holds the generic parts and no data:
  - `placeCard(target: TourRect | null, card: {width,height}, viewport: {width,height}, preferred: TourPlacement, gap: number) → { top, left, placement }`. It is pure. It flips to the opposite side, then the other axis, then centres. `null` target means centre.
  - `Spotlight({ rect })`: one `position: fixed` element at `rect` (plus padding), with a large spread `box-shadow` in `color-mix(in srgb, var(--ground) 55%, transparent)` (the palette scrim recipe), radius `--radius-card`, and an accent ring (`--accent-glow`). It uses `pointer-events: none`, so the highlighted control stays clickable, and **no backdrop-filter**. Position moves with `transform`, with a transition of `--motion-value` and `--motion-ease` that is off under reduced motion.
  - `Coachmark`: a `GlassPanel level={3}` card with `role="dialog" aria-modal="false" aria-labelledby aria-describedby`. It shows a counter `n / N`, title, body (ReactNode), Back, Next (Done on the last step), Skip, and progress dots (aria-hidden). Focus uses `useDialog` (relative import of `../palette/dialog`): focus lands on Next at each step and Tab cycles inside. Keys: → and Enter for next, ← for back, Esc for skip. A polite live region announces "Step n of N: title" once per step.
  - `TourOverlay({ rect, index, count, title, body, preferred, onNext, onBack, onClose })`: measures the card and composes Spotlight and Coachmark. At phone width (`media.phone`) the card docks as a bottom sheet above the rail. `tourCss` sets z-index: spotlight below the palette scrim (95) and card just above the spotlight.
- **`web/src/global/tour` (WIZ-07)** is the engine:
  - `steps.ts`: `TourStepDef { id; module: ModuleId | null; anchor: string | null; placement: TourPlacement; title: string; body: string }`, plus `TOUR_STEPS` (table 4.2) and `TOUR_VERSION = '1'`.
  - `body.tsx`: renders `body` placeholders. `{res.net}` becomes `<Value node="res.net"/>` (format by unit). `{base.locked_share|pct}` passes an explicit `FormatName`. `{vp.net[vp_x]}` passes a member. `{tenant}` is the tenant name from `useTenants()`.
  - `store.ts`: zustand `tourStore { open, index, start(), next(), back(), close(reason: 'done' | 'skip') }`. `close` writes seen.
  - `seen.ts`: `readSeen() / writeSeen()` on `localStorage['glidepath.tour.seen'] = TOUR_VERSION`. Every access is wrapped in try/catch.
  - `useAnchor(selector)`: finds the element. It tracks its rect with ResizeObserver, scroll and resize listeners (rAF-throttled), and waits with a MutationObserver up to `ANCHOR_WAIT_MS = 2 × motionMs('toast')`. It returns `{ rect, missing }`. When found it calls `scrollIntoView({ block: 'center' })` (`behavior: 'auto'` under reduced motion).
  - `TourHost({ module })`: when open and `step.module` differs from `module`, it calls `useShellNavigation().toModule(step.module)` and waits. It renders `TourOverlay` inside a wrapper `[data-tour][data-tour-step=<id>]`, with `data-tour-missing` when the anchor did not appear (the card centres and the tour can continue). It closes on tenant change. It **never** calls commit, preview or `toScenario`.
  - `TourButton()`: a top-bar icon button (`TOOL_ICONS.tour` from `../shell/modules`) with text "Tour", `aria-label="Start the walkthrough"`, `data-tour-button` and `data-tour-seen` when seen. A small accent dot shows until seen. Clicking it calls `start()` (always at step 1).

### 4.2 Steps (copy is final; at most 16 words each; numbers only via placeholders)

| # | id | module | anchor | place | title | body |
|---|---|---|---|---|---|---|
| 1 | `bar` | cockpit | `[data-testid="cockpit-net"]` | right | The bar | Net {res.net} against a bar of {res.bar}: the target {res.target} plus cost growth {base.headwinds}. |
| 2 | `baseline` | baseline | `.gp-treemap` | right | Where the money is | {base.locked_share\|pct} of {base.total} is locked: it cannot move this year. |
| 3 | `rates` | cockpit | `.gp-seg` | bottom | Scenarios | Try R: squeezing vendor rates alone is not a plan. |
| 4 | `levers` | levers | `[data-lever-detail]` | left | Levers | Each lever has its own timing and confidence. Watch the strip below. |
| 5 | `vps` | vps | `.gp-vps-rows` | top | Who owns what | Drag a domain toward another VP. Every VP bar follows. |
| 6 | `path` | path | `.gp-path-actions` | top | Find a path | The least risky way to {res.bar}, as ranked moves. |
| 7 | `odds` | path | `[data-testid="path-odds"]` | left | Odds | If each lever only delivers its confidence, how often is the bar cleared? |
| 8 | `market` | market | `[data-testid="market-trace"]` | right | Shareholders | IT net becomes {br.eps27\|eps} of EPS, about {br.px27} a share. |
| 9 | `handover` | cockpit | `[data-testid="cockpit-inputs"]` | left | Your numbers | Outside funding and the target are yours to change. |
| 10 | `excel` | excel | `[data-module="excel"] .gp-xl-chips` | bottom | Excel | Export, work offline, import. The app shows exactly what changed. |
| 11 | `airlines` | airlines | `[data-testid="airlines-grid"]` | top | Airlines | {tenant} is the first airline on it, not the only one. |
| 12 | `wizard` | wizard | `[data-wizard-stepper]` | bottom | Build a plan | Pick levers, tune them, set policy, see the result. |
| 13 | `optimize` | wizard | `[data-wizard-optimize]` | bottom | Optimize | From any step, let the solver find the least risky path. |
| 14 | `restart` | null | `[data-tour-button]` | bottom | Any time | Restart the tour here. ⌘K finds any number. |

Steps 1–11 follow the storyline beats 1–11 in order. Step 3 does not switch to R: the presenter clicks it if they want to. The narrative (`06_walkthrough_narrative.md`, WIZ-09) is keyed by these ids. Copy test (WIZ-07): no digit appears outside `{…}`, and no airline word appears.

## 5. Compute indicator (`@glidepath/ui/compute`, WIZ-03)

### 5.1 Concept

The "math is running" look is a band of thin, interfering sine waves that flow sideways while maths glyphs (`∑ ∫ ∂ λ σ μ ∇ π ≈ Δ √ ∞`) rise and fade through them, all in the accent tones over glass. It reads as computation, not decoration (moodboard: motion shows cause). It appears only while a job is queued or running and stops when the job ends.

### 5.2 API

```ts
export interface ComputeFlowProps {
  active: boolean;                     // false → renders nothing
  variant?: 'inline' | 'field';        // inline: panel header / tape; field: fills its box (empty state, step 4)
  progress?: number | null;            // 0..1 exactly as tier 2 sent it; brightens the glyph layer; null = indeterminate
  still?: boolean;                     // force the static rendering (low-glass quality, tests)
  className?: string;
}
export function ComputeFlow(props: ComputeFlowProps): JSX.Element | null;
export const computeCss: string;       // mounted with <style href="glidepath-compute" precedence="glidepath">
export function wavePath(cycles: number, amplitude: number): string;   // pure, viewBox 0 0 200 40, periodic over 200
export const COMPUTE_GLYPHS: readonly string[];
```

Root: `<span class="gp-compute" data-compute data-variant data-motion="on|still" data-visible aria-hidden="true">`. It is decorative: the accessible signal stays `JobHeader`'s progressbar and note.

### 5.3 Technique (HTML + small inline SVG + CSS; no canvas, no JS animation loop)

- **Waves**: inline has 3, field has 4. Each wave is an absolutely positioned HTML `<i>` wrapper, `width: 200%`, holding one small inline `<svg viewBox="0 0 400 40" preserveAspectRatio="none">` that contains the periodic path drawn twice. The **wrapper** (an HTML element, so it composites on the GPU; never animate `transform` on SVG children) loops `transform: translate3d(-50%,0,0)` linearly. Durations are `calc(var(--motion-flash) * 4|5|7)` (different per wave, so they interfere and seem to morph), and every other wave alternates direction. Strokes are `var(--accent)`, `var(--accent-2)` and `var(--ink-3)` at stroke-opacity .35–.8. Stroke width is in viewBox units, with `vector-effect: non-scaling-stroke`.
- **Glyphs**: inline has 6, field has 12 `<b>` spans in `--font-mono`, sized `--type-xs-size` inline or `--type-l-size` field, coloured `var(--accent)`. Keyframes `gp-compute-rise` run from `translate3d(0, 60%, 0)` with opacity 0 to opacity .8 to `translate3d(0, -60%, 0)` with opacity 0, over `calc(var(--motion-roll) * 5)`. The delay is `calc(var(--motion-stagger) * var(--i) * 4)`, with `--i` set inline per glyph. Horizontal positions are fixed percentages from the glyph index.
- **Entry**: the root fades in with opacity over `--motion-value` after a delay of `--motion-value`, so a job that ends within ~0.4 s never flickers.
- **Glow**: a `radial-gradient` of `--accent-glow` behind the field variant only. No `filter`, no `backdrop-filter`, no `box-shadow` (the glass budget stays ≤ 3 layers).
- **Size**: inline is `6rem × 1.25rem`, field is `100% × min 7.5rem`. Both use `contain: strict`, `overflow: hidden`, and an explicit size, so animation never triggers layout outside the box. `will-change: transform` applies only to the moving wrappers, and only while `data-motion="on"` and `data-visible="true"`.

### 5.4 Frame budget (demo Mac: frame p95 ≤ 16.7 ms)

- Only `transform` and `opacity` animate, on ≤ 16 layers (field) or ≤ 10 (inline). That is compositor-only, with no per-frame JS and no layout or paint. A unit test parses `computeCss` and fails on any other animated property.
- Off-screen pause: an IntersectionObserver sets `data-visible="false"`, which sets `animation-play-state: paused` and removes `will-change`. Hidden tabs are throttled by the browser.
- At most one field and a few inline instances are on screen at once (one per running job).
- Measured by WIZ-12 `compute_indicator_frame_p95_within_60fps` while a real solver job runs, and on the Mac with `pnpm e2e:perf -- --device`.

### 5.5 Reduced motion and low quality

- `prefersReducedMotion()` (ui/motion), `still`, or `useGlassQuality() === 'low'` (when a GlassProvider exists) sets `data-motion="still"`. The still state shows one static wave and three static glyphs at fixed positions, with no keyframes and no will-change. The global `reducedMotionCss` also stops every animation. The job's progressbar keeps showing progress.

### 5.6 Wiring (WIZ-08 + WIZ-05/06)

| Run | Where it shows | How |
|---|---|---|
| Any worker job with a `JobHeader` (Cockpit Odds and Fastest path, Path Result, Odds and Tornado, VPs Feasible, Wizard odds and optimizer) | panel header | `JobHeader` renders `<ComputeFlow active variant="inline" progress={job.progress}/>` before the note while `queued` or `running` (also while cancelling). The existing progressbar, note and cancel are unchanged. |
| Start of a run, before the first `job` message (POST in flight; quick runs) | header | `RunIndicator({ busy, jobId, note })`: `JobHeader` when `jobId`, else ComputeFlow inline plus "Starting…" while `busy`. |
| Path · Find a path (storyline beat 6) | Result panel body | `ResultPanel`: while `busy && !done`, `<ComputeFlow active variant="field"/>` above the `EmptyState` ("Finding a path…"). The header uses `RunIndicator`. |
| Wizard optimizer | tape + Step 4 Optimizer panel | 3.1 and 3.5 |

## 6. Shell entry points

- **Open the wizard**: the rail item `Build` (second), the ⌘K screen result "Build a plan" (automatic from `MODULE_IDS` and `MODULE_COPY`), tour step 12, and direct URL `/:tenant/:scenario/wizard`. Cockpit is not edited.
- **Start the tour**: the `TourButton` in the top bar's tools, before "Find any number" (WIZ-10 mounts it in `GlobalLayout` with `<TourHost module={module}/>` inside `BindProvider`, after `BoundFlightStrip`). It is icon only at phone width.
- Icons (WIZ-02, `global/shell/modules.tsx`), 24-unit strokes like the others:
  - `MODULE_COPY.wizard.icon`: `<path d="M4 18h4v-4h4v-4h4V6h4"/><circle cx="4" cy="18" r="1.4"/><circle cx="20" cy="6" r="1.4"/>`
  - `TOOL_ICONS.tour`: `<circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 11h1v5h1"/>`

## 7. Tests

### 7.1 Unit (vitest, per package; msw + the contract's mock session, as `levers.test.tsx` and `path.test.tsx` do)

| Package | File | Covers |
|---|---|---|
| contract | `schemas.spec.ts` (+1 test) | `AppModule.options` order with `wizard` |
| web/app | `routes.test.ts`, `modules.test.ts`, `build.test.ts` | 9 modules, `/…/wizard` parses, redirects still go to cockpit, 9 chunks |
| web/wizard | `store.test.ts` (WIZ-02), `wizard.test.tsx` (WIZ-05), `result.test.tsx` (WIZ-06) | each acceptance line, axe per step |
| ui/compute | `compute.test.tsx` | 5.2–5.5 |
| ui/overlays/tour | `tour.test.tsx` | placement table, keys, focus, live region, reduced motion, axe |
| web/tour | `tour.test.tsx` | steps table, navigation, missing anchor, placeholders, seen, never writes |
| web/jobs | `jobs.test.tsx` | indicator per job status, RunIndicator |
| web/path | `path.test.tsx` (+1 test) | field indicator while finding |
| web/shell | `shell.test.tsx` | Tour button, host mount, rail of 9 |
| e2e/src | `a11y.test.ts` (9), `visual.test.ts` (9/36), `wizard.test.ts` | helpers |

### 7.2 E2E (compose stack)

- `e2e/tests/wizard.spec.ts` and `e2e/tests/tour.spec.ts` run in the new `playwright.wizard.config.ts` (`pnpm e2e:wizard -- --trace off`). They are **ignored by the G9 smoke config**, so smoke stays under its 180 s budget.
- `e2e/tests/storyline-wizard.spec.ts` runs in the storyline config (`testMatch` gets it). Test `wizard_alt_beats_04_to_06_build_a_plan_and_optimize_to_the_bar` follows the narrative's wizard segment.
- Expected numbers come only from the spec bundle through the existing helpers: `golden_results.json` via `fixtures.goldenOf`, `specProse()` (bar, growth), `solver_demo_results.json` via `e2e/src/storyline.ts`, and `PEOPLE_LEVERS`. Text is formatted with the UI's own `fmt`, as `tests/cockpit.ts` does.
- Indicator tests run on a fresh copy of C (`stack.api.scenarioCreate({ mode: 'copy', from })` in set-up), so the Monte Carlo look-up is empty and a real job runs. The reduced-motion check uses a context with `reducedMotion: 'reduce'` and asserts `el.getAnimations({ subtree: true }).length === 0` on `[data-compute]`.
- A11y (`a11y.spec.ts`): wizard steps 1–4 × 2 themes, and the tour open on Cockpit and Wizard. Perf (`perf.spec.ts`): `compute_indicator_frame_p95_within_60fps` and `glass_layers_within_budget_with_tour_open`. Visual: `MODULES` gets `wizard` (step 1, 4 new shots, 36 total).

---

## 8. Work packages (Sonnet builders; file ownership is exclusive)

Legend: **C** create, **M** modify. "Read" means read-only input: never edit it. A file appears under exactly one package. Two hand-offs are sequential and declared: WP-02 creates stubs that WP-05/WP-06 then own; WP-01's consumer-count fix is its only e2e file. Waves: **0** WP-01 → WP-02 · **1** WP-03, WP-04, WP-09 · **2** WP-05, WP-06, WP-07, WP-08 · **3** WP-10 → WP-11 · **4** WP-12 → WP-13.

### Shared-file ownership (the files more than one feature touches)

| File | Owner |
|---|---|
| `contract/api-contract/src/core.ts` | WP-01 |
| `e2e/src/a11y.test.ts` | WP-01 |
| `web/src/app/modules.ts` (+ `routes.test.ts`, `modules.test.ts`, `build.test.ts`, `README.md`) | WP-02 |
| `web/src/app/router.tsx` | nobody (unchanged, D4) |
| `web/src/global/shell/modules.tsx` (MODULE_COPY, TOOL_ICONS) | WP-02 |
| `web/src/global/overlays/README.md` ("eight screens" → nine) | WP-02 |
| `web/src/global/shell/GlobalLayout.tsx`, `styles.ts`, `shell.test.tsx`, `README.md` | WP-10 |
| `web/src/modules/wizard/store.ts`, `store.test.ts` | WP-02 (frozen) |
| `web/src/modules/wizard/index.tsx`, `StepLevers.tsx`, `StepTune.tsx` | WP-02 stub → WP-05 |
| `web/src/modules/wizard/optimizer.tsx`, `StepPolicy.tsx`, `StepResult.tsx` | WP-02 stub → WP-06 |
| `web/src/jobs/*` | WP-08 |
| `web/src/modules/path/ResultPanel.tsx`, `path.test.tsx`, `README.md` | WP-08 |
| every other file of `modules/path`, `modules/vps`, `modules/cockpit` | nobody (read-only imports for WP-06) |
| `e2e/playwright.config.ts`, `playwright.storyline.config.ts`, `e2e/package.json`, root `package.json` | WP-11 |
| `e2e/src/visual.ts`, `visual.test.ts`, `e2e/visual/baselines/**`, `a11y/a11y.spec.ts`, `src/a11y.ts`, `perf/perf.spec.ts`, `src/perf.ts` | WP-12 |
| `docs/ux/06_walkthrough_narrative.md` | WP-09 |
| `docs/status/*-wiz.md` | WP-13 |

Common commands (from the repo root, after `pnpm i`):

- Unit gate for a package and its dependents: `pnpm turbo run typecheck lint test --filter=<pkg>...`
- Re-run one failing file while fixing: `pnpm --filter <pkg> exec vitest run <path>`
- Tier boundary: `pnpm tier-check`
- Stack for e2e: `cp .env.example .env` (if missing), then `docker compose up -d --build`

---

### WP-01 · WIZ-01 · Contract enum (sonnet/medium)

- **M** `contract/api-contract/src/core.ts`: insert `'wizard'` after `'cockpit'` in `AppModule`. Update its comment to name nine modules.
- **M** `contract/api-contract/src/schemas.spec.ts`: add a test asserting `AppModule.options` equals the 9-id order, and that a `SearchResult` with `module: 'wizard'` parses.
- **M** `e2e/src/a11y.test.ts`: `toHaveLength(9)`.
- Read: `tier2-logic/server/src/routes/explain/search.ts` (confirm nothing to change).
- Run: `pnpm turbo run typecheck lint test --filter=@glidepath/api-contract...` (tier 1 typecheck fails until WP-02 lands, which is expected; run WP-02 next in the same session), `pnpm --filter @glidepath/e2e test`, `pnpm tier-check`.

### WP-02 · WIZ-02 · Web registry and wizard skeleton (sonnet/high)

- **M** `web/src/app/modules.ts`: `wizard: () => import('../modules/wizard')`. `PRELOADED_MODULES` is unchanged. Update the comment ("nine modules").
- **M** `web/src/app/routes.test.ts`: length 9, titles. Redirect expectations stay `cockpit`.
- **M** `web/src/app/modules.test.ts`: test title only. **M** `web/src/app/build.test.ts`: `toHaveLength(MODULE_IDS.length)` / titles.
- **M** `web/src/app/README.md` and `web/src/global/overlays/README.md`: the module count.
- **M** `web/src/global/shell/modules.tsx`: `MODULE_COPY.wizard` and `TOOL_ICONS.tour` (§6), and the "nine" comment.
- **C** `web/src/modules/wizard/store.ts` (verbatim §3.7) and `store.test.ts` (step bounds, reset, focusLever).
- **C** stubs per §3.7: `index.tsx`, `optimizer.tsx`, `StepLevers.tsx`, `StepTune.tsx`, `StepPolicy.tsx`, `StepResult.tsx`.
- Read: §2, §3.7, §6; `global/overlays/palette.ts` (screens come from `MODULE_IDS`).
- Run: `pnpm turbo run typecheck lint test --filter=@glidepath/web...`, `pnpm tier-check`.

### WP-03 · WIZ-03 · ui ComputeFlow (sonnet/high)

- **C** `tier1-presentation/ui/src/compute/index.ts`, `ComputeFlow.tsx`, `wave.ts` (`wavePath`, `COMPUTE_GLYPHS`), `styles.ts` (`computeCss`, using `cssVar` / `var(--…)` and `rem` helpers like the other ui styles), `compute.test.tsx`, `README.md`.
- Read: §5; `ui/src/motion/*` (`prefersReducedMotion`, `motionMs`), `ui/src/glass/GlassProvider.tsx` (`useGlassQuality`; check how it behaves with no provider and fall back to full quality), `ui/src/tokens/README.md`, `ui/src/hud/styles.ts` (style conventions).
- Run: `pnpm turbo run typecheck lint test --filter=@glidepath/ui...`.

### WP-04 · WIZ-04 · ui tour primitives (sonnet/high)

- **C** `tier1-presentation/ui/src/overlays/tour/index.ts`, `place.ts`, `Spotlight.tsx`, `Coachmark.tsx`, `TourOverlay.tsx`, `styles.ts` (`tourCss`), `tour.test.tsx`, `README.md`.
- Read: §4.1; `ui/src/overlays/palette/dialog.ts` (`useDialog`, relative import), `ui/src/overlays/palette/styles.ts` (scrim recipe, z-index), `ui/src/glass/GlassPanel.tsx`, `ui/src/tokens/media.ts`.
- Run: `pnpm turbo run typecheck lint test --filter=@glidepath/ui...`.

### WP-05 · WIZ-05 · Wizard frame and steps 1–2 (sonnet/high)

- **M** (take over) `web/src/modules/wizard/index.tsx`, `StepLevers.tsx`, `StepTune.tsx`.
- **C** `web/src/modules/wizard/Stepper.tsx`, `Tape.tsx`, `StepNav.tsx`, `copy.ts`, `styles.ts` (`wizardCss`, mounted in `index.tsx` as `<style href="glidepath-wizard" precedence="glidepath">`), `wizard.test.tsx`, `README.md`.
- Use: `useWizard` / `wizardStore` (do not edit `store.ts`), `useWizardOptimizer` (do not edit `optimizer.tsx`), `@glidepath/ui/compute`, `JobHeader` / `JobsProvider` / `solverRunCanceller` from `../../jobs`, bind and data hooks.
- Read: §3.1–3.3, §3.7–3.9; `modules/levers/LeverList.tsx`, `LeverDetail.tsx`, `index.tsx`, `levers.test.tsx` (patterns only, no imports); `modules/cockpit/NetSavingsPanel.tsx` (gap chip pattern).
- Run: `pnpm turbo run typecheck lint test --filter=@glidepath/web...`, `pnpm tier-check`. While fixing: `pnpm --filter @glidepath/web exec vitest run src/modules/wizard/wizard.test.tsx`.

### WP-06 · WIZ-06 · Wizard steps 3–4 and optimizer (sonnet/high; escalate to opus/high on a second failed review)

- **M** (take over) `web/src/modules/wizard/optimizer.tsx` (real provider, same exports), `StepPolicy.tsx`, `StepResult.tsx`.
- **C** `web/src/modules/wizard/Moves.tsx`, `Odds.tsx`, `copyResult.ts`, `resultStyles.ts` (mounted by StepPolicy and StepResult as `<style href="glidepath-wizard-result" precedence="glidepath">`), `result.test.tsx`.
- Read-only imports allowed: `../path/useSolverRun` (`useSolverRun`, `terminal`, `Ask`), `../path/useAnalysis`, `../path/params` (`pathSpec`, `oddsSpec`, `PathChoice`), `../path/copy` (`OBJECTIVES`, `DEFAULT_OBJECTIVE`, `METRIC`, `NET_CELL`, `BAR_CELL`, `RISK_EXPOSURE`, `COPY.runTrials`), `../path/useLanding`, `../vps/Controls`, `../vps/OwnershipPanel`, `../vps/styles` (`vpsCss`), `../vps/VpCard` (type `VpMember`), `../cockpit/scale` (`gaugeMax`). Also `useShellNavigation`, `useToast` and `presetLetter` from `../../global/shell`, and `dataKeys`, `useServerState`, `useMembers`, `useBundle` from `../../data`.
- Read: §3.4–3.8; `modules/path/index.tsx` (save-as-scenario flow), `ResultPanel.tsx` (`cleared`, MoveRow usage), `path.test.tsx` (msw solver routes, mock job), `modules/vps/index.tsx` (members to `vps` / `domains`), `modules/cockpit/VpRings.tsx`, `OddsPanel.tsx` (P(clear) look-up).
- Run: `pnpm turbo run typecheck lint test --filter=@glidepath/web...`, `pnpm tier-check`. While fixing: `pnpm --filter @glidepath/web exec vitest run src/modules/wizard/result.test.tsx`.

### WP-07 · WIZ-07 · Tour engine and steps (sonnet/high)

- **C** `web/src/global/tour/index.ts`, `steps.ts`, `store.ts`, `seen.ts`, `body.tsx`, `useAnchor.ts`, `TourHost.tsx`, `TourButton.tsx`, `tour.test.tsx`, `README.md`.
- Use: `@glidepath/ui/overlays/tour`, `Value` / `useBindContext` from `../../bind`, `useTenants` from `../../data`, `useShellNavigation` (`../shell/navigation`), `TOOL_ICONS` and `Icon` (`../shell/modules`, read-only), `motionMs` (`@glidepath/ui/motion`), and the `ModuleId` type.
- Read: §4; `docs/ux/05_demo_storyline.md`; `global/shell/navigation.ts`; `bind/Value.tsx`.
- Run: `pnpm turbo run typecheck lint test --filter=@glidepath/web...`.

### WP-08 · WIZ-08 · Indicator wiring (sonnet/high)

- **M** `web/src/jobs/JobHeader.tsx`, `index.ts` (export `RunIndicator`), `styles.tsx`, `jobs.test.tsx`, `README.md`. **C** `web/src/jobs/RunIndicator.tsx`.
- **M** `web/src/modules/path/ResultPanel.tsx` (header `RunIndicator` while busy; field ComputeFlow above the empty state while finding), `path.test.tsx` (one new test; existing ones untouched and green), `path/README.md` (one line).
- Read: §5.6; `jobs/*`, `modules/cockpit/OddsPanel.tsx`, `modules/vps/FeasiblePanel.tsx` (confirm they use `JobHeader`).
- Run: `pnpm turbo run typecheck lint test --filter=@glidepath/web...`, `pnpm tier-check`.

### WP-09 · WIZ-09 · Narrative script (sonnet/medium)

- **C** `docs/ux/06_walkthrough_narrative.md`. For each beat: time, screen, tour step id (§4.2), **Do**, **Say** (05's lines, tightened), live node ids on screen with the AA seed value in brackets, and a fallback. Also include a "Wizard segment (3 min, replaces beats 4–6)": step 1 toggle Cloud FinOps (L11), step 2 shelfware (`lev.L10.shelf`), step 3 outside funding, step 4 Find a path and Use this path. Add presenter notes (keys: → ← Esc, the Tour button, what to say while the indicator runs, slow-job fallback: the warmer pre-runs C/D) and a pre-flight checklist delta.
- Read: §3, §4; `docs/ux/05_demo_storyline.md`; `docs/spec/README.md` (Headline numbers); `docs/spec/reference/solver_demo_results.json`.
- Run: none (docs). Self-check every quoted number against those files.

### WP-10 · WIZ-10 · Shell entry points (sonnet/high)

- **M** `web/src/global/shell/GlobalLayout.tsx` (`<TourButton/>` in `.gp-tools` before the search button; `<TourHost module={module}/>` after `<BoundFlightStrip/>` inside `BindProvider`), `styles.ts` (top-bar spacing, phone icon-only), `shell.test.tsx` (button, host, rail of 9 with Build second), `README.md`.
- Read: §6; `global/tour/index.ts` (exports).
- Run: `pnpm turbo run typecheck lint test --filter=@glidepath/web...`.

### WP-11 · WIZ-11 · E2E flows (sonnet/high)

- **C** `e2e/tests/wizard.spec.ts`, `e2e/tests/tour.spec.ts`, `e2e/tests/storyline-wizard.spec.ts`, `e2e/src/wizard.ts` (pure selectors and expected values from the bundle), `e2e/src/wizard.test.ts`, `e2e/playwright.wizard.config.ts` (based on `playwright.config.ts`, `testMatch: ['wizard.spec.ts', 'tour.spec.ts']`, its own budget, timeout 120 s).
- **M** `e2e/playwright.config.ts` (add both to `testIgnore`, plus `storyline-wizard.spec.ts`), `e2e/playwright.storyline.config.ts` (`testMatch` adds `storyline-wizard.spec.ts`), `e2e/package.json` (`"wizard": "node run.mjs --config playwright.wizard.config.ts"`, and the new config in `lint`), root `package.json` (`"e2e:wizard": "pnpm --filter @glidepath/e2e run wizard"`), `e2e/README.md`.
- Read: §3.9, §4.2, §7.2; `e2e/tests/storyline.spec.ts` (helpers `open`, number parsing, fork handling), `fixtures.ts`, `cockpit.ts`, `e2e/src/storyline.ts`, `spec-headline.ts`.
- Run: `pnpm turbo run typecheck lint test --filter=@glidepath/e2e`, stack up, `pnpm e2e:wizard -- --trace off`, `pnpm e2e -- --trace off` (smoke still ≤ 180 s), `pnpm e2e:storyline -- --trace off`.

### WP-12 · WIZ-12 · A11y, perf, visual (sonnet/high)

- **M** `e2e/a11y/a11y.spec.ts` (wizard steps 2–4 by clicking the stepper, tour open), `e2e/src/a11y.ts` (helpers if needed), `e2e/perf/perf.spec.ts` (two tests in §7.2; reuse `frameStats` and `FRAME_P95_BUDGET_MS`), `e2e/src/perf.ts` (only if a helper is needed; budgets unchanged), `e2e/src/visual.ts` (`MODULES` adds `'wizard'` after `'cockpit'`), `e2e/src/visual.test.ts` (9 / 36 / "13 of the 36").
- **M** `e2e/visual/baselines/chromium-linux/*.png`. First run `pnpm e2e:visual` and inspect every `-diff.png`: the 32 old screens may differ only in the rail and top bar. Then run `pnpm e2e:visual -- --update` and commit 36 baselines and the report.
- Run: `pnpm turbo run typecheck lint test --filter=@glidepath/e2e`, `pnpm e2e:a11y`, `pnpm e2e:perf`, `pnpm e2e:visual`.

### WP-13 · WIZ-13 · Integration and regression (opus/high)

- **C** `docs/status/<date>-wiz.md` (results table as in `docs/status/2026-11-27.md`). No feature code. Route findings to the owning WP.
- Run §9 end to end on one develop commit, then dry-run `06_walkthrough_narrative.md` with the tour on the stack in Cruise and Daylight and time it.

## 9. Final regression checklist (WIZ-13; all on one commit)

| # | Gate | Command | Pass |
|---|---|---|---|
| 1 | Backlog | `python3 tools/backlog/extract.py --check` | clean |
| 2 | Types, lint, unit (all) | `pnpm i && pnpm turbo run typecheck lint test` | all tasks green |
| 3 | Engine parity (G3) | `pnpm parity:golden` | 760/760 golden and **245/245** replay, 1e-6 relative |
| 4 | Fuzz (G4) | `pnpm parity:fuzz` | 200/200 |
| 5 | Solvers (G5) | `pnpm test:solvers` | min-risk $143.0M / risk $42.0M / people levers unchanged; all-VP $148.1M; MC C 0%, D 4.5% ± 1.5 pp |
| 6 | Excel (G6) | `pnpm test:excel` | 8/8 |
| 7 | Tenancy (G7) | `pnpm test:leak` | no leak; RLS on every tenant table |
| 8 | Tier separation (G13) | `pnpm tier-check` | clean (no tier-2 symbol or SQL in the bundle) |
| 9 | Stack (G14) | `docker compose up -d --build` | healthy with seed |
| 10 | Smoke (G9) | `pnpm e2e -- --trace off` | green, < 180 s |
| 11 | Wizard + tour + indicator | `pnpm e2e:wizard -- --trace off` | green |
| 12 | Storyline (G10) | `pnpm e2e:storyline -- --trace off` | 11 beats + questions + wizard segment green |
| 13 | Integration | `pnpm int:m2 -- --trace off` · `pnpm int:m3 -- --trace off` | green |
| 14 | A11y (G12) | `pnpm e2e:a11y` | zero serious, 9 modules × 2 themes + wizard steps + tour |
| 15 | Perf (G8/QA-08) | `pnpm e2e:perf` then `pnpm e2e:perf -- --device` on the demo Mac | drag and compute-indicator frame p95 ≤ 16.7 ms; preview p95 < 25 ms; glass ≤ 3 incl. tour |
| 16 | Visual (G11) | `pnpm e2e:visual` | 36/36 against approved baselines |
| 17 | Demo check | `ops/demo-check.sh` | green |
| 18 | Rehearsal | narrative + tour, both themes | timed, notes in the status file |

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `min_risk_mix` might move intensity variables of a lever switched off in step 1 (no per-lever decision set in the contract). | WIZ-11 tests it (`lev.L06` off → no `lev.L06.*` move). A failure is a **tier-2 solver finding** for the SOL owner: never hidden in tier 1, never skipped. The fallback for the demo is to tune from presets with all levers on, as storyline beat 6 does. |
| The visual churn of 32 baselines could hide a real regression. | WIZ-12 reviews the diff images before `--update`. Diffs must sit in the rail and top bar only. |
| Cross-module imports (wizard → path, vps, cockpit/scale) break if those files change. | They are read-only for everyone in this epic. Wizard tests cover the reuse. Build test counts module entries only. |
| The tour anchors drift when a module's markup changes. | Anchors are existing stable test ids or classes. `tour.spec` asserts every anchor is visible with no `data-tour-missing`. |
| The indicator costs frames on the demo Mac. | Compositor-only animation, ≤ 16 layers, off-screen pause, still mode under low glass quality. Measured by the perf monitor and `--device`. |
| Solver cache hits make the indicator flash. | The entry fade has a `--motion-value` delay. Tests use a fresh copy to force a real job. |
| Schedule: 10 days to the freeze, INT-05 in progress. | Waves keep at most 4 builders in flight. Every item is S/M. WIZ-13 runs before INT-06. |
