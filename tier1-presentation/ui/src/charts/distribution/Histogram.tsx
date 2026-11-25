import { ChartStyles } from './ChartStyles';
import { isNum, plain } from './plain';

/** One precomputed bin: its span on the axis and its height value (a count or a density). */
export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

export interface HistogramProps {
  /**
   * Precomputed bins from tier 2 (the Monte Carlo sample array, binned there). Tier 1 does no
   * statistics: it scales the counts it is handed to the chart height and nothing else.
   */
  bins: readonly HistogramBin[];
  /** P10 / P50 / P90 of net, $M, from tier 2; printed under the axis. */
  p10: number | null | undefined;
  p50: number | null | undefined;
  p90: number | null | undefined;
  /** The bar in $M (`res.bar`): dashed line, and bins past it turn status green. */
  bar: number | null | undefined;
  /** Accessible name. */
  label?: string;
  /** viewBox width and height (the svg scales to its container; prototype 320 x 120). */
  width?: number;
  height?: number;
  className?: string;
}

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 120;
/** Side inset, bin gap, label band under the axis and the room kept above the tallest bin. */
const INSET = 4;
const BIN_GAP = 2;
const LABEL_BAND = 18;
const TOP_ROOM = 4;
const BIN_RADIUS = 2;
const LABEL_BASELINE = 4;
const BAR_LABEL_DX = 5;
const BAR_LABEL_Y = 10;
/** viewBox units the "Bar" label needs right of its line; less than that left and it flips. */
const BAR_LABEL_ROOM = 28;

/**
 * Histogram (`hist`, #21): bars from the bin array in props, a dashed bar line with its label,
 * bins past the bar in status green, and P10 / P50 / P90 labels under the axis.
 */
export function Histogram({
  bins,
  p10,
  p50,
  p90,
  bar,
  label = 'Distribution of net savings',
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  className,
}: HistogramProps) {
  const usable = bins.filter((b) => isNum(b.from) && isNum(b.to) && isNum(b.count));
  const first = usable[0];
  const last = usable[usable.length - 1];
  const cls = className ? `gp-chart ${className}` : 'gp-chart';

  if (!first || !last || !(last.to > first.from)) {
    return (
      <>
        <ChartStyles />
        <svg
          className={cls}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${label}: no data yet`}
          data-chart="histogram"
          data-empty="true"
        />
      </>
    );
  }

  const lo = first.from;
  const hi = last.to;
  const xs = (v: number) => {
    const x = ((width - 2 * INSET) * (v - lo)) / (hi - lo) + INSET;
    return Math.min(width - INSET, Math.max(INSET, x));
  };
  const top = Math.max(0, ...usable.map((b) => b.count));
  const plotH = height - LABEL_BAND - TOP_ROOM;
  const baseline = height - LABEL_BAND;
  const barX = isNum(bar) ? xs(bar) : null;

  const pLabels: [string, number | null | undefined][] = [
    ['P10', p10],
    ['P50', p50],
    ['P90', p90],
  ];
  const percentiles = pLabels.flatMap(([name, v]): [string, number][] =>
    isNum(v) ? [[name, v]] : [],
  );

  const summary = [
    ...percentiles.map(([name, v]) => `${name} ${plain(v, 0)}`),
    ...(isNum(bar) ? [`bar ${plain(bar, 0)}`] : []),
  ].join(', ');

  return (
    <>
      <ChartStyles />
      <svg
        className={cls}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        data-chart="histogram"
      >
        <title>{label}</title>
        <desc>{summary}</desc>
        {usable.map((b, i) => {
          const x0 = xs(b.from);
          const w = Math.max(1, xs(b.to) - x0 - BIN_GAP);
          const h = top > 0 ? (plotH * Math.max(0, b.count)) / top : 0;
          const clears = isNum(bar) && (b.from + b.to) / 2 >= bar;
          return (
            <rect
              key={i}
              className="gp-hist-bin"
              data-tone={clears ? 'pos' : 'base'}
              x={x0 + BIN_GAP / 2}
              y={baseline - h}
              width={w}
              height={h}
              rx={BIN_RADIUS}
            >
              <title>{`${plain(b.from, 0)} to ${plain(b.to, 0)}${clears ? ', past the bar' : ''}`}</title>
            </rect>
          );
        })}
        {barX !== null && (
          <g data-part="bar">
            <line className="gp-chart-ref" x1={barX} x2={barX} y1={0} y2={baseline} />
            {/* near the right edge the label sits left of the line, so it stays inside the panel */}
            <text
              className="gp-chart-ink2"
              x={barX > width - BAR_LABEL_ROOM ? barX - BAR_LABEL_DX : barX + BAR_LABEL_DX}
              y={BAR_LABEL_Y}
              textAnchor={barX > width - BAR_LABEL_ROOM ? 'end' : undefined}
            >
              Bar
            </text>
          </g>
        )}
        {percentiles.map(([name, v]) => (
          <text
            key={name}
            data-part="p-label"
            data-p={name}
            x={xs(v)}
            y={height - LABEL_BASELINE}
            textAnchor="middle"
          >
            {`${name} ${plain(v, 0)}`}
          </text>
        ))}
      </svg>
    </>
  );
}
