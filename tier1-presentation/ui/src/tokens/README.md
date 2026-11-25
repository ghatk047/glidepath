# tokens

`docs/ux/tokens.json` -> `tokens.css` (CSS custom properties; Cruise is the default, Daylight under `[data-theme="daylight"]`) and `tokens.generated.ts` (typed maps `cssVar`, `tokenValue`, `breakpoints`).

- Regenerate: `pnpm --filter @glidepath/ui build:tokens` (a test fails if the committed files are stale).
- Theme: `initTheme()` / `setTheme()` set `data-theme` on `<html>` and remember it in localStorage (`glidepath.theme`).
- Breakpoints: `media.tablet` (1180 px), `media.phone` (760 px).
- Import `tokens.css` once at the app entry. Components use `var(--...)` or `cssVar[...]`; no hex or raw px outside this folder.
