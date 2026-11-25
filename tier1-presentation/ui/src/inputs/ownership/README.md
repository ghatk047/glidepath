# inputs/ownership

Ownership bar (#13) from `docs/ux/04_component_inventory.md`, matching `docs/ux/prototype/src/app.js`
(VP ownership dividers, `.ownbar`) and the "Who owns what" panel of `docs/ux/screens/vps-dark-1440.jpg`.
Import as `@glidepath/ui/inputs/ownership`.

```tsx
<OwnershipBar
  domainId="data_analytics"
  label="Data & analytics"
  shares={[
    { vp: 'vp_commercial', label: 'Commercial', share: 0.3 },
    { vp: 'vp_operations', label: 'Operations', share: 0.4 },
    { vp: 'vp_corporate', label: 'Corporate', share: 0.2 },
    { vp: 'vp_infra', label: 'Infra & Other', share: 0.1 },
  ]}
  violations={problem?.violations}
  onPreview={(domainId, next) => preview(domainId, next)}
  onCommit={(domainId, next) => commit(domainId, next)}
/>
```

- `shares` is one `org.dom_share[domainId, vp]` row from tier 2 (model units, 0.3 = 30%), one entry
  per VP in slot order. Segment colour follows the slot through `vpColour` (charts/gauge). Web binds
  the node ids and maps `onPreview` / `onCommit` to previews and `applyChangeset` writes; the
  callbacks get `(domainId, shares)` with `vp`, `label` and the new `share` for every VP.
- Dividers: n VPs have n - 1 of them, each a focusable `role="slider"` (0..100 of the row, `aria-valuemin`
  / `aria-valuemax` are its neighbours, `aria-valuetext` "Commercial 30%, Operations 40%"). They move
  in whole steps (`step`, default `OWNERSHIP_STEP` 5%, normally the variable's registry step) and
  cannot cross, so the segments partition the row and the shares always total 100%. A row tier 2
  sends off the grid or not totalling 100% is drawn as a full row (running totals snapped to the
  grid, last segment takes the remainder); the message about it is tier 2's.
- Labels: a segment at or above `labelMin` (default `OWNERSHIP_LABEL_MIN` 12%) shows its share; the
  segment tooltip (`data-tip`, shown by the shared `<Tooltip />` from overlays/drawer) always gives
  "VP · share".
- Feel: segments and labels move locally on every frame. `onPreview` fires at most once per 33 ms
  (`latestThrottle` from inputs/slider, latest wins). `onCommit` fires once per gesture: pointer
  release or cancel, arrow/Home/End release, Enter, or blur; a commit drops a pending preview, and a
  gesture that moved nothing commits nothing. Keys: arrows +/- one step, Home/End to the neighbour.
- Messages: `violations` (`{ severity, message }`, a contract `Violation` fits) are shown as sent in a
  live region (`alert` when any is an error, else `status`) and referenced by the dividers'
  `aria-describedby`. The component never judges a row valid or invalid.
- The shown row returns to `shares` when tier 2 sends new ones, unless a change is uncommitted.
- Presentational only: no node binding, no maths beyond clamp/snap/partition (`partition.ts`). CSS
  (`ownershipCss`) is token-derived and hoisted once via React 19 `<style href precedence>`. The grip
  uses the CSS keyword `white` (no white token), as on the slider thumb; segment text is white or black by the
  VP colour's lightness (`vpTextColour` from charts/gauge), so 10 px labels keep 4.5:1 in both themes (G12).
