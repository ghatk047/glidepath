import { useEffect, useState } from 'react';
import { motionMs } from '@glidepath/ui/motion';
import type { TourRect } from '@glidepath/ui/overlays/tour';

/** How long to wait for an anchor to appear (a module just mounted): two toast durations. */
export const ANCHOR_WAIT_MS = 2 * motionMs('toast');

export interface AnchorState {
  rect: TourRect | null;
  /** The wait ran out and the element never appeared. */
  missing: boolean;
}

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
};

const rectOf = (el: Element): TourRect => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

const same = (a: TourRect | null, b: TourRect | null) =>
  a === b ||
  (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

/**
 * Finds `selector`, tracks its viewport rect (ResizeObserver, scroll, resize; rAF-throttled)
 * and waits for it with a MutationObserver. `null` selector or `enabled: false` = no anchor,
 * not missing. Scrolls the element to the centre once found.
 */
export function useAnchor(selector: string | null, enabled = true): AnchorState {
  const [state, setState] = useState<AnchorState>({ rect: null, missing: false });

  useEffect(() => {
    setState((s) => (s.rect === null && !s.missing ? s : { rect: null, missing: false }));
    if (!selector || !enabled) return;

    let el: Element | null = null;
    let frame = 0;
    let timer = 0;
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    let live = true;

    const measure = () => {
      frame = 0;
      if (!live || !el) return;
      if (!el.isConnected) {
        // the module re-rendered: look again
        el = null;
        find();
        return;
      }
      const rect = rectOf(el);
      setState((s) => (same(s.rect, rect) && !s.missing ? s : { rect, missing: false }));
    };
    const schedule = () => {
      if (frame === 0 && live) frame = requestAnimationFrame(measure);
    };

    const found = (target: Element) => {
      el = target;
      window.clearTimeout(timer);
      mo?.disconnect();
      mo = null;
      try {
        target.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      } catch {
        /* jsdom and old engines */
      }
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(schedule);
        ro.observe(target);
        ro.observe(document.documentElement);
      }
      measure();
    };

    function find(): boolean {
      let target: Element | null = null;
      try {
        target = document.querySelector(selector!);
      } catch {
        target = null;
      }
      if (target) {
        found(target);
        return true;
      }
      return false;
    }

    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);

    if (!find()) {
      mo = new MutationObserver(() => {
        if (find()) mo?.disconnect();
      });
      mo.observe(document.body, { childList: true, subtree: true });
      timer = window.setTimeout(() => {
        mo?.disconnect();
        if (live && !el) setState({ rect: null, missing: true });
      }, ANCHOR_WAIT_MS);
    }

    return () => {
      live = false;
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [selector, enabled]);

  return state;
}
