# charts/monthly

Monthly curve (#26): the Levers screen "2027 by month" panel. Matches
`docs/ux/prototype/src/views.js` (`areaChart`) and `docs/ux/04_component_inventory.md` (Outputs 26).
Import as `@glidepath/ui/charts/monthly`.

```tsx
// `series` is the payload of the CON-02 `levers.monthly` view (contract/api-contract `LeversMonthlyView`)
<MonthlyCurve series={view} selected={selectedLeverKey} labels={{ labour: 'Labour', L01: 'Crew scheduling' }} />
```

- Item contract `MonthlyCurve(series, selected)`: `series` is the view payload (`families`: one summed
  series per family; `levers`: one series per lever, each with its `family`); `selected` is the lever
  member key whose own series is drawn as the ink line. No selection, or a key not in `series.levers`,
  draws no line.
- Presentational only. Every band edge and the line map `series` values through d3 `scaleLinear`
  (x: month index, y: `$M / mo`, clamped to the axis). The single accumulation is the stacking
  baseline (`stackFamilies`): each family band sits on the tops of the bands before it, in the order
  tier 2 sent them. Family areas come from `families` only; `levers` only feeds the selected line.
- Marks: stacked areas with a `ground` hairline between them, direct family labels at the right edge
  (mid-band, no legend), the selected lever as a 2-unit ink line over the areas with an end dot at the
  last month, d3 gridlines with value labels, month letters under the axis.
- Colours cycle by family order through three token slots (`MONTHLY_SLOTS`): `sequential-3`,
  `sequential-2`, `accent` (as the prototype), so a fourth family reuses slot 0.
- `domain` fixes the value axis. Without it, `monthlyDomain(series, selected)` is the d3 `nice(4)`
  extent from zero to the highest stack top or selected value.
- `labels` maps family keys and lever keys to display names (the view carries keys only; the default
  is the key). `title` names the chart (default "Monthly savings by lever family").
- Tooltip: each family area drives the shared tooltip from `overlays/drawer` (`tipProps`): family name
  and its last-month value (`Dec $12.0M/mo`). Mount `<Tooltip />` once at the app root.
- Accessibility: the SVG is a named `group`; each family area is a focusable `img` named
  "{family} Dec $x/mo" (focus shows the tooltip), the selected line is an `img` named the same way.
  Labels and axis text are `aria-hidden` duplicates.
- CSS is generated from tokens (`styles.ts`) and injected with a hoisted `<style href precedence>`.
  Reduced motion turns the path transitions off.
