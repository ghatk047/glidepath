export type Bezier = readonly [number, number, number, number];

/** "cubic-bezier(.2,.8,.2,1)" -> [.2, .8, .2, 1]. */
export function parseCubicBezier(css: string): Bezier {
  const m = /^cubic-bezier\(\s*([^)]*)\)$/.exec(css.trim());
  const parts = m?.[1]?.split(',').map((p) => Number(p.trim())) ?? [];
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) {
    throw new Error(`not a cubic-bezier(): ${css}`);
  }
  return parts as unknown as Bezier;
}

const NEWTON_STEPS = 8;
const BISECT_STEPS = 24;
const EPS = 1e-6;

/** CSS-style timing function: progress t in [0,1] -> eased progress. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const ax = 1 - 3 * x2 + 3 * x1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 1 - 3 * y2 + 3 * y1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;

  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < NEWTON_STEPS; i++) {
      const err = sx(u) - t;
      if (Math.abs(err) < EPS) return sy(u);
      const d = dx(u);
      if (Math.abs(d) < EPS) break;
      u -= err / d;
    }
    let lo = 0;
    let hi = 1;
    u = t;
    for (let i = 0; i < BISECT_STEPS; i++) {
      const x = sx(u);
      if (Math.abs(x - t) < EPS) break;
      if (x < t) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}
