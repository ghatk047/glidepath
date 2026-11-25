import { useEffect, useRef, useState } from 'react';
import { motionMs } from '@glidepath/ui/motion';

/**
 * True for one `motion.flash` after the value tier 2 pushed changed (the "changed numbers glow"
 * of the VPs screen). The first value to arrive does not glow; comparison only, no arithmetic.
 */
export function useGlow(value: unknown): boolean {
  const seen = useRef(value);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (Object.is(seen.current, value)) return;
    const had = seen.current !== undefined && seen.current !== null;
    seen.current = value;
    if (!had) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), motionMs('flash'));
    return () => clearTimeout(t);
  }, [value]);
  return on;
}
