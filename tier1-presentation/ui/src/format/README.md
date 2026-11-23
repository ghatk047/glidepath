# format

The only presentation transform. `fmt.money | pct | fte | mult | eps | cents | signed`.

| Call | Example |
|---|---|
| `fmt.money(1007.6)` | `$1,007.6M` (input is $M) |
| `fmt.money(-23.7)` / `fmt.signed(43)` | `−$23.7M` / `+$43.0M` |
| `fmt.pct(0.208)` | `20.8%` (input is a decimal) |
| `fmt.pct(2, { scale: 'points' })` | `2.0%` (input is percentage points) |
| `fmt.fte(2692)` | `2,692` |
| `fmt.mult(7.39)` | `7.39×` |
| `fmt.eps(0.091)` | `$0.091` |
| `fmt.cents(1.74)` / `{ perGallon: true }` | `1.7¢` / `1.7¢/gal` |
| any kind with `null`, `undefined`, `NaN`, `±Infinity` | `—` |

`scale` is the bundle's `percentScale` for the cell (`'fraction'`, the default, or `'points'`): tier 2 sets it per variable and node, so a corporate driver (`corp.gdp` 2.0) and a lever share (0.1) both read correctly without the caller knowing the id.

Options: `digits` overrides the default fraction digits; `signed` adds `+` to positives; `fmt.signed(v, kind)` is shorthand. Negatives use U+2212. A value that rounds to zero carries no sign.

`toFixed`, `toLocaleString`, `toPrecision` and `Intl` are forbidden elsewhere in tier 1: spread `formatLintConfig` (from `eslint-rule.ts`) into the web/ui ESLint config.
