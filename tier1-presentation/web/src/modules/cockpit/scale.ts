import { MAJOR_EVERY, TICK_STEP } from '@glidepath/ui/charts/gauge';

/**
 * Display scale of the gauge: the axis end, not a business number. The contract carries no
 * gauge scale (reported as a gap in MOD-01), so the panel picks the axis the prototype draws
 * (`core.js` `gauge`): the larger of bar and net plus headroom, rounded up to a major tick, so
 * the bar notch never sits on the end of the arc. For AA C (bar 143.0) that is the render's 180.
 */
export const GAUGE_HEADROOM = 1.18;

const MAJOR = TICK_STEP * MAJOR_EVERY;

const isNum = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Axis end of the gauge for the values on screen; `null` until tier 2 has pushed any. */
export function gaugeMax(
  bar: number | null | undefined,
  net: number | null | undefined,
): number | null {
  const shown = [bar, net].filter(isNum);
  if (!shown.length) return null;
  const top = Math.max(...shown, 0) * GAUGE_HEADROOM;
  return Math.max(MAJOR, Math.ceil(top / MAJOR) * MAJOR);
}
