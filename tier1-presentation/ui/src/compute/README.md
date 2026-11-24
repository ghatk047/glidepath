# compute

`ComputeFlow`: the "math is running" indicator (plan 07 §5). Thin interfering sine waves flow
sideways while maths glyphs rise through them, in the Cruise accent tones over glass.

```tsx
import { ComputeFlow } from '@glidepath/ui/compute';
<ComputeFlow active variant="inline" progress={job.progress} />
```

- `variant`: `inline` (6rem x 1.25rem, 3 waves, 6 glyphs) or `field` (fills its box, 4 waves, 12 glyphs).
- `progress`: 0..1 as tier 2 sent it; brightens the glyph layer. Never derived here.
- `still`: force the static rendering. Also static under `prefers-reduced-motion` and when `useGlassQuality()` is `low` (full quality without a GlassProvider).
- Decorative (`aria-hidden`); the accessible signal stays the job's progressbar and note.
- Only `transform` and `opacity` animate, on the HTML wave wrappers and glyph spans. No JS loop, no filter or box-shadow. An IntersectionObserver sets `data-visible="false"` off-screen, which pauses animation and drops `will-change`.
- Exports: `ComputeFlow`, `computeCss`, `wavePath(cycles, amplitude)`, `COMPUTE_GLYPHS`.
