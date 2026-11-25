# inputs/slider

Slider · decision (#7) and Slider · estimate (#8) from `docs/ux/04_component_inventory.md`, matching
`docs/ux/prototype/src/views.js` (`slider`) and `docs/ux/screens/levers-*-1440.jpg`.
Import as `@glidepath/ui/inputs/slider`.

```tsx
<Slider
  variant="decision"
  label="Shelfware harvested"
  value={v}
  min={0}
  max={0.3}
  step={0.01}
  unit="%"
  ghosts={[
    { label: 'C', value: c },
    { label: 'D', value: d },
  ]}
  onPreview={preview}
  onCommit={commit}
/>
```

- `percentScale` (optional, the bundle's): `'points'` makes a `%` value label read 2.0% for 2, `'fraction'` (default) 10.0% for 0.1. `formatByUnit(value, unit, step, scale?)` is the shared label format.
- Native `input type=range`, labelled by its `<label>`; `aria-valuetext` is the formatted value.
- `decision`: white thumb, accent fill. `estimate`: grey fill, lock icon in the label and a glass
  tooltip "Estimate: solvers never move it" (on lock hover and keyboard focus, and in
  `aria-describedby`). Pick the variant from the variable's registry `kind` (07_frontend §3).
- Ghost ticks (C, D) come from `ghosts`; ones outside `[min, max]` are not drawn. Screen readers
  get them as "Reference marks: C 10%, D 15%".
- Feel (07_frontend §3): thumb and value label move locally on every frame. `onPreview` fires at
  most once per `PREVIEW_INTERVAL_MS` (33 ms), leading edge, latest value wins. `onCommit` fires
  once per gesture: pointer release / native `change`, release of an arrow, Page, Home or End key,
  Enter, or blur. A commit drops any pending preview.
- Keys: arrows ±step, Page Up/Down ±10 steps, Home/End min/max. Values clamp to `min`/`max` and
  snap to `step` (the display metadata in the props).
- The shown value returns to the `value` prop when tier 2 sends a new one, unless a change is
  still uncommitted. A commit that tier 2 answers with an unchanged `value` keeps the local value.
- Value label: `format` prop, else by registry unit through `fmt` (`%`, `%/yr`, `$M`, `FTE`, `x`),
  digits from `step`; other units read "6 months".
- Presentational only: no node binding (web binds with `useVariable`), no maths beyond
  clamp/snap and track position. CSS (`sliderCss`) is token-derived and hoisted once via React 19
  `<style href precedence>`. The thumb uses the CSS keyword `white` (no white token in tokens.json).
