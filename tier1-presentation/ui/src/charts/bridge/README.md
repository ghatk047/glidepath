# charts/bridge

Bridge / waterfall (#19) for the Cockpit "CY26 → CY27 outlay" panel. Matches
`docs/ux/prototype/src/core.js` (`waterfall`) and `docs/ux/screens/cockpit-*.jpg`.
Import as `@glidepath/ui/charts/bridge`.

```tsx
// payload of the CON-02 `bridge` view (contract/api-contract `BridgeView`)
<Bridge {...view} domain={[840, 1080]} onStep={(s) => s.cell && openTrace(s.cell)} />
```

- Props are the `BridgeView` payload: `steps` (base, growth, savings, oneTime, outlay, each with
  `value`, `from`, `to`, `cell`), `targetOutlay`, `gap`. Item contract
  `Bridge(base, growth, iy, otIt, outlay, target)` maps to those steps and `targetOutlay`.
- Presentational only: each bar runs from `y(from)` to `y(to)` on a d3 `scaleLinear` (clamped, so
  the level bars' `from: 0` sits on the axis break). `value` is only the direct label; `gap` only
  decides whether the red bracket shows (`gap > 0`) and names it. Nothing is summed or netted.
- Marks: axis-break zigzag at the floor, dotted connectors at each step's `to`, dashed target
  outlay line with its label, red gap bracket from the CY27 outlay to the target line, direct
  value labels above each bar and categories under the axis.
- `domain` sets the value axis (the panel header shows `domain[0]` as "axis starts at …").
  Without it, `bridgeDomain(view)` is the d3 `nice()` extent of the plotted values with one tick
  step of floor below.
- `labels` overrides the per-step copy (`DEFAULT_BRIDGE_LABELS`), `targetLabel` the line label.
- Accessibility: the SVG is a named `group`; every bar, the target line and the bracket are
  `img`s with an accessible name and a `<title>` tooltip. With `onStep`, bars become keyboard
  buttons (Tab, Enter, Space) that hand back the step (its `cell` opens the trace drawer).
- CSS is generated from tokens (`styles.ts`) and injected with a hoisted `<style href precedence>`.
  Bars ease on change (`motion.value`); reduced motion turns that off.
