/**
 * Python float semantics the evaluator needs (PORTING.md S06, S13, S16, S18, S24). Every mode (static
 * where-filters, scalar evaluate, rerun, batch) uses these, never the JS builtins they replace.
 */
import { EngineError } from '../errors';

/** `fmod(fabs(x), 2.0) == 1.0` (CPython `DOUBLE_IS_ODD_INTEGER`). */
const PARITY = 2;
const isOddInteger = (x: number): boolean => Math.abs(x) % PARITY === 1;

/** Python `bool(x)` of a float: true iff `x != 0`, so NaN is true and only ±0 is false (S16). */
export function pyTruthy(x: number): boolean {
  return x !== 0;
}

/**
 * Python `min(xs)`: the first element, replaced only by a strictly smaller one (S18). Ties keep the
 * first (`min(0, -0)` = 0); a leading NaN sticks; a later NaN is skipped. `xs` must not be empty.
 */
export function pyMin(xs: ArrayLike<number>): number {
  let r = xs[0]!;
  for (let i = 1; i < xs.length; i++) if (xs[i]! < r) r = xs[i]!;
  return r;
}

/** Python `max(xs)`: like `pyMin` with `>` (S18). `xs` must not be empty. */
export function pyMax(xs: ArrayLike<number>): number {
  let r = xs[0]!;
  for (let i = 1; i < xs.length; i++) if (xs[i]! > r) r = xs[i]!;
  return r;
}

/**
 * Python `float(sum(xs))` for floats: CPython >= 3.12 adds with Neumaier compensation (S06). The start
 * value is the int 0, so the first term goes through `0 + x0` (−0 becomes 0). Empty → 0.
 */
export function pySum(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n === 0) return 0;
  let f = 0 + xs[0]!;
  let c = 0;
  for (let i = 1; i < n; i++) {
    const x = xs[i]!;
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += f - t + x;
    else c += x - t + f;
    f = t;
  }
  if (c !== 0 && Number.isFinite(c)) f += c;
  return f;
}

/** Thrown by `pyPow`/`pyDiv` without a cell; the evaluator adds the cell being computed. */
function powError(code: 'DIV_ZERO' | 'OVERFLOW' | 'COMPLEX', message: string): EngineError {
  return new EngineError(code, message);
}

/**
 * Python `a / b` for floats: '/' by ±0 raises ZeroDivisionError (DIV_ZERO), never ±Infinity (S04).
 * NaN or infinite divisors divide normally; an overflowing quotient is ±Infinity (Python does not raise).
 */
export function pyDiv(a: number, b: number): number {
  if (b === 0) throw new EngineError('DIV_ZERO', 'division by zero');
  return a / b;
}

/**
 * Python `a ** b` for floats (CPython `float_pow`, S24): `0 ** negative` raises (DIV_ZERO), a negative
 * base with a non-integer exponent is complex in Python (COMPLEX, D5), a finite result that overflows
 * raises (OVERFLOW). `x ** 0` = 1 and `1 ** y` = 1 even for NaN; `(-1) ** ±inf` = 1.
 */
export function pyPow(v: number, w: number): number {
  if (w === 0) return 1;
  if (Number.isNaN(v)) return v;
  if (Number.isNaN(w)) return v === 1 ? 1 : w;
  if (!Number.isFinite(w)) {
    const a = Math.abs(v);
    if (a === 1) return 1;
    return w > 0 === a > 1 ? Infinity : 0;
  }
  if (!Number.isFinite(v)) {
    const odd = isOddInteger(w);
    if (w > 0) return odd ? v : Math.abs(v);
    return odd ? (v > 0 ? 0 : -0) : 0;
  }
  if (v === 0) {
    if (w < 0) throw powError('DIV_ZERO', '0.0 cannot be raised to a negative power');
    return isOddInteger(w) ? v : 0;
  }
  let negate = false;
  if (v < 0) {
    if (w !== Math.floor(w)) {
      throw powError('COMPLEX', `negative number ${v} raised to a fractional power ${w}`);
    }
    v = -v;
    negate = isOddInteger(w);
  }
  if (v === 1) return negate ? -1 : 1;
  let x = Math.pow(v, w);
  if (x === Infinity) throw powError('OVERFLOW', 'Numerical result out of range');
  if (negate) x = -x;
  return x;
}
