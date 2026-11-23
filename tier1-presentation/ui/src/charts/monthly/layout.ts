/**
 * Monthly curve geometry: d3 scales over the series tier 2 sends (CON-02 `levers.monthly` view).
 * Layout only. Tier 2 already summed each family per month and each lever's own series; the one
 * accumulation here is the stacking baseline an area chart needs (each band sits on the bands
 * below it). Nothing nets, averages or derives a business value. Pixel positions are SVG user
 * units in the prototype's 300 x 200 viewBox (docs/ux/prototype/src/views.js `areaChart`).
 */
import type { LeversMonthlyView } from '@glidepath/api-contract';
import { max, tickStep } from 'd3-array';
import { scaleLinear, type ScaleLinear } from 'd3-scale';

export type MonthlyFamily = LeversMonthlyView['families'][number];
export type MonthlyLever = LeversMonthlyView['levers'][number];

/** SVG user-unit box (prototype `W`, `H`). */
export const MONTHLY_VIEWBOX = { width: 300, height: 200 } as const;
/** Plot area: room for axis labels left, the month letters below (prototype `L`, `T`, `B`, `Rr`). */
export const MONTHLY_PLOT = { left: 28, right: 294, top: 10, bottom: 178 } as const;
/** Gridline count hint for d3 `ticks()` / `nice()` (the prototype draws four intervals). */
export const MONTHLY_TICK_COUNT = 4;
/** Offsets (user units) for labels and marks, from the prototype. */
export const MONTHLY_OFFSETS = {
  tickLabel: 6,
  tickBaseline: 4,
  monthLabel: 8,
  familyLabelInset: 4,
  familyLabelBaseline: 4,
  endDotRadius: 4,
} as const;
/** Family colour slots, cycled by family order (prototype: seq-3, seq-2, accent). */
export const MONTHLY_SLOTS = 3;
/** Month letters under the axis and month names in tooltips; calendar labels, not business data. */
export const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'] as const;
export const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export type MonthlyDomain = readonly [number, number];

export interface StackedBand {
  family: MonthlyFamily;
  /** Colour slot (0 .. MONTHLY_SLOTS - 1): the CSS maps it to a token. */
  slot: number;
  /** Per month: where the band starts and ends on the value axis (stack baseline, then top). */
  lower: number[];
  upper: number[];
}

/** Stack the families in the order tier 2 sent them: each band's lower edge is the one below's top. */
export function stackFamilies(families: readonly MonthlyFamily[]): StackedBand[] {
  let below: number[] = [];
  return families.map((family, i): StackedBand => {
    const lower = below.length ? below : family.values.map(() => 0);
    const upper = family.values.map((v, m) => lower[m]! + v);
    below = upper;
    return { family, slot: i % MONTHLY_SLOTS, lower, upper };
  });
}

/**
 * Default value axis: d3 `nice(MONTHLY_TICK_COUNT)` from zero to the highest plotted value (top
 * of the stack, or the selected lever's own line). Pass `domain` to fix the axis instead.
 */
export function monthlyDomain(
  view: Pick<LeversMonthlyView, 'families'>,
  selected?: Pick<MonthlyLever, 'values'> | null,
): MonthlyDomain {
  const tops = stackFamilies(view.families).flatMap((b) => b.upper);
  const hi = max([...tops, ...(selected?.values ?? [])]);
  if (hi === undefined || !Number.isFinite(hi) || hi <= 0) return [0, 1];
  const [lo, top] = scaleLinear().domain([0, hi]).nice(MONTHLY_TICK_COUNT).domain() as [
    number,
    number,
  ];
  return [lo, top];
}

export interface MonthlyBandGeometry extends StackedBand {
  /** Closed outline: along the top edge, back along the baseline. */
  path: string;
  /** Screen y of the band's right-edge middle (direct label). */
  labelY: number;
}

export interface MonthlyGeometry {
  x: ScaleLinear<number, number>;
  y: ScaleLinear<number, number>;
  ticks: number[];
  /** Decimal places the tick labels need (0 unless the tick step is fractional). */
  tickDigits: number;
  bands: MonthlyBandGeometry[];
  /** Selected lever: its line path and the end dot (last month). */
  line: { path: string; endX: number; endY: number } | null;
}

/** Path coordinates to one decimal (user units). */
const r1 = (n: number) => Math.round(n * 10) / 10;
const pt = (x: number, y: number) => `${r1(x)} ${r1(y)}`;

/** Scales, area outlines and the selected line for a view on a domain. */
export function monthlyGeometry(
  view: Pick<LeversMonthlyView, 'families'>,
  selected: Pick<MonthlyLever, 'values'> | null,
  domain: MonthlyDomain,
): MonthlyGeometry {
  const months = view.families[0]?.values.length ?? selected?.values.length ?? 0;
  const x = scaleLinear()
    .domain([0, months > 1 ? months - 1 : 1])
    .range([MONTHLY_PLOT.left, MONTHLY_PLOT.right]);
  const y = scaleLinear()
    .domain([domain[0], domain[1]])
    .range([MONTHLY_PLOT.bottom, MONTHLY_PLOT.top])
    .clamp(true);
  const ticks = y.ticks(MONTHLY_TICK_COUNT).filter((t) => t >= domain[0] && t <= domain[1]);
  const step = tickStep(domain[0], domain[1], MONTHLY_TICK_COUNT);
  const fractional = Number.isFinite(step) && step > 0 && step < 1;
  const tickDigits = fractional ? (step < 0.01 ? 3 : step < 0.1 ? 2 : 1) : 0;

  const bands = stackFamilies(view.families).map((b): MonthlyBandGeometry => {
    const last = b.upper.length - 1;
    const along = b.upper.map((v, m) => `${m ? 'L' : 'M'}${pt(x(m), y(v))}`);
    const back = b.lower.map((v, m) => `L${pt(x(m), y(v))}`).reverse();
    return {
      ...b,
      path: `${along.join('')}${back.join('')}Z`,
      // direct label sits mid-band at the right edge
      labelY: last >= 0 ? (y(b.lower[last]!) + y(b.upper[last]!)) / 2 : MONTHLY_PLOT.bottom,
    };
  });

  const n = selected?.values.length ?? 0;
  const line =
    selected && n
      ? {
          path: selected.values.map((v, m) => `${m ? 'L' : 'M'}${pt(x(m), y(v))}`).join(''),
          endX: x(n - 1),
          endY: y(selected.values[n - 1]!),
        }
      : null;
  return { x, y, ticks, tickDigits, bands, line };
}
