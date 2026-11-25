# charts/distribution

Histogram and tornado (UX inventory #21, #22). Import as `@glidepath/ui/charts/distribution`. Presentational: tier 2 sends precomputed bins and sorted rows, tier 1 only scales them to the svg. No statistics, no sorting, no rules.

- `<Histogram bins p10 p50 p90 bar label? width? height?>`: `bins` is `{ from, to, count }[]` binned by tier 2 from the Monte Carlo sample array (tier 1 never bins samples). One rect per bin, heights scaled to the tallest count. A bin whose centre is at or past `bar` gets `data-tone="pos"` (status green); the rest use the accent. Dashed bar line labelled "Bar"; `P10 63 / P50 102 / P90 136` labels under the axis (a missing value drops its label). Empty bins render an empty, labelled svg.
- `<Tornado items max? formatValue? label?>`: `items` is `{ variableId, label?, swing, category }[]` drawn in the order given. `category` is `policy | timing | lever`: policy and timing are amber (`warn`), levers blue (`sequential.2`). Bar length is `swing / max` (default: largest swing in `items`). Value label drops the `$` and `M` (the panel header says "swing $M"); override with `formatValue`.
- Accessibility: each svg is `role="img"` with a name; histogram has a `<desc>` of the P values and bar; every bin and bar carries a `<title>` (hover tip, and the category or "past the bar" in words, so colour is never the only cue).
- CSS is generated from tokens (`styles.ts`) and injected with a hoisted `<style href precedence>`; chart geometry is in viewBox units, so the svg scales with its panel.

