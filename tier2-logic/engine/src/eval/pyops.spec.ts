import { describe, expect, it } from 'vitest';
import { EngineError } from '../errors';
import { pyDiv, pyMax, pyMin, pyPow, pySum, pyTruthy } from './pyops';

const bits = (x: number) => {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, x);
  return b.getBigUint64(0);
};
/** Bitwise equality (distinguishes -0 from 0; NaN equals NaN). */
const same = (a: number, b: number) => Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b));

// Expected values: CPython 3.13 `sum`, `min`, `max`, `**` on the same inputs, copied verbatim.
describe('Python float operations (pyops.spec.ts)', () => {
  it('pySum adds in member order with Neumaier compensation, bitwise equal to CPython sum()', () => {
    const cases: [number[], number][] = [
      [Array<number>(10).fill(0.1), 1.0],
      [[1e100, 1.0, -1e100], 1.0],
      [[-0], 0],
      [[-0, -0], 0],
      [[], 0],
      [[Infinity, -Infinity], NaN],
      [[1e308, 1e308], Infinity],
      [[1e308, 1e308, -1e308], Infinity],
      [[0.1, 0.2, 0.3], 0.6],
      [[3.0, 1e16, -1e16], 3.0],
      [[NaN, 1.0], NaN],
      [[1.0, -Infinity], -Infinity],
    ];
    for (const [xs, want] of cases) expect(same(pySum(xs), want), JSON.stringify(xs)).toBe(true);

    // random.seed(7); 50 values over 18 orders of magnitude. Naive left-to-right gives ...096.0.
    // As strings: Python repr() digits, parsed by Number() to the same doubles.
    const xs = [
      '-352334.4703336753',
      '-210353.00715365296',
      '-855127426664914.5',
      '-811739916120634.9',
      '-884002150450586.4',
      '-570603.6383286766',
      '-132708.6326752283',
      '-518673999745950.0',
      '-150961621714972.06',
      '-752396.0777007088',
      '261251831463474.1',
      '895417884914011.2',
      '171082.84528077347',
      '952510.2111858402',
      '113329.79587418516',
      '-420781.4273366475',
      '81371771064284.95',
      '-383036351796131.25',
      '-638547240152125.0',
      '142408.7828235845',
      '-255204914548537.56',
      '424221531492307.3',
      '-880797.6600675347',
      '-7171009773016.441',
      '-0.00014481538866119425',
      '-6.879626832065196e-5',
      '-276835.2881108674',
      '588758963044982.4',
      '559659.2611684874',
      '148847420517341.94',
      '-9.767280889488874e-6',
      '0.00045889057887843536',
      '217918.03807280725',
      '-0.0007638684434900758',
      '-0.0006700757927128536',
      '-0.0006960309306789905',
      '-156603291046511.38',
      '-844759035638409.0',
      '0.00014605188055476803',
      '-0.00031975527561760894',
      '188739754210036.94',
      '593783.9516431887',
      '0.0006799355610250828',
      '-51803325160711.07',
      '-870000048567810.4',
      '402984042608847.8',
      '155892461435436.28',
      '0.0006438495732194298',
      '433255588796607.2',
      '-0.00030598948862309874',
    ].map(Number);
    expect(bits(pySum(xs))).toBe(bits(-2846889082679097.0));
    expect(xs.reduce((a, b) => a + b, 0)).toBe(-2846889082679096.0);
    expect(pySum(new Float64Array([0.1, 0.2, 0.3]))).toBe(0.6);
  });

  it('pyTruthy treats NaN as true and only ±0 as false', () => {
    expect(pyTruthy(NaN)).toBe(true);
    expect(pyTruthy(0)).toBe(false);
    expect(pyTruthy(-0)).toBe(false);
    expect(pyTruthy(1e-300)).toBe(true);
    expect(pyTruthy(-Infinity)).toBe(true);
  });

  it('pyMin and pyMax keep the first of equal values and match Python on NaN', () => {
    expect(Object.is(pyMin([0, -0]), 0)).toBe(true); // min(0, -0.0) = 0
    expect(Object.is(pyMin([-0, 0]), -0)).toBe(true); // min(-0.0, 0) = -0.0
    expect(Object.is(pyMax([0, -0]), 0)).toBe(true);
    expect(pyMax([NaN, 1])).toBeNaN(); // max(nan, 1) = nan: a leading NaN sticks
    expect(pyMax([1, NaN])).toBe(1); // max(1, nan) = 1: a later NaN is skipped
    expect(pyMin([NaN, 1])).toBeNaN();
    expect(pyMin([1, NaN, 0])).toBe(0);
    expect(pyMin([3, 1, 2])).toBe(1);
    expect(pyMax([3, 1, 4, 4])).toBe(4);
    expect(Math.min(1, NaN, 0)).toBeNaN(); // why not Math.min
  });

  it('pyPow follows Python float pow', () => {
    const cases: [number, number, number][] = [
      [2, 0.5, 1.4142135623730951],
      [2, 10, 1024],
      [-8, 3, -512],
      [-8, 2, 64],
      [-1, Infinity, 1],
      [1, NaN, 1],
      [NaN, 0, 1],
      [NaN, 2, NaN],
      [3, NaN, NaN],
      [0, 3, 0],
      [-0, 3, -0],
      [-0, 2, 0],
      [Infinity, -3, 0],
      [-Infinity, -3, -0],
      [-Infinity, 3, -Infinity],
      [-Infinity, 2, Infinity],
      [0.5, Infinity, 0],
      [2, -Infinity, 0],
      [2, Infinity, Infinity],
      [1e-300, 2, 0],
      [10, -400, 0],
      [-1, 1e300, 1],
      [-1, 3, -1],
    ];
    for (const [a, b, want] of cases) expect(same(pyPow(a, b), want), `${a} ** ${b}`).toBe(true);

    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as EngineError).code;
      }
      return undefined;
    };
    expect(code(() => pyPow(0, -1))).toBe('DIV_ZERO'); // ZeroDivisionError
    expect(code(() => pyPow(-0, -2))).toBe('DIV_ZERO');
    expect(code(() => pyPow(10, 400))).toBe('OVERFLOW'); // OverflowError
    expect(code(() => pyPow(-10, 401))).toBe('OVERFLOW');
    expect(code(() => pyPow(-8, 1 / 3))).toBe('COMPLEX'); // Python returns a complex number (D5)
  });

  it('pyDiv raises on ±0 and divides NaN and infinite divisors', () => {
    expect(() => pyDiv(1, 0)).toThrow(EngineError);
    expect(() => pyDiv(0, -0)).toThrow(/division by zero/);
    expect(pyDiv(1, NaN)).toBeNaN();
    expect(pyDiv(1, Infinity)).toBe(0);
    expect(pyDiv(1e308, 1e-10)).toBe(Infinity); // Python: inf, no OverflowError
  });
});
