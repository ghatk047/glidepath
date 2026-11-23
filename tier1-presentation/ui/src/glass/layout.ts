import { breakpoints, tokenValue } from '../tokens';

/** Column spans used by the screens (prototype `.c3` … `.c12`). */
export const SPANS = [3, 4, 5, 6, 7, 8, 9, 12] as const;
export type Span = (typeof SPANS)[number];

/** Columns of the grid, from tokens (space.gridColumns). */
export const GRID_COLUMNS = Number(tokenValue['space.gridColumns']);

export type Viewport = 'desktop' | 'tablet' | 'phone';

/** Viewport class for a width in CSS px, using the token breakpoints (max-width semantics). */
export function viewportFor(width: number): Viewport {
  if (width <= breakpoints.phone) return 'phone';
  if (width <= breakpoints.tablet) return 'tablet';
  return 'desktop';
}

const HALF = GRID_COLUMNS / 2;
const QUARTER = GRID_COLUMNS / 4;

/**
 * Columns a cell spans at each viewport. Below the tablet breakpoint, quarter-width tiles
 * become half width (6) and everything else full width (12); below the phone breakpoint the
 * grid is one column, so every cell stacks. The CSS in `styles.ts` is generated from this.
 */
export function spanAt(span: Span, viewport: Viewport): number {
  if (viewport === 'desktop') return span;
  if (viewport === 'phone') return GRID_COLUMNS;
  return span <= QUARTER ? HALF : GRID_COLUMNS;
}
