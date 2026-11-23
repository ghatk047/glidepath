import type { CSSProperties } from 'react';

export type SkeletonSize = 'label' | 'text' | 'mid' | 'big' | 'hero' | 'block';

export interface SkeletonProps {
  /** Type size the bar stands in for (its height is 1em of that token size), or a block. */
  size?: SkeletonSize;
  /** Width as a percentage of the container. */
  width?: `${number}%`;
  /** Aspect ratio of a block skeleton, e.g. "2 / 1" (charts). */
  ratio?: string;
  className?: string;
}

/**
 * A resting placeholder bar at 40% opacity (02_information_architecture §6). Static on
 * purpose: no shimmer, no spinner. Hidden from assistive tech; the panel says aria-busy.
 */
export function Skeleton({ size = 'text', width, ratio, className }: SkeletonProps) {
  const style: CSSProperties & Record<'--gp-skel-ratio', string | undefined> = {
    width,
    '--gp-skel-ratio': ratio,
  };
  return (
    <span
      className={className ? `gp-skel ${className}` : 'gp-skel'}
      data-size={size}
      aria-hidden="true"
      style={style}
    />
  );
}

/** The default loading body of a panel: label, hero number, one line. */
export function PanelSkeleton() {
  return (
    <>
      <Skeleton size="hero" width="55%" />
      <Skeleton size="text" width="80%" />
      <Skeleton size="text" width="40%" />
    </>
  );
}
