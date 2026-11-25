# UIX · Desktop fit and the first-time viewer's tour

Product-owner request for the demo (Fri 4 Dec 2026): the app is shown full screen on a laptop (1280x720) and on a 1080p display, never on a phone or tablet. Every screen gets tighter spacing, a smaller display scale, multi-column layouts instead of wide cards, less page scroll and no text spilling out of a panel; truncated text carries a tooltip. The walkthrough tour (WIZ-07, WIZ-10) becomes a script a first-time viewer can follow alone. Glass look unchanged; phone and tablet keep the token values.

**Tier-2 change: none.** No contract change.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| UIX-01 | Desktop density pass | M4 | opus/high | M | WIZ-12 |
| UIX-02 | Tour as a first-time viewer's demo script | M4 | opus/high | S | WIZ-10 |
| UIX-03 | E2E: desktop fit audit at 1280x720 and 1920x1080 | M4 | opus/high | S | WIZ-11 |

## UIX-01 · Desktop density pass

```yaml
id: UIX-01
title: "Desktop density pass"
epic: UIX
milestone: M4
priority: must
status: review
stream: C
model: opus
effort: high
depends_on: [WIZ-12]
tier: 1
package: "tier1-presentation (ui glass, web shell and modules)"
contract: "Token custom properties redefined above the tablet breakpoint; DESKTOP_QUERY / SHORT_DESKTOP_QUERY from @glidepath/ui/glass"
inputs:
  - "tier1-presentation/ui/src/glass/styles.ts"
  - "tier1-presentation/web/src/global/shell/styles.ts"
acceptance:
  - "Above the tablet breakpoint gap, panel padding, panel radius and display sizes step down, again up to 900 px tall; tablet and phone unchanged (ui glass tests)"
  - "Title, scenario bar and tools on one row at 1280 px and wider (UIX-03 audit)"
  - "Baseline line items and the lever list scroll inside their panel; wizard step 1 in two columns (UIX-03 audit)"
  - "Every ellipsis-truncated label has a title with the full text (UIX-03 audit)"
gates: [G2, G12, G13]
size: M
notes: "G11 baselines (chromium-linux) change by design and need re-approval in a Linux container."
```

## UIX-02 · Tour as a first-time viewer's demo script

```yaml
id: UIX-02
title: "Tour as a first-time viewer's demo script"
epic: UIX
milestone: M4
priority: must
status: review
stream: C
model: opus
effort: high
depends_on: [WIZ-10]
tier: 1
package: "tier1-presentation/web (global/tour)"
contract: "TourStepDef.about"
inputs:
  - "tier1-presentation/web/src/global/tour/steps.ts"
  - "docs/ux/06_walkthrough_narrative.md"
acceptance:
  - "Each step has an about line: what the screen is for, at most 22 words, no digit, no placeholder (tour.test.tsx)"
  - "TOUR_VERSION is 2 so the Tour button's dot shows again (tour.test.tsx)"
gates: [G2]
size: S
notes: "Copy lives in steps.ts; docs/ux stays read-only."
```

## UIX-03 · E2E: desktop fit audit at 1280x720 and 1920x1080

```yaml
id: UIX-03
title: "E2E: desktop fit audit at 1280x720 and 1920x1080"
epic: UIX
milestone: M4
priority: must
status: review
stream: D
model: opus
effort: high
depends_on: [WIZ-11]
tier: ops
package: "e2e (desktop/desktop.spec.ts, playwright.desktop.config.ts)"
contract: "pnpm e2e:desktop; captures and per-screen JSON in DESKTOP_SHOTS_DIR"
inputs:
  - "e2e/visual/visual.spec.ts"
  - "e2e/src/wizard.ts (TOUR_STEP_SPECS)"
acceptance:
  - "Every module, wizard steps 2 to 4: no horizontal page scroll, no text past its panel, no text cut without an ellipsis, no ellipsis without a tooltip"
  - "Every tour step: card inside the screen and covering under 35% of its target"
gates: [G9]
size: S
notes: "Not in CI; run before the freeze against the demo stack."
```
