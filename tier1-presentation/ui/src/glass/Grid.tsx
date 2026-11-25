import type { HTMLAttributes, ReactNode } from 'react';
import type { Span } from './layout';

const join = (...xs: (string | false | undefined | null)[]) => xs.filter(Boolean).join(' ');

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/**
 * 12-column grid with the token gap. Cells (GridCell or GlassPanel with `span`) keep their
 * span at desktop, go 6/12 below 1180 px (quarter tiles to half, the rest full) and stack
 * below 760 px. See `spanAt` in layout.ts.
 */
export function Grid({ className, children, ...rest }: GridProps) {
  return (
    <div {...rest} className={join('gp-grid', className)}>
      {children}
    </div>
  );
}

export interface GridCellProps extends HTMLAttributes<HTMLDivElement> {
  span: Span;
  /** Stack children vertically with the token gap (e.g. two panels in one column). */
  stack?: boolean;
  children?: ReactNode;
}

export function GridCell({ span, stack, className, children, ...rest }: GridCellProps) {
  return (
    <div {...rest} className={join(`gp-span-${span}`, stack && 'gp-stack', className)}>
      {children}
    </div>
  );
}
