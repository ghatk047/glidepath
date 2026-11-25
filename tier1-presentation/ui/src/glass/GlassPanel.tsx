import { useId, useState, type HTMLAttributes, type ReactNode } from 'react';
import type { GlassLevel } from './budget';
import { useGlassBlur, useGlassQuality } from './GlassProvider';
import type { Span } from './layout';
import { PanelSkeleton } from './Skeleton';

export interface GlassPanelHeader {
  /** Small mono noun, e.g. "Net savings · CY27". Names the panel region. */
  label: ReactNode;
  /** Right-hand status chip area: status chip, job progress, error or stale chip, actions. */
  status?: ReactNode;
  /** Element for the label. Default h2. */
  labelAs?: 'h2' | 'h3' | 'h4' | 'span';
}

export interface GlassPanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /**
   * Glass level (moodboard glass recipe): 1 = panel (glass-2 → glass), 2 = raised surface
   * (glass-3 → glass-2), 3 = overlay such as popover, palette, drawer, tooltip (glass-3).
   */
  level?: GlassLevel;
  header?: GlassPanelHeader;
  /** Grid columns at desktop width (see Grid). */
  span?: Span;
  /** Panel padding: panel tokens (22/24), tight (16/18) or none. */
  padding?: 'panel' | 'tight' | 'none';
  /** Loading: header stays, body shows skeletons at 40%, aria-busy is set. Never a spinner. */
  loading?: boolean;
  /** Skeleton layout to show while loading (default: hero + two lines). */
  skeleton?: ReactNode;
  as?: 'section' | 'div' | 'article' | 'aside';
  children?: ReactNode;
}

export function GlassPanel({
  level = 1,
  header,
  span,
  padding = 'panel',
  loading = false,
  skeleton,
  as: Tag = 'section',
  className,
  children,
  ...rest
}: GlassPanelProps) {
  const blurred = useGlassBlur(level);
  const quality = useGlassQuality();
  const labelId = useId();
  // numbers fade in once evaluated: reveal only on a loading -> loaded transition
  const [prevLoading, setPrevLoading] = useState(loading);
  const [reveal, setReveal] = useState(false);
  if (prevLoading !== loading) {
    setPrevLoading(loading);
    setReveal(prevLoading && !loading);
  }

  const cls = ['gp-panel', span ? `gp-span-${span}` : null, className].filter(Boolean).join(' ');
  const Label = header?.labelAs ?? 'h2';

  return (
    <Tag
      {...rest}
      className={cls}
      data-level={level}
      data-blur={blurred ? 'on' : 'off'}
      data-quality={quality}
      data-pad={padding}
      aria-busy={loading || undefined}
      aria-labelledby={header ? labelId : rest['aria-labelledby']}
    >
      {header && (
        <header className="gp-panel-h">
          <Label id={labelId} className="gp-label">
            {header.label}
          </Label>
          <div className="gp-panel-status" aria-live="polite">
            {header.status}
          </div>
        </header>
      )}
      <div className="gp-body" data-reveal={reveal || undefined}>
        {loading ? (skeleton ?? <PanelSkeleton />) : children}
      </div>
    </Tag>
  );
}
