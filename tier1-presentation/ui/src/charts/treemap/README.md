# charts/treemap

Treemap (#20): the Baseline screen "Where the money is" panel (CY26 outlay, group → line). Matches
`docs/ux/prototype/src/views.js` (`treemap`), `core.js` (`squarify`) and
`docs/ux/04_component_inventory.md` (Outputs 20). Import as `@glidepath/ui/charts/treemap`.

```tsx
// `view` is the payload of the CON `baseline.groups` view (contract/api-contract `BaselineGroupsView`)
<Treemap
  groups={view}
  colourBy={{
    categories: [
      { key: 'locked', label: 'Locked' },
      { key: 'partly', label: 'Partly addressable' },
      { key: 'addressable', label: 'Addressable' },
    ],
    of: addrByLine, // line key -> `addr` attribute from `members`
  }}
  selected={groupKey}
  onSelect={setGroupKey}
  lineLabels={{ it_055: { label: 'Training & certifications', detail: 'AA / training vendors' } }}
  title="Treemap of CY26 IT outlay by cost pool"
/>
```

- Item contract `Treemap(groups, colourBy, selected, onSelect)`: `groups` is the whole
  `baseline.groups` view payload (`total` plus `groups[{key, label, value, lines[{key, value}]}]`),
  so the root area comes from tier 2's `total` too. `colourBy` gives each line a category
  (`of`, by line key) and the category order (`categories`). `selected` is a group key; `onSelect`
  gets the group key on click (anywhere in the group), Enter or Space.
- Presentational only. `treemapLayout` is d3-hierarchy `treemap` + `treemapSquarify` over two
  levels; each node's value is the value tier 2 sent (view `total`, group `value`, line `value`),
  so nothing is summed (`sum()` is not called). Children are ordered largest first (d3
  `descending`), as the prototype. Zero and negative values have no area and are skipped.
- Gaps: d3 `paddingInner` of 2 user units between groups and 1 between cells (`TREEMAP_GAPS`), no
  outer padding, in the prototype's 800 × 500 viewBox.
- Marks: cells (radius 2) coloured by category slot on the sequential ramp (`sequential-1/2/3`,
  cycled; a line with no category uses `track`); a ground outline per group, the selected group
  outlined in ink (2 units) and the others dimmed; a label chip on a ground scrim in the top-left of
  each group large enough for it (label, plus the group value when tall), label cut with "…" to fit.
- Layout is memoised on the `groups` object: selection changes and hovers never re-lay out. The
  layout of 415 lines takes well under a frame (`treemap.bench.ts`, `vitest bench`).
- Tooltip: every cell drives the shared tooltip from `overlays/drawer` (`tipProps`): line name,
  detail (vendor), amount (two decimals under $1M), category. Focusing a group shows its name,
  value and line count. Mount `<Tooltip />` once at the app root.
- Accessibility: the SVG is a named `group`. With `onSelect`, each group is a focusable `button`
  with `aria-pressed`, named "{label} $x, n lines"; without it, a named `group`. Each cell is an
  `img` named "{line} $x {category}". Chips are `aria-hidden` duplicates.
- `fit` (UIX-01): the chart fills the box CSS gives it (`.gp-treemap-fit`, height 100%) instead of keeping
  the 800 × 500 shape. A ResizeObserver reads the drawn size and the viewBox follows it in CSS px, so the
  groups re-tile to the box's shape and labels keep their size; until the first measure (or without
  ResizeObserver) the default box is used. Baseline uses it so the treemap fits a screen with no page scroll.
- `lineLabels` maps line keys to `{label, detail}` (the view carries keys only; default: the key).
  The legend (category swatches) belongs to the panel header, not the chart.
- CSS is generated from tokens (`styles.ts`) and injected with a hoisted `<style href precedence>`.
  Reduced motion turns the dim transition off.
