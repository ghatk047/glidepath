# 01 · Moodboard: "Cruise"

Calm instruments over a night sky. Glass recedes, numbers lead, and every number moves when you touch it. The app is built for one room and one question: can AA reach the bar, and how? The live version of this page is the **Mood** tab in the prototype.

## Principles

| Principle | Rule |
|---|---|
| Numbers first | One hero number per panel. Labels are small mono nouns. The only sentences on screen are a lever's one-line hypothesis and short footnotes. |
| One accent | Contrail ice marks what you can touch (slider fill, primary button, focus) and what you saved. Nothing else uses it. |
| Glass for objects | Panels are glass; content inside is flat. Nothing is glass on glass except popovers, the palette and the trace drawer. |
| Motion shows cause | When an input moves, the outputs it drives move with it. Nothing animates for decoration except the slow sky drift. |

## Palette

Tokens are in `tokens.json`. Cruise is the default theme.

| Token | Cruise (dark) | Daylight (light) | Use |
|---|---|---|---|
| ground | `#060a12` | `#e8eef6` | Page background under the sky |
| aurora-1 / 2 / 3 | `#16365f` / `#0c4450` / `#4a2f19` | `#bcd4f2` / `#c8e8e6` / `#f5dcbd` | Three blurred blobs (steel, teal, horizon) drifting 46–60 s |
| glass / glass-2 / glass-3 | rgba(148,182,228,.055 / .10 / .16) | rgba(255,255,255,.50 / .66 / .82) | Panel tint, control tint, pressed tint |
| glass-line | rgba(196,222,255,.11) | rgba(255,255,255,.85) | 1px hairline on glass |
| ink / ink-2 / ink-3 | `#eaf1fb` / `#a8b8cd` / `#7d8ea6` | `#0a1525` / `#3f4f66` / `#5d6c82` | Text: primary, secondary, labels |
| accent | `#8ccbff` | `#1667c0` | Interactive + savings |
| track / total | rgba(148,182,228,.17) / .22 | rgba(16,36,72,.12) / `#c3d0e2` | Slider and progress tracks; base and end bars in bridges |
| pos / neg / warn | `#3ddc97` / `#ff7466` / `#fab219` | `#0b8a54` / `#cf3f33` / `#a86a00` | Status only, always with icon and word |

**Series (VPs), validated** with the dataviz palette checker on both surfaces (adjacent pairs, CVD ΔE ≥ 9.2, normal-vision ΔE ≥ 24.6, contrast ≥ 3:1 in dark):

| Slot | VP | Dark | Light |
|---|---|---|---|
| 1 | Commercial | `#3987e5` | `#2a78d6` |
| 2 | Operations | `#d95926` | `#eb6834` |
| 3 | Corporate | `#199e70` | `#1baf7a` |
| 4 | Infrastructure & All Others | `#9085e9` | `#6250d6` |

Four VPs fail an all-pairs test (no 4-colour set passes), so VP colour is never the only cue: every VP mark has a direct label. Colour follows the VP, never its rank. A fifth VP added in the editable org chart takes the next slot from the reference palette (magenta), and the checker is re-run.

**Sequential (addressability):** locked → partly → addressable = `seq-1 / seq-2 / seq-3` (dark `#26364d / #2f5d93 / #5f9fe6`; light `#c5d2e3 / #86b6ef / #2a78d6`).

## Type

Geist for everything, Geist Mono for labels and axis text. `font-variant-numeric: tabular-nums` on every figure.

| Role | Size / weight | Example |
|---|---|---|
| Hero | clamp(48, 5.4vw, 76) / 300, tracking −3.5% | $119.3M |
| Big | clamp(30, 3vw, 40) / 300 | +$0.091 |
| Mid | 22 / 400 | $36.6M |
| Title | 22 / 500 | Software licence & SaaS optimisation |
| Body | 15 / 400 | Hypothesis lines |
| Small | 13 / 400 | Lists, tables |
| Label | Mono 11 / 500, uppercase, +9% tracking | NET SAVINGS · CY27 |
| Chart text | Mono 10.5 / 500 | Axis ticks |

Units sit smaller than numerals ("$119.3" + "M" at 42%).

## Glass recipe

Five layers, the same everywhere:

1. **Sky:** three radial aurora blobs, blur 80px, plus 5% fractal grain (3.5% in Daylight).
2. **Backdrop blur:** `backdrop-filter: blur(28px) saturate(150%)`.
3. **Tint:** vertical gradient glass-2 → glass.
4. **Hairline:** 1px glass-line.
5. **Highlight:** `inset 0 1px 0 glass-hi`, plus a soft drop shadow `0 30px 70px -30px` at 75% black (35% navy in Daylight).

Radii: panel 22, control 12–16, chip 999, well 16. A "well" (flat tint, hairline, no shadow) groups content inside a panel.

## Motion

| What | Spec |
|---|---|
| Value change | Number rolls to the new value, 420–520 ms, ease-out `cubic-bezier(.2,.8,.2,1)` |
| Recalculated value | One accent glow, 900 ms, then gone |
| Slider thumb, toggle, popover | Spring `cubic-bezier(.34,1.56,.64,1)`, 250–300 ms |
| Lists (solver moves) | 90 ms stagger, most valuable first |
| Charts | Arc and bar lengths tween 420 ms; no entrance animations |
| Sky | 46–60 s alternate drift |
| Reduced motion | All of the above off; values jump |

## Charts

- Thin marks, 4–6px rounded data ends, recessive grid at 7% ink.
- The bar is always one dashed ink line with a label. The target (ex-growth) is a dotted notch.
- Never two y-axes. Truncated axes carry a break glyph and say so in the panel header ("axis starts at $840M").
- Text is ink, never series colour. Every chart has hover tooltips and (in the build) a table view.
- Monte Carlo bins past the bar turn status green. Policy and timing inputs in the tornado are amber, levers are sequential blue.
- Forms used: gauge, ring, bullet, bridge (waterfall), treemap, stacked area, histogram, tornado, scatter with frontier, EPS bars.

## Icons

24px grid, 1.5px stroke, round caps and joins, `currentColor`. Set: cockpit, baseline, levers, vps, solver (path), market, data (Excel), airlines, mood, ia, comps, story, search, trace, lock, spark, export, import, undo, check, plus, chevron, arrow, play, file, sun. No emoji. No airline marks.

## Words

| Word | Meaning everywhere |
|---|---|
| Bar | Target + CY27 cost growth ($143.0M for AA) |
| Net | In-year savings − one-time cost borne by IT |
| Gap | Net − bar (negative = short) |
| Run-rate | Full-year 2028 effect |
| Locked | Cannot move within 12 months |
| Path | A solver answer you can open and edit |

Voice: labels are nouns, buttons are verbs ("Find a path", "Apply as changeset"), toasts confirm cause and effect ("Scenario Balanced · net $119.3M").
