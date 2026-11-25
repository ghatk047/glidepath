import { prefersReducedMotion } from '../../motion';
import type { TourRect } from './place';
import { SPOTLIGHT_PAD_PX } from './styles';

export interface SpotlightProps {
  /** The target in viewport pixels; `null` draws nothing (a centred card has no hole). */
  rect: TourRect | null;
  /** Extra room around the target, in px. */
  pad?: number;
}

/**
 * One fixed element sized to the target with a very large spread shadow: the shadow is the
 * scrim, the element's own box is the hole. `pointer-events: none`, so the highlighted control
 * stays clickable. It moves with `transform`; the transition is off under reduced motion.
 */
export function Spotlight({ rect, pad = SPOTLIGHT_PAD_PX }: SpotlightProps) {
  if (!rect) return null;
  const reduced = prefersReducedMotion();
  return (
    <div
      className="gp-tour-spot"
      data-tour-spotlight=""
      aria-hidden="true"
      style={{
        width: rect.width + 2 * pad,
        height: rect.height + 2 * pad,
        transform: `translate(${rect.left - pad}px, ${rect.top - pad}px)`,
        ...(reduced ? { transition: 'none' } : null),
      }}
    />
  );
}
