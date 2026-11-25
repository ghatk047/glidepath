# @glidepath/int

Milestone integration specs (INT items) against the running compose stack. Black box: the specs reach
the stack the way a browser does, through `web` (Caddy) at PUBLIC_BASE_URL, signed in with a magic link
caught by mailpit (dev profile), and use only the contract (`@glidepath/api-contract` client and WS
parser) plus the reference files in `docs/spec/` (golden values via `@glidepath/parity`, slider bounds
from `variables.json`).

The specs need a stack, so they are not part of `turbo run test`; the package has no `test` script.

```
docker compose up -d                       # or: ops/compose-check.sh --keep (project glidepath-check)
pnpm int:m1                                # INT_COMPOSE_PROJECT=glidepath-check after compose-check
```

## `m1.spec.ts` (INT-02, M1 exit of 09 §1)

1. The seed holds the five locked presets; preset C is unedited.
2. `GET /scenarios/:C/calc` equals the golden C headline values (`res.net`, `res.gap`, `res.risk`,
   `br.eps27`) and every other golden C cell the calc carries (1e-6 relative after `round(x, 6)`, as G3).
3. `WS /ws/session` on C: the snapshot of all 152 golden C cells matches golden; a `preview` of
   `g.target_net` (one registry step) answers `delta{seq}`; `cancelPreview` restores the committed cells.
4. `POST /changesets` on C: forks `Custom (from C)` (`forkedFrom` = C), the stored outputs equal what the
   preview showed, the author's session hears `changeset{forkedFrom}` + `delta{null}`, and the fork, its
   input, its history entry and its `calc_run` are readable back.
5. Preset C is untouched: same version, GET calc still golden.

The spec prints `[m1] timings (ms)` (calc GET, preview round trip, commit) for the status note. Each run
adds one fork (`Custom (from C) n`); preset C never changes, so the spec can run again on the same stack.

## Settings (environment only, defaults match `.env.example`)

| Variable | Default |
|---|---|
| `INT_BASE_URL` | `PUBLIC_BASE_URL`, else `https://localhost` |
| `INT_MAIL_URL` | `http://localhost:8025` (mailpit API) |
| `INT_EMAIL` | `DEMO_USER_EMAIL`, else `demo@example.com` (the seed's owner) |
| `INT_TENANT` | `aa` |
| `INT_CA_FILE` | unset: Caddy's internal root CA is read from the `web` container |
| `INT_COMPOSE_PROJECT` | `glidepath` (the project to read that CA from) |
