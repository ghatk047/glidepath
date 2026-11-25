# glass

Glass primitives from the moodboard glass recipe, inside the blur budget of 07_frontend §5.

- `<GlassProvider>`: mount once at the app root, inside the element that has `tokens.css`. It injects the glass CSS (`glassCss`, generated from the token map in `styles.ts`), owns the blur budget and turns on the low-blur fallback on `prefers-reduced-transparency` or slow frames (p75 frame time over 25 ms, sampled on mount).
- `<Aurora />`: the sky. Pre-blurred: the blur is baked into the gradients, so the sky has no `filter` or `backdrop-filter`. Drifts 46–60 s, still under reduced motion or the fallback.
- `<GlassPanel level header span padding loading skeleton>`: level 1 = panel (glass-2 → glass), 2 = raised (glass-3 → glass-2), 3 = overlay: popover, palette, drawer, tooltip (glass-3). `header={{ label, status }}`: label names the region, and `status` is the status chip area (aria-live). `loading` keeps the header and shows skeletons, never a spinner.
- `<Grid>` / `<GridCell span stack>`: 12 columns with the token gap. Below 1180 px, quarter tiles go to 6 columns and everything else to 12. Below 760 px every cell stacks.
- `<Skeleton size width ratio>`: a still bar at 40% opacity, 1em of a type token tall, or a block.

Blur budget: at most 3 surfaces carry `backdrop-filter` (`data-blur="on"`). Slots go to the highest level first. A level gets blur only when all of its surfaces fit, so one level always looks the same. With a full Cockpit, panels stay tint-only over the pre-blurred sky and overlays get the blur.

`stories/CockpitComposite.tsx` is the Cockpit layout built from these primitives. The tests use it for the budget count, the layout snapshot and axe.
