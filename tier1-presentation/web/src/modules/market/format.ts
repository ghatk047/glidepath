import { fmt } from '@glidepath/ui/format';
import { decimalsOf, formatByUnit } from '@glidepath/ui/inputs/slider';

/**
 * Display transforms of the Market screen. Presentation only: the registry's corporate `%`
 * values are percentage points (GDP 2 = 2.0%), while `fmt.pct` takes decimals, so the unit
 * scale is applied here, for display, and nothing is written back.
 */
export const pctPoints = (v: number, digits = 1, signed = false): string =>
  fmt.pct(v / 100, { digits, signed });

/** Display of a corporate driver value by its registry unit and step (digits follow the step). */
export function driverFormat(unit: string, step: number | null): (v: number) => string {
  const d = step === null ? 0 : decimalsOf(step);
  switch (unit) {
    case '%':
      return (v) => pctPoints(v, d);
    case '%/yr':
      return (v) => `${pctPoints(v, d)}/yr`;
    case '$/bbl':
      return (v) => fmt.eps(v, { digits: 0 });
    case '$/gal':
    case '$':
      return (v) => fmt.eps(v, { digits: Math.max(d, 2) });
    case '#':
    case 'm':
    case 'k':
      return (v) => fmt.fte(v);
    default:
      return (v) => formatByUnit(v, unit, step ?? 1);
  }
}

/** The one-time cost reads as a cost in the render ("−$39.1M"): the sign is display only. */
export const asCost = (v: number): string => fmt.money(-v);

export const epsFmt = (v: number, signed = false): string => fmt.eps(v, { digits: 2, signed });
