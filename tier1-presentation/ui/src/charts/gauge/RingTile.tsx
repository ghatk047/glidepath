import type { ReactNode } from 'react';
import { fmt } from '../../format';
import { cssVar, defaultTheme, type TokenPath } from '../../tokens';
import { GaugeStyles } from './GaugeStyles';
import { RING, isNum, p1, ringFraction, type Maybe } from './geometry';

const seriesPath = (i: number) => `themes.${defaultTheme}.color.series.${i}` as TokenPath;

/** Number of VP colour slots in the reference palette (tokens `color.series`). */
export const VP_SLOTS = Object.keys(cssVar).filter((k) =>
  k.startsWith(`themes.${defaultTheme}.color.series.`),
).length;

/**
 * VP colour by slot order (07_frontend §4, moodboard Colour): slot 0 is the first VP, slot 4 the
 * fifth (magenta). Colour follows the VP's slot, never its rank. Slots past the palette wrap.
 */
export function vpColour(slot: number): string {
  const i = ((Math.trunc(slot) % VP_SLOTS) + VP_SLOTS) % VP_SLOTS;
  return cssVar[seriesPath(i)];
}

/**
 * Text drawn on a VP colour is white or black, whichever reads better (G12: 4.5:1 for small text).
 * A colour with perceptual lightness (OKLCH L) under the cut takes white, any other black. The cut
 * sits between the palette's slots that need white and those that need black in both themes
 * (`e2e/a11y` checks every screen with axe).
 */
export const ON_SERIES_LIGHTNESS_CUT = 0.55;

/** CSS colour for text on `series` (a CSS colour such as `vpColour(slot)`). */
export const onSeriesText = (series: string): string =>
  `oklch(from ${series} calc((${ON_SERIES_LIGHTNESS_CUT} - l) * 1000) 0 0)`;

/** Text colour for text on the VP in `slot` (see `onSeriesText`). */
export const vpTextColour = (slot: number): string => onSeriesText(vpColour(slot));

export interface RingTileProps {
  /** The VP's net, $M (e.g. `res.vp_net` for that VP). */
  value: Maybe;
  /** What the ring fills towards, $M: the VP's bar. */
  max: Maybe;
  /** A VP slot (0-based, colour by slot order) or a CSS colour token such as `var(--accent)`. */
  colour: number | string;
  /** VP name for the tooltip and the spoken label. */
  label?: string;
  /** Word after max in the tooltip ("bar"). */
  maxLabel?: string;
  /** Pixel box of the ring in SVG units (prototype 64). */
  size?: number;
  /** Side content: the VP's net and "of $X bar". Laid out in a ring row. */
  children?: ReactNode;
  className?: string;
}

/**
 * Ring tile (#17, `ring`): VP net against its bar, the percentage in the centre, arc in the VP
 * colour. The arc transitions (motion.roll) and stops under reduced motion. Values arrive as props.
 */
export function RingTile({
  value,
  max,
  colour,
  label,
  maxLabel = 'bar',
  size = RING.size,
  children,
  className,
}: RingTileProps) {
  const stroke = typeof colour === 'number' ? vpColour(colour) : colour;
  const half = size / 2;
  const r = half - RING.stroke;
  const circ = 2 * Math.PI * r;
  const fill = ringFraction(value, max);
  // The centre shows the share as given (an over-bar VP reads above 100%); the arc clamps.
  const share = isNum(value) && isNum(max) && max > 0 ? value / max : null;
  const pct = fmt.pct(share, { digits: 0 });
  const tip = `${label ? `${label}: ` : ''}${fmt.money(value)} of ${fmt.money(max)} ${maxLabel} · ${pct}`;

  const ring = (
    <svg
      className={children == null && className ? `gp-ring ${className}` : 'gp-ring'}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={tip}
    >
      <circle
        cx={half}
        cy={half}
        r={r}
        fill="none"
        stroke={cssVar[`themes.${defaultTheme}.color.track` as TokenPath]}
        strokeWidth={RING.stroke}
      />
      <circle
        className="gp-ring-arc"
        data-tip={tip}
        cx={half}
        cy={half}
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth={RING.stroke}
        strokeLinecap="round"
        strokeOpacity={fill > 0 ? 1 : 0}
        strokeDasharray={`${p1(circ * fill)} ${p1(circ)}`}
        transform={`rotate(-90 ${half} ${half})`}
      />
      <text
        className="gp-ring-pct"
        x="50%"
        y={RING.textY}
        textAnchor="middle"
        dominantBaseline="middle"
        aria-hidden="true"
      >
        {pct}
      </text>
    </svg>
  );

  return (
    <>
      <GaugeStyles />
      {children == null ? (
        ring
      ) : (
        <div className={className ? `gp-ring-row ${className}` : 'gp-ring-row'}>
          {ring}
          {children}
        </div>
      )}
    </>
  );
}
