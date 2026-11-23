# inputs/editable

Editable number (#9, `.ed`) and Edit popover (#10, `openPop`). Module `src/inputs/editable` (index.ts). Presentational only: values, formats, limits and warning texts arrive as props from tier 2; ids are used verbatim (ADR-018: binding to node ids lives in web).

- `<EditableNumber variableId | nodeId value format popover changed mode onTrace>`: the number as a button. Dotted underline on hover, solid once changed (`changed` prop; when omitted, after the first edit through its popover, until Reset). The displayed text rolls to pushed values (`NumberRoll`); `format` is a `fmt.*` function; null shows an em dash.
  - `mode="input"` (default): click opens the popover.
  - `mode="output"`: click calls `onTrace(nodeId)` (trace drawer). If `popover` is given, a small pin button (visible on hover, focus, or when `pinned`) opens the popover in output mode.
- `<EditPopover label unit min max step source confidence defaultValue warnings value format mode onChange onReset onPin onClose anchor>`: number field + slider + chips (Source, Confidence, Default) + Reset / Done. Escape or an outside press closes; focus goes to the number field on open and back to the anchor on close. `onChange` fires live (field commit on Enter or blur, slider on every move). Reset calls `onReset`, else `onChange(defaultValue)`, then closes. Output mode adds a reason field and "Pin with reason" (disabled until a reason is typed) calling `onPin({ value, reason })`.
- `warnings` are rendered verbatim, one list item each, in a `role="status"` region (a glyph is added by CSS, so colour is not the only cue).
- `parse` (typed text to number) defaults to `parseNumber`: it strips everything but digits, `.`, `-` and U+2212. Units that need a rule (percent typed as `4` meaning 0.04) pass their own `parse`; the popover never clamps or validates, tier 2 does and answers with warnings.
- Styles: `editableCss` (tokens only) is mounted into `<head>` once by `useEditableStyles()`. The popover is a level 3 `GlassPanel`; mount `GlassProvider` at the app root for the glass CSS.
