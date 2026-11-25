import { tokenValue } from '../tokens';

export type DurationToken = 'value' | 'roll' | 'flash' | 'stagger' | 'toast';

/** Milliseconds for a motion duration token ("520ms" -> 520). */
export function motionMs(name: DurationToken): number {
  const raw = tokenValue[`motion.${name}`];
  const n = /^(\d+(?:\.\d+)?)ms$/.exec(raw)?.[1];
  if (n === undefined) throw new Error(`motion.${name} is not a ms duration: ${raw}`);
  return Number(n);
}
