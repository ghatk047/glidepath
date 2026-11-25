# shell

Presentational shell components (04_component_inventory, Shell #1, #2, #6). Props only; no scenario or tenant logic. Web binds them to ids and routes. Import as `@glidepath/ui/shell`.

- `<Rail items current tenantCode tenantName? tenantStatus? onTenant? onSelect? />`: nav landmark, 84 px column (`space.railWidth`). Items are links (`href` default `#id`); `current` gets `aria-current="page"`, the glass-2 tint and an accent icon. Items with a different `group` get a divider. Under 760 px it is a fixed bottom bar that scrolls inside itself. Icons are passed in (drawn with `currentColor`).
- `<ScenarioBar scenarios current customs? paths? onSelect />`: segmented letter + name buttons (`aria-pressed`, pressed = glass-3). On a phone only the letter is visible; the name stays in the accessible name. Custom and Path scenarios sit in an overflow menu (`role=menu`, menuitemradio, arrows / Home / End / Escape). When `current` is a custom or path, the overflow button shows it.
- `<TenantButton code status? name? onClick? />`: IATA code in a neutral mono monogram (max 3 characters). No image or logo prop exists (rule 9).
- `<ShellStyles />` injects `shellCss` once (components do it themselves). The ScenarioBar menu uses a level 3 `GlassPanel`, so mount `GlassProvider` at the app root.

Tokens only: colours, radii, fonts, motion and the rail width come from CSS vars; control metrics with no token are rem (`rem()`); the only px are the token hairline width and the phone breakpoint. Phone touch targets are 44 (`TOUCH_TARGET`).

The rail carries no backdrop blur (tint only over the pre-blurred sky), to stay inside the 3-layer budget of `glass`.
