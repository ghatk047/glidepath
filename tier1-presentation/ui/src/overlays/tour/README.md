# overlays/tour

Generic walkthrough primitives (WIZ-04). Import `@glidepath/ui/overlays/tour`. No data and no state: the engine (`web/src/global/tour`) owns steps, store and anchors and passes a measured `rect`.

- `placeCard(target, card, viewport, preferred, gap)`: pure. Preferred side, then opposite, then the other axis, then centre. `null` target centres. Returns `{ top, left, placement }`.
- `<Spotlight rect pad?>`: one fixed element; its spread shadow (ground at 55%) is the scrim, `pointer-events: none`, no backdrop-filter, accent ring, moves by `transform`.
- `<Coachmark index count title body onNext onBack onClose>`: level 3 glass `role="dialog" aria-modal="false"`. Counter `n / N`, Back (disabled on 1), Next (Done last), Skip, dots. Focus lands on Next each step, Tab cycles inside (`useDialog`). Keys: ArrowRight / Enter next, ArrowLeft back, Escape skip. Polite live region: "Step n of N: title".
- `<TourOverlay rect index count title body preferred onNext onBack onClose>`: measures the card, composes the two, docks as a bottom sheet at phone width, and mounts `tourCss` (`<style href="glidepath-tour">`).
- z-index: spotlight 93, card 94, under the palette scrim (95). Reduced motion: transitions off (inline and CSS).
