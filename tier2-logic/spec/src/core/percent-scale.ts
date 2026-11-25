/**
 * Percent scale (WEB-10): how a percent-unit value is stored, so the front end shows and parses it
 * correctly without knowing any id. Pure: no IO. The bundle builder sets it per variable and node.
 *
 * Two scales exist in the model (docs/spec, variables.json and formula_graph.json):
 *  - `fraction`: 0.1 is 10%. Every lever, target, baseline and VP percent (`g.target_pct` 0.1).
 *  - `points`: 2.0 is 2.0%. Every corporate-layer percent (`corp.gdp` 2.0, `corp.lf` 84), whose
 *    formulas divide by 100 where they need a fraction (`... * corp.tax / 100`).
 *
 * The rule is read from registry fields only, never from ids:
 *  - Percent family: the unit starts with `%` (`%`, `%/yr`, `% of US FTE`, `% of US cost`).
 *    Other units (`pts` = percentage-point differences, `$M`, `x`, ...) have no percent scale: `null`.
 *  - Variable: layer `corporate` -> `points`, any other layer -> `fraction`.
 *  - Node: layer `corporate` -> `points` (these nodes are built from corporate inputs, e.g.
 *    `pl.lf = corp.lf + ...`); otherwise `points` when the formula itself converts a ratio to
 *    points (every expression ends in `* 100`: `pl.ebit / pl.rev * 100`, `val.px_vs`,
 *    `br.eps_pct27`), else `fraction`.
 * `percent-scale.test.ts` checks the rule against every percent variable and node of the spec,
 * and the server test against the engine's computed magnitudes.
 */

export type PercentScale = 'fraction' | 'points';

/** Layer whose percent values are percentage points. */
export const POINTS_LAYER = 'corporate';

/** Percent family of registry units: `%`, `%/yr`, `% of US FTE`. */
export const isPercentUnit = (unit: string): boolean => unit.startsWith('%');

/** True when `expr` is one product ending in `* 100` (no top-level sum or difference). */
export function endsInTimes100(expr: string): boolean {
  const text = expr.trim();
  if (!/\*\s*100$/.test(text)) return false;
  let depth = 0;
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && (ch === '+' || ch === '-')) return false;
  }
  return depth === 0;
}

/** Scale of a registry variable; `null` when its unit is not a percent. */
export function variablePercentScale(v: {
  readonly unit: string;
  readonly layer: string;
}): PercentScale | null {
  if (!isPercentUnit(v.unit)) return null;
  return v.layer === POINTS_LAYER ? 'points' : 'fraction';
}

/** Scale of a formula node; `null` when its unit is not a percent. */
export function nodePercentScale(n: {
  readonly unit: string;
  readonly layer: string;
  readonly expr?: string | undefined;
  readonly cases?: readonly { readonly expr: string }[] | undefined;
}): PercentScale | null {
  if (!isPercentUnit(n.unit)) return null;
  if (n.layer === POINTS_LAYER) return 'points';
  const exprs = [...(n.cases ?? []).map((c) => c.expr), ...(n.expr !== undefined ? [n.expr] : [])];
  return exprs.length > 0 && exprs.every(endsInTimes100) ? 'points' : 'fraction';
}
