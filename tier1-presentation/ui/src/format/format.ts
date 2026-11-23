/**
 * Display formatting. The only place in the front end allowed to use toFixed / Intl
 * (enforced by ./eslint-rule). Values arrive from tier 2 in model units:
 * money in $M (float), percentages as decimals (0.208 = 20.8%), FTE as head counts,
 * multiples as plain numbers, EPS in $ per share, cents in cents per gallon.
 */

export const EM_DASH = '—';
export const MINUS = '−';
const TIMES = '×';
const CENT = '¢';

export type Maybe = number | null | undefined;

export interface DigitsOpt {
  /** Fraction digits, overriding the kind's default. */
  digits?: number;
  /** Prefix positive values with "+". Negative values always use the minus sign. */
  signed?: boolean;
}

export interface CentsOpt extends DigitsOpt {
  /** Append "/gal". */
  perGallon?: boolean;
}

export type SignedKind = 'money' | 'pct' | 'fte' | 'mult' | 'eps' | 'cents';

const numberFormats = new Map<number, Intl.NumberFormat>();
/** en-US, grouped, fixed fraction digits, round half away from zero on the decimal value. */
const nf = (digits: number): Intl.NumberFormat => {
  let f = numberFormats.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      useGrouping: true,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      roundingMode: 'halfExpand',
    } as Intl.NumberFormatOptions);
    numberFormats.set(digits, f);
  }
  return f;
};

const isNum = (v: Maybe): v is number => typeof v === 'number' && Number.isFinite(v);

/** Core: sign handling + grouped magnitude, wrapped by prefix/suffix. */
const render = (
  v: Maybe,
  digits: number,
  signed: boolean | undefined,
  prefix: string,
  suffix: string,
): string => {
  if (!isNum(v)) return EM_DASH;
  const body = nf(digits).format(Math.abs(v));
  // A value that rounds to zero shows no sign ("-0.0" never appears).
  const isZero = !/[1-9]/.test(body);
  const sign = isZero ? '' : v < 0 ? MINUS : signed ? '+' : '';
  return `${sign}${prefix}${body}${suffix}`;
};

const money = (v: Maybe, o: DigitsOpt = {}): string =>
  render(v, o.digits ?? 1, o.signed, '$', 'M');

/** Input is a decimal: 0.208 -> "20.8%". */
const pct = (v: Maybe, o: DigitsOpt = {}): string =>
  render(isNum(v) ? v * 100 : v, o.digits ?? 1, o.signed, '', '%');

const fte = (v: Maybe, o: Pick<DigitsOpt, 'signed'> = {}): string =>
  render(v, 0, o.signed, '', '');

const mult = (v: Maybe, o: DigitsOpt = {}): string =>
  render(v, o.digits ?? 2, o.signed, '', TIMES);

const eps = (v: Maybe, o: DigitsOpt = {}): string => render(v, o.digits ?? 3, o.signed, '$', '');

/** Input is already in cents (e.g. br.fuel_equiv_cents). */
const cents = (v: Maybe, o: CentsOpt = {}): string =>
  render(v, o.digits ?? 1, o.signed, '', o.perGallon && isNum(v) ? `${CENT}/gal` : CENT);

const byKind = { money, pct, fte, mult, eps, cents } as const;

/** Explicit sign on positives (+$43.0M); negatives use the minus sign (−$23.7M). Defaults to money. */
const signed = (v: Maybe, kind: SignedKind = 'money'): string => byKind[kind](v, { signed: true });

export const fmt = { money, pct, fte, mult, eps, cents, signed } as const;
