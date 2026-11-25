import { useId, type ReactNode } from 'react';
import { fmt } from '../../format';
import { cssVar, defaultTheme, type TokenPath } from '../../tokens';
import { GaugeStyles } from './GaugeStyles';
import {
  GAUGE,
  MAJOR_EVERY,
  angleAt,
  arcPath,
  isNum,
  p1,
  polar,
  tickValues,
  type Maybe,
} from './geometry';
import { useTween } from './useTween';

type ColorKey = 'ink' | 'ink3' | 'track' | 'accent' | 'accent2';
const c = (k: ColorKey) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];

export interface GaugeLabels {
  /** Words on the marks and in the tooltips; numbers always come from props. */
  net?: string;
  bar?: string;
  target?: string;
  scale?: string;
}
const DEFAULT_LABELS: Required<GaugeLabels> = {
  net: 'Net savings',
  bar: 'Bar',
  target: 'Target',
  scale: 'Scale',
};

export interface GaugeProps {
  /** res.net, $M: the gradient fill runs from 0 to here. */
  net: Maybe;
  /** res.bar, $M: the solid notch. */
  bar: Maybe;
  /** g.target_net (target ex-growth), $M: the dotted notch. */
  target: Maybe;
  /** Scale max, $M, from tier 2. The arc spans 0..max; ticks every 20, labels 0 and max. */
  max: Maybe;
  /** Centre slot over the arc: hero number, "of $X bar", status chip. */
  children?: ReactNode;
  labels?: GaugeLabels;
  /** Overrides the spoken summary built from the props. */
  ariaLabel?: string;
  className?: string;
}

/** Scale numbers print as whole numbers, like the prototype ("Bar 143", "0", "180"). */
const whole = (v: Maybe) => fmt.fte(v);

/**
 * Gauge (#16, `gauge`): 270° arc, gradient fill for net, solid bar notch, dotted target notch,
 * ticks every 20, labels 0 and max. The fill tweens (motion.roll) and jumps under reduced motion.
 * Every mark carries a `data-tip` for the shared tooltip. Values arrive as props (ADR-018).
 */
