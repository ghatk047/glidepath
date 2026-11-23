# @glidepath/e2e

G9 E2E smoke (QA-04): Playwright (Chromium) against the running compose stack, reached through `web`
(Caddy) like a browser. Not part of `turbo run test` (it needs a stack); `test` runs only the unit
tests of the helpers.

```
docker compose up -d                  # or: ops/compose-check.sh --keep [--project glidepath-check]
pnpm e2e -- --trace off               # INT_COMPOSE_PROJECT=<project> when it is not `glidepath`
```

Settings are the INT settings (`tools/int/src/stack.ts`): `INT_BASE_URL` / `PUBLIC_BASE_URL`,
`INT_MAIL_URL` (mailpit, dev profile), `INT_EMAIL`, `INT_TENANT`, `INT_CA_FILE`, `INT_COMPOSE_PROJECT`.
Sign-in is the INT magic link (mailpit); the session cookies are handed to the browser. The browser
ignores the certificate error of Caddy's `tls internal` CA; Node's fetch trusts the CA.

`tests/smoke.spec.ts` (serial, one signed-in page, `globalTimeout` 180 s = the G9 budget):

1. `cockpit_c_headline_numbers_equal_golden`: Cockpit of preset C shows `res.net`, `res.gap`,
   `res.risk`, `br.eps27` equal to `golden_results.json` `scenarios.C` formatted with the UI's `fmt`.
2. `drag_target_moves_the_bar_and_forks_preset_c`: pointer-drag of the Net target slider
   (`g.target_net`, range from the registry) moves `res.bar`, commits, and tier 2 forks the locked preset.
3. `switch_scenario_shows_golden_a`: the scenario bar switches to A; headline equals golden A.
4. `edit_input_via_popover_then_undo`: "of $X bar" opens the edit popover, one step commits an edit,
   Undo in the changeset tray restores golden A.
5. `edit_lever_via_cmdk_popover_then_undo`: ⌘K finds `lev.L10.shelf` by id, Enter jumps to Levers and
   opens the lever's popover, one step commits an edit (a fork of locked preset A), Undo restores
   golden A.
6. `suite_finishes_within_the_g9_budget`.

The SPA sends `x-csrf-token` itself (WEB-09); the browser gets the `gp_csrf` cookie like a real
sign-in and nothing injects the header. The app mounts `GlobalOverlays` (⌘K, lever popover, trace
drawer), so the smoke drives the real palette.

## Performance monitors (QA-08, G8)

```
pnpm e2e:perf -- --trace off          # INT_COMPOSE_PROJECT=<project> when it is not `glidepath`
pnpm e2e:perf -- --device             # the owner's run on the demo Mac (headed), same specs, same table
```

`perf/perf.spec.ts` (own config `playwright.perf.config.ts`, driver `perf.mjs`; same stack, sign-in and
browser set-up as the smoke; the tests are independent, so one metric over budget does not hide the rest):

1. `drag_frame_p95_within_60fps`: rAF frame intervals while the Net target slider (`g.target_net`) is dragged
   back and forth, one pointer move per frame. p95 <= 16.7 ms. The row also carries p50/p99/max, fps, dropped
   frames, long tasks, the glass quality the app settled on, and an idle-page control p95 (not a budget: it shows
   what the machine alone does to frame times).
2. `preview_round_trip_p95_under_25ms`: from the browser (the page's own origin, cookies and TLS, through Caddy)
   one `preview` frame answered by its `delta`, 200 round trips after 20 warm-up, paced at
   `PREVIEW_MIN_INTERVAL_MS` like the SPA's client (the server caps reruns at that rate). p95 < 25 ms.
3. `glass_layers_within_budget_on_every_module`: computed `backdrop-filter` layers on screen on each of the eight
   modules and on Cockpit with the edit popover open; at most `GLASS_BLUR_BUDGET` (3).
4. `report`: prints the metric table (also `perf-report.json`, git-ignored) and fails when any metric is over.

When the host's 1-minute load exceeds its CPU count the table says so: the numbers are then not a device
measurement. Budgets are never relaxed; re-measure on a quiet machine (`--device` on the demo Mac).
