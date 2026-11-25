import { fmt } from '../../format';

/**
 * A bare number for chart labels ("63", "39.1"): the prototype prints P labels and swings without
 * the $ and M that `fmt.money` adds, because the panel header already says "$M". It goes through
 * `fmt.money` so rounding, grouping and the minus sign stay in the format module.
 */
export function plain(v: number | null | undefined, digits: number): string {
  return fmt.money(v, { digits }).replace(/^(−?)\$(.*)M$/, '$1$2');
}

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
