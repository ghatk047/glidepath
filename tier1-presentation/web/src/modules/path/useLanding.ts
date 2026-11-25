import { useEffect, useState } from 'react';
import { motionMs, prefersReducedMotion } from '@glidepath/ui/motion';

/**
 * "Find a path lands moves one by one" (03_screens): how many of `count` rows are on screen for
 * the result `key`. The first row lands at once, then one more every `motion.stagger` (90 ms
 * token). A new key starts again from one; reduced motion shows every row at once. Display only:
 * the rows and their order are tier 2's.
 */
export function useLanding(key: string | null, count: number): number {
  const [state, setState] = useState<{ key: string | null; shown: number }>({ key, shown: 0 });

  useEffect(() => {
    if (key === null) return;
    if (count === 0 || prefersReducedMotion()) {
      setState({ key, shown: count });
      return;
    }
    let shown = 1;
    setState({ key, shown });
    if (shown >= count) return;
    const timer = setInterval(() => {
      shown += 1;
      setState({ key, shown });
      if (shown >= count) clearInterval(timer);
    }, motionMs('stagger'));
    return () => clearInterval(timer);
  }, [key, count]);

  if (state.key !== key) return 0;
  return state.shown > count ? count : state.shown;
}
