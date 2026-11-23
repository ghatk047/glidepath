/**
 * Display axis of the Adjusted EPS bars (not a business number): gridlines every half dollar,
 * the axis ends rounded up to a gridline so no bar touches the edge. Layout geometry only;
 * the bar values are the session's.
 */
export const EPS_TICK = 0.5;

const isNum = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

export interface EpsAxis {
  readonly lo: number;
  readonly hi: number;
  readonly ticks: readonly number[];
}

/** Axis for the bars on screen: from the lowest gridline under the data to the highest over it. */
export function epsAxis(values: readonly (number | null | undefined)[]): EpsAxis {
  const shown = values.filter(isNum);
  const top = Math.max(0, ...shown);
  const bottom = Math.min(0, ...shown);
  const hi = Math.max(EPS_TICK, Math.ceil(top / EPS_TICK) * EPS_TICK);
  const lo = Math.min(-EPS_TICK, Math.floor(bottom / EPS_TICK) * EPS_TICK);
  const ticks: number[] = [];
  for (let t = hi; t >= lo - 1e-9; t -= EPS_TICK) ticks.push(Math.round(t * 100) / 100);
  return { lo, hi, ticks };
}

/** Position of `v` on the axis in percent from the top. */
export const topPct = (v: number, axis: EpsAxis): number =>
  ((axis.hi - v) / (axis.hi - axis.lo)) * 100;
