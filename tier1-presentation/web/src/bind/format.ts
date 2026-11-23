import { fmt, type PercentScale } from '@glidepath/ui/format';
import { parsePercent } from '@glidepath/ui/inputs/editable';
import { formatByUnit } from '@glidepath/ui/inputs/slider';

/** A `fmt` kind by name (`<Value node="res.net" format="money" />`) or a display function. */
export type FormatName = 'money' | 'pct' | 'fte' | 'mult' | 'eps' | 'cents';
export type FormatProp = FormatName | ((v: number) => string);

/**
 * The bundle's `percentScale` of a variable or node (set by tier 2 from the registry): `fraction`
 * 0.1 is 10%, `points` 2.0 is 2.0%, `null` (or absent) when the unit is not a percent.
 */
export type { PercentScale };

/** `fmt` kinds for the registry units that have one. */
const byUnit: Readonly<Record<string, (v: number) => string>> = {
  $M: (v) => fmt.money(v),
  FTE: (v) => fmt.fte(v),
  x: (v) => fmt.mult(v),
};

/**
 * The display transform of a bound value: the `format` prop when given, else by the unit tier 2
 * sent (with the variable's step for its digits, like the slider label). Percent units read by
 * `scale`, the bundle's `percentScale` (`fraction` when absent). Presentation only.
 */
export function formatFor(
  format: FormatProp | undefined,
  unit: string | undefined,
  step?: number | null,
  scale?: PercentScale | null,
): (v: number) => string {
  if (typeof format === 'function') return format;
  if (format === 'pct') return (v) => fmt.pct(v, { scale });
  if (format) return (v) => fmt[format](v);
  if (unit !== undefined && typeof step === 'number') {
    return (v) => formatByUnit(v, unit, step, scale);
  }
  if (unit !== undefined && unit.startsWith('%')) {
    const suffix = unit.slice(1);
    return (v) => `${fmt.pct(v, { scale })}${suffix}`;
  }
  return (
    (unit !== undefined && byUnit[unit]) || ((v) => (unit ? `${String(v)} ${unit}` : String(v)))
  );
}

/**
 * Parser of typed text for an edit field, or `undefined` for the default number parser: a percent
 * unit is typed as it reads ("12" is 12%): `fraction` cells store 0.12, `points` cells store 12.
 */
export function parseFor(
  unit: string,
  scale?: PercentScale | null,
): ((text: string) => number | null) | undefined {
  return unit.startsWith('%') ? parsePercent(scale) : undefined;
}
