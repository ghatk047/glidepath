# UIX · Desktop fit and the first-time viewer's tour

Product-owner request for the demo (Fri 4 Dec 2026): the app is shown full screen on a laptop (1280x720) and on a 1080p display, never on a phone or tablet. Every screen gets tighter spacing, a smaller display scale, multi-column layouts instead of wide cards, less page scroll and no text spilling out of a panel; truncated text carries a tooltip. The walkthrough tour (WIZ-07, WIZ-10) becomes a script a first-time viewer can follow alone. Glass look unchanged; phone and tablet keep the token values.

**Tier-2 change: none.** No contract change.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| UIX-01 | Desktop density pass and desktop fit audit | M4 | opus/high | M | WIZ-12 |
| UIX-02 | Tour as a first-time viewer's demo script | M4 | opus/high | S | UIX-01 |

## UIX-01 · Desktop density pass and desktop fit audit

```yaml
id: UIX-01
title: "Desktop density pass and desktop fit audit"
epic: UIX
milestone: M4
priority: must
status: review
tier: 1
package: "tier1-presentation/ui, tier1-presentation/web, e2e"
acceptance:
  - "Above the tablet breakpoint the token gap, panel padding, panel radius and display sizes step down (ui glass `desktopDensity`), again at heights up to 900 px; tablet and phone unchanged"
  - "Title, scenario bar and tools share one row at 1280 px and wider"
  - "Long lists (baseline line items, lever list) scroll inside their panel; wizard step 1 lays levers out in two columns"
  - "Every ellipsis-truncated label has a title with the full text"
  - "`pnpm e2e:desktop -- --trace off`: every module at 1280x720 and 1920x1080 with no horizontal page scroll, no text past its panel, no untitled truncation; captures and per-screen JSON in DESKTOP_SHOTS_DIR"
```

## UIX-02 · Tour as a first-time viewer's demo script

```yaml
id: UIX-02
title: "Tour as a first-time viewer's demo script"
epic: UIX
milestone: M4
priority: must
status: review
tier: 1
package: "tier1-presentation/web (global/tour), docs/ux/06_walkthrough_narrative.md"
acceptance:
  - "Each step says what the screen is for and what to try, in plain words; numbers only as placeholders"
  - "TOUR_VERSION bumped so the Tour button's dot shows again"
  - "Every step's card fits on screen beside its target at 1280x720 and 1920x1080"
```
