/* eslint-disable no-magic-numbers -- numerical-method coefficients (Lanczos, Acklam, Marsaglia, tolerances), not business numbers */
/**
 * Numerics for Monte Carlo: the normal CDF and its inverse, the regularised incomplete beta and its
 * inverse, numpy-style percentiles, ranks, Spearman correlation and histograms. Pure.
 */

const LN_SQRT_2PI = 0.9189385332046727; // ln √(2π)
const SQRT_2PI = 2.5066282746310002;

// ---------------------------------------------------------------------------------------------------
// Normal
// ---------------------------------------------------------------------------------------------------

/** Beyond this |z| the normal CDF is 0 or 1 in float64. */
const PHI_CUTOFF = 38;

/** Standard normal CDF Φ(z) (Marsaglia 2004 Taylor series; absolute error ~1e-15). */
export function normCdf(z: number): number {
  if (Number.isNaN(z)) return Number.NaN;
  if (z <= -PHI_CUTOFF) return 0;
  if (z >= PHI_CUTOFF) return 1;
  const q = z * z;
  let s = z;
  let t = 0;
  let b = z;
  let i = 1;
  while (s !== t) {
    t = s;
    i += 2;
    b *= q / i;
    s = t + b;
  }
  const p = 0.5 + s * Math.exp(-0.5 * q - LN_SQRT_2PI);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

const A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
const B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
const C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
const P_LOW = 0.02425;

/** Inverse standard normal CDF Φ⁻¹(p), p in (0, 1) (Acklam, one Halley refinement step). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let x: number;
  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((C[0]! * q + C[1]!) * q + C[2]!) * q + C[3]!) * q + C[4]!) * q + C[5]!) / ((((D[0]! * q + D[1]!) * q + D[2]!) * q + D[3]!) * q + 1);
  } else if (p <= 1 - P_LOW) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((A[0]! * r + A[1]!) * r + A[2]!) * r + A[3]!) * r + A[4]!) * r + A[5]!) * q) /
      (((((B[0]! * r + B[1]!) * r + B[2]!) * r + B[3]!) * r + B[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((C[0]! * q + C[1]!) * q + C[2]!) * q + C[3]!) * q + C[4]!) * q + C[5]!) / ((((D[0]! * q + D[1]!) * q + D[2]!) * q + D[3]!) * q + 1);
  }
  const e = normCdf(x) - p;
  const u = e * SQRT_2PI * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

// ---------------------------------------------------------------------------------------------------
// Beta
// ---------------------------------------------------------------------------------------------------

const LANCZOS_G = 7;
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x), x > 0 (Lanczos, g = 7). */
export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const y = x - 1;
  let a = LANCZOS[0]!;
  const t = y + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i]! / (y + i);
  return LN_SQRT_2PI + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

const CF_MAX_ITER = 400;
const CF_EPS = 1e-15;
const FP_MIN = 1e-300;

/** Continued fraction of the incomplete beta (Lentz; Numerical Recipes `betacf`). */
function betaCf(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FP_MIN) d = FP_MIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= CF_MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FP_MIN) d = FP_MIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FP_MIN) c = FP_MIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FP_MIN) d = FP_MIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FP_MIN) c = FP_MIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < CF_EPS) break;
  }
  return h;
}

/** ln B(a, b). */
export const lnBeta = (a: number, b: number): number => lnGamma(a) + lnGamma(b) - lnGamma(a + b);

/** Regularised incomplete beta I_x(a, b), a, b > 0. */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(a * Math.log(x) + b * Math.log1p(-x) - lnBeta(a, b));
  return x < (a + 1) / (a + b + 2) ? (front * betaCf(a, b, x)) / a : 1 - (front * betaCf(b, a, 1 - x)) / b;
}

const INV_MAX_ITER = 200;
const INV_TOL = 1e-13;

/**
 * Inverse of I_x(a, b): Newton steps on the CDF, kept inside a shrinking bisection bracket. a or b ≤ 0
 * is the degenerate limit (all mass at 0 or 1).
 */
export function betaInv(p: number, a: number, b: number): number {
  if (!(a > 0)) return 0;
  if (!(b > 0)) return 1;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const lnB = lnBeta(a, b);
  let lo = 0;
  let hi = 1;
  let x = a / (a + b);
  for (let i = 0; i < INV_MAX_ITER; i++) {
    const f = betaCdf(x, a, b) - p;
    if (f === 0) return x;
    if (f < 0) lo = x;
    else hi = x;
    const pdf = Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - lnB);
    let next = x - f / pdf;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - x) <= INV_TOL * x || hi - lo <= INV_TOL * hi) return next;
    x = next;
  }
  return x;
}

// ---------------------------------------------------------------------------------------------------
// Sample statistics
// ---------------------------------------------------------------------------------------------------

/** Percentile `q` (0..100) of `sorted` (ascending), numpy's default linear interpolation. */
export function percentile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const h = ((n - 1) * q) / 100;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Ranks 1..n of `x`, ties get their average rank. */
export function ranks(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((i, j) => x[i]! - x[j]!);
  const r = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && x[idx[j + 1]!] === x[idx[i]!]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]!] = avg;
    i = j + 1;
  }
  return r;
}

/** Pearson correlation; 0 when either side has no variance. */
export function pearson(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = x.length;
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i]!;
    my += y[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** Spearman rank correlation (Pearson on average ranks). */
export const spearman = (x: ArrayLike<number>, y: ArrayLike<number>): number => pearson(ranks(x), ranks(y));

/** Equal-width bins over [min, max] of `sorted`; the last bin includes its upper edge. */
export function histogram(sorted: ArrayLike<number>, bins: number): { lo: number; hi: number; count: number }[] {
  const n = sorted.length;
  if (n === 0) return [];
  const min = sorted[0]!;
  const max = sorted[n - 1]!;
  if (max === min) return [{ lo: min, hi: max, count: n }];
  const width = (max - min) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < n; i++) {
    const k = Math.min(bins - 1, Math.floor((sorted[i]! - min) / width));
    counts[k]! += 1;
  }
  return counts.map((count, k) => ({ lo: min + k * width, hi: k === bins - 1 ? max : min + (k + 1) * width, count }));
}
