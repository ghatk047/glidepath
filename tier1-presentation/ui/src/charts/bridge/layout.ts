/**
 * Bridge geometry: d3 scales over the extents tier 2 sends (CON-02 `bridge` view). Layout only:
 * every bar runs from `scale(step.from)` to `scale(step.to)`; nothing here adds, nets or derives a
 * business value. Pixel positions are in the SVG's own user units (the prototype's 640 × 300
 * viewBox, docs/ux/prototype/src/core.js `waterfall`), so the chart scales with its panel.
 */
import type { BridgeView } from '@glidepath/api-contract';
import { extent, tickStep } from 'd3-array';
import { scaleBand, scaleLinear, type ScaleBand, type ScaleLinear } from 'd3-scale';

export type BridgeStep = BridgeView['steps'][number];
export type BridgeStepKey = BridgeStep['key'];

/** Display order of the five steps (the contract's tuple order). */
export const BRIDGE_STEP_KEYS = ['base', 'growth', 'savings', 'oneTime', 'outlay'] as const;
/** Steps that are levels standing on the axis floor; the others float between them. */
const LEVEL_KEYS: ReadonlySet<BridgeStepKey> = new Set(['base', 'outlay']);
export const isLevelStep = (key: BridgeStepKey) => LEVEL_KEYS.has(key);

/** SVG user-unit box (prototype `W`, `H`). */
export const BRIDGE_VIEWBOX = { width: 640, height: 300 } as const;
/** Plot area inside the box: room for axis labels left, value labels above, categories below. */
export const BRIDGE_PLOT = { left: 46, right: 628, top: 26, bottom: 260 } as const;
/** Gridline / axis label count hint for d3 `ticks()`. */
export const BRIDGE_TICK_COUNT = 5;
/** Band padding: the prototype's 64-unit bars with 57-unit gaps and a 0.3-gap inset. */
const BAND_PADDING_INNER = 0.47;
const BAND_PADDING_OUTER = 0.14;
/** A zero-height step still shows as a sliver. */
export const MIN_BAR_HEIGHT = 2;

/** Offsets (user units) for direct labels and marks, from the prototype. */
export const BRIDGE_OFFSETS = {
  valueLabel: 8,
  categoryLabel: 18,
  targetLabel: 17,
  tickLabel: 8,
  tickBaseline: 4,
  bracketInset: 6,
  breakInset: 6,
  bracketArm: 5,
} as const;

export type BridgeDomain = readonly [number, number];

/**
 * Default value axis: the d3 `nice(BRIDGE_TICK_COUNT)` extent of everything the chart plots (each step's `to`, the
 * floating steps' `from`, the target outlay), with the floor pulled down one d3 tick step so the
 * level bars rise visibly above the axis break. Level steps' `from` (the zero they stand on) is
 * below the break and does not set the axis. The web panel shows `domain[0]` as "axis starts at".
 */
export function bridgeDomain(view: Pick<BridgeView, 'steps' | 'targetOutlay'>): BridgeDomain {
  const plotted = view.steps.flatMap((s) => (isLevelStep(s.key) ? [s.to] : [s.from, s.to]));
  const [min, max] = extent([...plotted, view.targetOutlay]);
  if (min === undefined || max === undefined) return [0, 1];
  const [lo, hi] = scaleLinear().domain([min, max]).nice(BRIDGE_TICK_COUNT).domain() as [
    number,
    number,
  ];
  const step = tickStep(lo, hi, BRIDGE_TICK_COUNT);
  return Number.isFinite(step) && step > 0 ? [lo - step, hi] : [lo, hi];
}

export interface BarGeometry {
  step: BridgeStep;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Centre of the bar (direct labels). */
  cx: number;
  /** Screen y of `step.to`: where the next connector starts. */
  yTo: number;
}

export interface BridgeGeometry {
  y: ScaleLinear<number, number>;
  x: ScaleBand<BridgeStepKey>;
  bars: BarGeometry[];
  ticks: number[];
  /** Screen y of the target outlay line. */
  yTarget: number;
}

/** Scales and bar rectangles for a bridge view on a domain. */
export function bridgeGeometry(
  view: Pick<BridgeView, 'steps' | 'targetOutlay'>,
  domain: BridgeDomain,
): BridgeGeometry {
  const y = scaleLinear()
    .domain([domain[0], domain[1]])
    .range([BRIDGE_PLOT.bottom, BRIDGE_PLOT.top])
    .clamp(true);
  const x = scaleBand<BridgeStepKey>()
    .domain(BRIDGE_STEP_KEYS)
    .range([BRIDGE_PLOT.left, BRIDGE_PLOT.right])
    .paddingInner(BAND_PADDING_INNER)
    .paddingOuter(BAND_PADDING_OUTER);
  const width = x.bandwidth();
  const bars = view.steps.map((step): BarGeometry => {
    const y0 = y(step.from);
    const y1 = y(step.to);
    const top = Math.min(y0, y1);
    const left = x(step.key) ?? BRIDGE_PLOT.left;
    return {
      step,
      x: left,
      y: top,
      width,
      height: Math.max(MIN_BAR_HEIGHT, Math.abs(y0 - y1)),
      cx: left + width / 2,
      yTo: y1,
    };
  });
  const ticks = y.ticks(BRIDGE_TICK_COUNT).filter((t) => t >= domain[0] && t <= domain[1]);
  return { y, x, bars, ticks, yTarget: y(view.targetOutlay) };
}
