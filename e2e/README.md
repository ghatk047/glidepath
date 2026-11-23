# @glidepath/e2e

Playwright (Chromium) against the running compose stack, reached through `web` (Caddy) like a
browser: the G9 smoke (QA-04), the M2 integration spec (INT-03) and the demo storyline (QA-05, G10). Not part of `turbo run test`
(they need a stack); `test` runs only the unit tests of the helpers (`src/`).

```
docker compose up -d                  # or: ops/compose-check.sh --keep [--project glidepath-check]
pnpm e2e -- --trace off               # G9 smoke; INT_COMPOSE_PROJECT=<project> when not `glidepath`
pnpm int:m2 -- --trace off            # M2 integration spec (its own config and budget)
pnpm e2e:storyline -- --trace off     # G10 demo storyline (its own config and budget)
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

`tests/cockpit.ts` holds what both specs read on the Cockpit: the element each headline cell is
drawn in and the text the UI's own `fmt` makes of a number.

## `tests/m2.spec.ts` (INT-03, M2 exit of 09 §1)

Its own run (`playwright.m2.config.ts`, which the G9 config leaves out of `pnpm e2e`), so the G9
budget stays the smoke's. Serial, one signed-in page:

1. `cockpit_c_shows_the_spec_headline_numbers`: the Cockpit of preset C shows net 119.3,
   gap −23.7, risk-adjusted 82.0 and EPS +0.091 — the numbers **read from the spec**
   (`docs/spec/README.md` § "Headline numbers", via `src/spec-headline.ts`), rendered through
   `fmt`; the golden cells of C read the same.
2. `edits_persist_across_reload`: one registry step on the net target in its popover commits, tier
   2 forks `Custom (from C)`, and after `page.reload()` the fork, its edits count, its changeset
   row and every number are back; locked preset C is still at 0 edits and still golden.
3. `global_layer_works_…`: rail (8 modules, tenant monogram, routing), flight strip (its five
   cells off Cockpit, golden C), scenario bar (switch to A → the spec's A numbers), edit popover
   (the registry's min / max / step), trace drawer (`res.net`, tier 2's words and upstream chain),
   ⌘K (button and shortcut, a spec id ranked by `GET /search`).
4. `cockpit_c_screenshots_in_both_themes`: writes `docs/status/assets/cockpit-c-{cruise,daylight}-1440.jpg`
   for the status note, asserting the spec numbers in each theme.
5. `m2_suite_finishes_within_its_budget`.

The spec prints `[m2] timings (ms)`, what it read on screen and the screenshots it wrote. Each run
adds one `Custom (from C)` fork, like `int:m1`; preset C is never written.

## Visual baselines (QA-06, G11)

```
pnpm e2e:visual -- --trace off        # compare with the approved baselines; INT_COMPOSE_PROJECT=<project> when it is not `glidepath`
pnpm e2e:visual -- --update           # approve: write the baselines that are missing or differ (first approval, or a reviewed change)
```

`visual/visual.spec.ts` (own config `playwright.visual.config.ts`, driver `visual.mjs`; same stack and sign-in as the
smoke) takes a full-page screenshot of each of the 8 modules of preset C in 2 themes (`cruise`, `daylight`; set the way the
toggle stores it, `glidepath.theme`) at 2 widths (1440 and 390 CSS px), device scale 2 and reduced motion, like the UX pack's
renders. 32 tests, titled `<module>-<theme>-<width>`, each `toHaveScreenshot` against
`visual/baselines/chromium-<platform>/<module>-<theme>-<width>.png` (committed, one set per platform because fonts and
rasterisation differ between a Linux container and a Mac). The pixel threshold is in `src/visual.ts`: colour tolerance 0.1 and
at most 0.2% of pixels differing. Without `--update` a missing baseline fails; it is never written silently.

The last test, `visual_report_generated_beside_the_ux_screens`, writes the reviewer's report
`visual-report/index.html` (git-ignored; the folder holds the images and can be zipped): every baseline beside the render of
the same screen in `docs/ux/screens/` (13 of the 32 screens have one: Path is the pack's `solver`, Excel its `data`), the
page-height difference between the two, and for a failed comparison this run's capture and the pixel diff. That is the first
approval of G11: the reviewer reads the pairs, and a screen that differs from its render is recorded, not "fixed" in the pack.
`src/visual.ts` (matrix, file names, report page) and `src/visual-report.ts` (files) are unit-tested without a stack.

## `tests/storyline.spec.ts` (QA-05, G10)

`pnpm e2e:storyline -- --trace off` (`playwright.storyline.config.ts`, budget 600 s; the G9 config leaves it
out). The 11 beats of `docs/ux/05_demo_storyline.md` "Run of show", one test each, then the "Ready for
questions" moves the build has. Black box like the smoke: signed in with the INT magic link, every number the
storyline quotes read from the spec bundle and rendered through the UI's own `fmt`
(`src/storyline.ts`: README prose for the bar, growth and locked share; `solver_demo_results.json` for the
minimum-risk path and the Monte Carlo odds; `spec-headline.ts` for Rates only / C / D; `golden_results.json`
for the fuel equivalent). `src/storyline.test.ts` (part of `pnpm test`) pins that each quoted number is in the
spec and agrees with the golden results.

Beats are independent (each opens its own screen on a locked preset; an edit forks `Custom (from C)` as in
the room), so one failing beat does not hide the next. Run order is the order of the room:

1. `beat_01_…`: Cockpit C, the bar 143.0 (target plus cost growth 43.0), net 119.3, gap −23.7, risk-adjusted 82.0, EPS +0.091.
2. `beat_02_…`: Baseline, locked share 20.8%, group by pool, click Airline platforms and US labour.
3. `beat_03_…`: scenario bar to Rates only: net 8.1, gap −134.9, risk-adjusted 5.8.
4. `beat_04_…`: Levers, seventeen levers, drag shelfware (L10), Cloud FinOps (L11) off and on, the strip follows.
5. `beat_05_…`: VPs, four short bars, drag Data & analytics toward Commercial.
6. `beat_06_…`: Find a path: net 143.0, bar cleared, US headcount unchanged, no people lever (L03 to L05) or head count moved, COLA refused to 100%.
7. `beat_07_…`: D's headline (166.9, clear), odds C 0% and D 4.5% (within the solver gate's ±1.5 pp), the Cockpit's Odds tile.
8. `beat_08_…`: Market, walk the trace node by node, EPS +0.091, price +1.02, fuel 1.74¢, Brent up ten dollars.
9. `beat_09_…`: Cockpit hand-over: one-time funding and the target.
10. `beat_10_…`: Excel, export C + D (the download), re-import it unchanged (0 changes), then an import with one conflict.
11. `beat_11_…`: Airlines, the AA tile (Live, monogram, counts), "Add an airline".

"Ready for questions": COLA to 0%, outside funding 0% and 100% (net swings by the one-time tile, EPS does
not move), one line edited on Baseline, start month (April) of L03 to L05.

The Excel conflict is made on a Custom scenario because the UI exports presets only and presets are locked:
the test exports a Custom scenario through the API, edits the net target in the file (`src/xlsx.ts`, ExcelJS),
changes the same target in the app, and hands the file to the review screen.

Where a step waits on another backlog item the test is `test.fixme` with the item id in its title and states the
final behaviour; the list is in the QA-05 report, and the header comment of the spec.