export function Gauge({
  net,
  bar,
  target,
  max,
  children,
  labels,
  ariaLabel,
  className,
}: GaugeProps) {
  const L = { ...DEFAULT_LABELS, ...labels };
  const gradId = `gp-gauge-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const hasScale = isNum(max) && max > 0;
  const end = GAUGE.start + GAUGE.sweep;
  const scaleText = hasScale ? `${whole(0)} to ${whole(max)}` : fmt.fte(null);
  const summary =
    ariaLabel ??
    `${L.net} ${fmt.money(net)} against a bar of ${fmt.money(bar)}; ` +
      `${L.target.toLowerCase()} ${fmt.money(target)}; ${L.scale.toLowerCase()} ${scaleText}`;

  const [x0, y0] = polar(GAUGE.r, GAUGE.start);
  const [x1, y1] = polar(GAUGE.r, end);

  return (
    <div className={className ? `gp-gauge ${className}` : 'gp-gauge'}>
      <GaugeStyles />
      <svg className="gp-gauge-svg" viewBox={GAUGE.viewBox} role="img" aria-label={summary}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor={c('accent2')} />
            <stop offset="1" stopColor={c('accent')} />
          </linearGradient>
        </defs>
        <g className="gp-gauge-ticks" aria-hidden="true">
          {tickValues(max).map((t, i) => {
            const major = i % MAJOR_EVERY === 0;
            const a = angleAt(t, max);
            const [ax, ay] = polar(GAUGE.r + GAUGE.tickIn, a);
            const [bx, by] = polar(GAUGE.r + (major ? GAUGE.tickMajor : GAUGE.tickMinor), a);
            return (
              <line
                key={t}
                x1={p1(ax)}
                y1={p1(ay)}
                x2={p1(bx)}
                y2={p1(by)}
                stroke={c('ink3')}
                strokeWidth={major ? GAUGE.tickWidthMajor : GAUGE.tickWidthMinor}
                opacity={GAUGE.tickOpacity}
                data-major={major}
              />
            );
          })}
        </g>
        <g data-mark="track" data-tip={`${L.scale} ${scaleText}`}>
          <path
            d={arcPath(GAUGE.r, GAUGE.start, end)}
            stroke={c('track')}
            strokeWidth={GAUGE.stroke}
            strokeLinecap="round"
            fill="none"
          />
        </g>
        {hasScale && (
          <NetFill net={net} max={max} gradId={gradId} tip={`${L.net} ${fmt.money(net)}`} />
        )}
        {hasScale && isNum(target) && (
          <Notch
            kind="target"
            value={target}
            max={max}
            text={`${L.target} ${whole(target)}`}
            tip={`${L.target} ${fmt.money(target)}`}
          />
        )}
        {hasScale && isNum(bar) && (
          <Notch
            kind="bar"
            value={bar}
            max={max}
            text={`${L.bar} ${whole(bar)}`}
            tip={`${L.bar} ${fmt.money(bar)}`}
          />
        )}
        <text
          data-label="min"
          x={p1(x0 - GAUGE.endLabelDx)}
          y={p1(y0 + GAUGE.endLabelDy)}
          textAnchor="middle"
          aria-hidden="true"
        >
          {whole(0)}
        </text>
        {hasScale && (
          <text
            data-label="max"
            x={p1(x1 + GAUGE.endLabelDx)}
            y={p1(y1 + GAUGE.endLabelDy)}
            textAnchor="middle"
            aria-hidden="true"
          >
            {whole(max)}
          </text>
        )}
      </svg>
      {children != null && <div className="gp-gauge-center">{children}</div>}
    </div>
  );
}

/** The net fill: its own component so only it re-renders while the tween runs. */
function NetFill({
  net,
  max,
  gradId,
  tip,
}: {
  net: Maybe;
  max: number;
  gradId: string;
  tip: string;
}) {
  const shown = useTween(net);
  if (!isNum(net) || net <= 0 || shown === null) return null;
  return (
    <g data-mark="net" data-tip={tip} data-shown={shown}>
      <path
        className="gp-gauge-fill"
        d={arcPath(GAUGE.r, GAUGE.start, angleAt(shown, max))}
        stroke={`url(#${gradId})`}
        strokeWidth={GAUGE.stroke}
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}

interface NotchProps {
  kind: 'bar' | 'target';
  value: number;
  max: number;
  text: string;
  tip: string;
}

/** A notch across the track with its label outside: bar solid, target dotted (moodboard Charts). */
function Notch({ kind, value, max, text, tip }: NotchProps) {
  const strong = kind === 'bar';
  const a = angleAt(value, max);
  const [x0, y0] = polar(GAUGE.r - GAUGE.notchHalf, a);
  const [x1, y1] = polar(GAUGE.r + GAUGE.notchHalf, a);
  const [tx, ty] = polar(GAUGE.r + GAUGE.notchLabel, a);
  const line = { x1: p1(x0), y1: p1(y0), x2: p1(x1), y2: p1(y1) };
  return (
    <g data-mark={kind} data-tip={tip}>
      <line className="gp-gauge-hit" {...line} strokeWidth={GAUGE.hitWidth} />
      <line
        className="gp-gauge-notch"
        {...line}
        stroke={c('ink')}
        strokeWidth={strong ? GAUGE.barWidth : GAUGE.targetWidth}
        strokeLinecap="round"
        strokeDasharray={strong ? undefined : GAUGE.targetDash}
      />
      <text
        x={p1(tx)}
        y={p1(ty + GAUGE.labelNudge)}
        textAnchor="middle"
        className={strong ? 'gp-t-ink' : undefined}
        aria-hidden="true"
      >
        {text}
      </text>
    </g>
  );
}
