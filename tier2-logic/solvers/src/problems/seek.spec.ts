/**
 * SOL-02 acceptance 1: goal seek is an 11-point monotonicity scan then Brent; a non-monotone or
 * out-of-range scan ends `unreachable` with the closest value (synthetic functions).
 */
import { describe, expect, it } from 'vitest';
import { isMonotone, scanGrid, SCAN_POINTS, seek, seekScalar } from './seek';

/** Wraps `f`, recording every point it is asked for. */
function recorded(f: (x: number) => number): { f: (x: number) => number; xs: number[] } {
  const xs: number[] = [];
  return { xs, f: (x) => (xs.push(x), f(x)) };
}

describe('SOL-02 goal seek: 11-point monotonicity scan then Brent; non-monotone or out-of-range → unreachable with the closest value', () => {
  it('scans 11 evenly spaced points first (lo and hi included), then refines with Brent', () => {
    const { f, xs } = recorded((x) => x ** 3 + x);
    const r = seekScalar(f, -2, 3, 4);
    expect(SCAN_POINTS).toBe(11);
    expect(xs.slice(0, 11)).toEqual(scanGrid(-2, 3, 11));
    expect(xs[0]).toBe(-2);
    expect(xs[10]).toBe(3);
    expect(r).toMatchObject({ reachable: true, reason: 'solved' });
    expect(r.value ** 3 + r.value).toBeCloseTo(4, 9);
    expect(r.evaluations).toBe(xs.length);
    // Brent converges in a handful of steps on a smooth bracket.
    expect(xs.length - 11).toBeLessThan(15);
  });

  it('solves increasing, decreasing and transcendental functions to 1e-9', () => {
    expect(seekScalar((x) => 2 * x + 1, 0, 10, 7).value).toBeCloseTo(3, 9);
    expect(seekScalar((x) => 5 - 0.5 * x, 0, 10, 2).value).toBeCloseTo(6, 9);
    expect(seekScalar(Math.exp, 0, 5, 20).value).toBeCloseTo(Math.log(20), 9);
    expect(seekScalar((x) => Math.atan(x - 0.3), -1, 1, 0).value).toBeCloseTo(0.3, 9);
  });

  it('accepts flat stretches and kinks (monotone, not strictly): MAX(0, x − 3)', () => {
    const r = seekScalar((x) => Math.max(0, x - 3), 0, 10, 2);
    expect(r).toMatchObject({ reachable: true, reason: 'solved' });
    expect(r.value).toBeCloseTo(5, 9);
  });

  it('returns a scan point that hits the target exactly without refining', () => {
    const { f, xs } = recorded((x) => 3 * x);
    expect(seekScalar(f, 0, 10, 12)).toMatchObject({ value: 4, output: 12, reachable: true, evaluations: 11 });
    expect(xs).toHaveLength(11);
  });

  it('non-monotone → unreachable with the closest scan value, even when a root exists', () => {
    const { f, xs } = recorded((x) => (x - 5) ** 2);
    const r = seekScalar(f, 0, 10, 4.5);
    expect(r).toMatchObject({ reachable: false, reason: 'non_monotone' });
    // Closest scan points to 4.5 are x = 3 and x = 7 (output 4); the first is kept.
    expect(r.value).toBe(3);
    expect(r.output).toBe(4);
    expect(xs).toHaveLength(11);
  });

  it('out of range (monotone) → unreachable with the nearer end', () => {
    expect(seekScalar((x) => x, 0, 1, 5)).toMatchObject({ value: 1, output: 1, reachable: false, reason: 'out_of_range' });
    expect(seekScalar((x) => x, 0, 1, -2)).toMatchObject({ value: 0, output: 0, reachable: false, reason: 'out_of_range' });
    expect(seekScalar((x) => -x, 0, 1, 5)).toMatchObject({ value: 0, output: -0, reachable: false });
  });

  it('a point that does not evaluate makes the scan non-monotone', () => {
    const r = seekScalar((x) => (x > 0.45 && x < 0.55 ? Number.NaN : x), 0, 1, 0.3);
    expect(r).toMatchObject({ reachable: false, reason: 'non_monotone', value: 0.3 });
    const none = seekScalar(() => Number.NaN, 0, 1, 0.3);
    expect(none).toMatchObject({ reachable: false, value: 0 });
    expect(none.output).toBeNaN();
  });

  it('a bracket that stops evaluating inside (between scan points) → unreachable', () => {
    // Finite on the scan grid only.
    const onGrid = (x: number) => (Math.abs(x * 10 - Math.round(x * 10)) < 1e-9 ? x : Number.NaN);
    expect(seekScalar(onGrid, 0, 1, 0.55)).toMatchObject({ reachable: false, reason: 'non_monotone' });
  });

  it('a degenerate range evaluates once', () => {
    expect(seekScalar((x) => x, 2, 2, 2)).toMatchObject({ value: 2, reachable: true, evaluations: 1 });
    expect(seekScalar((x) => x, 2, 2, 3)).toMatchObject({ value: 2, reachable: false, reason: 'out_of_range' });
  });

  it('honours scanPoints, xtol and maxIterations', () => {
    const { f, xs } = recorded((x) => x * x);
    const r = seekScalar(f, 0, 4, 2, { scanPoints: 3, xtol: 1e-3, maxIterations: 50 });
    expect(xs.slice(0, 3)).toEqual([0, 2, 4]);
    expect(Math.abs(r.value - Math.SQRT2)).toBeLessThan(1e-3);
    const capped = seekScalar((x) => x * x * x, 0, 4, 2, { maxIterations: 1 });
    expect(capped.reachable).toBe(true);
  });

  it('is a generator: yields the scan as one request, then one point per Brent step', () => {
    const gen = seek(0, 10, 3.3);
    const first = gen.next([]);
    expect(first.done).toBe(false);
    expect(first.value).toHaveLength(11);
    const second = gen.next((first.value as number[]).map((x) => x));
    expect(second.done).toBe(false);
    expect(second.value).toHaveLength(1);
  });

  it('isMonotone ignores steps within the tolerance', () => {
    expect(isMonotone([1, 2, 2, 3], 0)).toBe(true);
    expect(isMonotone([3, 2, 2, 1], 0)).toBe(true);
    expect(isMonotone([1, 2, 1.9999, 3], 1e-3)).toBe(true);
    expect(isMonotone([1, 2, 1.5, 3], 1e-3)).toBe(false);
  });
});
