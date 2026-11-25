/**
 * Python float rounding and the two parity tolerances (tier2-logic/engine/PORTING.md S29, §6).
 * `golden_results.json` and `parity_report.json` hold `round(v, 6)` of engine.py's values, so the TS
 * value is rounded the same way before it is compared.
 */

/** Digits `toFixed` may print: enough for the exact expansion of any double that rounds above 0. */
const EXACT_DIGITS = 100;

/** Decimals in the reference files. */
export const REFERENCE_DECIMALS = 6;

/**
 * Python `round(x, nd)` for a float: the exact binary value rounded to `nd` decimals, ties to even,
 * read back with correct rounding (CPython `float.__round__`).
 */
export function pyRound(x: number, nd: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const exact = Math.abs(x).toFixed(EXACT_DIGITS); // exact decimal expansion for |x| < 1e21
  if (exact.includes('e')) return x; // |x| >= 1e21: an integer already
  const [int, frac] = exact.split('.') as [string, string];
  const kept = int + frac.slice(0, nd);
  const rest = frac.slice(nd);
  const exactHalf = rest[0] === '5' && !/[1-9]/.test(rest.slice(1));
  const up = exactHalf ? Number(kept[kept.length - 1]) % 2 === 1 : rest[0]! >= '5';
  const digits = (BigInt(kept) + (up ? 1n : 0n)).toString().padStart(nd + 1, '0');
  const sign = x < 0 ? '-' : '';
  return Number(
    `${sign}${digits.slice(0, digits.length - nd)}.${digits.slice(digits.length - nd)}`,
  );
}

/** Golden tolerance: 1e-6 relative / 1e-9 absolute. */
export const GOLDEN_REL = 1e-6;
export const GOLDEN_ABS = 1e-9;
/** Replay tolerance: 1e-6 absolute. */
export const REPLAY_ABS = 1e-6;

/** `|rounded - golden| <= max(1e-6 |golden|, 1e-9)`. */
export function goldenClose(rounded: number, golden: number): boolean {
  return Math.abs(rounded - golden) <= Math.max(GOLDEN_REL * Math.abs(golden), GOLDEN_ABS);
}

/** `|rounded - engine| <= 1e-6`. */
export function replayClose(rounded: number, engine: number): boolean {
  return Math.abs(rounded - engine) <= REPLAY_ABS;
}
