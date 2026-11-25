# charts/gauge

Gauge and Ring tile (UX inventory #16, #17). Import as `@glidepath/ui/charts/gauge`. Presentational: every value arrives as a prop from tier 2 (ADR-018); web binds the node ids. Geometry is the prototype's (`core.js` `gauge`, `ring`) in SVG user units.

- `<Gauge net bar target max labels ariaLabel>{centre}</Gauge>`: 270° arc. Net is the gradient fill (accent-2 → accent, glow), bar is a solid ink notch labelled "Bar 143", target is a dotted notch labelled "Target 100". Ticks every 20 (`TICK_STEP`), a major one every 60, labels 0 and `max`. `max` is a prop: the scale is never derived from net or bar here. A value past the scale pins to the end of the arc. Null values draw nothing for that mark (track only before tier 2 pushes).
- Fill tween: the arc follows `motion` NumberRoll (token `motion.roll`, `motion.ease`), so it lands with the number roll of the centre hero. Under `prefers-reduced-motion` it jumps.
- Centre slot: children render in `.gp-gauge-center` over the arc (hero number, "of $X bar", status chip). Use `.gp-gauge-hero` and `.gp-gauge-hero-unit` for the Cockpit hero number (prototype `.gauge-wrap .hero-num`). The centre lets the pointer through to the arc except over its own content.
- `<RingTile value max colour label>{side}</RingTile>`: VP net against its bar, percentage in the centre (ink, never series colour), arc in the VP colour. `colour` is a VP slot (0-based) or a CSS colour token. `vpColour(slot)` maps slot order to `color.series` (wraps past `VP_SLOTS`). Children go beside the ring in a `.gp-ring-row`. The arc clamps to 0..100%; the centre text shows the share as given.
- Tooltips: every mark carries `data-tip` (gauge track, net, bar, target; the ring arc) for the shared Tooltip (UI-18). Notches have a wider invisible hit line. The SVGs are `role="img"` with a spoken summary.
- CSS is generated from tokens (`styles.ts`) and injected with a React 19 hoisted `<style href precedence>`.
