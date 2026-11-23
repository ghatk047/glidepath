/**
 * One-dimensional root finding for goal seek (`solvers.json` `goal_seek.method`: "Brent / bisection after
 * a monotonicity scan (11 points); report 'not reachable within range' with the closest value").
 *
 * The search is a generator: it yields the points it wants evaluated and receives their outputs, so the
 * same code runs on a scalar function (tests, `seekScalar`) and on the engine's batch evaluator, where
 * many searches (one per breakeven row) advance in lockstep, one batch per round. Pure: no IO.
 */

/** Points of the monotonicity scan, `lo` and `hi` included (`solvers.json` `goal_seek.method`). */
export const SCAN_POINTS = 11;

/** Brent stops once the bracket is narrower than this fraction of the search range. */
export const DEFAULT_XTOL_FRACTION = 1e-10;

/** Brent iterations before giving up (it converges in far fewer on any bracketed root). */
export const DEFAULT_MAX_ITERATIONS = 200;

/**
 * Two scan outputs differing by less than this fraction of the largest |output| count as equal, so
 * floating-point noise on a flat stretch does not read as a turn.
 */
export const MONOTONE_RTOL = 1e-9;

/** A scan needs both ends. */
const MIN_SCAN_POINTS = 2;
/** Constants of Brent's zeroin step (Brent 1973; Numerical Recipes `zbrent`). */
const BRENT_TWO = 2;
const BRENT_HALF = 0.5;
const BRENT_THREE = 3;

export interface SeekOptions {
  /** Scan points; at least 2. Default 11. */
  readonly scanPoints?: number;
  /** Absolute x tolerance of Brent; default `(hi − lo) × 1e-10`. */
  readonly xtol?: number;
  readonly maxIterations?: number;
}

/**
 * - `solved`: monotone on the scan and the target lies between the end outputs: `value` solves it.
 * - `out_of_range`: monotone but the target lies outside the outputs over `[lo, hi]`.
 * - `non_monotone`: the scan turns (or a point does not evaluate): not solved, as the spec asks.
 */
export type SeekReason = 'solved' | 'out_of_range' | 'non_monotone';

export interface SeekResult {
  /** The solution, or the scan point whose output is closest to the target when not reachable. */
  readonly value: number;
  /** Output at `value`. */
  readonly output: number;
  readonly reachable: boolean;
  readonly reason: SeekReason;
  /** Function evaluations used. */
  readonly evaluations: number;
}

/** A search: yields points to evaluate, receives their outputs in the same order. */
export type Seeker = Generator<readonly number[], SeekResult, readonly number[]>;

/** Evenly spaced points from `lo` to `hi`, both included. */
export function scanGrid(lo: number, hi: number, n: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(i === n - 1 ? hi : lo + ((hi - lo) * i) / (n - 1));
  return xs;
}

/** True when `ys` never rises or never falls (steps within `tol` count as flat). */
export function isMonotone(ys: readonly number[], tol: number): boolean {
  let up = false;
  let down = false;
  for (let i = 1; i < ys.length; i++) {
    const d = ys[i]! - ys[i - 1]!;
    if (d > tol) up = true;
    else if (d < -tol) down = true;
  }
  return !(up && down);
}

/**
 * Solves `f(x) = target` for `x ∈ [lo, hi]`: an `n`-point scan (one request), then, if the scan is
 * monotone and brackets the target, Brent's method on the bracketing scan interval (one point per
 * request). A non-monotone scan or a target outside the scanned outputs ends `unreachable` with the
 * scan point closest to the target.
 */
export function* seek(lo: number, hi: number, target: number, options: SeekOptions = {}): Seeker {
  const n = Math.max(MIN_SCAN_POINTS, Math.floor(options.scanPoints ?? SCAN_POINTS));
  const xs = lo === hi ? [lo] : scanGrid(lo, hi, n);
  const ys = yield xs;
  const hs = xs.map((_, i) => ys[i]! - target);
  let evaluations = xs.length;

  // Closest scan point (first on a tie).
  let best = -1;
  for (let i = 0; i < hs.length; i++) {
    if (Number.isFinite(hs[i]) && (best < 0 || Math.abs(hs[i]!) < Math.abs(hs[best]!))) best = i;
  }
  const closest = (reason: SeekReason): SeekResult =>
    best < 0
      ? { value: lo, output: Number.NaN, reachable: false, reason, evaluations }
      : { value: xs[best]!, output: ys[best]!, reachable: false, reason, evaluations };

  if (best < 0 || hs.some((h) => !Number.isFinite(h))) return closest('non_monotone');
  const scale = Math.max(...ys.map(Math.abs));
  if (!isMonotone(ys, MONOTONE_RTOL * scale)) return closest('non_monotone');

  const exact = hs.indexOf(0);
  if (exact >= 0) return { value: xs[exact]!, output: ys[exact]!, reachable: true, reason: 'solved', evaluations };
  let k = -1;
  for (let i = 0; i + 1 < hs.length; i++) {
    if (Math.sign(hs[i]!) !== Math.sign(hs[i + 1]!)) {
      k = i;
      break;
    }
  }
  if (k < 0) return closest('out_of_range');

  const xtol = options.xtol ?? (hi - lo) * DEFAULT_XTOL_FRACTION;
  const root = yield* brent(xs[k]!, hs[k]!, xs[k + 1]!, hs[k + 1]!, xtol, options.maxIterations ?? DEFAULT_MAX_ITERATIONS, target);
  evaluations += root.evaluations;
  if (!root.ok) return closest('non_monotone');
  return { value: root.x, output: root.fx + target, reachable: true, reason: 'solved', evaluations };
}

/**
 * Brent's method (zeroin) on `[a, b]` with `fa`, `fb` of opposite signs, for `h(x) = f(x) − target`.
 * Yields one point per request and receives `f` there.
 */
function* brent(
  a: number,
  fa: number,
  b: number,
  fb: number,
  xtol: number,
  maxIterations: number,
  target: number,
): Generator<readonly number[], { x: number; fx: number; evaluations: number; ok: boolean }, readonly number[]> {
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  let evaluations = 0;
  for (let it = 0; it < maxIterations; it++) {
    if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol1 = BRENT_TWO * Number.EPSILON * Math.abs(b) + BRENT_HALF * xtol;
    const xm = BRENT_HALF * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) break;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      // Inverse quadratic interpolation, or the secant step when only two points are distinct.
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = BRENT_TWO * xm * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (BRENT_TWO * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (BRENT_TWO * p < Math.min(BRENT_THREE * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : Math.sign(xm) * tol1;
    const [y] = yield [b];
    evaluations += 1;
    fb = y! - target;
    // The function stopped evaluating inside the bracket: not solved.
    if (!Number.isFinite(fb)) return { x: a, fx: fa, evaluations, ok: false };
  }
  return { x: b, fx: fb, evaluations, ok: true };
}

/** Runs a search on a scalar function (synthetic tests, small callers). */
export function seekScalar(
  f: (x: number) => number,
  lo: number,
  hi: number,
  target: number,
  options?: SeekOptions,
): SeekResult {
  const gen = seek(lo, hi, target, options);
  let step = gen.next([]);
  while (!step.done) step = gen.next(step.value.map(f));
  return step.value;
}
