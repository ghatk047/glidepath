import { describe, expect, it } from 'vitest';
import { fmt } from './index';

const DASH = '—';
const MINUS = '−';

describe('fmt acceptance: values (test table)', () => {
  const table: Array<[string, () => string, string]> = [
    // $M, one decimal, thousands separators
    ['money hero', () => fmt.money(119.3), '$119.3M'],
    ['money thousands', () => fmt.money(1007.6), '$1,007.6M'],
    ['money rounds to one decimal', () => fmt.money(931.2649), '$931.3M'],
    ['money zero', () => fmt.money(0), '$0.0M'],
    ['money negative uses minus sign', () => fmt.money(-23.7), `${MINUS}$23.7M`],
    ['money negative thousands', () => fmt.money(-1234.56), `${MINUS}$1,234.6M`],
    ['money digits option', () => fmt.money(1007.6, { digits: 0 }), '$1,008M'],
    ['money negative rounding to zero has no sign', () => fmt.money(-0.04), '$0.0M'],
    // signed
    ['signed gap (negative)', () => fmt.signed(-23.7), `${MINUS}$23.7M`],
    ['signed growth (positive)', () => fmt.signed(43), '+$43.0M'],
    ['signed savings', () => fmt.signed(-138.8), `${MINUS}$138.8M`],
    ['signed zero has no sign', () => fmt.signed(0), '$0.0M'],
    ['signed pct', () => fmt.signed(0.196, 'pct'), '+19.6%'],
    ['signed eps', () => fmt.signed(0.091, 'eps'), '+$0.091'],
    ['signed fte', () => fmt.signed(-120, 'fte'), `${MINUS}120`],
    ['signed mult', () => fmt.signed(0.5, 'mult'), '+0.50×'],
    ['signed cents', () => fmt.signed(1.74, 'cents'), '+1.7¢'],
    ['signed via money opts', () => fmt.money(43, { signed: true }), '+$43.0M'],
    // percent from decimals
    ['pct from decimal', () => fmt.pct(0.208), '20.8%'],
    ['pct negative', () => fmt.pct(-0.0125), `${MINUS}1.3%`],
    ['pct digits', () => fmt.pct(0.5, { digits: 0 }), '50%'],
    ['pct zero', () => fmt.pct(0), '0.0%'],
    ['pct above 100', () => fmt.pct(12.345), '1,234.5%'],
    // percent scale (WEB-10): the bundle's `percentScale` says how the value is stored
    ['pct fraction scale is the default', () => fmt.pct(0.1, { scale: 'fraction' }), '10.0%'],
    ['pct points: corp.gdp 2 reads 2.0%', () => fmt.pct(2, { scale: 'points' }), '2.0%'],
    ['pct points: corp.lf 84.2', () => fmt.pct(84.2, { scale: 'points' }), '84.2%'],
    ['pct points negative', () => fmt.pct(-1.5, { scale: 'points' }), `${MINUS}1.5%`],
    ['pct points signed', () => fmt.pct(1.588, { scale: 'points', signed: true }), '+1.6%'],
    ['pct points digits', () => fmt.pct(2.05, { scale: 'points', digits: 2 }), '2.05%'],
    ['pct null scale is a fraction', () => fmt.pct(0.1, { scale: null }), '10.0%'],
    // FTE integers
    ['fte integer', () => fmt.fte(2692), '2,692'],
    ['fte rounds', () => fmt.fte(2691.6), '2,692'],
    ['fte negative', () => fmt.fte(-1500), `${MINUS}1,500`],
    // multiples
    ['mult two decimals', () => fmt.mult(7.39), '7.39×'],
    ['mult pads', () => fmt.mult(8), '8.00×'],
    // EPS
    ['eps three decimals', () => fmt.eps(0.091), '$0.091'],
    ['eps base', () => fmt.eps(0.465), '$0.465'],
    ['eps negative', () => fmt.eps(-0.75, { digits: 2 }), `${MINUS}$0.75`],
    // cents per gallon
    ['cents one decimal', () => fmt.cents(1.74), '1.7¢'],
    ['cents per gallon', () => fmt.cents(1.74, { perGallon: true }), '1.7¢/gal'],
  ];
  it.each(table)('%s', (_name, run, expected) => {
    expect(run()).toBe(expected);
  });

  it('null, undefined and non-finite values render as an em dash', () => {
    const kinds = ['money', 'pct', 'fte', 'mult', 'eps', 'cents', 'signed'] as const;
    for (const k of kinds) {
      expect(fmt[k](null)).toBe(DASH);
      expect(fmt[k](undefined)).toBe(DASH);
      expect(fmt[k](Number.NaN)).toBe(DASH);
      expect(fmt[k](Number.POSITIVE_INFINITY)).toBe(DASH);
    }
    expect(fmt.signed(null, 'pct')).toBe(DASH);
  });

  it('rounds half away from zero on decimal values (no binary drift)', () => {
    expect(fmt.money(1.005, { digits: 2 })).toBe('$1.01M');
    expect(fmt.money(0.25)).toBe('$0.3M');
    expect(fmt.money(-0.25)).toBe(`${MINUS}$0.3M`);
  });
});
