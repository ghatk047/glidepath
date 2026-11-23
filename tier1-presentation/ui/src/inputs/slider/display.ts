/**
 * Display mechanics for the slider: where the thumb may sit and how its label reads.
 * Input clamping uses the display metadata tier 2 sends with the variable (min, max, step);
 * it is what a native range does, made exact so 0.1 + 0.2 shows as 0.3. No model maths here.
 */
import { fmt } from '../../format';

/** Fraction digits of a step such as 0.05 (2) or 1e-7 (7). */
export function decimalsOf(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = String(Math.abs(n));
  const exp = s.indexOf('e-');
  if (exp >= 0) {
    const mantissa = s.slice(0, exp);
    const dot = mantissa.indexOf('.');
    return Number(s.slice(exp + 2)) + (dot < 0 ? 0 : mantissa.length - dot - 1);
  }
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

const roundTo = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/**
 * Clamp to [min, max] and snap to the step grid that starts at min (native range semantics).
 * A max off the grid snaps to the highest on-grid value at or below it. step <= 0 clamps only.
 */
export function snapToStep(value: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(value)) return min;
  const clamped = Math.min(max, Math.max(min, value));
  if (!(step > 0)) return clamped;
  const digits = Math.max(decimalsOf(step), decimalsOf(min));
  let snapped = roundTo(min + Math.round((clamped - min) / step) * step, digits);
  if (snapped > max) snapped = roundTo(snapped - step, digits);
  return snapped;
}

/** Thumb / ghost position along the track, in percent. */
export function percentOf(value: number, min: number, max: number): number {
  return max > min ? ((value - min) / (max - min)) * 100 : 0;
}

/**
 * The value label for a registry unit (variables.json `unit`), through the format module.
 * Digits follow the step, so a 1-point percentage step reads "18%" and a $0.5M step "$12.5M".
 * Units with no `fmt` kind read as the plain value plus the unit ("6 months").
 */
export function formatByUnit(value: number, unit: string, step: number): string {
  const d = decimalsOf(step);
  switch (unit) {
    case '%':
      return fmt.pct(value, { digits: Math.max(0, d - 2) });
    case '%/yr':
      return `${fmt.pct(value, { digits: Math.max(0, d - 2) })}/yr`;
    case '$M':
      return fmt.money(value, { digits: d });
    case 'FTE':
      return fmt.fte(value);
    case 'x':
      return fmt.mult(value, { digits: d });
    default: {
      const shown = String(roundTo(value, d));
      return unit && unit !== '#' ? `${shown} ${unit}` : shown;
    }
  }
}
