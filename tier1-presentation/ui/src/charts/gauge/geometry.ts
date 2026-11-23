/**
 * Gauge and ring geometry: where marks sit on the arc. Presentation only. Every value (net, bar,
 * target, scale max) arrives from tier 2 as a prop; this file only maps a value to an angle on a
 * scale it was given. The constants are the prototype's drawing units
 * (docs/ux/prototype/src/core.js `gauge`, `ring`), in SVG user units of the viewBox, not px.
 */

export type Maybe = number | null | undefined;
export const isNum = (v: Maybe): v is number => typeof v === 'number' && Number.isFinite(v);

/** Drawing units of the 270° gauge (core.js `gauge`). */
export const GAUGE = {
  viewBox: '-10 -6 340 300',
  cx: 160,
  cy: 160,
  r: 128,
  /** 135°: the arc starts at the lower left... */
  start: Math.PI * 0.75,
  /** ...and sweeps 270° clockwise to the lower right. */
  sweep: Math.PI * 1.5,
  /** Track and fill thickness. */
  stroke: 14,
  /** Ticks sit outside the track, from r + tickIn to r + tickMinor / tickMajor. */
  tickIn: 16,
  tickMinor: 19,
  tickMajor: 23,
  tickWidthMinor: 1,
  tickWidthMajor: 1.4,
  tickOpacity: 0.6,
  /** Notches cross the track by notchHalf either side; labels sit at r + notchLabel. */
  notchHalf: 13,
  notchLabel: 38,
  /** Baseline nudge so a label centres on its notch. */
  labelNudge: 4,
  barWidth: 2.4,
  targetWidth: 1.4,
  targetDash: '2 3',
  /** Invisible hit line on the notches so the tooltip is reachable. */
  hitWidth: 12,
  /** The 0 and max labels sit under the arc ends. */
  endLabelDx: 4,
  endLabelDy: 26,
} as const;

/** Display axis: a tick every 20 on the scale, a major tick every third (core.js `gauge`). */
export const TICK_STEP = 20;
export const MAJOR_EVERY = 3;

/** Drawing units of the ring (core.js `ring`). */
export const RING = {
  size: 64,
  stroke: 5,
  /** The percentage sits a touch under the middle so it reads optically centred. */
  textY: '54%',
} as const;

const round = (n: number, places: number) => {
  const k = 10 ** places;
  const v = Math.round(n * k) / k;
  return v === 0 ? 0 : v; // never "-0"
};
/** Coordinates print with 2 places on arcs and 1 on lines, as in the prototype. */
export const p2 = (n: number) => round(n, 2);
export const p1 = (n: number) => round(n, 1);

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Share of the scale in [0, 1]; empty without a usable scale. */
export function scaleFraction(v: Maybe, max: Maybe): number {
  if (!isNum(v) || !isNum(max) || max <= 0) return 0;
  return clamp01(v / max);
}

/** Angle (radians) of a value on the gauge's 0..max scale; values past either end pin to it. */
export const angleAt = (v: Maybe, max: Maybe) => GAUGE.start + GAUGE.sweep * scaleFraction(v, max);

export const polar = (r: number, a: number, cx: number = GAUGE.cx, cy: number = GAUGE.cy) =>
  [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;

/** Clockwise SVG arc path from angle a0 to a1 on the gauge circle of radius r. */
export function arcPath(r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p2(x0)} ${p2(y0)}A${r} ${r} 0 ${large} 1 ${p2(x1)} ${p2(y1)}`;
}

/** Tick values 0, 20, 40 … up to the scale max (from props). */
export function tickValues(max: Maybe): number[] {
  if (!isNum(max) || max <= 0) return [];
  const out: number[] = [];
  for (let i = 0; i * TICK_STEP <= max; i++) out.push(i * TICK_STEP);
  return out;
}

/** Ring fill share in [0, 1] (value / max, clamped). The arc never overdraws or runs backwards. */
export const ringFraction = scaleFraction;
