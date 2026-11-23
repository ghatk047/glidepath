import { useLayoutEffect, useRef, useState } from 'react';
import { NumberRoll } from '../../motion';
import { isNum, type Maybe } from './geometry';

/**
 * The value to draw right now while a pushed value tweens from old to new. Reuses the motion
 * module's NumberRoll (token `motion.roll`, `motion.ease`, retarget mid-roll, reduced motion jumps)
 * so the arc lands with the number roll in the gauge centre. It interpolates the display only.
 */
export function useTween(target: Maybe): number | null {
  const [shown, setShown] = useState<number | null>(isNum(target) ? target : null);
  const roll = useRef<NumberRoll | null>(null);
  const first = useRef(target);

  useLayoutEffect(() => {
    const r = new NumberRoll({
      // String(n) round-trips a double exactly, so the roll carries the raw value, not text.
      format: String,
      initial: isNum(first.current) ? first.current : null,
      onFrame: (text) => setShown(Number(text)),
    });
    roll.current = r;
    return () => {
      r.destroy();
      roll.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (isNum(target)) roll.current?.set(target);
    else setShown(null);
  }, [target]);

  return isNum(target) ? shown : null;
}
