import { describe, expect, it } from 'vitest';
import { goldenClose, pyRound, replayClose } from './round';

describe('Python rounding and tolerances', () => {
  it('pyRound(x, 6) equals CPython round(x, 6)', () => {
    // [x, round(x, 6)] printed by CPython 3.12 (repr of both).
    const cases: [number, number][] = [
      [0.0078125, 0.007812], // exact tie: to even
      [0.0234375, 0.023438], // exact tie: to even
      [-0.0078125, -0.007812],
      [2.5e-7, 0],
      [1.0000005, 1.000001], // the double is just above the tie
      [0.4999995, 0.499999], // the double is just below the tie
      [119.28685250000001, 119.286853],
      [0.1 + 0.2, 0.3],
      [123456.0000005, 123456.000001],
      [1e21, 1e21],
      [5e-324, 0],
      [0.002675, 0.002675],
      [2.675, 2.675],
    ];
    for (const [x, py] of cases) expect(pyRound(x, 6), String(x)).toBe(py);
    expect(Object.is(pyRound(-1e-7, 6), -0)).toBe(true);
    expect(pyRound(NaN, 6)).toBeNaN();
    expect(pyRound(-Infinity, 6)).toBe(-Infinity);
  });

  it('golden is 1e-6 relative / 1e-9 absolute; replay is 1e-6 absolute', () => {
    expect(goldenClose(1000.001, 1000)).toBe(true);
    expect(goldenClose(1000.0011, 1000)).toBe(false);
    expect(goldenClose(1e-9, 0)).toBe(true);
    expect(goldenClose(2e-9, 0)).toBe(false);
    expect(replayClose(1000.000001, 1000)).toBe(true);
    expect(replayClose(1000.000002, 1000)).toBe(false);
  });
});
