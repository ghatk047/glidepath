# motion

- `NumberRoll` / `bindNumberRoll(el, { format })`: tweens the *displayed* number from old to new (token `motion.roll` 520 ms, or `motion.value` 420 ms; token `motion.ease`). The target always comes from tier 2 via `set(value)`; nothing is computed here. Width is reserved in `ch` (widest of old/new text) with token `type.numerals`, so the roll causes no layout shift. A retarget mid-roll continues from the shown value.
- `springs.toggle | toast | drawer`: token `motion.spring` curve, 250/300 ms, toast hold = token `motion.toast`. `transition(name, props, reduced)` builds the CSS value.
- Reduced motion: `prefersReducedMotion()`; the roll jumps and springs become `none`. `reducedMotionCss` switches off every CSS transition and animation; include it once at the app entry.
- Spring durations (250/300 ms) are constants here because tokens.json has no token for them yet.
- Framework-free; a React wrapper calls `set()` from an effect.
