# 04 · Component inventory

27 components. Live specimens are on the **Parts** tab of the prototype; reference implementations are in `prototype/src/` (function names in brackets). Every component reads colour, type, radius and motion from `tokens.json` only. Every interactive component has hover, focus-visible (2px accent ring), pressed and disabled states, and a 44px minimum touch target on phone.

## Shell (6)

| # | Component | Props | States / notes |
|---|---|---|---|
| 1 | **Rail** (`shell`) | items[{id, label, icon}], current, tenantCode | Current = glass-2 tint + accent icon. Bottom bar under 760px (scrolls inside itself). |
| 2 | **Scenario bar** (`seg`) | scenarios[{id, letter, name}], current, customs[], paths[] | Pressed = glass-3. Letters only on phone. Custom and Path scenarios in an overflow menu. |
| 3 | **Flight strip / HUD** (`hud`) | nodes: res.net, res.bar, res.gap, res.risk, br.eps27 | Fixed bottom centre. Progress bar to 120% of bar with a bar tick. Hidden on Cockpit. Phone: net, bar, gap only. |
| 4 | **Command palette** (`openPalette`) | index of inputs, levers, nodes, lines, screens | ⌘K / Ctrl+K. Up to 9 results, kind + unit on the right, Enter jumps and focuses. Empty state suggests "COLA", "cloud", "headcount". |
| 5 | **Edits counter + changeset tray** | count, changes[], canUndo, canRedo | Dot when > 0. Tray: list of changes (who, what, from → to), undo / redo, save as scenario, discard. |
| 6 | **Tenant button** | code, status | IATA code in a neutral monogram. Never a logo. |

## Inputs (9)

| # | Component | Props | States / notes |
|---|---|---|---|
| 7 | **Slider · decision** (`slider`) | variableId, value, min, max, step, unit, ghosts[{label, value}] | White thumb, accent fill, ghost ticks for C and D. Commits a changeset entry on release; evaluates on every frame. |
| 8 | **Slider · estimate** | same + kind = estimate | Grey fill, lock icon in label. Solvers never move it; tooltip says so. |
| 9 | **Editable number** (`.ed`) | nodeId or variableId, format | Dotted underline on hover, solid once changed. Inputs open the edit popover; outputs open the trace drawer. |
| 10 | **Edit popover** (`openPop`) | variable def (label, unit, min, max, step, source, confidence, default) | Number field + slider + chips + Reset / Done. For outputs: "Pin with reason" writes an Override. Escape closes. |
| 11 | **Dial** (`knob`) | variableId, value, min, max, step, default | 270° arc, drag up/down or arrow keys, ghost tick = default, role = slider with aria values. |
| 12 | **Toggle · stepper · segmented** (`toggle`, `stepper`, `seg`) | value, label | Toggle springs; stepper ±step with typed entry; segmented for enums (target method, valuation basis). |
| 13 | **Ownership bar** (drag in `app.js`) | domainId, shares by VP | Drag dividers in 5% steps; row always sums to 100%; segments labelled ≥ 12%. Keyboard: focus a divider, arrows move 5%. |
| 14 | **Radio card** | options[{id, label}], value | Solver objective. Checked = glass-2 + hairline. |
| 15 | **Prompt bar** | value, onSubmit | AI reconfiguration. Always ends in a reviewable changeset, never a direct write. |

## Outputs (12)

| # | Component | Props | States / notes |
|---|---|---|---|
| 16 | **Gauge** (`gauge`) | net, bar, target, max | 270° arc with gradient fill, bar notch solid, target notch dotted, ticks every 20, labels 0 and max. Fill tweens. |
| 17 | **Ring tile** (`ring`) | value, max, colour | VP net / bar. Percentage in the centre. |
| 18 | **Status chip** (`gapChip`) | gap or status, label | Icon + word + number: "▲ $23.9M clear", "▼ $23.7M short", "1 conflict". Never colour alone. |
| 19 | **Bridge / waterfall** (`waterfall`) | base, growth, iy, otIt, outlay, target | Axis break glyph, connectors, target outlay dashed line, gap bracket. |
| 20 | **Treemap** (`treemap`, `squarify`) | groups[{key, label, items[{line, value}]}], colourBy | Two levels, 2px gaps between groups, 1px between cells, label chips on a ground scrim, selected group outlined in ink. |
| 21 | **Histogram** (`hist`) | P10, P50, P90 (or samples), bar | Bins past the bar in status green; P labels under the axis. Build uses the real sample array. |
| 22 | **Tornado** (`tornado`) | items[{variableId, swing}] | Sorted by swing; policy / timing inputs amber, levers blue. |
| 23 | **Trace node** (`traceNodes`) | nodeId, label, value, note | Chain with arrows; selected = accent ring and glow; opens the trace drawer. |
| 24 | **Move row** | variableId, from, to, rank | Track with C tick, accent span, thumb at the new value, "from → to". |
| 25 | **Diff row** | sheet, item, exported, file, appNow, status | Accept toggle, or File / App choice for conflicts, "new line" chip. |
| 26 | **Monthly curve** (`areaChart`) | per-lever monthly savings, selected lever | Stacked area by family with direct labels, selected lever as an ink line with an end dot. |
| 27 | **Toast** (`toast`) | message, icon | Top centre, spring in, 2.4 s, `role="status"`. |

## Overlays (part of the global layer)

- **Trace drawer** (`openTrace`): right side, 420px, glass; node value, node id, formula in words, upstream chain, top drivers; closes on outside click or Escape.
- **Tooltip** (`initTips`): glass-3, 12px, follows the pointer, every chart mark carries one.

## Accessibility notes

- All controls are native elements (`button`, `input type=range`, `input type=checkbox`, `select`) with labels; dials and ownership dividers expose `role="slider"` with values.
- Text contrast meets 4.5:1 for body and 3:1 for large numerals in both themes; series colours carry direct labels.
- `prefers-reduced-motion` switches off all transitions, the number roll and the sky drift.
