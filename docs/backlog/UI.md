# UI · UI library

`tier1-presentation/ui`: tokens, glass, the 27 components of `ux/04_component_inventory.md`, charts, motion, formatters. Presentational only (ADR-018): values arrive as props.

18 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| UI-01 | Tokens to CSS variables, Cruise and Daylight themes | M0 | sonnet/medium | S | FND-01 |
| UI-02 | Glass primitives, grid and aurora background | M0 | opus/high | M | UI-01 |
| UI-03 | Format module: money, percent, FTE, multiples, EPS | M0 | sonnet/medium | S | UI-01 |
| UI-04 | Motion: number roll, springs, reduced motion | M0 | sonnet/high | S | UI-01 |
| UI-05 | Shell components: Rail, Scenario bar, Tenant button (#1, #2, #6) | M2 | sonnet/high | M | UI-02 |
| UI-06 | Flight strip, Status chip, Toast (#3, #18, #27) | M2 | sonnet/high | M | UI-02, UI-03, UI-04 |
| UI-07 | Command palette and Edits tray (#4, #5) | M2 | sonnet/high | M | UI-02 |
| UI-08 | Sliders: decision and estimate (#7, #8) | M2 | opus/high | M | UI-02, UI-03 |
| UI-09 | Editable number and Edit popover (#9, #10) | M2 | sonnet/high | M | UI-02, UI-03 |
| UI-10 | Dial, Toggle, Stepper, Segmented, Radio card, Prompt bar (#11, #12, #14, #15) | M2 | sonnet/medium | M | UI-02 |
| UI-11 | Ownership bar (#13) | M3 | sonnet/high | S | UI-02 |
| UI-12 | Gauge and Ring tile (#16, #17) | M2 | opus/high | M | UI-02, UI-04 |
| UI-13 | Bridge / waterfall (#19) | M2 | opus/high | M | UI-02 |
| UI-14 | Treemap (#20) | M3 | opus/high | M | UI-02 |
| UI-15 | Histogram and Tornado (#21, #22) | M2 | sonnet/high | M | UI-02 |
| UI-16 | Trace node, Move row, Diff row (#23, #24, #25) | M3 | sonnet/high | M | UI-02 |
| UI-17 | Monthly curve (#26) | M3 | sonnet/high | S | UI-02 |
| UI-18 | Overlays: Trace drawer shell and Tooltip | M2 | sonnet/high | S | UI-02 |

## UI-01 · Tokens to CSS variables, Cruise and Daylight themes

```yaml
id: UI-01
title: "Tokens to CSS variables, Cruise and Daylight themes"
epic: UI
milestone: M0
priority: must
status: done
stream: C
model: sonnet
effort: medium
depends_on: [FND-01]
tier: 1
package: "tier1-presentation/ui/src/tokens"
contract: "CSS custom properties + TS token map from tokens.json"
inputs:
  - "docs/ux/tokens.json"
  - "docs/ux/01_moodboard.md#Palette"
  - "docs/ux/01_moodboard.md#Type"
  - "docs/architecture/07_frontend.md#1. Structure"
acceptance:
  - "a build step converts docs/ux/tokens.json into CSS custom properties for Cruise (dark, default) and Daylight (light) plus a typed TS map; every token key appears in the output (test)"
  - "theme set by data-theme on <html>, remembered per viewer in localStorage (test)"
  - "breakpoints 1180 px and 760 px exported from tokens as media helpers (test)"
  - "no hex or raw px outside this folder in ui/web (FND-02 lint passes)"
gates: [G1, G2, G13]
size: S
notes: ""
merged_at: "2026-11-23"
```

Everything visual reads from here.

## UI-02 · Glass primitives, grid and aurora background

```yaml
id: UI-02
title: "Glass primitives, grid and aurora background"
epic: UI
milestone: M0
priority: must
status: done
stream: C
model: opus
effort: high
depends_on: [UI-01]
tier: 1
package: "tier1-presentation/ui/src/glass"
contract: "GlassPanel(level, header?), Grid, Aurora, Skeleton"
inputs:
  - "docs/ux/01_moodboard.md#Glass recipe"
  - "docs/architecture/07_frontend.md#5. Performance rules"
  - "docs/ux/02_information_architecture.md#6. Screen states"
  - "docs/ux/screens/cockpit-dark-1440.jpg"
  - "docs/ux/screens/cockpit-light-1440.jpg"
acceptance:
  - "GlassPanel levels glass-1/2/3 per the glass recipe, header slot with status chip area; 12-column grid with token gap; 6/12 columns below 1180 px, stacked below 760 px (test: component + layout snapshot)"
  - "pre-blurred aurora background; at most three backdrop-filter layers on screen (test counts in a composite story)"
  - "low-blur fallback on prefers-reduced-transparency and on frame-time sampling (test)"
  - "Skeleton at 40% opacity for loading, no spinners in panels (test)"
  - "panel chrome matches the cockpit renders in both themes (G11, reviewer)"
gates: [G1, G2, G11, G12]
size: M
notes: ""
merged_at: "2026-11-23"
```

The glass look, within the blur budget.

## UI-03 · Format module: money, percent, FTE, multiples, EPS

```yaml
id: UI-03
title: "Format module: money, percent, FTE, multiples, EPS"
epic: UI
milestone: M0
priority: must
status: done
stream: C
model: sonnet
effort: medium
depends_on: [UI-01]
tier: 1
package: "tier1-presentation/ui/src/format"
contract: "fmt.money/pct/fte/mult/eps/cents/signed"
inputs:
  - "docs/architecture/02_repo_and_conventions.md#3. Conventions (money $M, percentages decimals)"
  - "docs/spec/excel_template.json (cell_rules.number_formats)"
  - "docs/ux/03_screens.md#Cockpit · \"Path to the bar\""
acceptance:
  - "$M with one decimal and thousands separators, signed gaps (−$23.7M style), percent from decimals, FTE integers, multiples (7.39×), EPS ($0.091), cents per gallon; null → em dash (test table)"
  - "formatting is the only presentation transform; web lint forbids toFixed/Intl outside this module (test)"
gates: [G1, G2]
size: S
notes: ""
merged_at: "2026-11-23"
```

The only place numbers become strings.

## UI-04 · Motion: number roll, springs, reduced motion

```yaml
id: UI-04
title: "Motion: number roll, springs, reduced motion"
epic: UI
milestone: M0
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [UI-01]
tier: 1
package: "tier1-presentation/ui/src/motion"
contract: "NumberRoll, spring presets"
inputs:
  - "docs/ux/01_moodboard.md#Motion"
  - "docs/ux/04_component_inventory.md#Accessibility notes"
  - "docs/architecture/07_frontend.md#3. Editing feel without local math"
acceptance:
  - "NumberRoll tweens from old to new displayed value with token durations, no layout shift (test with fake timers)"
  - "prefers-reduced-motion disables every transition and the roll (test)"
  - "spring presets from tokens for toggles, toasts and drawers (test)"
gates: [G1, G2, G12]
size: S
notes: "Interpolates the display only; the target value always comes from tier 2."
merged_at: "2026-11-23"
```

Numbers that glide, never invented.

## UI-05 · Shell components: Rail, Scenario bar, Tenant button (#1, #2, #6)

```yaml
id: UI-05
title: "Shell components: Rail, Scenario bar, Tenant button (#1, #2, #6)"
epic: UI
milestone: M2
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [UI-02]
tier: 1
package: "tier1-presentation/ui/src/shell"
contract: "Rail, ScenarioBar, TenantButton props per inventory"
inputs:
  - "docs/ux/04_component_inventory.md#Shell (6) (#1, #2, #6)"
  - "docs/ux/02_information_architecture.md#2. Global layer (on every module)"
  - "docs/ux/prototype/src/views.js (shell, seg)"
acceptance:
  - "Rail: items, current (glass-2 tint + accent icon), tenantCode; bottom bar under 760 px scrolling inside itself; aria-current (test)"
  - "Scenario bar: segmented letters + names, letters only on phone, custom and path scenarios in an overflow menu, pressed = glass-3 (test)"
  - "Tenant button: IATA code in a neutral monogram, never a logo (test)"
  - "keyboard operable, 44 px touch targets on phone, axe clean (G12); no formulas or business rules: values arrive as props (lint + review)"
gates: [G1, G2, G12]
size: M
notes: ""
merged_at: "2026-11-23"
```

The frame around every module.

## UI-06 · Flight strip, Status chip, Toast (#3, #18, #27)

```yaml
id: UI-06
title: "Flight strip, Status chip, Toast (#3, #18, #27)"
epic: UI
milestone: M2
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [UI-02, UI-03, UI-04]
tier: 1
package: "tier1-presentation/ui/src/hud"
contract: "FlightStrip, StatusChip, Toast"
inputs:
  - "docs/ux/04_component_inventory.md#Shell (6) (#3)"
  - "docs/ux/04_component_inventory.md#Outputs (12) (#18, #27)"
  - "docs/ux/prototype/src/app.js (hud, gapChip, toast)"
acceptance:
  - "FlightStrip shows net (progress track to 120% of bar with a bar tick), bar, gap chip, risk-adjusted, EPS 27 from props; hidden prop for Cockpit; phone variant net/bar/gap only (test)"
  - "StatusChip: icon + word + number ('▲ $23.9M clear', '▼ $23.7M short', '1 conflict'), never colour alone (test)"
  - "Toast top centre, spring in, 2.4 s, role=status (test)"
  - "no formulas or business rules: values arrive as props (lint + review); the 120% track scale is the UX display constant from the inventory"
gates: [G1, G2, G12]
size: M
notes: ""
merged_at: "2026-11-23"
```

The always-visible HUD and feedback.

## UI-07 · Command palette and Edits tray (#4, #5)

```yaml
id: UI-07
title: "Command palette and Edits tray (#4, #5)"
epic: UI
milestone: M2
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [UI-02]
tier: 1
package: "tier1-presentation/ui/src/overlays/palette"
contract: "CommandPalette, EditsTray (presentational)"
inputs:
  - "docs/ux/04_component_inventory.md#Shell (6) (#4, #5)"
  - "docs/ux/02_information_architecture.md#2. Global layer (on every module)"
  - "docs/ux/prototype/src/app.js (openPalette)"
acceptance:
  - "⌘K / Ctrl+K opens; up to 9 results with kind and unit on the right; arrow keys + Enter select; empty state suggests 'COLA', 'cloud', 'headcount' (test)"
  - "EditsTray: count dot when > 0; list who/what/from → to; undo, redo, save as scenario, discard callbacks (test)"
  - "focus trap and Escape close; axe clean (G12); no formulas or business rules: values arrive as props (lint + review)"
gates: [G1, G2, G12]
size: M
notes: ""
merged_at: "2026-11-23"
```

Find any number; see every edit.

## UI-08 · Sliders: decision and estimate (#7, #8)

```yaml
id: UI-08
title: "Sliders: decision and estimate (#7, #8)"
epic: UI
milestone: M2
priority: must
status: done
stream: C
model: opus
effort: high
depends_on: [UI-02, UI-03]
tier: 1
package: "tier1-presentation/ui/src/inputs/slider"
contract: "Slider(variant decision|estimate, value, min, max, step, unit, ghosts, onPreview, onCommit)"
inputs:
  - "docs/ux/04_component_inventory.md#Inputs (9) (#7, #8)"
  - "docs/architecture/07_frontend.md#3. Editing feel without local math"
  - "docs/ux/prototype/src/views.js (slider)"
  - "docs/ux/screens/levers-dark-1440.jpg"
acceptance:
  - "native input range; white thumb, accent fill, ghost ticks for C and D from props; estimate variant grey with lock icon and tooltip 'solvers never move it' (test)"
  - "thumb and value label move locally at 60 fps; onPreview throttled to ≤ 1 per 33 ms, latest value wins; onCommit on release or keyboard commit (test with fake timers)"
  - "clamps to min/max/step received in props (display metadata); arrow keys step (test)"
  - "no formulas or business rules: values arrive as props (lint + review)"
gates: [G1, G2, G12]
size: M
notes: ""
merged_at: "2026-11-23"
```

The control the demo is felt through.

## UI-09 · Editable number and Edit popover (#9, #10)

```yaml
id: UI-09
title: "Editable number and Edit popover (#9, #10)"
epic: UI
milestone: M2
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [UI-02, UI-03]
tier: 1
package: "tier1-presentation/ui/src/inputs/editable"
contract: "EditableNumber, EditPopover"
inputs:
  - "docs/ux/04_component_inventory.md#Inputs (9) (#9, #10)"
  - "docs/ux/02_information_architecture.md#2. Global layer (on every module)"
  - "docs/ux/prototype/src/app.js (openPop)"
acceptance:
  - "EditableNumber: dotted underline on hover, solid once changed; input mode opens the popover, output mode calls onTrace (test)"
  - "EditPopover: number field + slider + chips (source, confidence, default) + Reset / Done; Escape closes; output mode offers 'Pin with reason' (callback) (test)"
  - "warnings text rendered verbatim from props (tier 2's words) (test); no formulas or business rules: values arrive as props (lint + review)"
gates: [G1, G2, G12]
size: M
notes: ""
merged_at: "2026-11-23"
```

Every number editable from where it is shown.

## UI-10 · Dial, Toggle, Stepper, Segmented, Radio card, Prompt bar (#11, #12, #14, #15)

```yaml
id: UI-10
title: "Dial, Toggle, Stepper, Segmented, Radio card, Prompt bar (#11, #12, #14, #15)"
epic: UI
milestone: M2
priority: must
status: done
stream: C
model: sonnet
effort: medium
depends_on: [UI-02]
tier: 1
package: "tier1-presentation/ui/src/inputs/controls"
contract: "Dial, Toggle, Stepper, Segmented, RadioCard, PromptBar"
inputs:
  - "docs/ux/04_component_inventory.md#Inputs (9) (#11, #12, #14, #15)"
  - "docs/ux/prototype/src/views.js (knob, toggle, stepper, seg)"
acceptance:
  - "Dial: 270° arc, drag up/down or arrow keys, ghost tick = default, role=slider with aria values (test)"
  - "Toggle springs; Stepper ±step with typed entry; Segmented for enums; RadioCard checked = glass-2 + hairline (test)"
  - "PromptBar value/onSubmit, copy says it ends in a reviewable changeset (test)"
  - "no formulas or business rules: values arrive as props (lint + review)"
gates: [G1, G2, G12]
size: M
notes: ""
merged_at: "2026-11-23"
```

The remaining input controls.

## UI-11 · Ownership bar (#13)

```yaml
id: UI-11
title: "Ownership bar (#13)"
epic: UI
milestone: M3
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [UI-02]
tier: 1
package: "tier1-presentation/ui/src/inputs/ownership"
contract: "OwnershipBar(domainId, shares, onPreview, onCommit)"
inputs:
  - "docs/ux/04_component_inventory.md#Inputs (9) (#13)"
  - "docs/ux/03_screens.md#VPs · \"VP targets & ownership\""
  - "docs/ux/prototype/src/app.js (ownership drag)"
acceptance:
  - "drag dividers in 5% steps; segments partition the row so shares always total 100%; labels on segments ≥ 12% (test)"
  - "keyboard: focus a divider, arrows move 5%; dividers expose role=slider (test)"
  - "previews during drag, commit on release; validation messages come from tier 2 (test); no formulas or business rules: values arrive as props (lint + review)"
gates: [G1, G2, G12]
size: S
notes: ""
```

Who owns what, by dragging.

## UI-12 · Gauge and Ring tile (#16, #17)

```yaml
id: UI-12
title: "Gauge and Ring tile (#16, #17)"
epic: UI
milestone: M2
priority: must
status: in_progress
stream: C
model: opus
effort: high
depends_on: [UI-02, UI-04]
tier: 1
package: "tier1-presentation/ui/src/charts/gauge"
contract: "Gauge(net, bar, target, max), RingTile(value, max, colour)"
inputs:
  - "docs/ux/04_component_inventory.md#Outputs (12) (#16, #17)"
  - "docs/ux/01_moodboard.md#Charts"
  - "docs/ux/prototype/src/core.js (gauge, ring)"
  - "docs/ux/screens/cockpit-dark-1440.jpg"
acceptance:
  - "Gauge: 270° arc with gradient fill, solid bar notch, dotted target notch, ticks every 20, labels 0 and max, fill tweens (test: SVG structure + snapshot)"
  - "RingTile: percentage in the centre, VP colour by slot order (test)"
  - "tooltips on marks; reduced motion respected (test); no formulas or business rules: values arrive as props (lint + review)"
gates: [G1, G2, G11, G12]
size: M
notes: ""
```

The hero chart.

## UI-13 · Bridge / waterfall (#19)

```yaml
id: UI-13
title: "Bridge / waterfall (#19)"
epic: UI
milestone: M2
priority: must
status: in_progress
stream: C
model: opus
effort: high
depends_on: [UI-02]
tier: 1
package: "tier1-presentation/ui/src/charts/bridge"
contract: "Bridge(base, growth, iy, otIt, outlay, target)"
inputs:
  - "docs/ux/04_component_inventory.md#Outputs (12) (#19)"
  - "docs/ux/03_screens.md#Cockpit · \"Path to the bar\" (CY26 → CY27 outlay)"
  - "docs/ux/prototype/src/core.js (waterfall)"
acceptance:
  - "axis-break glyph, connectors, dashed target outlay line, red gap bracket, direct labels (test: SVG structure)"
  - "bar extents are d3 scale mappings of props only (test); no formulas or business rules: values arrive as props (lint + review)"
gates: [G1, G2, G11, G12]
size: M
notes: ""
```

CY26 → CY27 outlay.

## UI-14 · Treemap (#20)

```yaml
id: UI-14
title: "Treemap (#20)"
epic: UI
milestone: M3
priority: must
status: todo
stream: C
model: opus
effort: high
depends_on: [UI-02]
tier: 1
package: "tier1-presentation/ui/src/charts/treemap"
contract: "Treemap(groups, colourBy, selected, onSelect)"
inputs:
  - "docs/ux/04_component_inventory.md#Outputs (12) (#20)"
  - "docs/ux/03_screens.md#Baseline · \"Where the money is\""
  - "docs/ux/prototype/src/views.js (treemap, squarify)"
acceptance:
  - "two levels via d3-hierarchy squarify; 2 px gaps between groups, 1 px between cells; label chips on a ground scrim; selected group outlined in ink; click selects (test)"
  - "renders 415 cells in < 16 ms re-layout on hover (bench) and every cell has a tooltip (test); no formulas or business rules: values arrive as props (lint + review)"
gates: [G1, G2, G11, G12]
size: M
notes: ""
```

Where the money is.

## UI-15 · Histogram and Tornado (#21, #22)

```yaml
id: UI-15
title: "Histogram and Tornado (#21, #22)"
epic: UI
milestone: M2
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [UI-02]
tier: 1
package: "tier1-presentation/ui/src/charts/dist"
contract: "Histogram(samples|bins, p10, p50, p90, bar), Tornado(items)"
inputs:
  - "docs/ux/04_component_inventory.md#Outputs (12) (#21, #22)"
  - "docs/ux/prototype/src/views.js (hist, tornado)"
acceptance:
  - "Histogram: bins past the bar in status green, P labels under the axis, uses the sample/bin array from props (test)"
  - "Tornado: sorted as given, amber for policy/timing category, blue for levers (category from props) (test); no formulas or business rules: values arrive as props (lint + review)"
gates: [G1, G2, G11, G12]
size: M
notes: ""
merged_at: "2026-11-23"
```

Odds and sensitivities.

## UI-16 · Trace node, Move row, Diff row (#23, #24, #25)

```yaml
id: UI-16
title: "Trace node, Move row, Diff row (#23, #24, #25)"
epic: UI
milestone: M3
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [UI-02]
tier: 1
package: "tier1-presentation/ui/src/rows"
contract: "TraceNode, MoveRow, DiffRow"
inputs:
  - "docs/ux/04_component_inventory.md#Outputs (12) (#23, #24, #25)"
  - "docs/ux/prototype/src/app.js (traceNodes)"
  - "docs/ux/screens/data-dark-1440.jpg"
acceptance:
  - "TraceNode chain with arrows; selected = accent ring + glow; onOpen (test)"
  - "MoveRow: track with C tick, accent span, thumb at the new value, 'from → to' (test)"
  - "DiffRow: accept toggle, or File / App choice for conflicts, 'new line' chip, removal style (test); no formulas or business rules: values arrive as props (lint + review)"
gates: [G1, G2, G12]
size: M
notes: ""
```

Row components for Market, Path and Excel.

## UI-17 · Monthly curve (#26)

```yaml
id: UI-17
title: "Monthly curve (#26)"
epic: UI
milestone: M3
priority: must
status: todo
stream: C
model: sonnet
effort: high
depends_on: [UI-02]
tier: 1
package: "tier1-presentation/ui/src/charts/monthly"
contract: "MonthlyCurve(series, selected)"
inputs:
  - "docs/ux/04_component_inventory.md#Outputs (12) (#26)"
  - "docs/ux/prototype/src/views.js (areaChart)"
acceptance:
  - "stacked area by family with direct labels; selected lever as an ink line with an end dot (test)"
  - "series come from props (tier-2 view levers.monthly) (test); no formulas or business rules: values arrive as props (lint + review)"
gates: [G1, G2, G12]
size: S
notes: ""
```

2027 by month.

## UI-18 · Overlays: Trace drawer shell and Tooltip

```yaml
id: UI-18
title: "Overlays: Trace drawer shell and Tooltip"
epic: UI
milestone: M2
priority: must
status: done
stream: C
model: sonnet
effort: high
depends_on: [UI-02]
tier: 1
package: "tier1-presentation/ui/src/overlays/drawer"
contract: "TraceDrawer(content), Tooltip"
inputs:
  - "docs/ux/04_component_inventory.md#Overlays (part of the global layer)"
  - "docs/ux/prototype/src/app.js (openTrace, initTips)"
acceptance:
  - "TraceDrawer: right side, 420 px, glass; slots for value, node id, formula in words, upstream chain, top drivers; closes on outside click or Escape; focus trap (test)"
  - "Tooltip: glass-3, 12 px, follows the pointer; one shared instance used by every chart (test)"
gates: [G1, G2, G12]
size: S
notes: ""
merged_at: "2026-11-23"
```

The overlays every module uses.
