import { fmt } from '@glidepath/ui/format';
import { formatByUnit } from '@glidepath/ui/inputs/slider';

/** A `fmt` kind by name (`<Value node="res.net" format="money" />`) or a display function. */
export type FormatName = 'money' | 'pct' | 'fte' | 'mult' | 'eps' | 'cents';
export type FormatProp = FormatName | ((v: number) => string);

/** `fmt` kinds for the registry units that have one. */
const byUnit: Readonly<Record<string, (v: number) => string>> = {
  $M: (v) => fmt.money(v),
  '%': (v) => fmt.pct(v),
  FTE: (v) => fmt.fte(v),
  x: (v) => fmt.mult(v),
};

/**
 * The display transform of a bound value: the `format` prop when given, else by the unit tier 2
 * sent (with the variable's step for its digits, like the slider label). Presentation only.
 */
export function formatFor(
  format: FormatProp | undefined,
  unit: string | undefined,
  step?: number | null,
): (v: number) => string {
  if (typeof format === 'function') return format;
  if (format) return (v) => fmt[format](v);
  if (unit !== undefined && typeof step === 'number') return (v) => formatByUnit(v, unit, step);
  return (
    (unit !== undefined && byUnit[unit]) || ((v) => (unit ? `${String(v)} ${unit}` : String(v)))
  );
}
