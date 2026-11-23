export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

type MatchMedia = (query: string) => { matches: boolean };

/** True when the viewer asked for reduced motion. Safe where matchMedia is missing (false). */
export function prefersReducedMotion(
  mm: MatchMedia = (q) =>
    (globalThis as unknown as { matchMedia(q: string): { matches: boolean } }).matchMedia(q),
): boolean {
  try {
    return mm(REDUCED_MOTION_QUERY).matches === true;
  } catch {
    return false;
  }
}

/**
 * Token `motion.reducedMotion` = "all off": under the media query every CSS transition and
 * animation (including the sky drift) is off. The number roll and springs check
 * `prefersReducedMotion()` themselves. Include this once at the app entry.
 */
export const reducedMotionCss = `@media ${REDUCED_MOTION_QUERY} {
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
    scroll-behavior: auto !important;
  }
}
`;
