import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useGlassQuality } from '../glass';
import { prefersReducedMotion } from '../motion';
import { computeCss } from './styles';
import { COMPUTE_GLYPHS, WAVE_HEIGHT, WAVE_WIDTH, wavePath } from './wave';

export interface ComputeFlowProps {
  /** false renders nothing. */
  active: boolean;
  /** inline: panel header or tape; field: fills its box. */
  variant?: 'inline' | 'field';
  /** 0..1 exactly as tier 2 sent it; brightens the glyph layer. null or undefined: indeterminate. */
  progress?: number | null;
  /** Force the static rendering. */
  still?: boolean;
  className?: string;
}

/** Per wave: cycles, amplitude, duration multiplier of motion.flash, tone, direction. */
const WAVES = [
  { cycles: 2, amp: 12, w: 5, tone: 'a', dir: 'l' },
  { cycles: 3, amp: 8, w: 7, tone: 'b', dir: 'r' },
  { cycles: 5, amp: 5, w: 4, tone: 'c', dir: 'l' },
  { cycles: 4, amp: 10, w: 6, tone: 'b', dir: 'r' },
] as const;
const COUNTS = { inline: { waves: 3, glyphs: 6 }, field: { waves: 4, glyphs: 12 } } as const;
const STILL_GLYPHS = [0, 2, 4];

/** Fixed horizontal slot per glyph index, spread across the box. */
const glyphLeft = (i: number, n: number) => `${(((i * 5 + 1) % n) / n) * 88 + 4}%`;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function ComputeFlow({
  active,
  variant = 'inline',
  progress = null,
  still = false,
  className,
}: ComputeFlowProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(true);
  const lowGlass = useGlassQuality() === 'low';
  const motion = still || lowGlass || prefersReducedMotion() ? 'still' : 'on';

  useEffect(() => {
    const el = ref.current;
    const IO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    if (!active || !el || !IO) return;
    const io = new IO((entries) => {
      const last = entries[entries.length - 1];
      if (last) setVisible(last.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [active]);

  if (!active) return null;

  const { waves, glyphs } = COUNTS[variant];
  const p = typeof progress === 'number' && Number.isFinite(progress) ? clamp01(progress) : null;
  const rootStyle = p === null ? undefined : ({ '--gp-p': p } as CSSProperties);

  return (
    <>
      <style href="glidepath-compute" precedence="glidepath">
        {computeCss}
      </style>
      <span
        ref={ref}
        className={className ? `gp-compute ${className}` : 'gp-compute'}
        data-compute=""
        data-variant={variant}
        data-motion={motion}
        data-visible={visible ? 'true' : 'false'}
        aria-hidden="true"
        style={rootStyle}
      >
        {WAVES.slice(0, waves).map((w, i) => {
          const d = wavePath(w.cycles, w.amp);
          return (
            <i
              key={i}
              className="gp-compute-wave"
              data-tone={w.tone}
              data-dir={w.dir}
              data-still={i === 0 ? '' : undefined}
              style={{ '--w': w.w } as CSSProperties}
            >
              <svg viewBox={`0 0 ${WAVE_WIDTH * 2} ${WAVE_HEIGHT}`} preserveAspectRatio="none">
                <path d={d} />
                <path d={d} transform={`translate(${WAVE_WIDTH} 0)`} />
              </svg>
            </i>
          );
        })}
        <span className="gp-compute-glyphs">
          {Array.from({ length: glyphs }, (_, i) => (
            <b
              key={i}
              data-still={STILL_GLYPHS.includes(i) ? '' : undefined}
              style={{ left: glyphLeft(i, glyphs), '--i': i } as CSSProperties}
            >
              {COMPUTE_GLYPHS[i % COMPUTE_GLYPHS.length]}
            </b>
          ))}
        </span>
      </span>
    </>
  );
}
