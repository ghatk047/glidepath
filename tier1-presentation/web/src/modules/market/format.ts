import { fmt, type PercentScale } from '@glidepath/ui/format';
import { decimalsOf, formatByUnit } from '@glidepath/ui/inputs/slider';

/**
 * Display of a corporate driver value by its registry unit and step (digits follow the step).
 * Percent units go through the shared path (`formatByUnit` with the bundle's `percentScale`, which
 * tier 2 sets: corporate percents are points, GDP 2 = 2.0%), so this module scales nothing itself.
 */
export function driverFormat(
  unit: string,
  step: number | null,
  scale?: PercentScale | null,
): (v: number) => string {
  const d = step === null ? 0 : decimalsOf(step);
  switch (unit) {
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
      return (v) => formatByUnit(v, unit, step ?? 1, scale);
  }
}

/** The one-time cost reads as a cost in the render ("−$39.1M"): the sign is display only. */
export const asCost = (v: number): string => fmt.money(-v);

export const epsFmt = (v: number, signed = false): string => fmt.eps(v, { digits: 2, signed });
