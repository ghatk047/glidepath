# inputs/controls

Dial (#11), Toggle / Stepper / Segmented (#12), Radio card (#14), Prompt bar (#15). Module `src/inputs/controls` (index.ts). Presentational only: values, limits, defaults and labels arrive as props; ids are used verbatim (ADR-018, exposed as `data-variable-id`).

- `Dial`: 270° arc, drag up/down (160 px = full range) or arrow keys / Home / End; ghost tick at `defaultValue`; `role="slider"` with aria value/min/max/valuetext. `onChange` fires live, `onCommit` at the end of a drag or key press.
- `Toggle`: native checkbox with `role="switch"`; the knob moves on the toggle spring.
- `Stepper`: minus / plus by `step`, typed entry committed on Enter or blur (Escape cancels). `min`/`max` only bound the buttons.
- `Segmented`: `options[{id,label}]`, `value`, `aria-pressed` on the choice.
- `RadioCard`: native radio group; checked card gets glass-2 + hairline (`data-checked`).
- `PromptBar`: `value`, `onSubmit(text)`; copy says it ends in a reviewable changeset. Never writes.
- `controlsCss` is tokens only and mounted once by `useControlsStyles()`; mount `GlassProvider` at the app root.
