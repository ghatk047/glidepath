# @glidepath/tier-check

Web bundle inspector for gate G13 (tier separation). `pnpm tier-check` scans the production
web bundle and fails if it contains tier 2 code or SQL.

```
pnpm tier-check [--bundle <dir>] [--require-bundle]
```

Default bundle: `tier1-presentation/web/dist` (output of `pnpm --filter @glidepath/web build`).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | clean, or no bundle yet (prints `no web bundle at ...; skipping`) |
| 1 | leak found (each finding printed as `kind file:line match`) |
| 2 | tier-check itself could not run (bad arguments, unreadable bundle, or no bundle with `--require-bundle`) |

CI should pass `--require-bundle` once WEB-01 lands so a missing build fails the gate.

## What counts as a leak

- **Tier 2 symbols.** The denylist is derived at run time, not maintained by hand: the value
  exports (functions, classes, consts, enums; re-exports followed) of every entry file of every
  `tier2-logic/*` package (`main` and `exports` targets), read with the TypeScript checker.
  Type-only exports are skipped (erased at build). Names exported by `contract/*` or
  `tier1-presentation/*`, names shorter than 5 characters, and `packageName` are allowed.
  Matching is by whole identifier.
- **Tier 2 package specifiers** (`@glidepath/engine`, ...) and **source paths**
  (`tier2-logic/`, `tier3-data/`), including the `sources` of `.map` files.
- **SQL statement patterns**: upper-case `SELECT ... FROM`, `INSERT INTO`, `UPDATE ... SET`,
  `DELETE FROM`; any-case DML with a `$n` parameter; DDL (`create table` ...); `row level security`;
  `set_config(`.

Scanned: `.js .mjs .cjs .html .htm .map`.

Limit: a minifier mangles local names, so symbol matching is best effort; the package, path and
SQL checks and the boundary lint (`eslint-plugin-boundaries`) are the other layers.
