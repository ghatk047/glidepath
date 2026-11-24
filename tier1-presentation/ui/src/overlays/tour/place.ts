/** Viewport-pixel rectangle of the element a tour step points at. */
export interface TourRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The side of the target the card prefers to sit on. */
export type TourPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface CardPlacement {
  top: number;
  left: number;
  /** The side actually used; `center` when no side fits or there is no target. */
  placement: TourPlacement | 'center';
}

interface Size {
  width: number;
  height: number;
}

const OPPOSITE: Record<TourPlacement, TourPlacement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

const CROSS: Record<TourPlacement, [TourPlacement, TourPlacement]> = {
  top: ['right', 'left'],
  bottom: ['right', 'left'],
  left: ['bottom', 'top'],
  right: ['bottom', 'top'],
};

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(n, Math.max(lo, hi)));

/**
 * Where the coachmark goes. Pure. Tries the preferred side, then the opposite side, then the
 * other axis (two sides), then the centre of the viewport. A side fits when the card sits fully
 * between the target and the viewport edge; the cross axis is centred on the target and clamped
 * so the card never leaves the viewport. A `null` target centres the card.
 */
export function placeCard(
  target: TourRect | null,
  card: Size,
  viewport: Size,
  preferred: TourPlacement,
  gap: number,
): CardPlacement {
  const centre: CardPlacement = {
    top: Math.max(0, (viewport.height - card.height) / 2),
    left: Math.max(0, (viewport.width - card.width) / 2),
    placement: 'center',
  };
  if (!target) return centre;

  const margin = Math.min(gap, Math.max(0, (viewport.width - card.width) / 2));
  const marginY = Math.min(gap, Math.max(0, (viewport.height - card.height) / 2));
  const midX = target.left + target.width / 2 - card.width / 2;
  const midY = target.top + target.height / 2 - card.height / 2;
  const right = target.left + target.width;
  const bottom = target.top + target.height;

  const tryside = (side: TourPlacement): CardPlacement | null => {
    switch (side) {
      case 'top': {
        const top = target.top - gap - card.height;
        return top >= 0
          ? { top, left: clamp(midX, margin, viewport.width - card.width - margin), placement: side }
          : null;
      }
      case 'bottom': {
        const top = bottom + gap;
        return top + card.height <= viewport.height
          ? { top, left: clamp(midX, margin, viewport.width - card.width - margin), placement: side }
          : null;
      }
      case 'left': {
        const left = target.left - gap - card.width;
        return left >= 0
          ? { left, top: clamp(midY, marginY, viewport.height - card.height - marginY), placement: side }
          : null;
      }
      case 'right': {
        const left = right + gap;
        return left + card.width <= viewport.width
          ? { left, top: clamp(midY, marginY, viewport.height - card.height - marginY), placement: side }
          : null;
      }
    }
  };

  const order: TourPlacement[] = [preferred, OPPOSITE[preferred], ...CROSS[preferred]];
  for (const side of order) {
    const hit = tryside(side);
    if (hit) return hit;
  }
  return centre;
}
