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
5. `suite_finishes_within_the_g9_budget`.

Known gaps worked around (see the QA-04 report): the SPA does not send `x-csrf-token` (the fixture
adds it on writes), and `GlobalOverlays` (⌘K palette, lever popover, trace drawer) is not mounted by
the app router, so the popover driven here is the Cockpit target popover.
